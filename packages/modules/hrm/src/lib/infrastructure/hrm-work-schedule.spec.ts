import { ConflictException } from '@nestjs/common';
import { resolveDay } from './hrm-shift-resolution';
import { applySchedule, createHoliday, previewSchedule, type ApplyScheduleInput } from './hrm-work-schedule';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const MORNING = '00000000-0000-4000-8000-0000000000a2';
const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const ACTOR = '00000000-0000-4000-8000-0000000000f1';

interface Call {
  sql: string;
  params: unknown[];
}

/** DB giả: trả lời theo đoạn SQL, ghi lại mọi câu lệnh để kiểm tra có ghi / xoá hay không. */
function fakeDb(opts: { ready?: boolean; existing?: Record<string, unknown>[]; lockedPeriods?: string[]; employees?: Record<string, unknown>[] } = {}) {
  const calls: Call[] = [];
  const employees = opts.employees ?? [
    { employee_id: E1, employee_code: 'NV1', full_name: 'Nhân viên 1', join_date: '2020-01-01', inactive_from: null, unit_id: null, unit_name: null },
    { employee_id: E2, employee_code: 'NV2', full_name: 'Nhân viên 2', join_date: '2020-01-01', inactive_from: null, unit_id: null, unit_name: null },
  ];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ ready: opts.ready !== false }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.shift_definitions'))
      return {
        rows: [
          { id: ADMIN, code: 'HC', name: 'Hành chính', start_time: '08:00', end_time: '17:00', break_minutes: 60, status: 'ACTIVE' },
          { id: MORNING, code: 'S', name: 'Sáng', start_time: '08:00', end_time: '12:00', break_minutes: 0, status: 'ACTIVE' },
        ],
        rowCount: 2,
      };
    if (sql.includes('FROM hrm_schema.employee_profiles p')) return { rows: employees, rowCount: employees.length };
    if (sql.includes('FROM hrm_schema.employee_work_days') && sql.includes("status = 'ACTIVE'") && sql.includes('SELECT id, employee_id'))
      return { rows: opts.existing ?? [], rowCount: (opts.existing ?? []).length };
    if (sql.includes('period_code') && sql.includes("status = 'LOCKED'"))
      return { rows: (opts.lockedPeriods ?? []).map((period_code) => ({ period_code })), rowCount: (opts.lockedPeriods ?? []).length };
    if (sql.includes('FROM hrm_schema.timesheet_periods'))
      return {
        rows: (opts.lockedPeriods ?? []).map((p) => ({ id: p, status: 'LOCKED' })),
        rowCount: (opts.lockedPeriods ?? []).length,
      };
    if (sql.includes('RETURNING id')) return { rows: [{ id: '00000000-0000-4000-8000-0000000000b1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query } as never, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql) && !c.sql.includes('timesheet_periods'));
const inserts = (calls: Call[], table: string) => calls.filter((c) => /^\s*INSERT INTO/i.test(c.sql) && c.sql.includes(table));

const OFFICE = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'SHIFT' as const, shiftId: ADMIN }));
const base = (over: Partial<ApplyScheduleInput> = {}): ApplyScheduleInput => ({
  scope: { type: 'EMPLOYEES', employeeIds: [E1, E2] },
  pattern: OFFICE,
  fromDate: '2026-10-05',
  toDate: '2026-10-09',
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  employee_id: E1,
  work_date: '2026-10-06',
  day_type: 'SHIFT',
  shift_id: MORNING,
  source: 'TEMPLATE',
  ...over,
});

describe('xem trước phân ca', () => {
  it('đếm ngày sẽ tạo và không ghi gì vào DB', async () => {
    const { db, calls } = fakeDb({ lockedPeriods: [] });
    const preview = await previewSchedule(db, 'tenant-preview-1', base());
    expect(preview.summary).toMatchObject({ insert: 10, replace: 0, conflicts: 0, employees: 2 });
    expect(preview.employeeCount).toBe(2);
    expect(writes(calls)).toHaveLength(0);
  });

  it('liệt kê xung đột theo nhân viên, ngày và ca hiện có', async () => {
    const { db } = fakeDb({ existing: [row()] });
    const preview = await previewSchedule(db, 'tenant-preview-2', base());
    expect(preview.conflictTotal).toBe(1);
    expect(preview.conflicts[0]).toMatchObject({
      employeeCode: 'NV1',
      date: '2026-10-06',
      existing: { shiftCode: 'S', source: 'TEMPLATE' },
      incoming: { shiftCode: 'HC' },
    });
  });

  it('báo kỳ công đã khoá giao với khoảng ngày', async () => {
    const { db } = fakeDb({ lockedPeriods: ['2026-10'] });
    expect((await previewSchedule(db, 'tenant-preview-3', base())).lockedPeriods).toEqual(['2026-10']);
  });

  it('toàn công ty luôn cần xác nhận; ghi đè cũng cần xác nhận', async () => {
    const company = await previewSchedule(fakeDb().db, 'tenant-preview-4', base({ scope: { type: 'COMPANY' } }));
    expect(company.requiresConfirmation).toBe(true);
    expect(company.confirmReasons.join(' ')).toContain('toàn công ty');
    const overwrite = await previewSchedule(fakeDb({ existing: [row()] }).db, 'tenant-preview-5', base({ conflictMode: 'OVERWRITE_ALL' }));
    expect(overwrite.summary.replace).toBe(1);
    expect(overwrite.requiresConfirmation).toBe(true);
  });

  it('tenant chưa chạy migration thì báo rõ thay vì lỗi SQL', async () => {
    await expect(previewSchedule(fakeDb({ ready: false }).db, 'tenant-not-migrated', base())).rejects.toMatchObject({
      response: { code: 'HRM_SCHEDULE_NOT_MIGRATED' },
    });
  });

  it('từ chối đầu vào sai: khoảng ngày ngược, mẫu rỗng, ca không tồn tại', async () => {
    const { db } = fakeDb();
    await expect(previewSchedule(db, 't-bad-1', base({ fromDate: '2026-10-09', toDate: '2026-10-05' }))).rejects.toThrow('Ngày kết thúc');
    await expect(previewSchedule(db, 't-bad-2', base({ pattern: [] }))).rejects.toThrow('mẫu lịch');
    await expect(
      previewSchedule(db, 't-bad-3', base({ pattern: [{ weekday: 1, dayType: 'SHIFT', shiftId: '00000000-0000-4000-8000-0000000000ff' }] })),
    ).rejects.toThrow('không tồn tại');
  });
});

describe('áp dụng phân ca', () => {
  it('10. xung đột ở chế độ mặc định: ném 409, không ghi gì', async () => {
    const { db, calls } = fakeDb({ existing: [row()] });
    const error = await applySchedule(db, 'tenant-apply-1', ACTOR, base()).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'HRM_SCHEDULE_CONFLICT', summary: { conflicts: 1 } });
    expect(inserts(calls, 'employee_work_days')).toHaveLength(0);
  });

  it('gán nhiều nhân viên được ghi trong một lần và có nhật ký cho từng nhân viên', async () => {
    const { db, calls } = fakeDb();
    const result = await applySchedule(db, 'tenant-apply-2', ACTOR, base());
    expect(result).toMatchObject({ appliedDays: 10, employeeCount: 2 });
    const days = inserts(calls, 'employee_work_days')[0];
    expect((days.params[5] as string[]).length).toBe(10); // employee_id[]
    const audit = inserts(calls, 'work_schedule_audit')[0];
    expect(audit.params[7]).toEqual([E1, E2]); // một dòng nhật ký mỗi nhân viên
    expect(inserts(calls, 'work_schedule_batches')).toHaveLength(1);
  });

  it('toàn công ty chưa xác nhận thì ném 409 CONFIRM_REQUIRED, xác nhận rồi mới ghi', async () => {
    const input = base({ scope: { type: 'COMPANY' } });
    const first = fakeDb();
    const error = await applySchedule(first.db, 'tenant-apply-3', ACTOR, input).catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'HRM_SCHEDULE_CONFIRM_REQUIRED' });
    expect(inserts(first.calls, 'employee_work_days')).toHaveLength(0);
    const second = fakeDb();
    await expect(applySchedule(second.db, 'tenant-apply-3', ACTOR, { ...input, confirm: true })).resolves.toMatchObject({ appliedDays: 10 });
  });

  it('11/14. khoảng ngày thuộc kỳ công đã khoá thì bị chặn, không ghi', async () => {
    const { db, calls } = fakeDb({ lockedPeriods: ['p1'] });
    await expect(applySchedule(db, 'tenant-apply-4', ACTOR, base({ scope: { type: 'EMPLOYEE', employeeIds: [E1] } }))).rejects.toThrow('Kỳ công đã khóa');
    expect(inserts(calls, 'employee_work_days')).toHaveLength(0);
  });

  it('3. SKIP_EXISTING giữ nguyên ngày đã có lịch, chỉ tạo ngày còn thiếu', async () => {
    const { db, calls } = fakeDb({ existing: [row()] });
    const result = await applySchedule(db, 'tenant-apply-5', ACTOR, base({ conflictMode: 'SKIP_EXISTING' }));
    expect(result.appliedDays).toBe(9);
    expect(calls.some((c) => c.sql.includes("SET status = 'CANCELLED'"))).toBe(false);
  });

  it('ghi đè: dòng cũ chuyển CANCELLED (giữ lịch sử), không bao giờ xoá cứng', async () => {
    const { db, calls } = fakeDb({ existing: [row()] });
    await applySchedule(db, 'tenant-apply-6', ACTOR, base({ conflictMode: 'OVERWRITE_ALL', confirm: true }));
    const cancelled = calls.filter((c) => c.sql.includes("SET status = 'CANCELLED'"));
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].params[1]).toEqual(['00000000-0000-4000-8000-0000000000c1']);
    expect(calls.some((c) => /DELETE FROM hrm_schema\.employee_work_days/i.test(c.sql))).toBe(false);
  });

  it('OVERWRITE_KEEP_EXCEPTIONS không đụng ngoại lệ', async () => {
    const { db, calls } = fakeDb({ existing: [row({ source: 'EXCEPTION' })] });
    const result = await applySchedule(db, 'tenant-apply-7', ACTOR, base({ conflictMode: 'OVERWRITE_KEEP_EXCEPTIONS', confirm: true }));
    expect(result.appliedDays).toBe(9);
    expect(calls.some((c) => c.sql.includes("SET status = 'CANCELLED'"))).toBe(false);
  });

  it('7. ngoại lệ một ngày chỉ thay đúng ngày đó', async () => {
    const { db, calls } = fakeDb({
      existing: [row({ work_date: '2026-10-07', source: 'TEMPLATE', shift_id: ADMIN })],
      employees: [{ employee_id: E1, employee_code: 'NV1', full_name: 'Nhân viên 1', join_date: '2020-01-01', inactive_from: null, unit_id: null, unit_name: null }],
    });
    const result = await applySchedule(
      db,
      'tenant-apply-8',
      ACTOR,
      {
        kind: 'EXCEPTION',
        scope: { type: 'EMPLOYEE', employeeIds: [E1] },
        pattern: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, dayType: 'OFF' as const })),
        fromDate: '2026-10-07',
        toDate: '2026-10-07',
        confirm: true,
        reason: 'Nghỉ bù',
      },
    );
    expect(result.appliedDays).toBe(1);
    expect(calls.filter((c) => c.sql.includes("SET status = 'CANCELLED'"))[0].params[1]).toEqual(['00000000-0000-4000-8000-0000000000c1']);
    expect(inserts(calls, 'work_schedule_batches')[0].params[1]).toBe('EXCEPTION');
  });
});

describe('thứ tự tra ca cho bảng công', () => {
  const shiftRow = {
    id: ADMIN,
    assignment_id: 'w1',
    day_type: 'SHIFT',
    start_time: '08:00:00',
    end_time: '17:00:00',
    starts_at: '2026-10-05T01:00:00Z',
    ends_at: '2026-10-05T10:00:00Z',
  };

  function resolverDb(scheduleRow: Record<string, unknown> | undefined, ready = true) {
    const sqls: string[] = [];
    const db = {
      query: jest.fn(async (sql: string) => {
        sqls.push(sql);
        if (sql.includes('to_regclass') && sql.includes('employee_work_days')) return { rows: [{ ready }], rowCount: 1 };
        if (sql.includes('FROM hrm_schema.employee_work_days')) return { rows: scheduleRow ? [scheduleRow] : [], rowCount: scheduleRow ? 1 : 0 };
        if (sql.includes('unit_shift_assignments') && sql.includes('to_regclass')) return { rows: [{ ready: false }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    return { db: db as never, sqls };
  }

  it('lịch từng ngày có ca thì dùng ca đó và không tra lớp cũ', async () => {
    const { db, sqls } = resolverDb(shiftRow);
    const result = await resolveDay(db, 'tenant-resolve-1', E1, '2026-10-05', 'Asia/Ho_Chi_Minh');
    expect(result.scheduleDayType).toBe('SHIFT');
    expect(result.picked?.source).toBe('SCHEDULE');
    expect(sqls.some((s) => s.includes('shift_assignments a'))).toBe(false);
  });

  it('lịch ghi OFF tường minh: không có ca và không rơi xuống ca cũ', async () => {
    const { db, sqls } = resolverDb({ day_type: 'OFF', id: null });
    const result = await resolveDay(db, 'tenant-resolve-2', E1, '2026-10-11', 'Asia/Ho_Chi_Minh');
    expect(result).toEqual({ picked: null, scheduleDayType: 'OFF' });
    expect(sqls.some((s) => s.includes('hrm_schema.shift_assignments'))).toBe(false);
  });

  it('ngày lễ không bố trí ca trả HOLIDAY', async () => {
    const { db } = resolverDb({ day_type: 'HOLIDAY', id: null });
    expect((await resolveDay(db, 'tenant-resolve-3', E1, '2026-09-02', 'Asia/Ho_Chi_Minh')).scheduleDayType).toBe('HOLIDAY');
  });

  it('chưa có dòng lịch thì chưa có ca và không còn tra các bảng gán ca cũ', async () => {
    const { db, sqls } = resolverDb(undefined);
    const result = await resolveDay(db, 'tenant-resolve-4', E1, '2026-10-05', 'Asia/Ho_Chi_Minh');
    expect(result).toEqual({ picked: null, scheduleDayType: null });
    expect(sqls.some((s) => s.includes('shift_assignments'))).toBe(false);
  });

  it('tenant chưa migrate: không truy vấn bảng mới và không lỗi', async () => {
    const { db, sqls } = resolverDb(undefined, false);
    await expect(resolveDay(db, 'tenant-resolve-5', E1, '2026-10-05', 'Asia/Ho_Chi_Minh')).resolves.toEqual({ picked: null, scheduleDayType: null });
    expect(sqls.some((s) => s.includes('FROM hrm_schema.employee_work_days'))).toBe(false);
  });
});

describe('8. ngày lễ giữ ca thường lệ để tính công trả lương như cũ', () => {
  const holidayInput = {
    name: 'Quốc khánh',
    kind: 'HOLIDAY' as const,
    fromDate: '2026-10-07',
    toDate: '2026-10-07',
    scope: { type: 'COMPANY' as const },
    treatment: 'OFF' as const,
    paid: true,
  };

  it('ngày lễ nghỉ thay lịch thường nhưng lưu lại ca bị thay; nhân viên chưa có lịch thì không có ca', async () => {
    const { db, calls } = fakeDb({ existing: [row({ work_date: '2026-10-07', shift_id: ADMIN })] });
    const result = await createHoliday(db, 'tenant-holiday-1', ACTOR, holidayInput);
    expect(result.summary).toMatchObject({ replace: 1, insert: 1, employees: 2 });
    const days = inserts(calls, 'employee_work_days')[0];
    expect(days.params[7]).toEqual(['HOLIDAY', 'HOLIDAY']); // day_type
    expect(days.params[8]).toEqual([ADMIN, null]); // E1 giữ ca HC bị thay, E2 chưa có lịch nên không có ca
    const replaced = calls.find((c) => c.sql.includes("SET status = 'CANCELLED'"));
    expect(replaced?.params[2]).toMatch(/^OVERRIDDEN_BY_HOLIDAY:/); // để hủy lễ thì khôi phục được
  });

  it('ngày lễ toàn công ty tạo dòng work_calendar để công thức tính công nhận ra ngày lễ', async () => {
    const { db, calls } = fakeDb();
    await createHoliday(db, 'tenant-holiday-2', ACTOR, holidayInput);
    const calendar = inserts(calls, 'work_calendar')[0];
    expect(calendar.sql).toContain("'HOLIDAY'");
    expect(calendar.sql).toContain('ON CONFLICT (tenant_id, work_date) DO NOTHING');
  });

  it('ngày lễ theo phòng ban không đụng lịch lễ công ty (work_calendar)', async () => {
    const { db, calls } = fakeDb();
    await createHoliday(db, 'tenant-holiday-3', ACTOR, {
      ...holidayInput,
      scope: { type: 'EMPLOYEES', employeeIds: [E1] } as never,
    });
    expect(inserts(calls, 'work_calendar')).toHaveLength(0);
  });

  it('ngày lễ không đè ngoại lệ đã có', async () => {
    const { db, calls } = fakeDb({ existing: [row({ work_date: '2026-10-07', source: 'EXCEPTION', day_type: 'OFF', shift_id: null })] });
    const result = await createHoliday(db, 'tenant-holiday-4', ACTOR, holidayInput);
    expect(result.summary.skipped).toBe(1);
    expect(calls.some((c) => c.sql.includes("SET status = 'CANCELLED'") && String(c.params[2]).startsWith('OVERRIDDEN'))).toBe(false);
  });

  it('tra ca ngày lễ: có ca lưu kèm thì dùng ca đó; không có thì không có ca (không còn lớp ca cũ)', async () => {
    const shiftRow = { id: ADMIN, assignment_id: 'w1', day_type: 'HOLIDAY', starts_at: '2026-10-07T01:00:00Z', ends_at: '2026-10-07T10:00:00Z' };
    const make = (scheduleRow: Record<string, unknown>) => {
      const sqls: string[] = [];
      return {
        sqls,
        db: {
          query: jest.fn(async (sql: string) => {
            sqls.push(sql);
            if (sql.includes('to_regclass') && sql.includes('employee_work_days')) return { rows: [{ ready: true }], rowCount: 1 };
            if (sql.includes('FROM hrm_schema.employee_work_days')) return { rows: [scheduleRow], rowCount: 1 };
            if (sql.includes('to_regclass')) return { rows: [{ ready: false }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          }),
        } as never,
      };
    };
    const withShift = make(shiftRow);
    const a = await resolveDay(withShift.db, 'tenant-holiday-5', E1, '2026-10-07', 'Asia/Ho_Chi_Minh');
    expect(a.scheduleDayType).toBe('HOLIDAY');
    expect(a.picked?.source).toBe('SCHEDULE');
    const without = make({ day_type: 'HOLIDAY', id: null });
    const b = await resolveDay(without.db, 'tenant-holiday-6', E1, '2026-10-07', 'Asia/Ho_Chi_Minh');
    expect(b).toEqual({ picked: null, scheduleDayType: 'HOLIDAY', holidayPaid: null });
    expect(without.sqls.some((s) => s.includes('shift_assignments'))).toBe(false);
  });
});
