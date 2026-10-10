import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import {
  createIntegrationEvent,
  type IntegrationEventEnvelope,
} from '@enterprise-platform/contracts-integration';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { assertLifecycleVersion, lifecycleAudit } from './hrm-lifecycle.js';
import {
  assertOpenRange,
  isoDate,
  lockEmployee,
  recalculateAttendance,
  resolvePolicy,
} from './hrm-time.js';
import { transitionLeave } from './hrm-leave-operations.js';
import { hrmTransaction } from './hrm-transaction.js';
import { fetchProcedureReversalCheck } from './hrm-procedure-api.js';

/**
 * Caller checks the approval permission; this transaction never edits Procedure state.
 * `expectedUpdatedAt = null` chỉ dành cho lời gọi hệ thống (sự kiện huỷ hiệu lực
 * từ Procedure), nơi không có bản ghi "vừa tải" để so phiên bản.
 */
export async function reverseApprovedRequest(
  db: PoolClient,
  tenant: string,
  actor: string,
  kind: HrmRequestKind,
  id: string,
  expectedUpdatedAt: string | null,
  reason: string,
) {
  if (!['leave', 'ot', 'business_trip', 'correction', 'advance'].includes(kind))
    throw new BadRequestException(
      'Đổi ca và hồ sơ đã áp dụng cần lập đơn điều chỉnh mới, giữ lịch sử phê duyệt cũ.',
    );
  const table = HRM_REQUEST_TABLES[kind];
  const before = (
    await db.query(
      `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenant, id],
    )
  ).rows[0];
  if (!before) throw new NotFoundException('Không tìm thấy đơn trong tenant');
  await lockEmployee(db, tenant, before.employee_id);
  const prior = (
    await db.query(
      'SELECT * FROM hrm_schema.request_reversals WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3',
      [tenant, kind, id],
    )
  ).rows[0];
  if (prior) {
    if (prior.reason !== reason)
      throw new ConflictException('Đơn đã được hủy hiệu lực với lý do khác.');
    return prior;
  }
  if (expectedUpdatedAt !== null)
    assertLifecycleVersion(before, expectedUpdatedAt);
  if (before.status !== 'APPROVED')
    throw new ConflictException(
      'Chỉ hủy hiệu lực đơn đã duyệt; đơn đang chờ dùng thao tác rút đơn.',
    );
  const link = (
    await db.query(
      'SELECT sync_status FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 ORDER BY revision DESC LIMIT 1',
      [tenant, kind, id],
    )
  ).rows[0];
  if (link && link.sync_status !== 'APPLIED')
    throw new ConflictException(
      'Quy trình chưa đồng bộ xong; cần đối soát trước khi hủy hiệu lực.',
    );
  const from = isoDate(
    before.work_date || before.from_date || before.request_date,
  );
  const to = isoDate(before.to_date || before.work_date || before.request_date);
  await assertOpenRange(db, tenant, from, to);
  const payroll = await db.query(
    `SELECT 1 FROM hrm_schema.payroll_periods p WHERE p.tenant_id=$1 AND p.from_date<=$3::date AND p.to_date>=$2::date AND (p.status IN ('LOCKED','PAID') OR EXISTS(SELECT 1 FROM hrm_schema.payroll_runs r WHERE r.tenant_id=p.tenant_id AND r.payroll_period_id=p.id AND r.status='FINALIZED'))`,
    [tenant, from, to],
  );
  if (payroll.rowCount)
    throw new ConflictException(
      'Kỳ lương đã chốt; cần xử lý điều chỉnh ở kỳ sau.',
    );
  if (
    kind === 'advance' &&
    (Number(before.disbursed_amount) > 0 ||
      Number(before.total_deducted_amount) > 0 ||
      (
        await db.query(
          'SELECT 1 FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND advance_request_id=$2',
          [tenant, id],
        )
      ).rowCount)
  )
    throw new ConflictException(
      'Tạm ứng đã giải ngân hoặc có lịch khấu trừ; cần đối soát thu hồi, không hủy đơn.',
    );
  if (kind === 'correction') {
    const events = (
      await db.query(
        'SELECT * FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 FOR UPDATE',
        [tenant, before.employee_id, from],
      )
    ).rows;
    const own = events.filter((e) => e.evidence?.correctionId === id);
    if (
      !own.length ||
      own.some((e) => e.voided_by_correction_id) ||
      events.some(
        (e) => !e.voided_by_correction_id && e.evidence?.correctionId !== id,
      )
    )
      throw new ConflictException(
        'Dữ liệu công đã thay đổi sau giải trình; cần gửi đơn điều chỉnh mới để đối chiếu.',
      );
    await db.query(
      'UPDATE hrm_schema.attendance_events SET voided_by_correction_id=NULL WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id=$4',
      [tenant, before.employee_id, from, id],
    );
    await db.query(
      "UPDATE hrm_schema.attendance_events SET voided_by_correction_id=$4 WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND evidence->>'correctionId'=$4::uuid::text",
      [tenant, before.employee_id, from, id],
    );
    const policy = await resolvePolicy(
      db,
      tenant,
      'ATTENDANCE',
      from,
      before.employee_id,
    );
    await recalculateAttendance(
      db,
      tenant,
      before.employee_id,
      from,
      String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh'),
      'MANUAL_CORRECTION',
    );
  }
  const reversal = (
    await db.query(
      `INSERT INTO hrm_schema.request_reversals(tenant_id,request_kind,request_id,employee_id,request_revision,before_snapshot,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenant,
        kind,
        id,
        before.employee_id,
        before.revision || 1,
        JSON.stringify(before),
        reason,
        actor,
      ],
    )
  ).rows[0];
  await db.query("SELECT set_config('hrm.business_reversal',$1,true)", [
    reversal.id,
  ]);
  if (kind === 'leave')
    await transitionLeave(db, tenant, actor, id, 'CANCELLED', reason);
  else
    await db.query(
      `UPDATE hrm_schema.${table} SET status='CANCELLED',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2`,
      [tenant, id],
    );
  await lifecycleAudit(db, tenant, actor, 'REQUEST_EFFECT_REVERSED', id, {
    kind,
    reason,
    reversalId: reversal.id,
    before,
  });
  return reversal;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const REVERSIBLE_KINDS = new Set(['leave', 'ot', 'business_trip', 'correction', 'advance']);

/** Mời người gửi đơn lập đơn mới, form điền sẵn từ đơn đã huỷ hiệu lực. */
export const HRM_REQUEST_ADJUSTMENT_REQUESTED = 'hrm.request.adjustment_requested';
/** Không huỷ hiệu lực được đơn theo yêu cầu của module khác: báo người yêu cầu đối soát. */
export const HRM_REQUEST_REVERSAL_FAILED = 'hrm.request.reversal_failed';
/** Workspace nhờ huỷ hiệu lực đơn từ của dự án (đơn không chạy qua Quy trình). */
export const WORKSPACE_PROJECT_REQUEST_REVERSAL_REQUESTED =
  'workspace.project_request.reversal_requested';

const REQUEST_LABELS: Readonly<Record<string, string>> = {
  leave: 'Đơn nghỉ phép',
  ot: 'Đơn làm thêm giờ',
  business_trip: 'Đơn công tác',
  correction: 'Đơn giải trình công',
  advance: 'Đơn tạm ứng',
};

export function hrmAdjustmentLaunchUrl(kind: string, requestId: string): string {
  return `/modules/hrm/requests?adjust=${encodeURIComponent(`${kind}:${requestId}`)}`;
}

/** Đơn đứng sau hồ sơ Procedure: `sourceId` của hồ sơ chính là `procedure_links.id`. */
async function linkedRequest(db: Pick<PoolClient, 'query'>, tenant: string, linkId: string) {
  if (!uuid.test(linkId)) return undefined;
  return (
    await db.query<{ request_kind: HrmRequestKind; request_id: string }>(
      'SELECT request_kind,request_id FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2',
      [tenant, linkId],
    )
  ).rows[0];
}

async function priorReversal(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  kind: string,
  id: string,
) {
  return Boolean(
    (
      await db.query(
        'SELECT 1 FROM hrm_schema.request_reversals WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3',
        [tenant, kind, id],
      )
    ).rowCount,
  );
}

function businessMessage(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : error.message;
}

async function emitHrmEvent(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  type: string,
  aggregateId: string,
  payload: Record<string, unknown>,
) {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type,
    version: 1,
    tenantId: tenant,
    source: 'hrm',
    correlationId: aggregateId,
    payload,
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1,'hrm-request',$2,$3,$4,$5::jsonb,$6)`,
    [event.id, aggregateId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

/** Người gửi đơn (tài khoản của nhân viên) — người nhận lời mời lập đơn điều chỉnh. */
async function requesterOf(db: Pick<PoolClient, 'query'>, tenant: string, kind: string, id: string) {
  const table = HRM_REQUEST_TABLES[kind as HrmRequestKind];
  if (!table) return undefined;
  return (
    await db.query<{ user_id: string | null; approved_by: string | null }>(
      `SELECT e.user_id, r.approved_by FROM hrm_schema.${table} r
         JOIN core_schema.employees e ON e.tenant_id=r.tenant_id AND e.id=r.employee_id
        WHERE r.tenant_id=$1 AND r.id=$2`,
      [tenant, id],
    )
  ).rows[0];
}

async function emitAdjustment(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  kind: string,
  id: string,
  reason: string,
  actorUserId: string,
) {
  const requester = await requesterOf(db, tenant, kind, id);
  if (!requester?.user_id) return;
  await emitHrmEvent(db, tenant, HRM_REQUEST_ADJUSTMENT_REQUESTED, id, {
    requestKind: kind,
    requestId: id,
    title: `${REQUEST_LABELS[kind] ?? 'Đơn'} đã bị huỷ hiệu lực, cần gửi đơn điều chỉnh`,
    reason,
    requesterUserId: requester.user_id,
    launchUrl: hrmAdjustmentLaunchUrl(kind, id),
    actorUserId,
  });
}

/**
 * Chạy thử đúng các bước huỷ của đơn trong một transaction rồi ROLLBACK —
 * cùng một bộ luật với lúc huỷ thật (kỳ công/kỳ lương đã chốt, tạm ứng đã
 * giải ngân...), không có bản sao luật.
 */
async function dryRun(
  pool: Pool,
  tenant: string,
  resolve: (db: PoolClient) => Promise<{ kind: HrmRequestKind; id: string } | string>,
): Promise<{ allowed: boolean; reason?: string; approverUserIds?: string[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await resolve(client);
    if (typeof target === 'string') return { allowed: false, reason: target };
    const requester = await requesterOf(client, tenant, target.kind, target.id);
    const approverUserIds = requester?.approved_by ? [requester.approved_by] : [];
    if (await priorReversal(client, tenant, target.kind, target.id))
      return { allowed: true, approverUserIds };
    await reverseApprovedRequest(
      client,
      tenant,
      SYSTEM_ACTOR,
      target.kind,
      target.id,
      null,
      'Kiểm tra trước khi huỷ hiệu lực',
    );
    return { allowed: true, approverUserIds };
  } catch (error) {
    const reason = businessMessage(error);
    if (reason) return { allowed: false, reason: `Đơn HRM: ${reason}` };
    throw error;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Procedure hỏi trước khi huỷ hiệu lực hồ sơ đứng sau một đơn HRM. */
export function checkLinkedReversal(pool: Pool, tenant: string, linkId: string) {
  return dryRun(pool, tenant, async (db) => {
    const link = await linkedRequest(db, tenant, linkId);
    return link
      ? { kind: link.request_kind, id: link.request_id }
      : 'Không tìm thấy đơn HRM của hồ sơ này.';
  });
}

/**
 * Workspace hỏi trước khi gửi yêu cầu huỷ đơn từ của dự án. Đơn chạy qua Quy
 * trình phải huỷ từ hồ sơ (Quy trình lan sang HRM), không huỷ thẳng ở đây.
 */
export function checkRequestReversal(pool: Pool, tenant: string, kindValue: string, id: string) {
  return dryRun(pool, tenant, async (db) => {
    if (!REVERSIBLE_KINDS.has(kindValue) || !uuid.test(id))
      return 'Loại đơn này không huỷ hiệu lực được; cần lập đơn điều chỉnh mới.';
    const procedure = (
      await db.query<{ instance_code: string | null }>(
        `SELECT instance_code FROM hrm_schema.procedure_links
          WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND instance_id IS NOT NULL
          ORDER BY revision DESC LIMIT 1`,
        [tenant, kindValue, id],
      )
    ).rows[0];
    if (procedure)
      return `Đơn chạy qua quy trình ${procedure.instance_code ?? ''}; cần huỷ hiệu lực hồ sơ quy trình.`.replace('  ', ' ');
    return { kind: kindValue as HrmRequestKind, id };
  });
}

interface ReversedPayload {
  readonly instanceId?: string;
  readonly instanceCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly reason?: string;
  readonly reversedBy?: string;
  readonly adjustmentRequested?: boolean;
}

/**
 * Huỷ hiệu lực đơn theo yêu cầu của module khác. Idempotent: đơn đã huỷ thì
 * bỏ qua. Luật nghiệp vụ chặn (chốt kỳ sau lúc kiểm trước) không tự hết khi
 * thử lại, nên ghi nhật ký, báo người yêu cầu (`hrm.request.reversal_failed`)
 * rồi ack, không lặp vô hạn.
 */
async function reverseForModule(
  pool: Pool,
  tenant: string,
  input: {
    readonly kind: HrmRequestKind;
    readonly id: string;
    readonly actor: string;
    readonly reason: string;
    readonly createAdjustment: boolean;
    readonly failure: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await hrmTransaction(pool, async (db) => {
      if (await priorReversal(db, tenant, input.kind, input.id)) return;
      await reverseApprovedRequest(db, tenant, input.actor, input.kind, input.id, null, input.reason);
      if (input.createAdjustment)
        await emitAdjustment(db, tenant, input.kind, input.id, input.reason, input.actor);
    });
  } catch (error) {
    const message = businessMessage(error);
    if (!message) throw error;
    await hrmTransaction(pool, async (db) => {
      await lifecycleAudit(db, tenant, input.actor, 'REQUEST_EFFECT_REVERSAL_FAILED', input.id, {
        kind: input.kind,
        reason: message,
        ...input.failure,
      });
      await emitHrmEvent(db, tenant, HRM_REQUEST_REVERSAL_FAILED, input.id, {
        requestKind: input.kind,
        requestId: input.id,
        reason: `Đơn HRM: ${message}`,
        recipientUserIds: [input.actor],
        ...input.failure,
      });
    });
  }
}

/** Procedure đã huỷ hiệu lực hồ sơ → HRM huỷ hiệu lực đơn đứng sau. */
export async function receiveHrmProcedureReversal(
  pool: Pool,
  tenant: string,
  event: IntegrationEventEnvelope,
): Promise<void> {
  const payload = event.payload as ReversedPayload;
  if (
    event.type !== 'procedure.instance.reversed' ||
    event.source !== 'procedure-engine' ||
    event.tenantId !== tenant ||
    payload?.sourceType !== 'hrm_request' ||
    !payload.sourceId
  )
    return;
  const link = await linkedRequest(pool, tenant, payload.sourceId);
  if (!link) return;
  const actor =
    payload.reversedBy && uuid.test(payload.reversedBy)
      ? payload.reversedBy
      : SYSTEM_ACTOR;
  await reverseForModule(pool, tenant, {
    kind: link.request_kind,
    id: link.request_id,
    actor,
    reason: `Hồ sơ ${payload.instanceCode ?? ''} bị huỷ hiệu lực: ${payload.reason ?? ''}`.trim(),
    createAdjustment: payload.adjustmentRequested === true,
    failure: { instanceId: payload.instanceId, eventId: event.id },
  });
}

interface ProjectRequestReversalPayload {
  readonly projectRequestId?: string;
  readonly code?: string;
  readonly sourceModule?: string;
  readonly requestKind?: string;
  readonly requestId?: string;
  readonly instanceId?: string;
  readonly reason?: string;
  readonly createAdjustment?: boolean;
  readonly requestedBy?: string;
}

/**
 * Workspace nhờ huỷ hiệu lực đơn từ của dự án. Đơn chạy qua Quy trình
 * (`instanceId`) do Quy trình xử lý rồi lan về đây; HRM chỉ nhận đơn thuần HRM.
 */
export async function receiveWorkspaceReversalRequest(
  pool: Pool,
  tenant: string,
  event: IntegrationEventEnvelope,
): Promise<void> {
  const payload = event.payload as ProjectRequestReversalPayload;
  if (
    event.type !== WORKSPACE_PROJECT_REQUEST_REVERSAL_REQUESTED ||
    event.source !== 'workspace' ||
    event.tenantId !== tenant ||
    payload?.sourceModule !== 'hrm' ||
    payload.instanceId ||
    !payload.requestId ||
    !uuid.test(payload.requestId) ||
    !REVERSIBLE_KINDS.has(String(payload.requestKind))
  )
    return;
  const actor =
    payload.requestedBy && uuid.test(payload.requestedBy) ? payload.requestedBy : SYSTEM_ACTOR;
  await reverseForModule(pool, tenant, {
    kind: payload.requestKind as HrmRequestKind,
    id: payload.requestId,
    actor,
    reason: `Đơn ${payload.code ?? ''} của dự án bị huỷ hiệu lực: ${payload.reason ?? ''}`.trim(),
    createAdjustment: payload.createAdjustment === true,
    failure: { projectRequestId: payload.projectRequestId, eventId: event.id },
  });
}

/** HRM → Procedure: đơn chạy qua quy trình vừa bị huỷ hiệu lực ngay trong HRM. */
export const HRM_REQUEST_REVERSED = 'hrm.request.reversed';

/**
 * Người duyệt huỷ hiệu lực đơn ngay trong HRM. Đơn chạy qua Quy trình thì hỏi
 * Quy trình trước (vật tư đã xuất… chặn hẳn), rồi phát `hrm.request.reversed`
 * trong cùng transaction để Quy trình huỷ hiệu lực hồ sơ theo. Quy trình báo
 * lại `procedure.instance.reversed`; HRM thấy đơn đã huỷ nên bỏ qua.
 */
export async function reverseRequestByUser(
  pool: Pool,
  tenant: string,
  input: {
    readonly actor: string;
    readonly kind: HrmRequestKind;
    readonly id: string;
    readonly expectedUpdatedAt: string;
    readonly reason: string;
  },
) {
  const link = (
    await pool.query<{ instance_id: string; instance_code: string | null }>(
      `SELECT instance_id::text, instance_code FROM hrm_schema.procedure_links
        WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND instance_id IS NOT NULL
        ORDER BY revision DESC LIMIT 1`,
      [tenant, input.kind, input.id],
    )
  ).rows[0];
  if (link) {
    const check = await fetchProcedureReversalCheck(tenant, link.instance_id);
    if (!check.allowed)
      throw new ConflictException(
        `Không huỷ hiệu lực được: ${check.reason ?? 'Quy trình không cho phép huỷ hồ sơ của đơn.'}`,
      );
  }
  return hrmTransaction(pool, async (db) => {
    const prior = await priorReversal(db, tenant, input.kind, input.id);
    const reversal = await reverseApprovedRequest(
      db,
      tenant,
      input.actor,
      input.kind,
      input.id,
      input.expectedUpdatedAt,
      input.reason,
    );
    if (link && !prior)
      await emitHrmEvent(db, tenant, HRM_REQUEST_REVERSED, input.id, {
        requestKind: input.kind,
        requestId: input.id,
        instanceId: link.instance_id,
        instanceCode: link.instance_code,
        reason: input.reason,
        reversedBy: input.actor,
      });
    return reversal;
  });
}
