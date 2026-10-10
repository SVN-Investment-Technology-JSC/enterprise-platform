import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ANNUAL_ONLY_MESSAGE } from '../infrastructure/hrm-annual-leave-policy.js';
import { mergeLeaveTypes } from '../infrastructure/hrm-leave-merge.js';
import { HrmAnnualLeavePolicyController } from './hrm-annual-leave-policy.controller';
import { HrmLeaveController } from './hrm-leave.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({
  HrmProcedureBridgeService: class {},
}));
jest.mock('@enterprise-platform/platform-identity', () => ({
  PlatformIdentityService: class {},
}));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const TENANT = 'tenant-1';
const ACTOR = 'user-hr';
const ANNUAL = '00000000-0000-4000-8000-0000000000a1';
const SICK = '00000000-0000-4000-8000-0000000000b2';
const UNPAID = '00000000-0000-4000-8000-0000000000c3';
const SCHEDULE = '00000000-0000-4000-8000-0000000000d4';
const OLD_STAMP = new Date('2026-09-01T03:00:00.000Z');
const req = { headers: {} } as Request;

type Row = Record<string, any>;
interface Call {
  sql: string;
  params: unknown[];
}

const leaveType = (id: string, extra: Row = {}): Row => ({
  id,
  tenant_id: TENANT,
  code: id.slice(-2),
  name: `Lý do ${id.slice(-2)}`,
  unit: 'DAYS',
  paid: true,
  deduct_balance: false,
  is_annual: false,
  active: true,
  merged_into_id: null,
  carryover_allowed: false,
  max_carryover_days: 0,
  carryover_expiry_month: 3,
  negative_limit: 0,
  requires_attachment: false,
  created_at: OLD_STAMP,
  updated_at: OLD_STAMP,
  ...extra,
});
const annualType = (extra: Row = {}) =>
  leaveType(ANNUAL, {
    code: 'AL',
    name: 'Phép năm',
    is_annual: true,
    deduct_balance: true,
    carryover_allowed: true,
    max_carryover_days: 5,
    ...extra,
  });
const schedule = (extra: Row = {}): Row => ({
  id: SCHEDULE,
  tenant_id: TENANT,
  leave_type_id: ANNUAL,
  policy_version_id: null,
  accrual_frequency: 'MONTHLY',
  accrual_amount: 1,
  proration_rule: 'HALF_MONTH',
  seniority_bonus_years: 0,
  seniority_bonus_days: 0,
  effective_from: '2026-01-01',
  effective_to: null,
  accrual_basis: 'CONTRACT_SIGN_DATE',
  start_offset_months: 0,
  advance_allowed: false,
  annual_days: 12,
  created_at: OLD_STAMP,
  updated_at: OLD_STAMP,
  ...extra,
});

/** Ngày cuối của tháng hiện tại (UTC), như date_trunc('month', CURRENT_DATE) + 1 month - 1 day. */
const monthEnd = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
})();

const balanceRow = (extra: Row = {}): Row => ({
  id: 'b1',
  tenant_id: TENANT,
  employee_id: 'e1',
  leave_type_id: ANNUAL,
  year: 2026,
  opening_balance: 3,
  accrued: 10,
  used: 4,
  pending: 1,
  adjusted: -1,
  remaining: 8,
  seniority_days: 0,
  carryover_remaining: 0,
  carryover_expiry_date: null,
  max_negative_allowed: 2,
  created_at: OLD_STAMP,
  updated_at: OLD_STAMP,
  leave_type_name: 'Phép năm',
  leave_type_code: 'AL',
  employee_name: 'Nguyễn Văn A',
  employee_code: 'NV001',
  department: 'Kỹ thuật',
  seniority_accrued: 0,
  carryover_open: 2,
  carryover_expires_on: new Date('2026-03-31T00:00:00'),
  ...extra,
});

interface World {
  types: Row[];
  schedules: Row[];
  tiers: Row[];
  usage: Record<string, { count: number; last_month: string | null }>;
  typesWithRequests: string[];
  balances: Row[];
  employees: Row[];
  audits: Row[];
}

/** Giả lập các truy vấn SQL của HRM đủ cho chính sách phép năm và các quy tắc lý do nghỉ. */
function build(init: Partial<World> = {}, granted = ['hrm.read', 'hrm.leave.read', 'hrm.leave.manage']) {
  const world: World = {
    types: [],
    schedules: [],
    tiers: [],
    usage: {},
    typesWithRequests: [],
    balances: [],
    employees: [],
    audits: [],
    ...init,
  };
  const calls: Call[] = [];
  let seq = 0;
  const typeById = (id: unknown) => world.types.find((t) => t.id === id);
  const copy = (rows: Row[]) => rows.map((row) => ({ ...row }));

  function answer(rawSql: string, params: unknown[]): Row[] {
    const q = rawSql.replace(/\s+/g, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q) || q.includes('pg_advisory_xact_lock'))
      return [];
    if (q.includes('FROM hrm_schema.leave_types WHERE tenant_id=$1 AND is_annual AND deleted_at IS NULL'))
      return copy(world.types.filter((t) => t.is_annual && !t.deleted_at));
    if (q.startsWith('SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE'))
      return copy(world.types.filter((t) => t.id === params[1]));
    if (q.startsWith('SELECT id,is_annual FROM hrm_schema.leave_types'))
      return world.types.filter((t) => t.id === params[1]).map((t) => ({ id: t.id, is_annual: t.is_annual }));
    if (q.startsWith('SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 FOR UPDATE'))
      return world.types.filter((t) => t.id === params[1]).map((t) => ({ id: t.id }));
    if (q.includes('FROM hrm_schema.leave_types t') && q.includes('NOT t.is_annual'))
      return world.types.filter(
        (t) =>
          t.active && !t.is_annual && t.unit === 'DAYS' &&
          ((t.paid && t.deduct_balance) || !world.typesWithRequests.includes(t.id)),
      );
    if (q.startsWith('UPDATE hrm_schema.leave_types SET is_annual=true')) {
      const type = typeById(params[1])!;
      Object.assign(type, {
        is_annual: true,
        paid: true,
        deduct_balance: true,
        active: true,
        carryover_allowed: params[2],
        max_carryover_days: params[3],
        carryover_expiry_month: params[4],
        updated_at: new Date(Date.now() + ++seq),
      });
      return [];
    }
    if (q.startsWith('UPDATE hrm_schema.leave_types SET name=COALESCE')) {
      const type = typeById(params[1])!;
      Object.assign(type, {
        name: params[2] ?? type.name,
        paid: params[3] ?? type.paid,
        active: params[8] ?? type.active,
        deduct_balance: params[9],
        updated_at: new Date(Date.now() + ++seq),
      });
      return [type];
    }
    if (q.startsWith('INSERT INTO hrm_schema.leave_types'))
      return [
        leaveType(`00000000-0000-4000-8000-00000000ff${++seq}`.slice(0, 36), {
          code: params[1], name: params[2], paid: params[4], deduct_balance: params[10],
          active: params[9],
        }),
      ];
    if (q.includes('SELECT id,code,name FROM hrm_schema.leave_types')) return [];
    if (q.startsWith('SELECT id FROM hrm_schema.leave_requests'))
      return world.typesWithRequests.includes(params[1] as string) ? [{ id: 'r1' }] : [];
    if (q.startsWith('SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 ORDER BY effective_from DESC'))
      return copy(
        world.schedules
          .filter((s) => s.leave_type_id === params[1])
          .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1)),
      );
    if (q.startsWith('SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id<>$2'))
      return copy(
        world.schedules.filter(
          (s) => s.leave_type_id !== params[1] && (!s.effective_to || s.effective_to > (params[2] as string)),
        ),
      );
    if (q.startsWith('SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND id=$3'))
      return copy(world.schedules.filter((s) => s.id === params[2]));
    if (q.startsWith('SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND accrual_basis'))
      return [];
    if (q.includes('count(*)::int AS count'))
      return [world.usage[params[1] as string] ?? { count: 0, last_month: null }];
    if (q.startsWith('DELETE FROM hrm_schema.leave_seniority_tiers')) {
      world.tiers = world.tiers.filter((t) => t.schedule_id !== params[1]);
      return [];
    }
    if (q.startsWith('INSERT INTO hrm_schema.leave_seniority_tiers')) {
      world.tiers.push({ schedule_id: params[1], min_years: params[2], bonus_days: params[3] });
      return [];
    }
    if (q.includes('FROM hrm_schema.leave_seniority_tiers')) {
      const ids = Array.isArray(params[1]) ? (params[1] as string[]) : [params[1] as string];
      return world.tiers
        .filter((t) => ids.includes(t.schedule_id))
        .sort((a, b) => a.min_years - b.min_years);
    }
    if (q.includes('daterange(')) return [];
    if (q.startsWith('UPDATE hrm_schema.leave_accrual_schedules SET effective_to=LEAST')) {
      const row = world.schedules.find((s) => s.id === params[1])!;
      const end = new Date(Date.parse(`${params[2]}T00:00:00Z`) - 86_400_000);
      row.effective_to = end.toISOString().slice(0, 10);
      row.updated_at = new Date(Date.now() + ++seq);
      return [];
    }
    if (q.startsWith('INSERT INTO hrm_schema.leave_accrual_schedules')) {
      const p = params as any[];
      const row = schedule({
        id: `00000000-0000-4000-8000-00000000e${String(++seq).padStart(3, '0')}`,
        leave_type_id: p[1], accrual_frequency: p[3], accrual_amount: p[4], proration_rule: p[5],
        seniority_bonus_years: p[6], seniority_bonus_days: p[7], effective_from: p[8], effective_to: p[9],
        accrual_basis: p[10], start_offset_months: p[11], advance_allowed: p[12], annual_days: p[13],
        updated_at: new Date(Date.now() + seq),
      });
      world.schedules.push(row);
      return [row];
    }
    if (q.startsWith('UPDATE hrm_schema.leave_accrual_schedules SET policy_version_id')) {
      const p = params as any[];
      const row = world.schedules.find((s) => s.id === p[14])!;
      Object.assign(row, {
        accrual_frequency: p[3], accrual_amount: p[4], proration_rule: p[5],
        seniority_bonus_years: p[6], seniority_bonus_days: p[7], effective_from: p[8], effective_to: p[9],
        accrual_basis: p[10], start_offset_months: p[11], advance_allowed: p[12], annual_days: p[13],
        updated_at: new Date(Date.now() + ++seq),
      });
      return [row];
    }
    if (q.startsWith('DELETE FROM hrm_schema.leave_accrual_schedules')) {
      world.schedules = world.schedules.filter((x) => x.id !== params[1]);
      return [];
    }
    if (q.includes('AS month_end')) return [{ month_end: monthEnd }];
    if (q.startsWith('UPDATE hrm_schema.leave_accrual_schedules SET annual_days')) {
      world.schedules.find((s) => s.id === params[1])!.annual_days = params[2];
      return [];
    }
    if (q.includes('INSERT INTO hrm_schema.audit_log')) {
      world.audits.push({ action: params[2], entity_id: params[3], detail: JSON.parse(params[4] as string) });
      return [];
    }
    if (q.includes('has_balance')) {
      // Mô phỏng truy vấn annual_only: nhân viên đang làm việc x lý do phép năm, LEFT JOIN quỹ phép.
      const annual = world.types.find((t) => t.is_annual && !t.deleted_at);
      if (!annual) return [];
      return world.employees
        .filter(
          (e) =>
            !['RESIGNED', 'TERMINATED'].includes(e.employment_status) &&
            (!params[2] || e.employee_id === params[2]),
        )
        .map((e) => {
          const found = world.balances.find((b) => b.employee_id === e.employee_id);
          return found
            ? { ...found, has_balance: true }
            : balanceRow({
                id: '',
                employee_id: e.employee_id,
                employee_name: e.full_name,
                employee_code: e.employee_code,
                department: e.department_name,
                opening_balance: 0, accrued: 0, used: 0, pending: 0, adjusted: 0, remaining: 0,
                carryover_open: null, carryover_expires_on: null,
                has_balance: false,
              });
        });
    }
    if (q.includes('FROM hrm_schema.leave_balances lb')) return world.balances;
    if (q.includes('SELECT CURRENT_DATE')) return [{ today: new Date('2026-10-10T00:00:00') }];
    if (q.includes('FROM hrm_schema.employee_profiles')) return [];
    throw new Error(`Truy vấn chưa được giả lập: ${q.slice(0, 120)}`);
  }

  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    const rows = answer(sql, params);
    return { rows, rowCount: rows.length };
  });
  const client = { query, release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) };
  const ctx = {
    getContext: jest.fn(async (_req: Request, permission: string) => {
      if (!granted.includes(permission))
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      return { pool, tenantId: TENANT, principal: { userId: ACTOR } };
    }),
  };
  const policy = Object.create(HrmAnnualLeavePolicyController.prototype) as HrmAnnualLeavePolicyController;
  Object.assign(policy, { ctx });
  const leave = Object.create(HrmLeaveController.prototype) as HrmLeaveController;
  Object.assign(leave, { ctx });
  return { world, calls, pool, ctx, policy, leave };
}

const startsWith = (prefix: string) => (c: Call) => c.sql.startsWith(prefix);
const indexOfCall = (calls: Call[], prefix: string) => calls.findIndex(startsWith(prefix));
const writes = (calls: Call[]) =>
  calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql) && !c.sql.includes('audit_log'));

const body = (extra: Row = {}) => ({
  accrualBasis: 'CONTRACT_SIGN_DATE' as const,
  annualDays: 14,
  startOffsetMonths: 2,
  advanceAllowed: true,
  seniorityTiers: [
    { minYears: 10, bonusDays: 2 },
    { minYears: 5, bonusDays: 1 },
  ],
  maxCarryoverDays: 4,
  carryoverExpiryMonth: 6,
  reason: 'Áp dụng chính sách 2026',
  ...extra,
});

describe('GET /annual-leave-policy', () => {
  it('chưa có phép năm: trả lý do chọn được, policy = null, quyền hrm.leave.read', async () => {
    const { policy, ctx } = build({
      types: [
        leaveType(SICK, { deduct_balance: false }),
        leaveType(UNPAID, { paid: false, deduct_balance: false }),
      ],
      typesWithRequests: [UNPAID],
    });
    const result = await policy.get(req);
    expect(ctx.getContext).toHaveBeenCalledWith(req, 'hrm.leave.read');
    expect(result.data.leaveType).toBeNull();
    expect(result.data.policy).toBeNull();
    expect(result.data.closedOtherSchedules).toBe(0);
    // lý do không lương đã có đơn không thể ép thành phép năm nên không được đề xuất
    expect(result.data.candidates.map((c) => c.id)).toEqual([SICK]);
    expect(result.data.candidates[0]).toMatchObject({ paid: true, deductBalance: false });
  });

  it('đã có phép năm: trả lý do, chính sách mới nhất, mốc thâm niên và chuyển phép', async () => {
    const { policy } = build({
      types: [annualType(), leaveType(SICK)],
      schedules: [
        schedule({ id: 'old', effective_from: '2025-01-01', effective_to: '2025-12-31' }),
        schedule({
          effective_from: '2026-01-01',
          advance_allowed: true,
          start_offset_months: 2,
          annual_days: 14,
          updated_at: new Date('2026-09-15T00:00:00.000Z'),
        }),
      ],
      tiers: [
        { schedule_id: SCHEDULE, min_years: 10, bonus_days: 2 },
        { schedule_id: SCHEDULE, min_years: 5, bonus_days: 1 },
      ],
    });
    const { data } = await policy.get(req);
    expect(data.leaveType).toEqual({ id: ANNUAL, code: 'AL', name: 'Phép năm' });
    expect(data.candidates).toEqual([]);
    expect(data.policy).toEqual({
      accrualBasis: 'CONTRACT_SIGN_DATE',
      annualDays: 14,
      startOffsetMonths: 2,
      advanceAllowed: true,
      effectiveFrom: '2026-01-01',
      seniorityTiers: [
        { minYears: 5, bonusDays: 1 },
        { minYears: 10, bonusDays: 2 },
      ],
      carryover: { allowed: true, maxDays: 5, expiryMonth: 3 },
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
  });

  it('lịch theo ngày vào làm (cách cũ) quy ra số ngày phép năm từ định mức tháng', async () => {
    const { policy } = build({
      types: [annualType()],
      schedules: [schedule({ accrual_basis: 'JOIN_DATE', annual_days: null, accrual_amount: 1.5 })],
    });
    const { data } = await policy.get(req);
    expect(data.policy).toMatchObject({ accrualBasis: 'JOIN_DATE', annualDays: 18 });
  });
});

describe('PUT /annual-leave-policy: quyền', () => {
  it('chỉ có hrm.leave.read thì đọc được nhưng ghi bị từ chối, không chạm cơ sở dữ liệu', async () => {
    const { policy, pool } = build({ types: [annualType()], schedules: [schedule()] }, ['hrm.leave.read']);
    await expect(policy.get(req)).resolves.toBeDefined();
    pool.connect.mockClear();
    await expect(policy.put(req, body())).rejects.toBeInstanceOf(ForbiddenException);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('PUT cần quyền hrm.leave.manage', async () => {
    const { policy, ctx } = build({ types: [annualType()], schedules: [schedule()] });
    await policy.put(req, body());
    expect(ctx.getContext).toHaveBeenCalledWith(req, 'hrm.leave.manage');
  });
});

describe('PUT /annual-leave-policy: kiểm tra đầu vào', () => {
  const bad = async (extra: Row) => {
    const { policy, calls } = build({ types: [annualType()], schedules: [schedule()] });
    await expect(policy.put(req, body(extra) as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
  };
  it('từ chối số liệu sai trước khi mở giao dịch', async () => {
    await bad({ reason: '  ' });
    await bad({ accrualBasis: 'OTHER' });
    await bad({ annualDays: -1 });
    await bad({ annualDays: 400 });
    await bad({ startOffsetMonths: 1.5 });
    await bad({ advanceAllowed: 'yes' });
    await bad({ seniorityTiers: [{ minYears: 5, bonusDays: 1 }, { minYears: 5, bonusDays: 2 }] });
    await bad({ effectiveFrom: '2026-11-15' });
    await bad({ maxCarryoverDays: -2 });
    await bad({ carryoverExpiryMonth: 13 });
    await bad({ leaveTypeId: 'khong-phai-uuid' });
    await bad({ expectedUpdatedAt: 'hôm qua' });
  });
  it('căn cứ ngày vào làm không có mốc bắt đầu sau N tháng và chỉ nhận chu kỳ thâm niên đều', async () => {
    await bad({ accrualBasis: 'JOIN_DATE' });
    await bad({
      accrualBasis: 'JOIN_DATE',
      startOffsetMonths: 0,
      seniorityTiers: [{ minYears: 5, bonusDays: 1 }, { minYears: 10, bonusDays: 5 }],
    });
  });
});

describe('PUT /annual-leave-policy: lần đầu chọn lý do phép năm', () => {
  it('bắt buộc leaveTypeId khi tenant chưa có phép năm', async () => {
    const { policy, calls } = build({ types: [leaveType(SICK)] });
    await expect(policy.put(req, body())).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(calls)).toEqual([]);
    expect(calls.map((c) => c.sql)).toContain('ROLLBACK');
  });

  it('lý do không tồn tại: 404; lý do đã ngừng: 409', async () => {
    const missing = build({ types: [] });
    await expect(missing.policy.put(req, body({ leaveTypeId: SICK }))).rejects.toBeInstanceOf(NotFoundException);
    const stopped = build({ types: [leaveType(SICK, { active: false })] });
    await expect(stopped.policy.put(req, body({ leaveTypeId: SICK }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('ép có lương, trừ quỹ rồi tạo lịch và mốc thâm niên, đúng thứ tự trong một giao dịch có nhật ký', async () => {
    const { policy, calls, world } = build({
      types: [leaveType(SICK, { paid: false, deduct_balance: false, code: 'SICK', name: 'Nghỉ ốm' })],
    });
    const result = await policy.put(req, body({ leaveTypeId: SICK }));
    // chính sách đã lưu được trả lại ngay
    expect(result.data.leaveType).toEqual({ id: SICK, code: 'SICK', name: 'Nghỉ ốm' });
    expect(result.data.policy).toMatchObject({
      accrualBasis: 'CONTRACT_SIGN_DATE',
      annualDays: 14,
      startOffsetMonths: 2,
      advanceAllowed: true,
      seniorityTiers: [{ minYears: 5, bonusDays: 1 }, { minYears: 10, bonusDays: 2 }],
      carryover: { allowed: true, maxDays: 4, expiryMonth: 6 },
    });
    expect(result.data.closedOtherSchedules).toBe(0);
    // loại nghỉ bị ép: có lương + trừ quỹ + là phép năm
    expect(world.types[0]).toMatchObject({ is_annual: true, paid: true, deduct_balance: true });
    const order = [
      'BEGIN',
      'SELECT pg_advisory_xact_lock',
      'SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND is_annual',
      'SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
      'SELECT * FROM hrm_schema.leave_accrual_schedules',
      'UPDATE hrm_schema.leave_types SET is_annual=true',
      'INSERT INTO hrm_schema.leave_accrual_schedules',
      'DELETE FROM hrm_schema.leave_seniority_tiers',
      'INSERT INTO hrm_schema.leave_seniority_tiers',
      'INSERT INTO hrm_schema.audit_log',
      'COMMIT',
    ].map((prefix) => indexOfCall(calls, prefix));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const typeUpdate = calls[indexOfCall(calls, 'UPDATE hrm_schema.leave_types SET is_annual=true')];
    expect(typeUpdate.sql).toContain('paid=true,deduct_balance=true');
    expect(typeUpdate.params).toEqual([TENANT, SICK, true, 4, 6]);
    const insert = calls[indexOfCall(calls, 'INSERT INTO hrm_schema.leave_accrual_schedules')];
    const year = new Date().getUTCFullYear();
    expect(insert.params).toEqual([
      TENANT, SICK, null, 'MONTHLY', 1.17, 'HALF_MONTH', 0, 0, `${year}-01-01`, null,
      'CONTRACT_SIGN_DATE', 2, true, 14,
    ]);
    expect(world.audits).toHaveLength(1);
    expect(world.audits[0]).toMatchObject({
      action: 'ANNUAL_LEAVE_POLICY_SAVED',
      entity_id: SICK,
      detail: { mode: 'create', designated: true, reason: 'Áp dụng chính sách 2026' },
    });
  });

  it('lý do không có lương hoặc không trừ quỹ nhưng đã có đơn thì không ép thành phép năm', async () => {
    const { policy, world } = build({
      types: [leaveType(UNPAID, { paid: false })],
      typesWithRequests: [UNPAID],
    });
    await expect(policy.put(req, body({ leaveTypeId: UNPAID }))).rejects.toBeInstanceOf(ConflictException);
    expect(world.types[0].is_annual).toBe(false);
  });

  it('không cho đổi sang lý do khác khi đã có phép năm', async () => {
    const { policy, calls } = build({
      types: [annualType(), leaveType(SICK)],
      schedules: [schedule()],
    });
    await expect(policy.put(req, body({ leaveTypeId: SICK }))).rejects.toBeInstanceOf(ConflictException);
    expect(writes(calls)).toEqual([]);
  });

  it('căn cứ ngày vào làm: ghi cột cách cũ (định mức tháng, chu kỳ thâm niên) và giữ số ngày năm', async () => {
    const { policy, calls, world } = build({ types: [leaveType(SICK)] });
    await policy.put(
      req,
      body({
        leaveTypeId: SICK,
        accrualBasis: 'JOIN_DATE',
        annualDays: 14,
        startOffsetMonths: 0,
        seniorityTiers: [{ minYears: 5, bonusDays: 1 }, { minYears: 10, bonusDays: 2 }],
      }),
    );
    const insert = calls[indexOfCall(calls, 'INSERT INTO hrm_schema.leave_accrual_schedules')];
    expect(insert.params.slice(3, 8)).toEqual(['MONTHLY', 1.17, 'BY_JOIN_DATE', 5, 1]);
    expect(insert.params[10]).toBe('JOIN_DATE');
    expect(world.schedules[0].annual_days).toBe(14);
  });
});

describe('PUT /annual-leave-policy: lần đầu đóng lịch cộng phép của lý do khác', () => {
  const LEGACY_RUNNING = '00000000-0000-4000-8000-0000000000e5';
  const LEGACY_FUTURE = '00000000-0000-4000-8000-0000000000e6';
  const LEGACY_ENDING = '00000000-0000-4000-8000-0000000000e7';
  const seed = () =>
    build({
      types: [leaveType(SICK), leaveType(UNPAID)],
      schedules: [
        // đang chạy và đã cộng phép đến hết 9/2026
        schedule({ id: LEGACY_RUNNING, leave_type_id: UNPAID, effective_from: '2026-01-01' }),
        // chưa bắt đầu và chưa cộng lần nào
        schedule({ id: LEGACY_FUTURE, leave_type_id: UNPAID, effective_from: '2999-01-01' }),
        // đã có ngày kết thúc sớm hơn cuối tháng hiện tại: không cần đụng
        schedule({ id: LEGACY_ENDING, leave_type_id: UNPAID, effective_from: '2025-01-01', effective_to: '2025-12-31' }),
      ],
      usage: { [LEGACY_RUNNING]: { count: 9, last_month: '2026-09-30' } },
    });

  it('kết thúc lịch đang chạy (không trước tháng đã cộng), xoá lịch chưa bắt đầu, trả và ghi số lịch đã đóng', async () => {
    const { policy, world, calls } = seed();
    const result = await policy.put(req, body({ leaveTypeId: SICK }));
    const expectedEnd = ['2026-09-30', monthEnd].sort().pop();
    expect(world.schedules.find((s) => s.id === LEGACY_RUNNING)?.effective_to).toBe(expectedEnd);
    expect(world.schedules.some((s) => s.id === LEGACY_FUTURE)).toBe(false);
    expect(world.schedules.find((s) => s.id === LEGACY_ENDING)?.effective_to).toBe('2025-12-31');
    expect(result.data.closedOtherSchedules).toBe(2);
    // đóng lịch cũ xảy ra sau khi đặt phép năm và trước nhật ký tổng
    const designate = indexOfCall(calls, 'UPDATE hrm_schema.leave_types SET is_annual=true');
    const close = indexOfCall(calls, 'SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id<>$2');
    const audit = calls.findIndex((c) => c.sql.includes('audit_log') && c.params.includes('ANNUAL_LEAVE_POLICY_SAVED'));
    expect(designate).toBeLessThan(close);
    expect(close).toBeLessThan(audit);
    // lịch của phép năm vừa tạo vẫn là lịch duy nhất còn mở
    expect(world.schedules.filter((s) => s.leave_type_id === SICK && !s.effective_to)).toHaveLength(1);
    const summary = world.audits.find((a) => a.action === 'ANNUAL_LEAVE_POLICY_SAVED')!;
    expect(summary.detail.closedOtherSchedules).toBe(2);
    expect(summary.detail.closedSchedules.map((c: Row) => [c.scheduleId, c.action])).toEqual([
      [LEGACY_RUNNING, 'deactivate'],
      [LEGACY_FUTURE, 'delete'],
    ]);
    expect(world.audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['LEAVE_SCHEDULE_DEACTIVATE', 'LEAVE_SCHEDULE_DELETED']),
    );
  });

  it('đã có phép năm thì lưu chính sách không động đến lịch của lý do khác', async () => {
    const { policy, world } = build({
      types: [annualType(), leaveType(UNPAID)],
      schedules: [schedule(), schedule({ id: LEGACY_RUNNING, leave_type_id: UNPAID })],
    });
    const result = await policy.put(req, body());
    expect(result.data.closedOtherSchedules).toBe(0);
    expect(world.schedules.find((s) => s.id === LEGACY_RUNNING)?.effective_to).toBeNull();
  });
});

describe('PUT /annual-leave-policy: đã có chính sách', () => {
  it('lịch chưa cộng phép lần nào: sửa tại chỗ, không tạo phiên bản, vẫn chỉ một lịch', async () => {
    const { policy, calls, world } = build({
      types: [annualType()],
      schedules: [schedule()],
      tiers: [{ schedule_id: SCHEDULE, min_years: 3, bonus_days: 1 }],
    });
    const result = await policy.put(req, body());
    expect(calls.some(startsWith('INSERT INTO hrm_schema.leave_accrual_schedules'))).toBe(false);
    expect(calls.some(startsWith('UPDATE hrm_schema.leave_accrual_schedules SET effective_to'))).toBe(false);
    const edit = calls[indexOfCall(calls, 'UPDATE hrm_schema.leave_accrual_schedules SET policy_version_id')];
    expect(edit.params.slice(8, 14)).toEqual(['2026-01-01', null, 'CONTRACT_SIGN_DATE', 2, true, 14]);
    expect(world.schedules).toHaveLength(1);
    expect(world.tiers.map((t) => t.min_years)).toEqual([5, 10]);
    expect(result.data.policy?.annualDays).toBe(14);
    expect(world.audits.map((a) => a.action)).toEqual(['LEAVE_SCHEDULE_EDIT', 'ANNUAL_LEAVE_POLICY_SAVED']);
    expect(world.audits[1].detail.mode).toBe('edit');
    // cột chuyển phép của lý do phép năm được cập nhật cùng giao dịch
    expect(world.types[0]).toMatchObject({ max_carryover_days: 4, carryover_expiry_month: 6, carryover_allowed: true });
  });

  it('đã cộng phép: đóng lịch cũ rồi tạo phiên bản mới từ đầu tháng sau tháng đã cộng', async () => {
    const { policy, calls, world } = build({
      types: [annualType()],
      schedules: [schedule()],
      usage: { [SCHEDULE]: { count: 9, last_month: '2026-09-30' } },
    });
    const result = await policy.put(req, body());
    const close = indexOfCall(calls, 'UPDATE hrm_schema.leave_accrual_schedules SET effective_to');
    const create = indexOfCall(calls, 'INSERT INTO hrm_schema.leave_accrual_schedules');
    expect(close).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(close);
    expect(calls[close].params.slice(1)).toEqual([SCHEDULE, '2026-10-01']);
    expect(calls[create].params[8]).toBe('2026-10-01');
    expect(world.schedules).toHaveLength(2);
    const openEnded = world.schedules.filter((s) => !s.effective_to);
    expect(openEnded).toHaveLength(1);
    expect(world.schedules.find((s) => s.id === SCHEDULE)?.effective_to).toBe('2026-09-30');
    expect(result.data.policy).toMatchObject({ effectiveFrom: '2026-10-01', annualDays: 14 });
    expect(world.audits.map((a) => a.action)).toContain('LEAVE_SCHEDULE_VERSION');
    expect(world.audits.at(-1)?.detail.mode).toBe('version');
  });

  it('effectiveFrom do người dùng chọn phải sau tháng đã cộng phép (luật hiện có, 409)', async () => {
    const { policy, world } = build({
      types: [annualType()],
      schedules: [schedule()],
      usage: { [SCHEDULE]: { count: 9, last_month: '2026-09-30' } },
    });
    await expect(policy.put(req, body({ effectiveFrom: '2026-09-01' }))).rejects.toBeInstanceOf(ConflictException);
    expect(world.schedules).toHaveLength(1);
    expect(world.schedules[0].effective_to).toBeNull();
  });

  it('lịch mới nhất đã kết thúc: tạo lịch mới từ tháng sau, không chồng lịch cũ', async () => {
    const { policy, world } = build({
      types: [annualType()],
      schedules: [schedule({ effective_to: '2026-06-15' })],
    });
    await policy.put(req, body());
    expect(world.schedules.map((s) => [s.effective_from, s.effective_to])).toEqual(
      expect.arrayContaining([['2026-07-01', null]]),
    );
  });

  it('expectedUpdatedAt: sai phiên bản trả 409 và không ghi gì; đúng phiên bản thì lưu', async () => {
    const stale = build({ types: [annualType()], schedules: [schedule()] });
    await expect(
      stale.policy.put(req, body({ expectedUpdatedAt: '2026-08-01T00:00:00.000Z' })),
    ).rejects.toMatchObject({ response: { code: 'HRM_STALE_VERSION' } });
    expect(writes(stale.calls)).toEqual([]);

    const fresh = build({ types: [annualType()], schedules: [schedule()] });
    const loaded = await fresh.policy.get(req);
    await expect(
      fresh.policy.put(req, body({ expectedUpdatedAt: loaded.data.policy?.updatedAt })),
    ).resolves.toBeDefined();
  });

  it('phép năm đang ngừng (dữ liệu cũ) được kích hoạt lại khi lưu chính sách', async () => {
    const { policy, world } = build({
      types: [annualType({ active: false })],
      schedules: [schedule()],
    });
    await policy.put(req, body());
    expect(world.types[0].active).toBe(true);
    expect(world.audits.at(-1)?.detail.reactivated).toBe(true);
  });
});

describe('Lịch cộng phép chỉ dành cho lý do phép năm', () => {
  const schedulePayload = {
    accrualFrequency: 'MONTHLY' as const,
    accrualAmount: 1,
    effectiveFrom: '2026-11-01',
  };

  it('tạo lịch cho lý do không phải phép năm: 409 với thông báo cố định', async () => {
    const { leave, calls } = build({ types: [leaveType(SICK)] });
    const error = await leave.createAccrualSchedule(req, SICK, schedulePayload).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(ANNUAL_ONLY_MESSAGE);
    expect(ANNUAL_ONLY_MESSAGE).toBe('Chỉ cấu hình phép năm tại Chính sách phép năm');
    expect(writes(calls)).toEqual([]);
  });

  it('tạo lịch cho lý do phép năm vẫn dùng được (giao diện cũ đã ẩn)', async () => {
    const { leave, world } = build({ types: [annualType()] });
    const result = await leave.createAccrualSchedule(req, ANNUAL, schedulePayload);
    expect(world.schedules).toHaveLength(1);
    expect(result.data.leaveTypeId).toBe(ANNUAL);
  });

  it('sửa và tạo phiên bản lịch của lý do không phải phép năm: 409, lý do phép năm: được phép', async () => {
    const other = build({
      types: [leaveType(SICK)],
      schedules: [schedule({ leave_type_id: SICK })],
    });
    const patch = { expectedUpdatedAt: OLD_STAMP.toISOString(), reason: 'Sửa' };
    await expect(
      other.leave.updateAccrualSchedule(req, SICK, SCHEDULE, { ...patch, accrualAmount: 2 }),
    ).rejects.toMatchObject({ message: ANNUAL_ONLY_MESSAGE });
    await expect(
      other.leave.versionAccrualSchedule(req, SICK, SCHEDULE, { ...patch, effectiveFrom: '2026-12-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes(other.calls)).toEqual([]);

    const annual = build({ types: [annualType()], schedules: [schedule()] });
    await expect(
      annual.leave.updateAccrualSchedule(req, ANNUAL, SCHEDULE, { ...patch, annualDays: 13 }),
    ).resolves.toBeDefined();
  });
});

describe('Lý do nghỉ: tạo, sửa, ngừng', () => {
  const patch = { reason: 'Điều chỉnh', expectedUpdatedAt: OLD_STAMP.toISOString() };
  const updateCall = (calls: Call[]) =>
    calls[indexOfCall(calls, 'UPDATE hrm_schema.leave_types SET name=COALESCE')];

  it('tạo lý do mới luôn không trừ quỹ dù gửi deductBalance=true; không tự đặt là phép năm', async () => {
    const { leave, calls } = build();
    const result = await leave.createLeaveType(req, {
      code: 'WED', name: 'Nghỉ cưới', paid: true, deductBalance: true,
    });
    const insert = calls.find(startsWith('INSERT INTO hrm_schema.leave_types'))!;
    expect(insert.params[10]).toBe(false);
    expect(result.data.deductBalance).toBe(false);
    expect(result.data.isAnnual).toBe(false);
    await expect(
      leave.createLeaveType(req, { code: 'X', name: 'Giả phép năm', isAnnual: true } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sửa lý do không phải phép năm: deduct_balance luôn false (ép phía server)', async () => {
    const { leave, calls } = build({ types: [leaveType(SICK, { deduct_balance: true })] });
    await leave.updateLeaveType(req, SICK, { ...patch, deductBalance: true, name: 'Nghỉ ốm' });
    expect(updateCall(calls).params[9]).toBe(false);
  });

  it('lý do không lương không bao giờ trừ quỹ', async () => {
    const { leave, calls } = build({ types: [leaveType(UNPAID, { paid: false })] });
    await leave.updateLeaveType(req, UNPAID, { ...patch, deductBalance: true, name: 'Nghỉ không lương' });
    expect(updateCall(calls).params[9]).toBe(false);
  });

  it('lý do phép năm: giữ trừ quỹ, không cho ngừng, không cho đổi thành không lương hoặc không trừ quỹ', async () => {
    const { leave, calls, world } = build({ types: [annualType()] });
    const fresh = () => ({ ...patch, expectedUpdatedAt: world.types[0].updated_at.toISOString() });
    for (const change of [{ active: false }, { paid: false }, { deductBalance: false }])
      await expect(leave.updateLeaveType(req, ANNUAL, { ...fresh(), ...change })).rejects.toBeInstanceOf(
        ConflictException,
      );
    await expect(leave.deleteLeaveType(req, ANNUAL, fresh())).rejects.toMatchObject({
      message: 'Không thể ngừng lý do phép năm duy nhất của hệ thống',
    });
    expect(calls.some(startsWith('UPDATE hrm_schema.leave_types'))).toBe(false);
    await leave.updateLeaveType(req, ANNUAL, { ...fresh(), name: 'Phép năm 2026' });
    expect(updateCall(calls).params[9]).toBe(true);
    expect(world.types[0]).toMatchObject({ active: true, deduct_balance: true });
  });

  it('PATCH không tự đổi is_annual; gửi lại đúng giá trị hiện có thì bỏ qua', async () => {
    const { leave, world } = build({ types: [leaveType(SICK), annualType()] });
    const fresh = (index: number) => ({ ...patch, expectedUpdatedAt: world.types[index].updated_at.toISOString() });
    await expect(leave.updateLeaveType(req, SICK, { ...fresh(0), isAnnual: true })).rejects.toMatchObject({
      message: ANNUAL_ONLY_MESSAGE,
    });
    await expect(leave.updateLeaveType(req, ANNUAL, { ...fresh(1), isAnnual: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(leave.updateLeaveType(req, SICK, { ...fresh(0), isAnnual: false, name: 'Ốm' })).resolves.toBeDefined();
    expect(world.types.map((t) => t.is_annual)).toEqual([false, true]);
  });

  it('lý do không phải phép năm vẫn ngừng được', async () => {
    const { leave, world } = build({ types: [leaveType(SICK)] });
    await leave.deleteLeaveType(req, SICK, patch);
    expect(world.types[0].active).toBe(false);
  });

  it('GET /leave-types trả thêm isAnnual', async () => {
    const { leave, pool } = build({ types: [annualType(), leaveType(SICK)] });
    pool.query.mockResolvedValueOnce({
      rows: [annualType(), leaveType(SICK)],
      rowCount: 2,
    });
    const result = await leave.listLeaveTypes(req);
    expect(result.data.map((t) => [t.code, t.isAnnual])).toEqual([
      ['AL', true],
      ['b2', false],
    ]);
  });
});

describe('GET /leave-balances (quỹ phép = danh sách nhân viên)', () => {
  const balance = balanceRow;
  const employee = (id: string, name: string, status = 'OFFICIAL'): Row => ({
    employee_id: id,
    employee_code: `NV-${id}`,
    full_name: name,
    department_name: 'Kỹ thuật',
    employment_status: status,
  });

  it('annual_only=1: trả đủ cột danh sách gọn, nhân viên đã có quỹ có hasBalance=true', async () => {
    const { leave, calls } = build({
      types: [annualType()],
      employees: [employee('e1', 'Nguyễn Văn A')],
      balances: [balance()],
    });
    const result = await leave.listAllLeaveBalances(req, '2026', undefined, '1');
    const query = calls.find((c) => c.sql.includes('has_balance'))!;
    expect(query.sql).toContain('lt.is_annual');
    expect(query.sql).toContain("e.employment_status NOT IN ('RESIGNED', 'TERMINATED')");
    expect(query.params).toEqual([TENANT, 2026, null]);
    expect(result.data[0]).toMatchObject({
      employeeId: 'e1',
      employeeCode: 'NV001',
      employeeName: 'Nguyễn Văn A',
      department: 'Kỹ thuật',
      year: 2026,
      accrued: 10,
      entitlement: 12,
      carryover: 3,
      carryoverRemaining: 2,
      carryoverExpiryDate: '2026-03-31',
      used: 4,
      pending: 1,
      remaining: 8,
      hasBalance: true,
    });
  });

  it('annual_only=1: nhân viên chưa có quỹ năm đó nhận dòng mặc định; người đã nghỉ việc không có dòng', async () => {
    const { leave } = build({
      types: [annualType()],
      employees: [
        employee('e1', 'Nguyễn Văn A'),
        employee('e2', 'Trần Thị B'),
        employee('e3', 'Lê C', 'RESIGNED'),
        employee('e4', 'Phạm D', 'TERMINATED'),
      ],
      balances: [balance()],
    });
    const result = await leave.listAllLeaveBalances(req, '2026', undefined, '1');
    expect(result.data.map((r) => [r.employeeId, r.hasBalance])).toEqual([
      ['e1', true],
      ['e2', false],
    ]);
    expect(result.data[1]).toMatchObject({
      id: '',
      employeeCode: 'NV-e2',
      employeeName: 'Trần Thị B',
      department: 'Kỹ thuật',
      leaveTypeCode: 'AL',
      accrued: 0,
      used: 0,
      pending: 0,
      remaining: 0,
      entitlement: 0,
      carryover: 0,
      hasBalance: false,
    });
    expect(result.meta.total).toBe(2);
  });

  it('annual_only=1: lọc theo employee_id; tenant chưa có lý do phép năm trả mảng rỗng', async () => {
    const one = build({
      types: [annualType()],
      employees: [employee('e1', 'A'), employee('e2', 'B')],
    });
    const filtered = await one.leave.listAllLeaveBalances(req, '2026', 'e2', '1');
    expect(filtered.data.map((r) => r.employeeId)).toEqual(['e2']);
    expect(one.calls.find((c) => c.sql.includes('has_balance'))!.params[2]).toBe('e2');

    const none = build({ types: [leaveType(SICK)], employees: [employee('e1', 'A')] });
    const empty = await none.leave.listAllLeaveBalances(req, '2026', undefined, '1');
    expect(empty.data).toEqual([]);
  });

  it('mặc định giữ hành vi cũ: không lọc phép năm, chỉ các dòng quỹ đã có (hasBalance=true); không có phép chuyển thì carryover = 0', async () => {
    const { leave, calls } = build({
      balances: [balance({ opening_balance: 0, carryover_open: null, carryover_expires_on: null })],
    });
    const result = await leave.listAllLeaveBalances(req, '2026');
    const query = calls.find((c) => c.sql.includes('FROM hrm_schema.leave_balances lb'))!;
    expect(query.sql).not.toContain('is_annual');
    expect(query.params).toEqual([TENANT, 2026, null]);
    expect(result.data[0]).toMatchObject({
      entitlement: 9, carryover: 0, carryoverRemaining: 0, carryoverExpiryDate: null, hasBalance: true,
    });
  });
});

describe('Gộp lý do nghỉ', () => {
  it('không gộp lý do phép năm vào lý do khác hoặc ngược lại', async () => {
    const db = {
      query: jest.fn(async (sql: string) =>
        sql.includes('FROM hrm_schema.leave_types WHERE')
          ? { rows: [annualType(), leaveType(SICK, { deduct_balance: true })], rowCount: 2 }
          : { rows: [], rowCount: 0 },
      ),
    };
    await expect(mergeLeaveTypes(db as never, TENANT, ACTOR, SICK, ANNUAL, 'gộp')).rejects.toBeInstanceOf(ConflictException);
    await expect(mergeLeaveTypes(db as never, TENANT, ACTOR, ANNUAL, SICK, 'gộp')).rejects.toBeInstanceOf(ConflictException);
    expect(db.query.mock.calls.some(([sql]) => /^(UPDATE|DELETE|INSERT)/.test(String(sql)))).toBe(false);
  });
});
