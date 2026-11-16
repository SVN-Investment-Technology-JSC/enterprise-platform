import {
  inTransaction,
  type createPostgresPool,
  type PostgresClient,
} from '@enterprise-platform/adapter-database';
import { IdempotentInbox, PermanentMessageError } from '@enterprise-platform/adapter-events';
import {
  HRM_EMPLOYEE_OFFBOARDED,
  type HrmEmployeeOffboardedPayload,
  type IntegrationEventEnvelope,
} from '@enterprise-platform/contracts-integration';
import { revokeTenantUserSessions } from './identity-session-revocation.js';
import { TenantAuthorizationService } from './tenant-authorization.js';

type Pool = ReturnType<typeof createPostgresPool>;

/**
 * Core nhận sự kiện nghỉ việc của HRM (ISS-BE-020). HRM không ghi `core_schema`; hàng đợi này là nơi duy nhất vô hiệu
 * tài khoản và đóng bổ nhiệm khi nhân viên nghỉ việc.
 */
export const IDENTITY_INTEGRATION_QUEUE = 'identity.integrations.v1';
export const IDENTITY_INTEGRATION_BINDINGS: readonly string[] = [HRM_EMPLOYEE_OFFBOARDED];
/** Người thao tác ghi vào audit khi hệ thống tự làm theo sự kiện (không phải người dùng nào). */
export const OFFBOARDING_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export type EmployeeOffboardingOutcome =
  | { readonly status: 'duplicate' }
  | { readonly status: 'no-account'; readonly endedAssignmentIds: readonly string[] }
  | {
      readonly status: 'disabled' | 'already-disabled';
      readonly userId: string;
      readonly endedAssignmentIds: readonly string[];
      readonly revokedSessions: number;
    }
  | {
      readonly status: 'admin-kept';
      readonly userId: string;
      readonly reason: 'last-tenant-admin' | 'primary-tenant-admin';
      readonly endedAssignmentIds: readonly string[];
    };

export interface EmployeeOffboardingDeps {
  /** Pool DB của tenant (core_schema, integration_schema.inbox_messages). */
  readonly tenantPool: Pool;
  /** Pool DB platform (identity_schema.tenant_auth_sessions, tenancy_schema, outbox platform). */
  readonly platformPool: Pool;
  readonly logger?: { warn(message: string): void };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Chỉ dùng các hàm ghi audit và kiểm quản trị viên, chạy trên client của transaction; không mở kết nối riêng. */
const authorization = new TenantAuthorizationService(async () => {
  throw new Error('Không dùng kết nối riêng khi xử lý sự kiện nghỉ việc.');
});

/**
 * Xử lý `hrm.employee.offboarded` trong MỘT transaction của DB tenant, chung với dòng inbox chống trùng:
 * khoá `authorization_state` (xếp hàng với mọi thao tác phân quyền), đóng bổ nhiệm còn hiệu lực, vô hiệu tài khoản
 * (trigger trên `core_schema.users` tăng revision và ghi `core.authorization.changed` vào outbox cùng transaction),
 * ghi audit. Người nghỉ là quản trị tenant cuối cùng hoặc Tenant Admin chính thì KHÔNG khoá, chỉ ghi cảnh báo và audit.
 *
 * Phiên đăng nhập nằm ở DB platform: thu hồi (kèm `identity.session.revoked`) trong transaction platform chạy TRƯỚC khi
 * transaction tenant commit. Platform lỗi thì tenant rollback và sự kiện được thử lại; tenant lỗi sau khi platform đã
 * commit thì lần thử lại thu hồi lại (không còn phiên nào, vô hại).
 */
export async function receiveEmployeeOffboarded(
  deps: EmployeeOffboardingDeps,
  event: IntegrationEventEnvelope,
): Promise<EmployeeOffboardingOutcome> {
  if (event.type !== HRM_EMPLOYEE_OFFBOARDED) throw new PermanentMessageError(`Loại sự kiện không hỗ trợ: ${event.type}`);
  const payload = (event.payload ?? {}) as Partial<HrmEmployeeOffboardedPayload>;
  const employeeId = typeof payload.employeeId === 'string' && UUID.test(payload.employeeId) ? payload.employeeId : null;
  const payloadUserId = typeof payload.userId === 'string' && UUID.test(payload.userId) ? payload.userId : null;
  if (!employeeId && !payloadUserId) throw new PermanentMessageError('Sự kiện nghỉ việc thiếu employeeId hợp lệ.');
  const effectiveDate =
    typeof payload.effectiveDate === 'string' && DATE.test(payload.effectiveDate.slice(0, 10))
      ? payload.effectiveDate.slice(0, 10)
      : null;

  let outcome: EmployeeOffboardingOutcome = { status: 'duplicate' };
  await new IdempotentInbox(deps.tenantPool, IDENTITY_INTEGRATION_QUEUE).process(event, async (client) => {
    outcome = await offboard(deps, client, {
      tenantId: event.tenantId,
      eventId: event.id,
      employeeId,
      userId: payloadUserId,
      effectiveDate,
    });
  });
  return outcome;
}

async function offboard(
  deps: EmployeeOffboardingDeps,
  client: PostgresClient,
  input: {
    tenantId: string;
    eventId: string;
    employeeId: string | null;
    userId: string | null;
    effectiveDate: string | null;
  },
): Promise<EmployeeOffboardingOutcome> {
  await client.query('SELECT revision FROM core_schema.authorization_state WHERE id=true FOR UPDATE');
  // Payload hiện tại chỉ có employeeId: tra tài khoản qua dòng liên kết của Core, không đọc schema HRM.
  const userId =
    input.userId ??
    (
      await client.query<{ user_id: string | null }>(
        'SELECT user_id::text AS user_id FROM core_schema.employees WHERE id = $1 AND tenant_id = $2',
        [input.employeeId, input.tenantId],
      )
    ).rows[0]?.user_id ??
    null;

  const endedAssignmentIds = await endActiveAssignments(client, input.employeeId, userId, input.effectiveDate);
  const source = { source: HRM_EMPLOYEE_OFFBOARDED, eventId: input.eventId, employeeId: input.employeeId };
  if (!userId) return { status: 'no-account', endedAssignmentIds };

  const user = (
    await client.query<{ status: string; is_active: boolean }>(
      'SELECT status, is_active FROM core_schema.users WHERE id = $1 FOR UPDATE',
      [userId],
    )
  ).rows[0];
  if (!user) return { status: 'no-account', endedAssignmentIds };

  if (user.status === 'disabled' && !user.is_active) {
    const revokedSessions = await revokeSessions(deps, input.tenantId, userId);
    return { status: 'already-disabled', userId, endedAssignmentIds, revokedSessions };
  }

  const keepReason = await adminKeepReason(deps, client, input.tenantId, userId);
  if (keepReason) {
    deps.logger?.warn(
      `Nhân viên nghỉ việc ${userId} (tenant ${input.tenantId}) là ${
        keepReason === 'last-tenant-admin' ? 'quản trị tenant cuối cùng' : 'Tenant Admin chính'
      }: không khoá tài khoản; quản trị tenant cần gán quản trị viên khác rồi khoá bằng tay.`,
    );
    await authorization.audit(client, OFFBOARDING_SYSTEM_ACTOR_ID, 'user.offboard.admin-kept', userId, null, {
      ...source,
      reason: keepReason,
      note:
        keepReason === 'last-tenant-admin'
          ? 'Không khoá: người nghỉ việc là quản trị tenant cuối cùng.'
          : 'Không khoá: người nghỉ việc là Tenant Admin chính.',
    });
    return { status: 'admin-kept', userId, reason: keepReason, endedAssignmentIds };
  }

  await client.query(
    `UPDATE core_schema.users SET status = 'disabled', is_active = false, updated_at = now() WHERE id = $1`,
    [userId],
  );
  await authorization.assertAdminRemains(client);
  await authorization.audit(
    client,
    OFFBOARDING_SYSTEM_ACTOR_ID,
    'user.status.change',
    userId,
    { status: user.status, isActive: user.is_active },
    { status: 'disabled', isActive: false, ...source },
  );
  const revokedSessions = await revokeSessions(deps, input.tenantId, userId);
  return { status: 'disabled', userId, endedAssignmentIds, revokedSessions };
}

/**
 * Đóng mọi bổ nhiệm còn hiệu lực như Core làm khi kết thúc phân công (`applyAppointment`, END):
 * - `effectiveDate` là ngày đầu tiên không còn làm việc (`inactive_from` của HRM), nên `end_date` (ngày cuối còn giữ
 *   chức danh, tính cả ngày đó) là `effectiveDate - 1`, không trước ngày bắt đầu; ngày kết thúc đã đặt sớm hơn thì giữ;
 * - `status='ended'` khi ngày nghỉ đã tới (`effectiveDate <= hôm nay`, trường hợp duy nhất HRM cho nhập); ngày tương lai
 *   thì chỉ đặt `end_date`, bổ nhiệm còn hiệu lực đến hết ngày đó như Core;
 * - bỏ cờ chức danh chính. Thiếu `effectiveDate` thì coi là hôm nay.
 * Trigger của Core ghi `core.org.assignment.ended` vào outbox cho từng dòng chuyển sang `ended`.
 */
async function endActiveAssignments(
  client: PostgresClient,
  employeeId: string | null,
  userId: string | null,
  effectiveDate: string | null,
): Promise<string[]> {
  const ended = await client.query<{ id: string }>(
    `UPDATE core_schema.organization_node_assignments
        SET end_date = LEAST(end_date, GREATEST(start_date, COALESCE($3::date, CURRENT_DATE) - 1)),
            status = CASE WHEN COALESCE($3::date, CURRENT_DATE) <= CURRENT_DATE THEN 'ended' ELSE status END,
            is_primary = false,
            updated_at = now()
      WHERE status = 'active' AND deleted_at IS NULL
        AND (($1::uuid IS NOT NULL AND employee_id = $1::uuid) OR ($2::uuid IS NOT NULL AND user_id = $2::uuid))
      RETURNING id::text AS id`,
    [employeeId, userId, effectiveDate],
  );
  return ended.rows.map((row) => row.id);
}

/** Không khoá người giữ quản trị tenant cuối cùng (tenant mất người quản trị) hay Tenant Admin chính (như màn Người dùng). */
async function adminKeepReason(
  deps: EmployeeOffboardingDeps,
  client: PostgresClient,
  tenantId: string,
  userId: string,
): Promise<'last-tenant-admin' | 'primary-tenant-admin' | null> {
  const primary = await deps.platformPool.query<{ core_user_id: string }>(
    'SELECT core_user_id::text AS core_user_id FROM tenancy_schema.tenant_admin_directory WHERE tenant_id = $1',
    [tenantId],
  );
  if (primary.rows[0]?.core_user_id === userId) return 'primary-tenant-admin';
  if (!(await authorization.isAdmin(client, userId))) return null;
  const others = await client.query(
    `SELECT 1 FROM core_schema.user_roles ur
       JOIN core_schema.roles r ON r.id = ur.role_id
       JOIN core_schema.users u ON u.id = ur.user_id
      WHERE r.key = 'tenant-admin' AND u.id <> $1 AND u.status = 'active' AND u.is_active = true
      LIMIT 1`,
    [userId],
  );
  return others.rowCount ? null : 'last-tenant-admin';
}

function revokeSessions(deps: EmployeeOffboardingDeps, tenantId: string, userId: string): Promise<number> {
  return inTransaction(deps.platformPool, (platform) =>
    revokeTenantUserSessions(platform, { tenantId, userId, reason: 'user-disabled' }),
  );
}
