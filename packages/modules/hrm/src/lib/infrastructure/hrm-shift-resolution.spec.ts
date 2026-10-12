import { leaveDays } from './hrm-leave-operations.js';
import { resolveDay, resolveShiftRow } from './hrm-shift-resolution.js';
import { shiftForDate } from './hrm-time.js';

/** DB giả trả lời theo đoạn SQL nên thứ tự câu truy vấn thật không quan trọng. */
function fakeDb(opts: {
  /** Dòng lịch phân ca theo ngày (lấy theo params[2]); trả về day_type + cột ca. */
  schedule?: (date: string) => Record<string, unknown> | undefined;
  weeklyOff?: number[];
  calendar?: Record<string, string>;
  scheduleTable?: boolean;
}) {
  const sqls: string[] = [];
  return {
    sqls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      sqls.push(sql);
      if (sql.includes('FROM hrm_schema.leave_types')) return { rows: [{ id: 't', unit: 'DAYS', paid: true }] };
      if (sql.includes('generate_series($2::date,$3::date')) {
        const rows = [];
        for (let t = Date.parse(String(params[1])); t <= Date.parse(String(params[2])); t += 86400000) {
          const date = new Date(t).toISOString().slice(0, 10);
          rows.push({ date, day_kind: opts.calendar?.[date] ?? null });
        }
        return { rows };
      }
      if (sql.includes('hrm_schema.timesheet_periods')) return { rows: [] };
      if (sql.includes('FROM hrm_schema.policy_versions'))
        return { rows: [{ id: 'p', config_json: { weeklyOffDays: opts.weeklyOff ?? [] } }] };
      if (sql.includes('to_regclass') && sql.includes('employee_work_days')) return { rows: [{ ready: opts.scheduleTable ?? true }] };
      if (sql.includes('to_regclass')) return { rows: [{ ready: false }] }; // chưa có bảng lịch định kỳ
      if (sql.includes('FROM hrm_schema.employee_work_days')) {
        const row = opts.schedule?.(String(params[2]));
        if (sql.includes('SELECT day_type FROM')) return { rows: row ? [{ day_type: row.day_type }] : [] };
        return { rows: row ? [row] : [] };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    }),
  };
}

const shiftRow = (extra: Record<string, unknown> = {}) => ({
  id: 'shift-1',
  name: 'HC',
  day_type: 'SHIFT',
  assignment_id: 'w1',
  check_in_before_minutes: 60,
  check_out_after_minutes: 60,
  break_minutes: 60,
  grace_late_minutes: 0,
  grace_early_minutes: 0,
  starts_at: '2026-09-07T01:00:00Z',
  ends_at: '2026-09-07T10:00:00Z',
  break_starts_at: null,
  break_ends_at: null,
  ...extra,
});

describe('tra ca chỉ từ chức năng Phân ca làm việc', () => {
  it('có dòng lịch từng ngày thì dùng ca đó và nguồn là SCHEDULE', async () => {
    const db = fakeDb({ schedule: () => shiftRow({ name: 'ca lịch' }) });
    const picked = await resolveShiftRow(db as never, 't', 'e', '2026-09-07', 'UTC');
    expect(picked?.source).toBe('SCHEDULE');
    expect(picked?.row.name).toBe('ca lịch');
  });

  it('shiftForDate trả ca từ lịch và không còn nhận khái niệm ca kế thừa từ đơn vị', async () => {
    const db = fakeDb({ schedule: () => shiftRow() });
    const shift = await shiftForDate(db as never, 't', 'e', '2026-09-07', 'UTC');
    expect(shift).toMatchObject({ id: 'shift-1', source: 'SCHEDULE', unitId: null });
  });

  it('chưa có lịch: không có ca và không truy vấn các bảng gán ca cũ', async () => {
    const db = fakeDb({});
    expect(await resolveDay(db as never, 't1', 'e', '2026-09-07', 'UTC')).toEqual({ picked: null, scheduleDayType: null });
    expect(db.sqls.some((s) => s.includes('shift_assignments') || s.includes('unit_shift_assignments'))).toBe(false);
  });

  it('tenant chưa có bảng lịch: không có ca, không lỗi SQL', async () => {
    const db = fakeDb({ scheduleTable: false });
    expect(await resolveShiftRow(db as never, 'tenant-no-table', 'e', '2026-09-07', 'UTC')).toBeNull();
    expect(db.sqls.some((s) => s.includes('FROM hrm_schema.employee_work_days'))).toBe(false);
  });
});

describe('đơn nghỉ phép theo lịch phân ca và ngày nghỉ hằng tuần', () => {
  const body = (duration: number) => ({
    employeeId: '11111111-1111-4111-8111-111111111111',
    leaveTypeId: '22222222-2222-4222-8222-222222222222',
    fromDate: '2026-09-04', // Thứ Sáu
    toDate: '2026-09-07', // Thứ Hai
    duration,
    reason: 'viec rieng',
  });
  const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  /** Lịch hành chính: chỉ phủ T2-T6, cuối tuần chưa có dòng lịch. */
  const weekdaysOnly = (date: string) => (isWeekend(date) ? undefined : shiftRow());

  it('không tính Thứ Bảy/Chủ nhật khi chính sách đặt là ngày nghỉ hằng tuần', async () => {
    const db = fakeDb({ weeklyOff: [6, 0], schedule: weekdaysOnly });
    const { days } = await leaveDays(db as never, 't', body(2) as never);
    expect(days.map((d) => d.date)).toEqual(['2026-09-04', '2026-09-07']);
  });

  it('báo số ngày làm việc khi khoảng nghỉ vắt qua cuối tuần', async () => {
    const db = fakeDb({ weeklyOff: [6, 0], schedule: weekdaysOnly });
    await expect(leaveDays(db as never, 't', body(4) as never)).rejects.toThrow(/là 2 ngày/);
  });

  it('ngày làm việc chưa có ca trong lịch phân ca thì báo chưa phân ca', async () => {
    const db = fakeDb({ weeklyOff: [], schedule: weekdaysOnly });
    await expect(leaveDays(db as never, 't', body(4) as never)).rejects.toThrow('Chưa phân ca ngày 2026-09-05');
  });

  it('lịch phân ca ghi OFF cho cuối tuần thì cuối tuần không bị trừ phép dù chính sách không có ngày nghỉ hằng tuần', async () => {
    const db = fakeDb({
      weeklyOff: [],
      schedule: (date) => (isWeekend(date) ? { day_type: 'OFF', id: null } : shiftRow()),
    });
    const { days } = await leaveDays(db as never, 't', body(2) as never);
    expect(days.map((d) => d.date)).toEqual(['2026-09-04', '2026-09-07']);
  });

  it('lịch phân ca có ca vào Thứ Bảy thì Thứ Bảy là ngày làm việc dù chính sách đặt nghỉ', async () => {
    const db = fakeDb({
      weeklyOff: [6, 0],
      schedule: (date) => (date === '2026-09-05' ? shiftRow({ name: 'ca T7' }) : weekdaysOnly(date)),
    });
    const { days } = await leaveDays(db as never, 't', body(3) as never);
    expect(days.map((d) => d.date)).toEqual(['2026-09-04', '2026-09-05', '2026-09-07']);
  });

  it('lịch phân ca ghi OFF một ngày thường thì ngày đó không bị trừ phép', async () => {
    const db = fakeDb({
      weeklyOff: [6, 0],
      schedule: (date) => (date === '2026-09-07' ? { day_type: 'OFF', id: null } : weekdaysOnly(date)),
    });
    const { days } = await leaveDays(db as never, 't', body(1) as never);
    expect(days.map((d) => d.date)).toEqual(['2026-09-04']);
  });
});
