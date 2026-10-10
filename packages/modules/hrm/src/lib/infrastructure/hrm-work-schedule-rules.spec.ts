import { ConflictException } from '@nestjs/common';
import { dayBefore, planRuleReplacement } from '../domain/work-schedule';
import { resolveDay } from './hrm-shift-resolution';
import { scheduleDayTypeOf } from './hrm-time';
import { leaveDays } from './hrm-leave-operations';
import { applyRule, cancelRule, endRule, previewRule } from './hrm-work-schedule-rules';
import type { ApplyScheduleInput } from './hrm-work-schedule';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const SAT = '00000000-0000-4000-8000-0000000000a2';
const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const UNIT = '00000000-0000-4000-8000-0000000000d1';
const ACTOR = '00000000-0000-4000-8000-0000000000f1';
const RULE_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_RULE = '00000000-0000-4000-8000-0000000000c2';

interface Call {
  sql: string;
  params: unknown[];
}

function fakeDb(
  opts: {
    existing?: { id: string; effective_from: string; effective_to: string | null; template_name?: string | null }[];
    lockedPeriods?: string[];
    rule?: Record<string, unknown>;
  } = {},
) {
  const calls: Call[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ ready: true }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.shift_definitions'))
      return {
        rows: [
          { id: ADMIN, code: 'HC', name: 'Hành chính', start_time: '08:00', end_time: '17:00', break_minutes: 60, status: 'ACTIVE' },
          { id: SAT, code: 'S', name: 'Sáng', start_time: '08:00', end_time: '12:00', break_minutes: 0, status: 'ACTIVE' },
        ],
        rowCount: 2,
      };
    if (sql.includes('FROM hrm_schema.work_schedule_rules') && sql.includes('FOR UPDATE')) {
      const rule = opts.rule;
      return { rows: rule ? [rule] : [], rowCount: rule ? 1 : 0 };
    }
    if (sql.includes('FROM hrm_schema.work_schedule_rules') && sql.includes('effective_to IS NULL OR effective_to >='))
      return { rows: opts.existing ?? [], rowCount: (opts.existing ?? []).length };
    if (sql.includes('SELECT count(*)::int AS n FROM hrm_schema.employee_profiles')) return { rows: [{ n: 12 }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.employee_profiles p') && sql.includes('p.employee_id = ANY')) {
      const wanted = (params[1] as string[]) ?? [];
      const rows = [
        { employee_id: E1, employee_code: 'NV1', full_name: 'Nhân viên 1' },
        { employee_id: E2, employee_code: 'NV2', full_name: 'Nhân viên 2' },
      ].filter((e) => wanted.includes(e.employee_id));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM core_schema.organization_nodes') && sql.includes("category <> 'position'"))
      return { rows: [{ id: UNIT, name: 'Phòng Kế toán' }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.timesheet_periods') && sql.includes('period_code'))
      return { rows: (opts.lockedPeriods ?? []).map((period_code) => ({ period_code })), rowCount: (opts.lockedPeriods ?? []).length };
    if (sql.includes('FROM hrm_schema.timesheet_periods'))
      return { rows: (opts.lockedPeriods ?? []).map((p) => ({ id: p, status: 'LOCKED' })), rowCount: (opts.lockedPeriods ?? []).length };
    if (sql.includes('RETURNING id')) return { rows: [{ id: '00000000-0000-4000-8000-0000000000b1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query } as never, calls };
}

const inserts = (calls: Call[], table: string) => calls.filter((c) => /^\s*INSERT INTO/i.test(c.sql) && c.sql.includes(table));
const updates = (calls: Call[], table: string) => calls.filter((c) => /^\s*UPDATE/i.test(c.sql) && c.sql.includes(table));
const OFFICE = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'SHIFT' as const, shiftId: ADMIN }));
const open = (over: Partial<ApplyScheduleInput> = {}): ApplyScheduleInput => ({
  scope: { type: 'COMPANY' },
  pattern: OFFICE,
  fromDate: '2026-11-01',
  ...over,
});
const existing = (over: Record<string, unknown> = {}) => ({ id: RULE_ID, effective_from: '2026-01-01', effective_to: null, template_name: 'Hành chính', ...over });

describe('lịch định kỳ: thay thế lịch cũ cùng phạm vi', () => {
  it('lịch cũ bắt đầu trước thì cắt vào ngày liền trước, bắt đầu từ ngày mới trở đi thì huỷ, đã kết thúc thì giữ nguyên', () => {
    const plan = planRuleReplacement(
      [
        { id: 'a', from: '2026-01-01', to: null },
        { id: 'b', from: '2026-11-01', to: null },
        { id: 'c', from: '2026-12-01', to: '2026-12-31' },
        { id: 'd', from: '2026-01-01', to: '2026-10-31' },
        { id: 'e', from: '2026-03-01', to: '2026-11-15' },
      ],
      '2026-11-01',
    );
    expect(plan.truncate).toEqual([
      { id: 'a', newTo: '2026-10-31' },
      { id: 'e', newTo: '2026-10-31' },
    ]);
    expect(plan.cancel).toEqual(['b', 'c']);
  });

  it('ngày liền trước qua ranh giới tháng và năm', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });
});

describe('xem trước lịch định kỳ', () => {
  it('toàn công ty: một lịch, đếm nhân viên đang được phủ, cần xác nhận, không ghi gì', async () => {
    const { db, calls } = fakeDb();
    const preview = await previewRule(db, 'tenant-rule-1', open());
    expect(preview).toMatchObject({ ruleCount: 1, employeeCount: 12, conflictTotal: 0, requiresConfirmation: true });
    expect(preview.confirmReasons.join(' ')).toContain('toàn công ty');
    expect(calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql))).toHaveLength(0);
  });

  it('báo lịch cũ sẽ bị cắt và xung đột ở chế độ mặc định', async () => {
    const { db } = fakeDb({ existing: [existing()] });
    const preview = await previewRule(db, 'tenant-rule-2', open());
    expect(preview.conflictTotal).toBe(1);
    expect(preview.rules[0].changes[0]).toMatchObject({ action: 'TRUNCATE', newTo: '2026-10-31', templateName: 'Hành chính' });
  });

  it('nhiều nhân viên: mỗi người một lịch; phòng ban: mỗi phòng một lịch', async () => {
    expect((await previewRule(fakeDb().db, 'tenant-rule-3', open({ scope: { type: 'EMPLOYEES', employeeIds: [E1, E2] } }))).ruleCount).toBe(2);
    expect((await previewRule(fakeDb().db, 'tenant-rule-4', open({ scope: { type: 'UNIT', unitIds: [UNIT] } }))).ruleCount).toBe(1);
  });

  it('báo kỳ công đã khoá nằm trong khoảng hiệu lực', async () => {
    const { db } = fakeDb({ lockedPeriods: ['2026-12'] });
    expect((await previewRule(db, 'tenant-rule-5', open())).lockedPeriods).toEqual(['2026-12']);
  });

  it('từ chối: có ngày kết thúc, ngoại lệ, loại trừ nhân viên, mẫu sai', async () => {
    const { db } = fakeDb();
    await expect(previewRule(db, 't-r-6', open({ toDate: '2026-12-31' }))).rejects.toThrow('không có ngày kết thúc');
    await expect(previewRule(db, 't-r-7', open({ kind: 'EXCEPTION' }))).rejects.toThrow('Ngoại lệ');
    await expect(previewRule(db, 't-r-8', open({ scope: { type: 'COMPANY', excludeEmployeeIds: [E1] } }))).rejects.toThrow('Loại trừ');
    await expect(previewRule(db, 't-r-9', open({ pattern: [{ weekday: 1, dayType: 'SHIFT' }] }))).rejects.toThrow('chưa chọn ca');
  });
});

describe('áp dụng lịch định kỳ', () => {
  it('gán một lần không có ngày kết thúc: ghi lịch + mẫu tuần chụp lại + nhật ký', async () => {
    const { db, calls } = fakeDb();
    const result = await applyRule(db, 'tenant-rule-10', ACTOR, open({ scope: { type: 'EMPLOYEE', employeeIds: [E1] }, reason: 'vào làm' }));
    expect(result).toMatchObject({ ruleCount: 1, changedRules: 0 });
    const rule = inserts(calls, 'work_schedule_rules')[0];
    expect(rule.sql).not.toContain('effective_to'); // không ngày kết thúc
    expect(rule.params.slice(1, 5)).toEqual(['EMPLOYEE', E1, null, '2026-11-01']);
    const days = inserts(calls, 'work_schedule_rule_days')[0];
    expect(days.params[2]).toEqual([1, 2, 3, 4, 5]);
    expect(days.params[4]).toEqual([ADMIN, ADMIN, ADMIN, ADMIN, ADMIN]);
    expect(inserts(calls, 'work_schedule_audit')).toHaveLength(1);
  });

  it('xung đột ở chế độ mặc định: 409, không ghi', async () => {
    const { db, calls } = fakeDb({ existing: [existing()] });
    const error = await applyRule(db, 'tenant-rule-11', ACTOR, open({ confirm: true })).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'HRM_SCHEDULE_RULE_CONFLICT', conflictTotal: 1 });
    expect(inserts(calls, 'work_schedule_rules')).toHaveLength(0);
  });

  it('ghi đè: cắt lịch cũ về ngày liền trước, huỷ lịch bắt đầu sau, không xoá cứng; cần xác nhận', async () => {
    const rows = [existing(), existing({ id: OTHER_RULE, effective_from: '2026-12-01' })];
    const first = fakeDb({ existing: rows });
    const needConfirm = await applyRule(first.db, 'tenant-rule-12', ACTOR, open({ scope: { type: 'EMPLOYEE', employeeIds: [E1] }, conflictMode: 'OVERWRITE_ALL' })).catch((e) => e);
    expect(needConfirm.getResponse()).toMatchObject({ code: 'HRM_SCHEDULE_CONFIRM_REQUIRED' });

    const { db, calls } = fakeDb({ existing: rows });
    const result = await applyRule(db, 'tenant-rule-12', ACTOR, open({ scope: { type: 'EMPLOYEE', employeeIds: [E1] }, conflictMode: 'OVERWRITE_ALL', confirm: true }));
    expect(result.changedRules).toBe(2);
    const truncate = updates(calls, 'work_schedule_rules').find((c) => c.sql.includes('SET effective_to'))!;
    expect(truncate.params).toEqual(['tenant-rule-12', RULE_ID, '2026-10-31']);
    const cancelled = updates(calls, 'work_schedule_rules').find((c) => c.sql.includes("status = 'CANCELLED'"))!;
    expect(cancelled.params[1]).toEqual([OTHER_RULE]);
    expect(calls.some((c) => /DELETE FROM hrm_schema\.work_schedule_rules/i.test(c.sql))).toBe(false);
  });

  it('SKIP_EXISTING bỏ qua phạm vi đã có lịch định kỳ', async () => {
    const { db, calls } = fakeDb({ existing: [existing()] });
    const result = await applyRule(db, 'tenant-rule-13', ACTOR, open({ conflictMode: 'SKIP_EXISTING', confirm: true }));
    expect(result).toMatchObject({ ruleCount: 0, skippedTargets: 1 });
    expect(inserts(calls, 'work_schedule_rules')).toHaveLength(0);
  });

  it('toàn công ty chưa xác nhận thì 409; kỳ công đã khoá chặn việc áp', async () => {
    const error = await applyRule(fakeDb().db, 'tenant-rule-14', ACTOR, open()).catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'HRM_SCHEDULE_CONFIRM_REQUIRED' });
    const locked = fakeDb({ lockedPeriods: ['p1'] });
    await expect(applyRule(locked.db, 'tenant-rule-15', ACTOR, open({ confirm: true }))).rejects.toThrow('Kỳ công đã khóa');
    expect(inserts(locked.calls, 'work_schedule_rules')).toHaveLength(0);
  });

  it('nhiều nhân viên: tạo từng lịch riêng', async () => {
    const { db, calls } = fakeDb();
    const result = await applyRule(db, 'tenant-rule-16', ACTOR, open({ scope: { type: 'EMPLOYEES', employeeIds: [E1, E2] } }));
    expect(result.ruleCount).toBe(2);
    expect(inserts(calls, 'work_schedule_rules')).toHaveLength(2);
    expect(inserts(calls, 'work_schedule_audit')).toHaveLength(2);
  });
});

describe('kết thúc và huỷ lịch định kỳ', () => {
  const rule = { id: RULE_ID, status: 'ACTIVE', effective_from: '2026-01-01', effective_to: null, employee_id: E1, unit_id: null };

  it('đặt ngày kết thúc: lịch không còn hiệu lực từ hôm sau, có nhật ký', async () => {
    const { db, calls } = fakeDb({ rule });
    await expect(endRule(db, 'tenant-end-1', ACTOR, RULE_ID, '2026-12-31', 'nghỉ việc')).resolves.toMatchObject({ effectiveTo: '2026-12-31' });
    expect(updates(calls, 'work_schedule_rules')[0].params).toEqual(['tenant-end-1', RULE_ID, '2026-12-31']);
    expect(inserts(calls, 'work_schedule_audit')[0].sql).toContain('RULE_END');
  });

  it('từ chối ngày kết thúc trước ngày bắt đầu hoặc không sớm hơn ngày kết thúc cũ', async () => {
    await expect(endRule(fakeDb({ rule }).db, 'tenant-end-2', ACTOR, RULE_ID, '2025-12-31', null)).rejects.toThrow('từ ngày bắt đầu');
    await expect(
      endRule(fakeDb({ rule: { ...rule, effective_to: '2026-06-30' } }).db, 'tenant-end-3', ACTOR, RULE_ID, '2026-07-31', null),
    ).rejects.toThrow('sớm hơn');
  });

  it('kết thúc lịch chạm kỳ công đã khoá thì bị chặn', async () => {
    const { db, calls } = fakeDb({ rule, lockedPeriods: ['p1'] });
    await expect(endRule(db, 'tenant-end-4', ACTOR, RULE_ID, '2026-06-30', null)).rejects.toThrow('Kỳ công đã khóa');
    expect(updates(calls, 'work_schedule_rules')).toHaveLength(0);
  });

  it('huỷ lịch chuyển CANCELLED (không xoá cứng); lịch không tồn tại hoặc đã huỷ thì báo lỗi', async () => {
    const { db, calls } = fakeDb({ rule });
    await cancelRule(db, 'tenant-cancel-1', ACTOR, RULE_ID, 'nhập nhầm');
    expect(updates(calls, 'work_schedule_rules')[0].sql).toContain("status = 'CANCELLED'");
    expect(calls.some((c) => /DELETE FROM/i.test(c.sql))).toBe(false);
    await expect(cancelRule(fakeDb().db, 'tenant-cancel-2', ACTOR, RULE_ID, null)).rejects.toThrow('Không tìm thấy');
    await expect(cancelRule(fakeDb({ rule: { ...rule, status: 'CANCELLED' } }).db, 'tenant-cancel-3', ACTOR, RULE_ID, null)).rejects.toThrow('đã được huỷ');
  });
});

describe('thứ tự tra ca có lịch định kỳ', () => {
  const shiftRow = { id: ADMIN, assignment_id: null, starts_at: '2026-11-02T01:00:00Z', ends_at: '2026-11-02T10:00:00Z' };

  function resolver(opts: { scheduleRow?: Record<string, unknown>; ruleRow?: Record<string, unknown> }) {
    const sqls: string[] = [];
    const db = {
      query: jest.fn(async (sql: string) => {
        sqls.push(sql);
        if (sql.includes('to_regclass') && sql.includes('employee_work_days')) return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('to_regclass') && sql.includes('work_schedule_rules')) return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('to_regclass')) return { rows: [{ ready: false }], rowCount: 1 };
        if (sql.includes('FROM hrm_schema.employee_work_days')) return { rows: opts.scheduleRow ? [opts.scheduleRow] : [], rowCount: opts.scheduleRow ? 1 : 0 };
        if (sql.includes('WITH RECURSIVE emp AS')) return { rows: opts.ruleRow ? [opts.ruleRow] : [], rowCount: opts.ruleRow ? 1 : 0 };
        if (sql.includes('FROM hrm_schema.shift_definitions s WHERE s.tenant_id')) return { rows: [shiftRow], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    return { db: db as never, sqls };
  }
  const ruleRow = (over: Record<string, unknown> = {}) => ({
    employee_id: E1,
    date: '2026-11-02',
    day_type: 'SHIFT',
    shift_id: ADMIN,
    rule_id: RULE_ID,
    scope_type: 'COMPANY',
    ...over,
  });

  it('dòng sinh sẵn (ngoại lệ, ngày lễ) thắng lịch định kỳ và không cần tra lịch định kỳ', async () => {
    const { db, sqls } = resolver({ scheduleRow: { day_type: 'OFF', id: null }, ruleRow: ruleRow() });
    const result = await resolveDay(db, 'tenant-order-1', E1, '2026-11-02', 'Asia/Ho_Chi_Minh');
    expect(result).toEqual({ picked: null, scheduleDayType: 'OFF' });
    expect(sqls.some((s) => s.includes('WITH RECURSIVE emp AS'))).toBe(false);
  });

  it('không có dòng sinh sẵn thì dùng lịch định kỳ có ca', async () => {
    const { db } = resolver({ ruleRow: ruleRow() });
    const result = await resolveDay(db, 'tenant-order-2', E1, '2026-11-02', 'Asia/Ho_Chi_Minh');
    expect(result.scheduleDayType).toBe('SHIFT');
    expect(result.picked?.source).toBe('RULE');
    expect(result.picked?.row.id).toBe(ADMIN);
  });

  it('lịch định kỳ ghi OFF: không có ca và không rơi xuống ca cũ', async () => {
    const { db, sqls } = resolver({ ruleRow: ruleRow({ day_type: 'OFF', shift_id: null }) });
    const result = await resolveDay(db, 'tenant-order-3', E1, '2026-11-08', 'Asia/Ho_Chi_Minh');
    expect(result).toEqual({ picked: null, scheduleDayType: 'OFF' });
    expect(sqls.some((s) => s.includes('hrm_schema.shift_assignments'))).toBe(false);
  });

  it('không có dòng sinh sẵn lẫn lịch định kỳ thì chưa có ca (không còn lớp ca cũ)', async () => {
    const { db, sqls } = resolver({});
    const result = await resolveDay(db, 'tenant-order-4', E1, '2026-11-02', 'Asia/Ho_Chi_Minh');
    expect(result).toEqual({ picked: null, scheduleDayType: null });
    expect(sqls.some((s) => s.includes('shift_assignments'))).toBe(false);
  });

  it('ngày lễ không lưu ca thường lệ: lấy ca từ lịch định kỳ để tính lương ngày lễ như cũ', async () => {
    const { db } = resolver({ scheduleRow: { day_type: 'HOLIDAY', id: null }, ruleRow: ruleRow() });
    const result = await resolveDay(db, 'tenant-order-5', E1, '2026-11-02', 'Asia/Ho_Chi_Minh');
    expect(result.scheduleDayType).toBe('HOLIDAY');
    expect(result.picked?.source).toBe('RULE');
    expect(result.picked?.row.id).toBe(ADMIN);
  });

  it('ngày lễ mà lịch định kỳ cho ngày đó là OFF thì không có ca', async () => {
    const { db } = resolver({ scheduleRow: { day_type: 'HOLIDAY', id: null }, ruleRow: ruleRow({ day_type: 'OFF', shift_id: null }) });
    expect(await resolveDay(db, 'tenant-order-6', E1, '2026-11-08', 'Asia/Ho_Chi_Minh')).toEqual({ picked: null, scheduleDayType: 'HOLIDAY', holidayPaid: null });
  });
});

describe('lịch định kỳ được tính vào loại ngày (đơn nghỉ phép, tăng ca)', () => {
  function db(opts: { row?: Record<string, unknown>; rule?: Record<string, unknown>; holidayRow?: Record<string, unknown> }) {
    return {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('to_regclass') && sql.includes('employee_work_days')) return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('to_regclass') && sql.includes('work_schedule_rules')) return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('to_regclass')) return { rows: [{ ready: false }], rowCount: 1 };
        if (sql.includes('SELECT day_type FROM hrm_schema.employee_work_days')) return { rows: opts.row ? [opts.row] : [], rowCount: opts.row ? 1 : 0 };
        if (sql.includes('FROM hrm_schema.employee_work_days')) return { rows: opts.holidayRow ? [opts.holidayRow] : [], rowCount: opts.holidayRow ? 1 : 0 };
        if (sql.includes('WITH RECURSIVE emp AS')) return { rows: opts.rule ? [opts.rule] : [], rowCount: opts.rule ? 1 : 0 };
        if (sql.includes('FROM hrm_schema.leave_types')) return { rows: [{ id: 't', unit: 'DAYS', paid: true }] };
        if (sql.includes('generate_series($2::date,$3::date')) {
          const rows = [];
          for (let t = Date.parse(String(params[1])); t <= Date.parse(String(params[2])); t += 86400000)
            rows.push({ date: new Date(t).toISOString().slice(0, 10), day_kind: null });
          return { rows };
        }
        if (sql.includes('hrm_schema.timesheet_periods')) return { rows: [] };
        if (sql.includes('FROM hrm_schema.policy_versions')) return { rows: [{ id: 'p', config_json: { weeklyOffDays: [] } }] };
        return { rows: [], rowCount: 0 };
      }),
    } as never;
  }
  const off = { employee_id: E1, date: '2026-11-08', day_type: 'OFF', shift_id: null, rule_id: RULE_ID, scope_type: 'COMPANY' };

  it('P0-1: không có dòng từng ngày thì loại ngày lấy từ lịch định kỳ (Chủ nhật OFF theo lịch công ty)', async () => {
    expect(await scheduleDayTypeOf(db({ rule: off }), 'tenant-kind-1', E1, '2026-11-08')).toBe('OFF');
    expect(await scheduleDayTypeOf(db({ rule: { ...off, day_type: 'SHIFT', shift_id: ADMIN } }), 'tenant-kind-2', E1, '2026-11-09')).toBe('SHIFT');
    expect(await scheduleDayTypeOf(db({}), 'tenant-kind-3', E1, '2026-11-08')).toBeNull();
  });

  it('P0-1: dòng từng ngày (ngoại lệ, ngày lễ) thắng lịch định kỳ', async () => {
    expect(await scheduleDayTypeOf(db({ row: { day_type: 'HOLIDAY' }, rule: off }), 'tenant-kind-4', E1, '2026-11-08')).toBe('HOLIDAY');
  });

  it('P0-1: đơn nghỉ qua ngày OFF theo lịch định kỳ không còn bị báo "Chưa phân ca"', async () => {
    const fake = db({ rule: off });
    // Ngày 08/11/2026 là Chủ nhật OFF theo lịch định kỳ; chỉ xin nghỉ đúng ngày đó thì không có ngày nào bị trừ phép
    const body = { employeeId: '11111111-1111-4111-8111-111111111111', leaveTypeId: '22222222-2222-4222-8222-222222222222', fromDate: '2026-11-08', toDate: '2026-11-08', duration: 0, reason: 'x' };
    const result = await leaveDays(fake, 'tenant-kind-5', body as never).catch((e) => e);
    expect(String(result?.message ?? '')).not.toContain('Chưa phân ca ngày');
  });

  it('P0-2: ngày lễ theo phạm vi mang cờ có lương từ company_holidays', async () => {
    const holiday = (paid: unknown) => ({ day_type: 'HOLIDAY', id: null, holiday_paid: paid });
    expect((await resolveDay(db({ holidayRow: holiday(true) }), 'tenant-paid-1', E1, '2026-09-02', 'UTC')).holidayPaid).toBe(true);
    expect((await resolveDay(db({ holidayRow: holiday(false) }), 'tenant-paid-2', E1, '2026-09-02', 'UTC')).holidayPaid).toBe(false);
    expect((await resolveDay(db({ holidayRow: holiday(undefined) }), 'tenant-paid-3', E1, '2026-09-02', 'UTC')).holidayPaid).toBeNull();
  });
});
