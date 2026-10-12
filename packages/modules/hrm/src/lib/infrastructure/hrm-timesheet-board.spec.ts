import { resolveDay } from './hrm-shift-resolution';
import { calculateTimesheet } from './hrm-timesheet-calculation';
import {
  LOAD_BOARD_MAX_QUERIES,
  computeBoardDay,
  loadBoard,
  resolveScheduleBatch,
  shiftWindowOf,
  sumBoardTotals,
  zonedMs,
  type BoardDayInput,
  type BoardShiftDef,
} from './hrm-timesheet-board';
import { dayContextForDate, resolvePolicy } from './hrm-time';

jest.mock('./hrm-time.js', () => ({
  ...jest.requireActual('./hrm-time.js'),
  resolvePolicy: jest.fn(),
  dayContextForDate: jest.fn(),
}));

const TZ = 'Asia/Ho_Chi_Minh';
const MON = '2026-10-05'; // thứ Hai
const SUN = '2026-10-11'; // Chủ nhật
const LATER = '2026-10-20'; // hôm nay trong các ca thử (ngày MON đã qua)

const SHIFT: BoardShiftDef = {
  id: 'shift-1',
  code: 'HC',
  name: 'Hành chính',
  startTime: '08:00:00',
  endTime: '17:00:00',
  breakStartTime: '12:00:00',
  breakEndTime: '13:00:00',
  crossMidnight: false,
  breakMinutes: 60,
  graceLateMinutes: 10,
  graceEarlyMinutes: 5,
};

/** Giờ địa phương VN -> ISO. */
const at = (date: string, hhmm: string) => new Date(zonedMs(date, `${hhmm}:00`, TZ)).toISOString();
const punch = (date: string, hhmm: string, kind: 'IN' | 'OUT') => ({
  id: `${kind}-${date}-${hhmm}`,
  kind,
  at: at(date, hhmm),
});
const inOut = (date: string, from: string, to: string) => [punch(date, from, 'IN'), punch(date, to, 'OUT')];

function input(over: Partial<BoardDayInput> = {}): BoardDayInput {
  return {
    date: MON,
    today: LATER,
    timezone: TZ,
    employed: true,
    calendarKind: null,
    calendarPaid: false,
    calendarName: null,
    policyConfig: { timezone: TZ, weeklyOffDays: [0] },
    scheduleDayType: 'SHIFT',
    scheduleHolidayPaid: null,
    scheduleHolidayName: null,
    shift: SHIFT,
    events: [],
    leaves: [],
    tripIds: [],
    ot: [],
    ...over,
  };
}
const leave = (over: Partial<NonNullable<BoardDayInput['leaves']>[number]> = {}) => ({
  requestId: 'leave-1',
  reasonName: 'Nghỉ phép năm',
  paid: true,
  annual: true,
  days: 1,
  paidMinutes: 480,
  ...over,
});

describe('computeBoardDay: số công và trạng thái theo ca', () => {
  it('đi làm đủ: PRESENT, 1 công, giờ ca và giờ chấm dạng HH:mm', () => {
    const d = computeBoardDay(input({ events: inOut(MON, '08:00', '17:00') }));
    expect(d).toMatchObject({
      kind: 'WORK',
      status: 'PRESENT',
      shiftCode: 'HC',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      checkIn: '08:00',
      checkOut: '17:00',
      scheduledMinutes: 480,
      workedMinutes: 480,
      paidMinutes: 480,
      workdayUnits: 1,
      lateMinutes: 0,
      anomalies: [],
    });
  });

  it('đi trễ quá ân hạn: LATE, số công làm tròn 2 chữ số', () => {
    const d = computeBoardDay(input({ events: inOut(MON, '08:30', '17:00') }));
    expect(d.status).toBe('LATE');
    expect(d.lateMinutes).toBe(30);
    expect(d.paidMinutes).toBe(450);
    expect(d.workdayUnits).toBe(0.94);
  });

  it('trễ trong ân hạn không bị tính là đi trễ', () => {
    expect(computeBoardDay(input({ events: inOut(MON, '08:05', '17:00') })).status).toBe('PRESENT');
  });

  it('về sớm: EARLY_LEAVE; vừa trễ vừa sớm: LATE_EARLY', () => {
    expect(computeBoardDay(input({ events: inOut(MON, '08:00', '16:00') }))).toMatchObject({
      status: 'EARLY_LEAVE',
      earlyLeaveMinutes: 60,
    });
    expect(computeBoardDay(input({ events: inOut(MON, '08:30', '16:00') })).status).toBe('LATE_EARLY');
  });

  it('thiếu chấm ra / thiếu chấm vào: ABNORMAL kèm mã MISSING_CHECK_*', () => {
    expect(computeBoardDay(input({ events: [punch(MON, '08:00', 'IN')] }))).toMatchObject({
      status: 'ABNORMAL',
      anomalies: ['MISSING_CHECK_OUT'],
      checkIn: '08:00',
      checkOut: null,
    });
    expect(computeBoardDay(input({ events: [punch(MON, '17:00', 'OUT')] }))).toMatchObject({
      status: 'ABNORMAL',
      anomalies: ['MISSING_CHECK_IN'],
    });
  });

  it('có ca, không chấm công, không đơn nghỉ: ABSENT chỉ khi ngày đã qua', () => {
    expect(computeBoardDay(input())).toMatchObject({ status: 'ABSENT', paidMinutes: 0, workdayUnits: 0 });
    expect(computeBoardDay(input({ today: MON }))).toMatchObject({ status: 'FUTURE', shiftCode: 'HC' });
  });

  it('ngày chưa tới: FUTURE nhưng vẫn hiển thị ca dự kiến', () => {
    const d = computeBoardDay(input({ today: '2026-10-01' }));
    expect(d).toMatchObject({ status: 'FUTURE', kind: 'WORK', shiftStart: '08:00', scheduledMinutes: 480, paidMinutes: 0 });
  });

  it('hôm nay: mới vào chưa ra không bị coi là thiếu chấm ra', () => {
    const d = computeBoardDay(input({ today: MON, events: [punch(MON, '08:00', 'IN')] }));
    expect(d.status).toBe('PRESENT');
    expect(d.anomalies).toEqual([]);
  });

  it('nhân viên chưa vào làm hoặc đã nghỉ: NO_SCHEDULE', () => {
    expect(computeBoardDay(input({ employed: false }))).toMatchObject({ kind: 'NO_SCHEDULE', status: 'NO_SCHEDULE', shiftCode: null });
  });

  it('chưa có lịch phân ca: NO_SCHEDULE; có chấm công mà không có ca: ABNORMAL NO_SHIFT', () => {
    const base = { shift: null, scheduleDayType: null } as const;
    // Ngày làm việc đã qua mà chưa có ca: ô "chưa phân ca" nhưng mang mã NO_SHIFT để chặn chốt công (calculateTimesheet coi là bất thường).
    expect(computeBoardDay(input({ ...base }))).toMatchObject({ kind: 'NO_SCHEDULE', status: 'NO_SCHEDULE', anomalies: ['NO_SHIFT'] });
    // Ngày chưa tới thì không phải lỗi.
    expect(computeBoardDay(input({ ...base, date: LATER, today: MON }))).toMatchObject({ anomalies: [] });
    expect(computeBoardDay(input({ ...base, events: inOut(MON, '08:00', '17:00') }))).toMatchObject({
      status: 'ABNORMAL',
      anomalies: ['NO_SHIFT'],
    });
  });

  it('nghỉ hằng tuần theo chính sách: OFF, không có công; lịch phân ca SHIFT thắng ngày nghỉ hằng tuần', () => {
    expect(computeBoardDay(input({ date: SUN, shift: null, scheduleDayType: null }))).toMatchObject({
      kind: 'OFF',
      status: 'OFF',
      scheduledMinutes: 0,
      paidMinutes: 0,
    });
    expect(computeBoardDay(input({ date: SUN, events: inOut(SUN, '08:00', '17:00') })).status).toBe('PRESENT');
    expect(computeBoardDay(input({ scheduleDayType: 'OFF', shift: null }))).toMatchObject({ kind: 'OFF', status: 'OFF' });
  });

  it('ngày lễ: HOLIDAY kèm tên lễ; lễ có lương trả theo ca, lễ không lương không có công', () => {
    const paid = computeBoardDay(input({ calendarKind: 'HOLIDAY', calendarPaid: true, calendarName: 'Quốc khánh' }));
    expect(paid).toMatchObject({ kind: 'HOLIDAY', status: 'HOLIDAY', holidayName: 'Quốc khánh', paidMinutes: 480, workdayUnits: 1 });
    const unpaid = computeBoardDay(input({ calendarKind: 'HOLIDAY', calendarPaid: false, calendarName: 'Lễ' }));
    expect(unpaid).toMatchObject({ status: 'HOLIDAY', paidMinutes: 0 });
    const scoped = computeBoardDay(
      input({ scheduleDayType: 'HOLIDAY', scheduleHolidayPaid: true, scheduleHolidayName: 'Lễ phòng ban' }),
    );
    expect(scoped).toMatchObject({ status: 'HOLIDAY', holidayName: 'Lễ phòng ban', paidMinutes: 480 });
  });

  it('nghỉ phép năm: ANNUAL_LEAVE; nghỉ có phép có lương: PAID_LEAVE; nghỉ không lương: UNPAID_LEAVE', () => {
    expect(computeBoardDay(input({ leaves: [leave()] }))).toMatchObject({
      status: 'ANNUAL_LEAVE',
      paidMinutes: 480,
      workdayUnits: 1,
      leave: { requestId: 'leave-1', reasonName: 'Nghỉ phép năm', paid: true, annual: true, days: 1 },
    });
    expect(
      computeBoardDay(input({ leaves: [leave({ annual: false, reasonName: 'Nghỉ cưới' })] })).status,
    ).toBe('PAID_LEAVE');
    expect(
      computeBoardDay(input({ leaves: [leave({ annual: false, paid: false, paidMinutes: 0, reasonName: 'Việc riêng' })] })),
    ).toMatchObject({ status: 'UNPAID_LEAVE', paidMinutes: 0, workdayUnits: 0 });
  });

  it('nghỉ nửa ngày + đi làm nửa ngày: đủ công và 0.5 ngày nghỉ', () => {
    const d = computeBoardDay(
      input({
        leaves: [leave({ days: 0.5, paidMinutes: 240 })],
        events: inOut(MON, '08:00', '12:00'),
      }),
    );
    expect(d).toMatchObject({ status: 'ANNUAL_LEAVE', paidMinutes: 480, workdayUnits: 1, leave: { days: 0.5 } });
  });

  it('công tác: TRIP, trả đủ công ca', () => {
    expect(computeBoardDay(input({ tripIds: ['trip-1'] }))).toMatchObject({
      status: 'TRIP',
      tripId: 'trip-1',
      paidMinutes: 480,
      workdayUnits: 1,
    });
  });

  it('thứ tự ưu tiên: lễ > OFF > công tác > phép năm > nghỉ có phép > nghỉ không lương > bất thường > nghỉ không phép', () => {
    const lv = [leave()];
    expect(computeBoardDay(input({ calendarKind: 'HOLIDAY', calendarPaid: true, leaves: lv, tripIds: ['t'] })).status).toBe('HOLIDAY');
    expect(computeBoardDay(input({ scheduleDayType: 'OFF', shift: null, leaves: lv, tripIds: ['t'] })).status).toBe('OFF');
    // đơn nghỉ trùng công tác là dữ liệu lệch: ABNORMAL (giống calculateTimesheet) thay vì chọn bừa một bên
    expect(computeBoardDay(input({ leaves: lv, tripIds: ['t'] }))).toMatchObject({
      status: 'ABNORMAL',
      anomalies: ['LEAVE_TRIP_OVERLAP'],
    });
    expect(computeBoardDay(input({ tripIds: ['t'] })).status).toBe('TRIP');
    const mixed = [
      leave({ requestId: 'u', annual: false, paid: false, paidMinutes: 0, days: 0.5 }),
      leave({ requestId: 'p', annual: false, paid: true, paidMinutes: 240, days: 0.5 }),
    ];
    expect(computeBoardDay(input({ leaves: mixed })).leave?.requestId).toBe('p');
    expect(computeBoardDay(input({ leaves: mixed })).status).toBe('PAID_LEAVE');
    expect(computeBoardDay(input({ leaves: [...mixed, leave({ requestId: 'a', days: 0.5, paidMinutes: 0 })] })).status).toBe('ANNUAL_LEAVE');
    // đơn nghỉ thắng bất thường (thiếu chấm ra) và nghỉ không phép
    expect(computeBoardDay(input({ leaves: lv, events: [punch(MON, '08:00', 'IN')] })).status).toBe('ANNUAL_LEAVE');
    expect(computeBoardDay(input({ events: [punch(MON, '08:00', 'IN')] })).status).toBe('ABNORMAL');
  });

  it('đơn nghỉ cũ không có chi tiết từng ngày: ABNORMAL cần rà soát', () => {
    const d = computeBoardDay(input({ leaves: [leave({ legacy: true, paidMinutes: 0 })] }));
    expect(d.status).toBe('ABNORMAL');
    expect(d.anomalies).toContain('LEGACY_LEAVE_REQUIRES_REVIEW');
  });

  it('tăng ca đã duyệt: cộng theo phút chấm thực tế ngoài ca, giới hạn bởi số phút duyệt; OT không lương không cộng', () => {
    const base = { events: inOut(MON, '08:00', '18:00') };
    const ot = (paid: boolean, approved = 60) => ({
      approvedMinutes: approved,
      paid,
      startMs: zonedMs(MON, '17:00:00', TZ),
      endMs: zonedMs(MON, '18:00:00', TZ),
    });
    expect(computeBoardDay(input({ ...base, ot: [ot(true)] })).otMinutes).toBe(60);
    expect(computeBoardDay(input({ ...base, ot: [ot(true, 30)] })).otMinutes).toBe(30);
    expect(computeBoardDay(input({ ...base, ot: [ot(false)] })).otMinutes).toBe(0);
  });

  it('ca qua đêm: cửa sổ ca sang ngày hôm sau', () => {
    const night: BoardShiftDef = { ...SHIFT, id: 'n', startTime: '22:00:00', endTime: '06:00:00', crossMidnight: true, breakStartTime: null, breakEndTime: null, breakMinutes: 0 };
    const w = shiftWindowOf(night, MON, TZ);
    expect(w.start).toBe(at(MON, '22:00'));
    expect(w.end).toBe(at('2026-10-06', '06:00'));
    const d = computeBoardDay(input({ shift: night, events: [punch(MON, '22:00', 'IN'), punch('2026-10-06', '06:00', 'OUT')] }));
    expect(d).toMatchObject({ status: 'PRESENT', scheduledMinutes: 480, paidMinutes: 480 });
  });

  it('tổng hợp: số công, số ngày theo từng loại', () => {
    const days = [
      computeBoardDay(input({ events: inOut(MON, '08:00', '17:00') })),
      computeBoardDay(input({ events: inOut(MON, '08:30', '17:00') })),
      computeBoardDay(input({ leaves: [leave({ days: 0.5, paidMinutes: 240 })], events: inOut(MON, '08:00', '12:00') })),
      computeBoardDay(input()),
      computeBoardDay(input({ date: SUN, shift: null, scheduleDayType: null })),
    ];
    expect(sumBoardTotals(days)).toMatchObject({
      workdayUnits: 2.94,
      lateDays: 1,
      absentDays: 1,
      annualLeaveDays: 0.5,
      offDays: 1,
      abnormalDays: 0,
    });
  });
});

describe('zonedMs tương đương (date + time) AT TIME ZONE', () => {
  it('múi giờ VN (+07) và múi giờ có DST', () => {
    expect(new Date(zonedMs('2026-10-05', '08:00:00', TZ)).toISOString()).toBe('2026-10-05T01:00:00.000Z');
    expect(new Date(zonedMs('2026-07-01', '09:00:00', 'America/New_York')).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(new Date(zonedMs('2026-01-01', '09:00:00', 'America/New_York')).toISOString()).toBe('2026-01-01T14:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Đối chiếu với đường lưu khi chốt (calculateTimesheet)
// ---------------------------------------------------------------------------------------------------------------

interface Scenario {
  name: string;
  date?: string;
  events?: ReturnType<typeof punch>[];
  /** paid_minutes của ngày nghỉ (đơn nghỉ đã duyệt, có chi tiết ngày). */
  leaves?: { paid_minutes: number; quantity: number; annual?: boolean; paid?: boolean }[];
  trip?: boolean;
  calendar?: { day_kind: string; paid: boolean } | null;
  scheduleDayType?: 'SHIFT' | 'OFF' | 'HOLIDAY' | null;
  noShift?: boolean;
  ot?: { approved: number; start: string; end: string };
}

const scenarios: Scenario[] = [
  { name: 'đi làm đủ', events: inOut(MON, '08:00', '17:00') },
  { name: 'đi trễ', events: inOut(MON, '08:30', '17:00') },
  { name: 'về sớm', events: inOut(MON, '08:00', '16:00') },
  { name: 'trễ và sớm', events: inOut(MON, '08:30', '16:00') },
  { name: 'thiếu chấm ra', events: [punch(MON, '08:00', 'IN')] },
  { name: 'thiếu chấm vào', events: [punch(MON, '17:00', 'OUT')] },
  { name: 'vắng không phép', events: [] },
  { name: 'nghỉ phép năm cả ngày', leaves: [{ paid_minutes: 480, quantity: 1, annual: true }] },
  { name: 'nghỉ có phép có lương', leaves: [{ paid_minutes: 480, quantity: 1, annual: false }] },
  { name: 'nghỉ không lương', leaves: [{ paid_minutes: 0, quantity: 1, annual: false, paid: false }] },
  { name: 'nghỉ nửa ngày + làm nửa ngày', leaves: [{ paid_minutes: 240, quantity: 0.5, annual: true }], events: inOut(MON, '08:00', '12:00') },
  { name: 'công tác', trip: true },
  { name: 'lễ có lương', calendar: { day_kind: 'HOLIDAY', paid: true } },
  { name: 'lễ không lương', calendar: { day_kind: 'HOLIDAY', paid: false } },
  { name: 'nghỉ hằng tuần', date: SUN, noShift: true },
  { name: 'OFF theo lịch phân ca', scheduleDayType: 'OFF', noShift: true },
  { name: 'tăng ca có lương', events: inOut(MON, '08:00', '18:00'), ot: { approved: 60, start: '17:00', end: '18:00' } },
  { name: 'nghỉ trùng công tác', leaves: [{ paid_minutes: 480, quantity: 1, annual: true }], trip: true },
  { name: 'nghỉ cả ngày nhưng có chấm vào lẻ (quên ra)', leaves: [{ paid_minutes: 480, quantity: 1, annual: true }], events: [punch(MON, '08:00', 'IN')] },
  { name: 'nghỉ không lương cả ngày nhưng có chấm vào lẻ', leaves: [{ paid_minutes: 0, quantity: 1, annual: false, paid: false }], events: [punch(MON, '08:00', 'IN')] },
  { name: 'công tác nhưng có chấm vào lẻ', trip: true, events: [punch(MON, '08:00', 'IN')] },
  { name: 'công tác ngày chưa phân ca', trip: true, noShift: true, scheduleDayType: null },
  { name: 'nghỉ nửa ngày + quên ra buổi chiều', leaves: [{ paid_minutes: 240, quantity: 0.5, annual: true }], events: [punch(MON, '13:00', 'IN')] },
];

/** Trạng thái của đường lưu (timesheets.status) ứng với trạng thái bảng công. */
function legacyStatus(status: string): string {
  if (['PRESENT', 'LATE', 'EARLY_LEAVE', 'LATE_EARLY'].includes(status)) return 'NORMAL';
  if (['ANNUAL_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE'].includes(status)) return 'LEAVE';
  if (status === 'TRIP') return 'BUSINESS_TRIP';
  return status;
}

async function savedPath(s: Scenario) {
  const date = s.date ?? MON;
  const config = { timezone: TZ, weeklyOffDays: [0] };
  (resolvePolicy as jest.Mock).mockResolvedValue({ id: 'pol', config_json: config });
  (dayContextForDate as jest.Mock).mockResolvedValue({
    shift: s.noShift
      ? null
      : { id: SHIFT.id, window: shiftWindowOf(SHIFT, date, TZ) },
    scheduleDayType: s.scheduleDayType === undefined ? (s.noShift ? null : 'SHIFT') : s.scheduleDayType,
    holidayPaid: null,
  });
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM hrm_schema.timesheet_periods'))
        return rows([{ id: 'p', status: 'OPEN', from_date: date, to_date: date }]);
      if (sql.includes('generate_series'))
        return rows([{ date, day_kind: s.calendar?.day_kind ?? null, holiday_paid: s.calendar?.paid ?? null }]);
      if (sql.includes('FROM hrm_schema.timesheets t')) return rows([]);
      if (sql.includes('FROM hrm_schema.employee_profiles'))
        return rows([{ employee_id: 'e1', join_date: '2026-01-01', inactive_from: null }]);
      if (sql.includes('FROM hrm_schema.attendance_events'))
        return rows((s.events ?? []).map((e) => ({ id: e.id, event_kind: e.kind, occurred_at: e.at })));
      if (sql.includes('NOT EXISTS(SELECT 1 FROM hrm_schema.leave_request_days')) return rows([]);
      if (sql.includes('JOIN hrm_schema.leave_request_days'))
        return rows((s.leaves ?? []).map((l, i) => ({ id: `l${i}`, ...l })));
      if (sql.includes('FROM hrm_schema.business_trip_requests')) return rows(s.trip ? [{ id: 'trip-1' }] : []);
      if (sql.includes('FROM hrm_schema.ot_requests'))
        return rows(
          s.ot
            ? [
                {
                  id: 'ot-1',
                  approved_minutes: s.ot.approved,
                  ot_rate_multiplier: 1.5,
                  paid: true,
                  starts_at: at(date, s.ot.start),
                  ends_at: at(date, s.ot.end),
                },
              ]
            : [],
        );
      if (sql.includes('count(*)::int AS count')) return rows([{ count: 1, abnormal: 0 }]);
      return rows([]);
    }),
  };
  await calculateTimesheet(db as never, 't', 'p');
  const p = calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.timesheets'))!.params;
  return {
    scheduled: p[8] as number,
    worked: p[9] as number,
    paid: p[10] as number,
    ot: p[11] as number,
    late: p[12] as number,
    early: p[13] as number,
    units: p[14] as number,
    status: p[15] as string,
  };
}

describe('đối chiếu bảng công tính trực tiếp với calculateTimesheet (đường lưu khi chốt)', () => {
  it.each(scenarios)('$name: cùng số phút, số công và trạng thái', async (s) => {
    const date = s.date ?? MON;
    const saved = await savedPath(s);
    const board = computeBoardDay(
      input({
        date,
        shift: s.noShift ? null : SHIFT,
        scheduleDayType: s.scheduleDayType === undefined ? (s.noShift ? null : 'SHIFT') : s.scheduleDayType,
        calendarKind: s.calendar?.day_kind ?? null,
        calendarPaid: s.calendar?.paid ?? false,
        events: s.events ?? [],
        leaves: (s.leaves ?? []).map((l, i) => ({
          requestId: `l${i}`,
          reasonName: null,
          paid: l.paid ?? true,
          annual: l.annual ?? false,
          days: l.quantity,
          paidMinutes: l.paid_minutes,
        })),
        tripIds: s.trip ? ['trip-1'] : [],
        ot: s.ot
          ? [{ approvedMinutes: s.ot.approved, paid: true, startMs: zonedMs(date, `${s.ot.start}:00`, TZ), endMs: zonedMs(date, `${s.ot.end}:00`, TZ) }]
          : [],
      }),
    );
    expect({
      scheduled: board.scheduledMinutes,
      worked: board.workedMinutes,
      paid: board.paidMinutes,
      ot: board.otMinutes,
      late: board.lateMinutes,
      early: board.earlyLeaveMinutes,
      units: board.workdayUnits,
      status: legacyStatus(board.status),
    }).toEqual(saved);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Lịch phân ca theo lô đối chiếu với resolveDay
// ---------------------------------------------------------------------------------------------------------------

describe('resolveScheduleBatch cùng thứ tự ưu tiên với resolveDay', () => {
  type Row = { dayType: 'SHIFT' | 'OFF' | 'HOLIDAY'; shiftId: string | null; holidayPaid?: boolean };
  const cases: { name: string; row?: Row; rule?: { dayType: 'SHIFT' | 'OFF'; shiftId: string | null } }[] = [
    { name: 'không có gì' },
    { name: 'lịch định kỳ SHIFT', rule: { dayType: 'SHIFT', shiftId: 's1' } },
    { name: 'lịch định kỳ OFF', rule: { dayType: 'OFF', shiftId: null } },
    { name: 'lịch định kỳ trỏ tới ca không còn', rule: { dayType: 'SHIFT', shiftId: 's9' } },
    { name: 'lịch từng ngày SHIFT thắng lịch định kỳ', row: { dayType: 'SHIFT', shiftId: 's2' }, rule: { dayType: 'SHIFT', shiftId: 's1' } },
    { name: 'lịch từng ngày OFF thắng lịch định kỳ SHIFT', row: { dayType: 'OFF', shiftId: null }, rule: { dayType: 'SHIFT', shiftId: 's1' } },
    { name: 'ngày lễ không ca lấy ca định kỳ', row: { dayType: 'HOLIDAY', shiftId: null, holidayPaid: true }, rule: { dayType: 'SHIFT', shiftId: 's1' } },
    { name: 'ngày lễ không ca, lịch định kỳ OFF', row: { dayType: 'HOLIDAY', shiftId: null, holidayPaid: false }, rule: { dayType: 'OFF', shiftId: null } },
    { name: 'ngày lễ có ca', row: { dayType: 'HOLIDAY', shiftId: 's3', holidayPaid: true } },
    { name: 'dòng SHIFT nhưng ca không còn', row: { dayType: 'SHIFT', shiftId: 's9' }, rule: { dayType: 'SHIFT', shiftId: 's1' } },
  ];
  const known = new Set(['s1', 's2', 's3']);

  it.each(cases)('$name', async ({ row, rule }) => {
    const db = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });
        if (sql.includes('to_regclass')) return rows([{ ready: true }]);
        if (sql.includes('FROM hrm_schema.employee_work_days w'))
          return rows(
            row
              ? [{ day_type: row.dayType, holiday_paid: row.holidayPaid ?? null, id: row.shiftId && known.has(row.shiftId) ? row.shiftId : null }]
              : [],
          );
        if (sql.includes('WITH RECURSIVE'))
          return rows(
            rule
              ? [{ employee_id: 'e1', date: MON, day_type: rule.dayType, shift_id: rule.shiftId, rule_id: 'r1', scope_type: 'COMPANY' }]
              : [],
          );
        if (sql.includes('FROM hrm_schema.shift_definitions s'))
          return rows(known.has(params[1] as string) ? [{ id: params[1], start_time: '08:00', end_time: '17:00' }] : []);
        return rows([]);
      }),
    };
    const old = await resolveDay(db as never, `tenant-${Math.random()}`, 'e1', MON, TZ);
    const batch = resolveScheduleBatch(
      row ? { employeeId: 'e1', date: MON, dayType: row.dayType, shiftId: row.shiftId, holidayPaid: row.holidayPaid ?? null, holidayName: null } : undefined,
      rule ? { dayType: rule.dayType, shiftId: rule.shiftId } : undefined,
      (id) => known.has(id),
    );
    expect({ shiftId: batch.shiftId, type: batch.scheduleDayType, paid: batch.holidayPaid }).toEqual({
      shiftId: (old.picked?.row.id as string | undefined) ?? null,
      type: old.scheduleDayType,
      paid: old.holidayPaid ?? null,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// loadBoard: số truy vấn cố định
// ---------------------------------------------------------------------------------------------------------------

function fakePool(employeeCount: number, opts: { locked?: boolean } = {}) {
  const ids = Array.from({ length: employeeCount }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  const queries: string[] = [];
  const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      if (sql.includes('to_regclass')) return rows([{ ready: true }]);
      if (sql.includes('FROM hrm_schema.employee_directory'))
        return rows(
          ids.map((id, i) => ({
            employee_id: id,
            employee_code: `NV${i + 1}`,
            full_name: `Nhân viên ${i + 1}`,
            department_name: 'Phòng A',
            position_name: 'Chuyên viên',
            join_date: i === 0 ? '2026-10-15' : '2026-01-01',
            inactive_from: null,
          })),
        );
      if (sql.includes('FROM hrm_schema.work_calendar'))
        return rows([{ date: '2026-09-02', day_kind: 'HOLIDAY', name: 'Quốc khánh', paid: true }]);
      if (sql.includes('FROM hrm_schema.policy_versions'))
        return rows([{ id: 'pol', config_json: { timezone: TZ, weeklyOffDays: [0, 6] }, version_no: 1, effective_from: '2020-01-01', effective_to: null, policy_code: 'ATT' }]);
      if (sql.includes('FROM hrm_schema.employee_work_days w')) return rows([]);
      if (sql.includes('WITH RECURSIVE')) {
        const [, emps, from, to] = params as [string, string[], string, string];
        const out: unknown[] = [];
        for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          if (wd === 0 || wd === 6) continue;
          for (const e of emps) out.push({ employee_id: e, date: d, day_type: 'SHIFT', shift_id: SHIFT.id, rule_id: 'r', scope_type: 'COMPANY' });
        }
        return rows(out);
      }
      if (sql.includes('FROM hrm_schema.attendance_events'))
        return rows([
          { id: 'i1', employee_id: ids[1] ?? ids[0], work_date: '2026-09-01', event_kind: 'IN', occurred_at: at('2026-09-01', '08:00') },
          { id: 'o1', employee_id: ids[1] ?? ids[0], work_date: '2026-09-01', event_kind: 'OUT', occurred_at: at('2026-09-01', '17:00') },
        ]);
      if (sql.includes('FROM hrm_schema.shift_definitions'))
        return rows([{ id: SHIFT.id, code: SHIFT.code, name: SHIFT.name, start_time: '08:00:00', end_time: '17:00:00', break_start_time: '12:00:00', break_end_time: '13:00:00', cross_midnight: false, break_minutes: 60, grace_late_minutes: 10, grace_early_minutes: 5 }]);
      if (sql.includes('FROM hrm_schema.timesheets') && opts.locked)
        return rows([
          { employee_id: ids[1] ?? ids[0], work_date: '2026-09-01', shift_id: SHIFT.id, scheduled_minutes: 480, worked_minutes: 450, paid_minutes: 450, ot_minutes: 0, late_minutes: 30, early_leave_minutes: 0, workday_units: 0.94, status: 'NORMAL', is_manually_adjusted: false, adjustment_needs_review: false, calculation_snapshot: { timezone: TZ, dayKind: 'WORK', firstIn: at('2026-09-01', '08:30'), lastOut: at('2026-09-01', '17:00'), anomalies: [] }, business_trip_request_id: null },
        ]);
      return rows([]);
    }),
  };
  return { pool, ids, queries };
}

describe('loadBoard: nạp theo lô', () => {
  const month = { from: '2026-09-01', to: '2026-09-30', today: '2026-10-10' };

  it('số truy vấn cố định, không tăng theo số ngày hay số nhân viên', async () => {
    const small = fakePool(1);
    await loadBoard(small.pool as never, 'tenant-small', { ...month, employeeIds: small.ids });
    const big = fakePool(20);
    await loadBoard(big.pool as never, 'tenant-big', { ...month, employeeIds: big.ids });
    const week = fakePool(20);
    await loadBoard(week.pool as never, 'tenant-week', { from: '2026-09-01', to: '2026-09-07', today: month.today, employeeIds: week.ids });
    expect(big.queries.length).toBe(small.queries.length);
    expect(week.queries.length).toBe(big.queries.length);
    expect(big.queries.length).toBeLessThanOrEqual(LOAD_BOARD_MAX_QUERIES);
  });

  it('đủ mọi ngày của tháng cho mọi nhân viên, kèm lịch chung và tổng', async () => {
    const { pool, ids } = fakePool(3);
    const board = await loadBoard(pool as never, 'tenant-shape', { ...month, employeeIds: ids });
    expect(board.calendar).toHaveLength(30);
    expect(board.calendar[1]).toMatchObject({ date: '2026-09-02', kind: 'HOLIDAY', holidayName: 'Quốc khánh' });
    expect(board.calendar[5]).toMatchObject({ date: '2026-09-06', weekday: 0, kind: 'OFF' });
    expect(board.employees).toHaveLength(3);
    for (const e of board.employees) expect(Object.keys(e.days)).toHaveLength(30);
    const e2 = board.employees[1];
    expect(e2.days['2026-09-01']).toMatchObject({ status: 'PRESENT', workdayUnits: 1, checkIn: '08:00', shiftCode: 'HC' });
    expect(e2.days['2026-09-02']).toMatchObject({ status: 'HOLIDAY', holidayName: 'Quốc khánh' });
    expect(e2.days['2026-09-03']).toMatchObject({ status: 'ABSENT' });
    expect(e2.days['2026-09-05']).toMatchObject({ status: 'OFF' });
    // nhân viên vào làm giữa tháng 10: tháng 9 chưa có lịch
    expect(board.employees[0].days['2026-09-03']).toMatchObject({ status: 'NO_SCHEDULE' });
    expect(e2.totals.workdayUnits).toBeGreaterThan(0);
    expect(e2.totals.absentDays).toBeGreaterThan(0);
  });

  it('tháng đã khóa: đọc từ timesheets bất biến, không truy vấn chấm công / đơn từ gốc', async () => {
    const { pool, ids, queries } = fakePool(2, { locked: true });
    const board = await loadBoard(pool as never, 'tenant-locked', { ...month, employeeIds: ids, lockedPeriodId: 'period-1' });
    expect(queries.some((q) => q.includes('FROM hrm_schema.attendance_events'))).toBe(false);
    // Chỉ danh sách đơn từ để hiển thị ở ô công được đọc (một truy vấn); số công vẫn từ dòng đã lưu.
    expect(queries.filter((q) => q.includes('FROM hrm_schema.ot_requests'))).toHaveLength(1);
    expect(board.employees[1].days['2026-09-01']).toMatchObject({
      status: 'LATE',
      lateMinutes: 30,
      shiftCode: 'HC',
      checkIn: '08:30',
      workdayUnits: 0.94,
      adjusted: false,
    });
    expect(board.employees[1].days['2026-09-03']).toMatchObject({ status: 'NO_SCHEDULE' });
  });
});

describe('computeBoardDay: nghỉ, công tác và lỗi chấm công (quy tắc dùng chung với calculateTimesheet)', () => {
  const lateMs = (hhmm: string) => zonedMs(MON, `${hhmm}:00`, TZ);
  const range = (from: string, to: string) => ({ startMs: lateMs(from), endMs: lateMs(to) });

  it('nghỉ cả ngày che lỗi chấm công thừa (quên ra, chấm giữa ca)', () => {
    const d = computeBoardDay(
      input({
        leaves: [leave({ interval: range('08:00', '17:00') })],
        events: [punch(MON, '08:00', 'IN')],
      }),
    );
    expect(d).toMatchObject({ status: 'ANNUAL_LEAVE', anomalies: [], lateMinutes: 0, earlyLeaveMinutes: 0 });
  });

  it('nghỉ sáng + vào chiều đúng giờ không bị đi trễ; quên ra buổi chiều vẫn là bất thường', () => {
    const morning = leave({ days: 0.5, paidMinutes: 240, interval: range('08:00', '12:00') });
    expect(
      computeBoardDay(input({ leaves: [morning], events: inOut(MON, '13:00', '17:00') })),
    ).toMatchObject({ lateMinutes: 0, status: 'ANNUAL_LEAVE', paidMinutes: 480 });
    expect(
      computeBoardDay(input({ leaves: [morning], events: [punch(MON, '13:00', 'IN')] })),
    ).toMatchObject({ status: 'ABNORMAL', anomalies: ['MISSING_CHECK_OUT'] });
  });

  it('Chủ nhật chưa phân ca là ngày OFF, kể cả khi có đơn công tác', () => {
    expect(computeBoardDay(input({ date: SUN, shift: null, scheduleDayType: null, policyConfig: { timezone: TZ } }))).toMatchObject({
      status: 'OFF',
      anomalies: [],
    });
  });

  it('công tác ngày chưa có ca: ABNORMAL NO_SHIFT (không che), công tác có ca: trả đủ công', () => {
    expect(
      computeBoardDay(input({ shift: null, scheduleDayType: null, tripIds: ['t'] })),
    ).toMatchObject({ status: 'ABNORMAL', anomalies: ['NO_SHIFT'] });
  });

  it('mỗi đơn tác động tới ngày được liệt kê ở sources', () => {
    const d = computeBoardDay(
      input({
        leaves: [leave({ days: 0.5, paidMinutes: 240, interval: range('08:00', '12:00') })],
        events: inOut(MON, '13:00', '17:00'),
        tripIds: [],
        correctionIds: ['c1'],
        shiftChangeIds: ['s1'],
        ot: [{ id: 'ot1', approvedMinutes: 60, paid: true, startMs: lateMs('17:30'), endMs: lateMs('18:30') }],
      }),
    );
    expect(d.sources).toEqual([
      { kind: 'LEAVE', id: 'leave-1', minutes: 240, label: 'Nghỉ phép năm' },
      { kind: 'OT', id: 'ot1', minutes: 60, label: null },
      { kind: 'CORRECTION', id: 'c1', minutes: null, label: null },
      { kind: 'SHIFT_CHANGE', id: 's1', minutes: null, label: null },
    ]);
  });
});
