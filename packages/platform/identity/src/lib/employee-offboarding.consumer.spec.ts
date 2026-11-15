import { PermanentMessageError } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import {
  IDENTITY_INTEGRATION_BINDINGS,
  IDENTITY_INTEGRATION_QUEUE,
  OFFBOARDING_SYSTEM_ACTOR_ID,
  receiveEmployeeOffboarded,
} from './employee-offboarding.consumer.js';

const TENANT = '7a3f0c2e-1111-4111-8111-000000000001';
const EMPLOYEE = '7a3f0c2e-2222-4222-8222-000000000002';
const USER = '7a3f0c2e-3333-4333-8333-000000000003';
const OTHER_ADMIN = '7a3f0c2e-4444-4444-8444-000000000004';

interface Call {
  readonly db: 'tenant' | 'platform';
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * DB giả: một client tenant (transaction của inbox) và DB platform. Ghi lại thứ tự câu lệnh của cả hai để kiểm mọi việc
 * phía tenant đi trên MỘT client trong BEGIN..COMMIT và phiên được thu hồi trước khi tenant commit.
 */
function harness(options: {
  user?: { status: string; is_active: boolean } | null;
  isAdmin?: boolean;
  otherAdmins?: boolean;
  primaryAdmin?: string | null;
  sessions?: string[];
  inbox?: Set<string>;
}) {
  const calls: Call[] = [];
  const inbox = options.inbox ?? new Set<string>();
  let sessions = [...(options.sessions ?? ['s-1', 's-2'])];
  const tenantClient = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ db: 'tenant', sql: sql.trim(), params });
      if (sql.includes('INSERT INTO integration_schema.inbox_messages')) {
        const key = `${params[0]}:${params[1]}`;
        if (inbox.has(key)) return { rowCount: 0, rows: [] };
        inbox.add(key);
        return { rowCount: 1, rows: [{ event_id: params[1] }] };
      }
      if (sql.includes('FROM core_schema.employees'))
        return { rowCount: 1, rows: [{ user_id: options.user === null ? null : USER }] };
      if (sql.includes('UPDATE core_schema.organization_node_assignments'))
        return { rowCount: 1, rows: [{ id: 'assignment-1' }] };
      if (sql.startsWith('SELECT status, is_active FROM core_schema.users')) {
        const user = options.user === undefined ? { status: 'active', is_active: true } : options.user;
        return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
      }
      if (sql.includes("r.key='tenant-admin'") && sql.includes('WHERE ur.user_id=$1'))
        return { rowCount: options.isAdmin ? 1 : 0, rows: [] };
      if (sql.includes('u.id <> $1')) return { rowCount: options.otherAdmins ? 1 : 0, rows: [] };
      if (sql.includes("WHERE r.key='tenant-admin' AND u.status='active'")) return { rowCount: 1, rows: [{}] };
      return { rowCount: 0, rows: [] };
    }),
    release: jest.fn(),
  };
  const platformClient = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ db: 'platform', sql: sql.trim(), params });
      if (sql.includes('UPDATE identity_schema.tenant_auth_sessions')) {
        const rows = sessions.map((id) => ({ id }));
        sessions = [];
        return { rowCount: rows.length, rows };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: jest.fn(),
  };
  const platformPool = {
    connect: async () => platformClient,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ db: 'platform', sql: sql.trim(), params });
      if (sql.includes('tenant_admin_directory'))
        return { rowCount: options.primaryAdmin ? 1 : 0, rows: options.primaryAdmin ? [{ core_user_id: options.primaryAdmin }] : [] };
      return { rowCount: 0, rows: [] };
    }),
  };
  const tenantPool = { connect: async () => tenantClient };
  const deps = { tenantPool: tenantPool as never, platformPool: platformPool as never, logger: { warn: jest.fn() } };
  const tenantSql = () => calls.filter((c) => c.db === 'tenant').map((c) => c.sql);
  return { calls, deps, tenantSql, inbox };
}

function offboardedEvent(overrides: Partial<IntegrationEventEnvelope> = {}): IntegrationEventEnvelope {
  return {
    id: '7a3f0c2e-5555-4555-8555-000000000005',
    type: 'hrm.employee.offboarded',
    version: 1,
    occurredAt: '2026-11-15T03:00:00.000Z',
    tenantId: TENANT,
    source: 'hrm',
    correlationId: EMPLOYEE,
    payload: { employeeId: EMPLOYEE, employmentStatus: 'RESIGNED', effectiveDate: '2026-11-15' },
    ...overrides,
  };
}

describe('Core nhận hrm.employee.offboarded (ISS-BE-020)', () => {
  it('nghe đúng loại sự kiện trên hàng đợi riêng của Core', () => {
    expect(IDENTITY_INTEGRATION_QUEUE).toBe('identity.integrations.v1');
    expect(IDENTITY_INTEGRATION_BINDINGS).toEqual(['hrm.employee.offboarded']);
  });

  it('SEC-BE020-02: vô hiệu tài khoản, đóng bổ nhiệm, audit, thu hồi phiên trong một transaction', async () => {
    const { deps, calls, tenantSql } = harness({ otherAdmins: true });
    const outcome = await receiveEmployeeOffboarded(deps, offboardedEvent());
    expect(outcome).toEqual({
      status: 'disabled',
      userId: USER,
      endedAssignmentIds: ['assignment-1'],
      revokedSessions: 2,
    });

    const sql = tenantSql();
    // Một transaction tenant: BEGIN, dòng inbox, khoá authorization_state, ..., COMMIT cuối cùng.
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('INSERT INTO integration_schema.inbox_messages');
    expect(sql[2]).toContain('core_schema.authorization_state WHERE id=true FOR UPDATE');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.filter((s) => s === 'BEGIN')).toHaveLength(1);
    expect(sql).not.toContain('ROLLBACK');

    // Tài khoản: UPDATE core_schema.users (trigger của Core tăng revision và ghi core.authorization.changed vào outbox
    // trong chính transaction này), rồi kiểm còn quản trị viên.
    const disable = calls.find((c) => c.sql.startsWith('UPDATE core_schema.users'));
    expect(disable?.db).toBe('tenant');
    expect(disable?.sql).toContain("status = 'disabled', is_active = false");
    expect(disable?.params).toEqual([USER]);

    // Bổ nhiệm đóng như Core: status ended, không trước ngày bắt đầu, theo employeeId hoặc tài khoản.
    const ended = calls.find((c) => c.sql.startsWith('UPDATE core_schema.organization_node_assignments'));
    expect(ended?.sql).toContain("THEN 'ended'");
    expect(ended?.sql).toContain('GREATEST(start_date');
    expect(ended?.params).toEqual([EMPLOYEE, USER, '2026-11-15']);

    // Audit đổi trạng thái, người thao tác là hệ thống, có nguồn sự kiện.
    const audit = calls.find((c) => c.sql.includes('INSERT INTO core_schema.authorization_audit'));
    expect(audit?.params[1]).toBe(OFFBOARDING_SYSTEM_ACTOR_ID);
    expect(audit?.params[2]).toBe('user.status.change');
    expect(audit?.params[3]).toBe(USER);
    expect(JSON.parse(audit?.params[5] as string)).toMatchObject({
      status: 'disabled',
      isActive: false,
      source: 'hrm.employee.offboarded',
    });

    // Phiên ở DB platform: thu hồi và phát identity.session.revoked cho từng phiên, TRƯỚC khi tenant COMMIT.
    const revokeIndex = calls.findIndex((c) => c.sql.startsWith('UPDATE identity_schema.tenant_auth_sessions'));
    const commitIndex = calls.findIndex((c) => c.db === 'tenant' && c.sql === 'COMMIT');
    expect(revokeIndex).toBeGreaterThan(-1);
    expect(revokeIndex).toBeLessThan(commitIndex);
    expect(calls[revokeIndex].params).toEqual([TENANT, USER, null]);
    const revokedEvents = calls.filter(
      (c) => c.db === 'platform' && c.sql.includes('INSERT INTO integration_schema.outbox_events'),
    );
    expect(revokedEvents.map((c) => c.params[2])).toEqual(['identity.session.revoked', 'identity.session.revoked']);
  });

  it('SEC-BE020-03: không khoá quản trị tenant cuối cùng, ghi cảnh báo và audit', async () => {
    const { deps, calls } = harness({ isAdmin: true, otherAdmins: false });
    const outcome = await receiveEmployeeOffboarded(deps, offboardedEvent());
    expect(outcome).toMatchObject({ status: 'admin-kept', reason: 'last-tenant-admin', userId: USER });
    expect(calls.some((c) => c.sql.startsWith('UPDATE core_schema.users'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('tenant_auth_sessions'))).toBe(false);
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('quản trị tenant cuối cùng'));
    const audit = calls.find((c) => c.sql.includes('INSERT INTO core_schema.authorization_audit'));
    expect(audit?.params[2]).toBe('user.offboard.admin-kept');
    expect(JSON.parse(audit?.params[5] as string)).toMatchObject({ reason: 'last-tenant-admin' });
    // Bổ nhiệm vẫn đóng: người đã nghỉ không còn giữ chức danh.
    expect(calls.some((c) => c.sql.startsWith('UPDATE core_schema.organization_node_assignments'))).toBe(true);
  });

  it('không khoá Tenant Admin chính, như màn Người dùng', async () => {
    const { deps, calls } = harness({ primaryAdmin: USER, isAdmin: true, otherAdmins: true });
    const outcome = await receiveEmployeeOffboarded(deps, offboardedEvent());
    expect(outcome).toMatchObject({ status: 'admin-kept', reason: 'primary-tenant-admin' });
    expect(calls.some((c) => c.sql.startsWith('UPDATE core_schema.users'))).toBe(false);
  });

  it('khoá quản trị tenant khi còn quản trị viên khác', async () => {
    const { deps } = harness({ isAdmin: true, otherAdmins: true, primaryAdmin: OTHER_ADMIN });
    expect(await receiveEmployeeOffboarded(deps, offboardedEvent())).toMatchObject({ status: 'disabled' });
  });

  it('SEC-BE020-04: cùng sự kiện đến hai lần chỉ xử lý một lần', async () => {
    const inbox = new Set<string>();
    const first = harness({ otherAdmins: true, inbox });
    expect(await receiveEmployeeOffboarded(first.deps, offboardedEvent())).toMatchObject({ status: 'disabled' });
    const second = harness({ otherAdmins: true, inbox });
    expect(await receiveEmployeeOffboarded(second.deps, offboardedEvent())).toEqual({ status: 'duplicate' });
    expect(second.tenantSql()).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO integration_schema.inbox_messages'),
      'ROLLBACK',
    ]);
    expect(second.calls.some((c) => c.db === 'platform')).toBe(false);
    expect([...inbox]).toEqual([`${IDENTITY_INTEGRATION_QUEUE}:${offboardedEvent().id}`]);
  });

  it('lỗi thu hồi phiên thì huỷ cả transaction tenant (kể cả dòng inbox) để thử lại', async () => {
    const { deps, tenantSql, inbox } = harness({ otherAdmins: true });
    const platform = deps.platformPool as unknown as { connect: () => Promise<unknown> };
    platform.connect = async () => ({
      query: async (sql: string) => {
        if (sql.includes('tenant_auth_sessions')) throw new Error('platform down');
        return { rowCount: 0, rows: [] };
      },
      release: () => undefined,
    });
    await expect(receiveEmployeeOffboarded(deps, offboardedEvent())).rejects.toThrow('platform down');
    expect(tenantSql().at(-1)).toBe('ROLLBACK');
    expect(inbox.size).toBe(1); // bộ giả không rollback; DB thật huỷ dòng inbox cùng transaction
  });

  it('tài khoản đã khoá thì không ghi lại, vẫn thu hồi phiên còn sót', async () => {
    const { deps, calls } = harness({ user: { status: 'disabled', is_active: false } });
    expect(await receiveEmployeeOffboarded(deps, offboardedEvent())).toMatchObject({
      status: 'already-disabled',
      revokedSessions: 2,
    });
    expect(calls.some((c) => c.sql.startsWith('UPDATE core_schema.users'))).toBe(false);
  });

  it('nhân sự chưa có tài khoản: chỉ đóng bổ nhiệm theo employeeId', async () => {
    const { deps, calls } = harness({ user: null });
    expect(await receiveEmployeeOffboarded(deps, offboardedEvent())).toEqual({
      status: 'no-account',
      endedAssignmentIds: ['assignment-1'],
    });
    expect(calls.some((c) => c.db === 'platform')).toBe(false);
  });

  it('đóng bổ nhiệm theo ngày nghỉ việc trong sự kiện: end_date là ngày làm việc cuối (effectiveDate - 1)', async () => {
    const { deps, calls } = harness({ otherAdmins: true });
    await receiveEmployeeOffboarded(
      deps,
      offboardedEvent({ payload: { employeeId: EMPLOYEE, employmentStatus: 'RESIGNED', effectiveDate: '2026-10-01' } }),
    );
    const ended = calls.find((c) => c.sql.startsWith('UPDATE core_schema.organization_node_assignments'));
    // Ngày lấy từ sự kiện, không phải ngày xử lý.
    expect(ended?.params).toEqual([EMPLOYEE, USER, '2026-10-01']);
    expect(ended?.sql).toContain('LEAST(end_date, GREATEST(start_date, COALESCE($3::date, CURRENT_DATE) - 1))');
    // Ngày nghỉ đã tới thì 'ended'; ngày tương lai (HRM hiện không cho nhập) giữ trạng thái, chỉ đặt end_date.
    expect(ended?.sql).toContain(
      "status = CASE WHEN COALESCE($3::date, CURRENT_DATE) <= CURRENT_DATE THEN 'ended' ELSE status END",
    );
  });

  it('effectiveDate dạng timestamp được cắt về ngày; sai định dạng thì coi là hôm nay', async () => {
    const withTime = harness({ otherAdmins: true });
    await receiveEmployeeOffboarded(
      withTime.deps,
      offboardedEvent({ payload: { employeeId: EMPLOYEE, effectiveDate: '2026-10-01T00:00:00+07:00' } }),
    );
    expect(
      withTime.calls.find((c) => c.sql.startsWith('UPDATE core_schema.organization_node_assignments'))?.params[2],
    ).toBe('2026-10-01');

    const invalid = harness({ otherAdmins: true });
    await receiveEmployeeOffboarded(
      invalid.deps,
      offboardedEvent({ payload: { employeeId: EMPLOYEE, effectiveDate: 'hôm qua' } }),
    );
    expect(
      invalid.calls.find((c) => c.sql.startsWith('UPDATE core_schema.organization_node_assignments'))?.params[2],
    ).toBeNull();
  });

  it('payload thiếu employeeId là lỗi vĩnh viễn (vào dead letter)', async () => {
    const { deps } = harness({});
    await expect(receiveEmployeeOffboarded(deps, offboardedEvent({ payload: {} }))).rejects.toBeInstanceOf(
      PermanentMessageError,
    );
  });
});
