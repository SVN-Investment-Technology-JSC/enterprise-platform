import type {
  HrmBoardCalendarDay,
  HrmBoardDay,
  HrmDaySource,
  HrmDayRequest,
  HrmBoardDayKind,
  HrmBoardDayStatus,
  HrmBoardEmployee,
  HrmBoardLeaveInfo,
  HrmBoardTotals,
} from '@enterprise-platform/contracts-hrm';
import type { PoolClient } from 'pg';
import {
  calculateAttendance,
  type Punch,
  type ShiftWindow,
} from '../domain/attendance-calculation.js';
import {
  resolveDayOutcome,
  type CoveredInterval,
  type DayShiftBounds,
} from '../domain/timesheet-day.js';
import { applyScheduleDayKind } from '../domain/work-schedule.js';
import {
  dayCapacityUnits,
  dayWorkUnits,
  DEFAULT_MONTH_STANDARD,
  monthStandardSetting,
  monthStandardWorkdays,
} from '../domain/standard-workdays.js';
import {
  effectiveDayKind,
  isUnassignedSunday,
  pickPolicyVersion,
  type ResolvableVersion,
} from './hrm-time.js';
import { workScheduleTableExists } from './hrm-shift-resolution.js';
import { resolveRuleDays, type RuleDay } from './hrm-work-schedule-resolve.js';

/**
 * Bảng công theo tháng: toàn bộ thời gian, tính trực tiếp, không ghi DB.
 *  - `computeBoardDay`: hàm THUẦN cho một nhân viên một ngày.
 *  - `loadBoard`: nạp dữ liệu THEO LÔ (số truy vấn cố định, không phụ thuộc số ngày hay số nhân viên) rồi gọi computeBoardDay.
 * Tháng đã khóa đọc từ hrm_schema.timesheets (bất biến) thay vì tính lại.
 */

type Db = Pick<PoolClient, 'query'>;
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

// ---------------------------------------------------------------------------------------------------------------
// Ngày giờ theo múi giờ
// ---------------------------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function validTimezone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || !timeZone) return DEFAULT_TIMEZONE;
  try {
    formatterOf(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function partsOf(ms: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatterOf(timeZone).formatToParts(new Date(ms)))
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = partsOf(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Thời điểm (ms UTC) của "ngày + giờ địa phương" trong múi giờ; tương đương (date + time) AT TIME ZONE tz của PostgreSQL. */
export function zonedMs(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi, s || 0);
  let utc = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(utc, timeZone);
  if (second !== utc) utc = second;
  return utc;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** HH:mm theo múi giờ của một thời điểm ISO. */
export function localHm(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const p = partsOf(ms, timeZone);
  return `${String(p.hour % 24).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const iso = (ms: number) => new Date(ms).toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------
// Kiểu đầu vào của bộ tính ngày công thuần
// ---------------------------------------------------------------------------------------------------------------

/** Ca làm việc (giờ địa phương, đúng như shift_definitions). */
export interface BoardShiftDef {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
  crossMidnight: boolean;
  breakMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
}

export interface BoardLeaveInput {
  requestId: string;
  reasonName: string | null;
  paid: boolean;
  annual: boolean;
  /** Số ngày nghỉ rơi vào ngày này (0.5 cho nửa ngày). */
  days: number;
  /** Số phút công hưởng lương của ngày nghỉ (leave_request_days.paid_minutes). */
  paidMinutes: number;
  /** Đơn cũ không có chi tiết từng ngày: cần rà soát tay. */
  legacy?: boolean;
  /** Khoảng nghỉ (từ ngày giờ đến ngày giờ) của đơn; null với đơn cũ chưa có giờ. */
  interval?: CoveredInterval | null;
}

export interface BoardOtInput {
  id?: string;
  approvedMinutes: number;
  paid: boolean;
  startMs: number;
  endMs: number;
}

export interface BoardDayInput {
  date: string;
  /** Hôm nay theo giờ VN (YYYY-MM-DD). */
  today: string;
  timezone: string;
  /** Nhân viên có hiệu lực việc làm vào ngày này (đã vào làm, chưa nghỉ). */
  employed: boolean;
  /** work_calendar */
  calendarKind: string | null;
  calendarPaid: boolean;
  calendarName: string | null;
  /** config_json của chính sách ATTENDANCE hiệu lực (ngày nghỉ hằng tuần). */
  policyConfig: Record<string, unknown> | null;
  /** Lịch phân ca (employee_work_days / lịch định kỳ). */
  scheduleDayType: 'SHIFT' | 'OFF' | 'HOLIDAY' | null;
  scheduleHolidayPaid: boolean | null;
  scheduleHolidayName: string | null;
  shift: BoardShiftDef | null;
  events: readonly Punch[];
  leaves: readonly BoardLeaveInput[];
  tripIds: readonly string[];
  /** Khoảng công tác theo từng đơn trong tripIds (cùng thứ tự); null/thiếu = cả ngày. */
  tripIntervals?: readonly (CoveredInterval | null)[];
  /** Nhãn hiển thị (điểm đến) theo từng đơn công tác. */
  tripLabels?: readonly (string | null)[];
  ot: readonly BoardOtInput[];
  /** Đơn giải trình công / đổi ca đã duyệt tác động tới ngày này (để truy vết). */
  correctionIds?: readonly string[];
  shiftChangeIds?: readonly string[];
}

export function shiftWindowOf(
  shift: BoardShiftDef,
  date: string,
  timeZone: string,
): ShiftWindow {
  const at = (day: string, time: string | null) =>
    time ? iso(zonedMs(day, time, timeZone)) : null;
  const next = addDays(date, 1);
  const cross = shift.crossMidnight;
  return {
    start: at(date, shift.startTime)!,
    end: at(cross ? next : date, shift.endTime)!,
    breakStart: at(
      cross && shift.breakStartTime && shift.breakStartTime < shift.startTime
        ? next
        : date,
      shift.breakStartTime,
    ),
    breakEnd: at(
      cross && shift.breakEndTime && shift.breakEndTime <= shift.startTime
        ? next
        : date,
      shift.breakEndTime,
    ),
    breakMinutes: shift.breakMinutes,
    graceLateMinutes: shift.graceLateMinutes,
    graceEarlyMinutes: shift.graceEarlyMinutes,
  };
}

const ANOMALY_NAMES: Record<string, string> = {
  MISSING_OUT: 'MISSING_CHECK_OUT',
  OUT_WITHOUT_IN: 'MISSING_CHECK_IN',
};

function emptyDay(
  date: string,
  kind: HrmBoardDayKind,
  status: HrmBoardDayStatus,
  extra: Partial<HrmBoardDay> = {},
): HrmBoardDay {
  return {
    date,
    kind,
    status,
    shiftCode: null,
    shiftName: null,
    shiftStart: null,
    shiftEnd: null,
    checkIn: null,
    checkOut: null,
    scheduledMinutes: 0,
    workedMinutes: 0,
    paidMinutes: 0,
    workdayUnits: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    otMinutes: 0,
    anomalies: [],
    leave: null,
    tripId: null,
    holidayName: null,
    adjusted: false,
    sources: [],
    ...extra,
  };
}

function leaveInfoOf(leaves: readonly BoardLeaveInput[]): HrmBoardLeaveInfo | null {
  if (!leaves.length) return null;
  const rank = (l: BoardLeaveInput) => (l.annual ? 0 : l.paid ? 1 : 2);
  const main = [...leaves].sort((a, b) => rank(a) - rank(b))[0];
  return {
    requestId: main.requestId,
    reasonName: main.reasonName,
    paid: main.paid,
    annual: main.annual,
    days: round2(leaves.reduce((n, l) => n + l.days, 0)),
  };
}

function leaveStatus(leave: HrmBoardLeaveInfo): HrmBoardDayStatus {
  return leave.annual ? 'ANNUAL_LEAVE' : leave.paid ? 'PAID_LEAVE' : 'UNPAID_LEAVE';
}

function lateEarlyStatus(late: number, early: number): HrmBoardDayStatus {
  return late && early ? 'LATE_EARLY' : late ? 'LATE' : early ? 'EARLY_LEAVE' : 'PRESENT';
}

/**
 * Tính một ngày công của MỘT nhân viên từ dữ liệu đã nạp. Thứ tự ưu tiên trạng thái (xem docs/hrm-bang-cong-thiet-ke.md):
 * lễ, nghỉ OFF, [dữ liệu lệch: đơn nghỉ trùng công tác / đơn nghỉ cũ], công tác, phép năm, nghỉ có phép (có lương), nghỉ không lương,
 * bất thường (thiếu chấm vào/ra), nghỉ không phép, đi trễ + về sớm, đi trễ, về sớm, đi làm đủ. Ngày chưa tới là FUTURE.
 * Công thức số phút giống calculateTimesheet (đường lưu khi chốt).
 */
export function computeBoardDay(input: BoardDayInput): HrmBoardDay {
  const { date, today, timezone } = input;
  if (!input.employed) return emptyDay(date, 'NO_SCHEDULE', 'NO_SCHEDULE');

  const scheduledKind = applyScheduleDayKind(
    effectiveDayKind(date, input.calendarKind, input.policyConfig),
    input.scheduleDayType,
  );
  // Chủ nhật chưa phân ca là ngày trống (cùng quy tắc với calculateTimesheet).
  const dayKind =
    scheduledKind !== 'OFF' &&
    scheduledKind !== 'HOLIDAY' &&
    isUnassignedSunday(date, scheduledKind, Boolean(input.shift))
      ? 'OFF'
      : scheduledKind;
  const off = dayKind === 'OFF';
  const holiday = dayKind === 'HOLIDAY';
  const holidayPaid = input.calendarKind
    ? Boolean(input.calendarPaid)
    : (input.scheduleHolidayPaid ?? false);
  const holidayName = holiday
    ? ((input.calendarKind === 'HOLIDAY' ? input.calendarName : null) ??
      input.scheduleHolidayName ??
      input.calendarName)
    : null;
  const isToday = date === today;
  const future = date > today;

  const shift = input.shift;
  let window: ShiftWindow | null = null;
  let invalidShift = false;
  if (shift) window = shiftWindowOf(shift, date, timezone);
  let calc: ReturnType<typeof calculateAttendance>;
  try {
    calc = calculateAttendance(input.events, window);
  } catch {
    invalidShift = true;
    calc = calculateAttendance(input.events, null);
  }

  // Làm thêm giờ tính theo khoảng thời gian đã duyệt trong đơn (không phụ thuộc giờ chấm ra), cùng cách với calculateTimesheet.
  const otMinutes = input.ot.reduce((n, ot) => n + (ot.paid ? Math.max(0, Number(ot.approvedMinutes)) : 0), 0);

  const scheduled = calc.scheduledMinutes;
  const trip = input.tripIds.length > 0;
  const hasEvents = input.events.length > 0;
  // Ngày chưa tới hoặc hôm nay chưa ra về: chưa phải lỗi chấm công.
  const anomalies = calc.anomalies
    .filter((a) => !(isToday && a === 'MISSING_OUT'))
    .filter((a) => !(future && a === 'NO_SHIFT'));
  const outcome = resolveDayOutcome({
    off,
    holiday,
    holidayPaid,
    shift: window ? boundsOfWindow(window) : null,
    scheduledMinutes: scheduled,
    workedMinutes: calc.workedMinutes,
    lateMinutes: calc.lateMinutes,
    earlyMinutes: calc.earlyMinutes,
    firstInMs: calc.firstIn ? Date.parse(calc.firstIn) : null,
    lastOutMs: calc.lastOut ? Date.parse(calc.lastOut) : null,
    anomalies,
    leaves: input.leaves.map((l) => ({
      days: l.days,
      paidMinutes: l.paidMinutes,
      interval: l.interval ?? null,
      legacy: l.legacy,
    })),
    hasOt: input.ot.length > 0,
    trips: input.tripIds.map((_, i) => {
      const interval = input.tripIntervals?.[i] ?? null;
      const dayStartMs = zonedMs(date, '00:00:00', timezone);
      const dayEndMs = zonedMs(addDays(date, 1), '00:00:00', timezone);
      return {
        interval,
        dayMinutes: interval
          ? Math.max(0, Math.round((Math.min(interval.endMs, dayEndMs) - Math.max(interval.startMs, dayStartMs)) / 60000))
          : null,
      };
    }),
  });
  const paid = outcome.paidMinutes;
  const issues = outcome.issues.map((a) => ANOMALY_NAMES[a] ?? a);
  if (invalidShift) issues.push('INVALID_SHIFT');
  // Ngày làm việc chưa có ca và chưa chấm công: ô "chưa phân ca" (không phải lỗi chấm công) nhưng vẫn chặn chốt công.
  const unscheduled =
    !shift && !hasEvents && issues.includes('NO_SHIFT') && !trip && input.leaves.length === 0;
  const blocking = unscheduled ? issues.filter((a) => a !== 'NO_SHIFT') : issues;

  const leave = leaveInfoOf(input.leaves);
  let status: HrmBoardDayStatus;
  if (holiday) status = 'HOLIDAY';
  else if (off) status = 'OFF';
  else if (blocking.length) status = 'ABNORMAL';
  else if (trip) status = 'TRIP';
  else if (leave) status = leaveStatus(leave);
  else if (future) status = 'FUTURE';
  else if (!shift) status = 'NO_SCHEDULE';
  else if (!hasEvents) status = isToday ? 'FUTURE' : 'ABSENT';
  else status = lateEarlyStatus(outcome.lateMinutes, outcome.earlyMinutes);

  const sources: HrmDaySource[] = [
    ...input.leaves.map((l) => ({
      kind: 'LEAVE' as const,
      id: l.requestId,
      minutes: l.paidMinutes,
      label: l.reasonName,
    })),
    ...input.tripIds.map((id, i) => ({
      kind: 'TRIP' as const,
      id,
      minutes: null,
      label: input.tripLabels?.[i] ?? null,
    })),
    ...input.ot
      .filter((o) => o.id)
      .map((o) => ({ kind: 'OT' as const, id: o.id as string, minutes: o.approvedMinutes, label: null })),
    ...(input.correctionIds ?? []).map((id) => ({ kind: 'CORRECTION' as const, id, minutes: null, label: null })),
    ...(input.shiftChangeIds ?? []).map((id) => ({ kind: 'SHIFT_CHANGE' as const, id, minutes: null, label: null })),
  ];

  const kind: HrmBoardDayKind = holiday
    ? 'HOLIDAY'
    : off
      ? 'OFF'
      : shift
        ? 'WORK'
        : 'NO_SCHEDULE';
  const showShift = shift && !off;
  return emptyDay(date, kind, status, {
    shiftCode: showShift ? shift.code : null,
    shiftName: showShift ? shift.name : null,
    shiftStart: showShift ? shift.startTime.slice(0, 5) : null,
    shiftEnd: showShift ? shift.endTime.slice(0, 5) : null,
    shiftBreakStart: showShift ? (shift.breakStartTime?.slice(0, 5) ?? null) : null,
    shiftBreakEnd: showShift ? (shift.breakEndTime?.slice(0, 5) ?? null) : null,
    shiftBreakMinutes: showShift ? shift.breakMinutes : 0,
    checkIn: localHm(calc.firstIn, timezone),
    checkOut: localHm(calc.lastOut, timezone),
    scheduledMinutes: off ? 0 : scheduled,
    workedMinutes: calc.workedMinutes,
    paidMinutes: paid,
    workdayUnits: dayWorkUnits(paid, scheduled),
    lateMinutes: outcome.lateMinutes,
    earlyLeaveMinutes: outcome.earlyMinutes,
    otMinutes,
    anomalies: issues,
    leave,
    tripId: trip ? input.tripIds[0] : null,
    holidayName,
    sources,
  });
}

function boundsOfWindow(w: ShiftWindow): DayShiftBounds {
  return {
    startMs: Date.parse(w.start),
    endMs: Date.parse(w.end),
    breakStartMs: w.breakStart ? Date.parse(w.breakStart) : null,
    breakEndMs: w.breakEnd ? Date.parse(w.breakEnd) : null,
    graceLateMinutes: Number(w.graceLateMinutes ?? 0),
    graceEarlyMinutes: Number(w.graceEarlyMinutes ?? 0),
  };
}

export function sumBoardTotals(days: readonly HrmBoardDay[]): HrmBoardTotals {
  const t = {
    workdayUnits: 0,
    workedMinutes: 0,
    paidMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    otMinutes: 0,
    lateDays: 0,
    earlyLeaveDays: 0,
    abnormalDays: 0,
    unscheduledDays: 0,
    absentDays: 0,
    annualLeaveDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    tripDays: 0,
    offDays: 0,
    holidayDays: 0,
  };
  for (const d of days) {
    t.workdayUnits += d.workdayUnits;
    t.workedMinutes += d.workedMinutes;
    t.paidMinutes += d.paidMinutes;
    t.lateMinutes += d.lateMinutes;
    t.earlyLeaveMinutes += d.earlyLeaveMinutes;
    t.otMinutes += d.otMinutes;
    if (d.lateMinutes > 0) t.lateDays++;
    if (d.earlyLeaveMinutes > 0) t.earlyLeaveDays++;
    if (d.status === 'ABNORMAL') t.abnormalDays++;
    else if (d.status === 'NO_SCHEDULE' && d.anomalies.includes('NO_SHIFT')) t.unscheduledDays++;
    else if (d.status === 'ABSENT') t.absentDays++;
    else if (d.status === 'ANNUAL_LEAVE') t.annualLeaveDays += d.leave?.days ?? 1;
    else if (d.status === 'PAID_LEAVE') t.paidLeaveDays += d.leave?.days ?? 1;
    else if (d.status === 'UNPAID_LEAVE') t.unpaidLeaveDays += d.leave?.days ?? 1;
    else if (d.status === 'TRIP') t.tripDays++;
    else if (d.status === 'OFF') t.offDays++;
    else if (d.status === 'HOLIDAY') t.holidayDays++;
  }
  t.workdayUnits = round2(t.workdayUnits);
  t.annualLeaveDays = round2(t.annualLeaveDays);
  t.paidLeaveDays = round2(t.paidLeaveDays);
  t.unpaidLeaveDays = round2(t.unpaidLeaveDays);
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Lịch phân ca theo lô (cùng thứ tự ưu tiên với resolveDay trong hrm-shift-resolution.ts)
// ---------------------------------------------------------------------------------------------------------------

export interface ScheduleDayRow {
  employeeId: string;
  date: string;
  dayType: 'SHIFT' | 'OFF' | 'HOLIDAY';
  shiftId: string | null;
  holidayPaid: boolean | null;
  holidayName: string | null;
}

export interface BatchResolvedDay {
  shiftId: string | null;
  scheduleDayType: 'SHIFT' | 'OFF' | 'HOLIDAY' | null;
  holidayPaid: boolean | null;
  holidayName: string | null;
}

/**
 * Thứ tự ưu tiên như resolveDay: 1) lịch từng ngày (employee_work_days, ACTIVE): OFF thì không ca; có ca thì dùng ca đó; ngày lễ không
 * lưu ca thì lấy ca của lịch định kỳ (nếu là SHIFT); 2) lịch định kỳ: OFF hoặc SHIFT (ca không còn tồn tại thì coi như không có lịch);
 * 3) không có gì: chưa có lịch. `shiftExists` cho biết ca còn tồn tại (shift_definitions).
 */
export function resolveScheduleBatch(
  scheduleRow: ScheduleDayRow | undefined,
  ruleDay: Pick<RuleDay, 'dayType' | 'shiftId'> | undefined,
  shiftExists: (id: string) => boolean,
): BatchResolvedDay {
  const rule = (): { dayType: 'OFF' } | { dayType: 'SHIFT'; shiftId: string } | null => {
    if (!ruleDay) return null;
    if (ruleDay.dayType === 'OFF') return { dayType: 'OFF' };
    return ruleDay.shiftId && shiftExists(ruleDay.shiftId)
      ? { dayType: 'SHIFT', shiftId: ruleDay.shiftId }
      : null;
  };
  if (scheduleRow) {
    const { dayType, holidayPaid, holidayName } = scheduleRow;
    if (dayType === 'OFF')
      return { shiftId: null, scheduleDayType: 'OFF', holidayPaid: null, holidayName: null };
    if (scheduleRow.shiftId && shiftExists(scheduleRow.shiftId))
      return { shiftId: scheduleRow.shiftId, scheduleDayType: dayType, holidayPaid, holidayName };
    const underlying = dayType === 'HOLIDAY' ? rule() : null;
    return {
      shiftId: underlying?.dayType === 'SHIFT' ? underlying.shiftId : null,
      scheduleDayType: dayType,
      holidayPaid,
      holidayName,
    };
  }
  const r = rule();
  if (r?.dayType === 'OFF')
    return { shiftId: null, scheduleDayType: 'OFF', holidayPaid: null, holidayName: null };
  if (r?.dayType === 'SHIFT')
    return { shiftId: r.shiftId, scheduleDayType: 'SHIFT', holidayPaid: null, holidayName: null };
  return { shiftId: null, scheduleDayType: null, holidayPaid: null, holidayName: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Nạp dữ liệu theo lô
// ---------------------------------------------------------------------------------------------------------------

export interface LoadBoardInput {
  from: string;
  to: string;
  employeeIds: readonly string[];
  /** Hôm nay theo giờ VN. */
  today: string;
  /** Tháng đã khóa: đọc từ timesheets của kỳ này thay vì tính lại. */
  lockedPeriodId?: string | null;
  /** Kỳ công của tháng (chưa khóa): chỉ để chồng các dòng đã điều chỉnh tay (giải trình công) lên kết quả tính. */
  periodId?: string | null;
}

export interface LoadedBoard {
  calendar: HrmBoardCalendarDay[];
  employees: HrmBoardEmployee[];
}

interface PolicyRow extends ResolvableVersion {
  effective_from: string;
  effective_to: string | null;
}

function mapShiftRow(r: Record<string, unknown>): BoardShiftDef {
  return {
    id: r.id as string,
    code: String(r.code ?? ''),
    name: String(r.name ?? ''),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    breakStartTime: r.break_start_time ? String(r.break_start_time) : null,
    breakEndTime: r.break_end_time ? String(r.break_end_time) : null,
    crossMidnight: r.cross_midnight === true,
    breakMinutes: Number(r.break_minutes ?? 0),
    graceLateMinutes: Number(r.grace_late_minutes ?? 0),
    graceEarlyMinutes: Number(r.grace_early_minutes ?? 0),
  };
}

const key = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** Khoảng [từ, đến) từ hai mốc ISO; null khi thiếu hoặc đảo ngược (đơn cũ chưa có giờ). */
function intervalOfIso(from: unknown, to: unknown): CoveredInterval | null {
  const a = from ? Date.parse(String(from)) : NaN;
  const b = to ? Date.parse(String(to)) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? { startMs: a, endMs: b } : null;
}

/** Số truy vấn tối đa của loadBoard (không phụ thuộc số ngày / số nhân viên). */
export const LOAD_BOARD_MAX_QUERIES = 18;

export async function loadBoard(
  db: Db,
  tenant: string,
  input: LoadBoardInput,
): Promise<LoadedBoard> {
  const { from, to, today } = input;
  const ids = [...new Set(input.employeeIds)];
  const dates = enumerateDates(from, to);
  const locked = Boolean(input.lockedPeriodId);

  const scheduleReady = await workScheduleTableExists(db, tenant);
  const [
    peopleRes,
    calendarRes,
    policyRes,
    scheduleRes,
    ruleDays,
    eventsRes,
    leavesRes,
    tripsRes,
    otRes,
    storedRes,
    correctionRes,
    shiftChangeRes,
    requestsRes,
  ] = await Promise.all([
    ids.length
      ? db.query(
          `SELECT d.employee_id, d.employee_code, d.full_name, d.department_name, d.position_name,
                  to_char(d.join_date,'YYYY-MM-DD') AS join_date, to_char(p.inactive_from,'YYYY-MM-DD') AS inactive_from
             FROM hrm_schema.employee_directory d
             JOIN hrm_schema.employee_profiles p ON p.tenant_id=d.tenant_id AND p.employee_id=d.employee_id
            WHERE d.tenant_id=$1 AND d.employee_id = ANY($2::uuid[]) AND d.deleted_at IS NULL`,
          [tenant, ids],
        )
      : empty(),
    db.query(
      `SELECT to_char(work_date,'YYYY-MM-DD') AS date, day_kind, name, paid FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date BETWEEN $2::date AND $3::date`,
      [tenant, from, to],
    ),
    db.query(
      `SELECT v.id, v.config_json, v.version_no, to_char(v.effective_from,'YYYY-MM-DD') AS effective_from, to_char(v.effective_to,'YYYY-MM-DD') AS effective_to, p.code AS policy_code, p.policy_type
         FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id
        WHERE p.tenant_id=$1 AND p.policy_type IN ('ATTENDANCE','PAYROLL') AND p.status='ACTIVE' AND v.status IN ('ACTIVE','SUPERSEDED')
          AND v.effective_from<=$3::date AND (v.effective_to IS NULL OR v.effective_to>=$2::date)
        ORDER BY v.effective_from DESC, v.version_no DESC`,
      [tenant, from, to],
    ),
    ids.length && scheduleReady
      ? db.query(
          `SELECT w.employee_id, to_char(w.work_date,'YYYY-MM-DD') AS date, w.day_type, w.shift_id, h.paid AS holiday_paid, h.name AS holiday_name
             FROM hrm_schema.employee_work_days w
             LEFT JOIN hrm_schema.company_holidays h ON h.id = w.holiday_id AND h.tenant_id = w.tenant_id
            WHERE w.tenant_id=$1 AND w.employee_id = ANY($2::uuid[]) AND w.work_date BETWEEN $3::date AND $4::date AND w.status='ACTIVE'`,
          [tenant, ids, from, to],
        )
      : empty(),
    ids.length && !locked ? resolveRuleDays(db, tenant, ids, from, to) : Promise.resolve([] as RuleDay[]),
    ids.length && !locked
      ? db.query(
          `SELECT id, employee_id, to_char(work_date,'YYYY-MM-DD') AS work_date, event_kind, occurred_at
             FROM hrm_schema.attendance_events
            WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND work_date BETWEEN $3::date AND $4::date AND voided_by_correction_id IS NULL
            ORDER BY occurred_at, id`,
          [tenant, ids, from, to],
        )
      : empty(),
    ids.length
      ? db.query(
          `SELECT r.id AS request_id, r.employee_id, to_char(d.work_date,'YYYY-MM-DD') AS work_date, d.quantity, d.paid_minutes,
                  t.name AS reason_name, COALESCE(t.paid, true) AS paid, COALESCE(t.is_annual, false) AS is_annual, false AS legacy,
                  to_jsonb(r)->>'from_at' AS from_at, to_jsonb(r)->>'to_at' AS to_at
             FROM hrm_schema.leave_requests r
             JOIN hrm_schema.leave_request_days d ON d.request_id = r.id AND d.tenant_id = r.tenant_id
             LEFT JOIN hrm_schema.leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
            WHERE r.tenant_id=$1 AND r.employee_id = ANY($2::uuid[]) AND r.status='APPROVED' AND d.work_date BETWEEN $3::date AND $4::date
           UNION ALL
           SELECT r.id, r.employee_id, to_char(g.d,'YYYY-MM-DD'), 1, 0,
                  t.name, COALESCE(t.paid, true), COALESCE(t.is_annual, false), true, NULL, NULL
             FROM hrm_schema.leave_requests r
             LEFT JOIN hrm_schema.leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
             CROSS JOIN LATERAL generate_series(GREATEST(r.from_date,$3::date), LEAST(r.to_date,$4::date), interval '1 day') g(d)
            WHERE r.tenant_id=$1 AND r.employee_id = ANY($2::uuid[]) AND r.status='APPROVED' AND r.from_date<=$4::date AND r.to_date>=$3::date
              AND NOT EXISTS(SELECT 1 FROM hrm_schema.leave_request_days d WHERE d.request_id = r.id)`,
          [tenant, ids, from, to],
        )
      : empty(),
    ids.length && !locked
      ? db.query(
          `SELECT id, employee_id, destination, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date,
                  to_jsonb(business_trip_requests)->>'from_at' AS from_at, to_jsonb(business_trip_requests)->>'to_at' AS to_at
             FROM hrm_schema.business_trip_requests
            WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND status='APPROVED' AND from_date<=$4::date AND to_date>=$3::date
            ORDER BY created_at, id`,
          [tenant, ids, from, to],
        )
      : empty(),
    ids.length && !locked
      ? db.query(
          `SELECT id, employee_id, to_char(work_date,'YYYY-MM-DD') AS work_date, to_char(start_time,'HH24:MI:SS') AS start_time, to_char(end_time,'HH24:MI:SS') AS end_time,
                  approved_minutes, paid
             FROM hrm_schema.ot_requests
            WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND work_date BETWEEN $3::date AND $4::date AND status='APPROVED'`,
          [tenant, ids, from, to],
        )
      : empty(),
    ids.length && (locked || input.periodId)
      ? db.query(
          `SELECT employee_id, to_char(work_date,'YYYY-MM-DD') AS work_date, shift_id, scheduled_minutes, worked_minutes, paid_minutes, ot_minutes,
                  late_minutes, early_leave_minutes, workday_units, status, is_manually_adjusted, adjustment_needs_review, calculation_snapshot, business_trip_request_id,
                  to_jsonb(timesheets)->'sources' AS sources
             FROM hrm_schema.timesheets
            WHERE tenant_id=$1 AND period_id=$2 AND employee_id = ANY($3::uuid[]) AND work_date BETWEEN $4::date AND $5::date AND (NOT $6::boolean OR is_manually_adjusted)`,
          [tenant, input.lockedPeriodId ?? input.periodId, ids, from, to, !locked],
        )
      : empty(),
    // Đơn giải trình công đã tác động tới ngày: sự kiện bị thay thế hoặc sự kiện do đơn tạo.
    ids.length && !locked
      ? db.query(
          `SELECT employee_id, to_char(work_date,'YYYY-MM-DD') AS work_date, cid FROM (
             SELECT employee_id, work_date, voided_by_correction_id::text AS cid FROM hrm_schema.attendance_events
              WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND work_date BETWEEN $3::date AND $4::date AND voided_by_correction_id IS NOT NULL
             UNION
             SELECT e.employee_id, e.work_date, to_jsonb(e)->'evidence'->>'correctionId' FROM hrm_schema.attendance_events e
              WHERE e.tenant_id=$1 AND e.employee_id = ANY($2::uuid[]) AND e.work_date BETWEEN $3::date AND $4::date AND e.voided_by_correction_id IS NULL
           ) x WHERE cid IS NOT NULL`,
          [tenant, ids, from, to],
        )
      : empty(),
    ids.length && !locked
      ? db.query(
          `SELECT id, employee_id, swap_with_employee_id, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date
             FROM hrm_schema.shift_change_requests
            WHERE tenant_id=$1 AND status='APPROVED' AND applied_at IS NOT NULL AND from_date<=$4::date AND to_date>=$3::date
              AND (employee_id = ANY($2::uuid[]) OR swap_with_employee_id = ANY($2::uuid[]))
            ORDER BY approved_at, id`,
          [tenant, ids, from, to],
        )
      : empty(),
    // Mọi đơn từ dính tới từng ngày (đã duyệt, chờ duyệt, từ chối) để mở xem từ ô công; một truy vấn cho cả năm loại đơn.
    ids.length
      ? db.query(
          `SELECT kind, id, employee_id, status, label, minutes, from_at, to_at, reason_name, description, created_at, ot_rate, trip_type, punch_in, punch_out,
                  to_char(day,'YYYY-MM-DD') AS date FROM (
             SELECT 'LEAVE' AS kind, r.id, r.employee_id, r.status, t.name AS label, d.paid_minutes AS minutes,
                    to_jsonb(r)->>'from_at' AS from_at, to_jsonb(r)->>'to_at' AS to_at, to_jsonb(r)->>'reason_name' AS reason_name,
                    to_jsonb(r)->>'reason' AS description, r.created_at, NULL::numeric AS ot_rate, NULL::text AS trip_type,
                    NULL::timestamptz AS punch_in, NULL::timestamptz AS punch_out, d.work_date AS day
               FROM hrm_schema.leave_requests r
               JOIN hrm_schema.leave_request_days d ON d.request_id=r.id AND d.tenant_id=r.tenant_id
               LEFT JOIN hrm_schema.leave_types t ON t.id=r.leave_type_id AND t.tenant_id=r.tenant_id
              WHERE r.tenant_id=$1 AND r.employee_id = ANY($2::uuid[]) AND r.status IN ('APPROVED','PENDING','REJECTED')
                AND d.work_date BETWEEN $3::date AND $4::date
             UNION ALL
             SELECT 'OT', o.id, o.employee_id, o.status, o.reason_name, o.planned_minutes,
                    to_jsonb(o)->>'from_at', to_jsonb(o)->>'to_at', o.reason_name, o.reason, o.created_at, o.ot_rate_multiplier, NULL::text,
                    NULL::timestamptz, NULL::timestamptz, g::date
               FROM hrm_schema.ot_requests o
               CROSS JOIN LATERAL generate_series(o.work_date, o.work_date + CASE WHEN o.end_time <= o.start_time THEN 1 ELSE 0 END, interval '1 day') g
              WHERE o.tenant_id=$1 AND o.employee_id = ANY($2::uuid[]) AND o.status IN ('APPROVED','PENDING','REJECTED')
                AND o.work_date <= $4::date AND o.work_date + CASE WHEN o.end_time <= o.start_time THEN 1 ELSE 0 END >= $3::date
             UNION ALL
             SELECT 'TRIP', b.id, b.employee_id, b.status, b.destination, NULL::int,
                    to_jsonb(b)->>'from_at', to_jsonb(b)->>'to_at', to_jsonb(b)->>'reason_name', b.reason, b.created_at, NULL::numeric,
                    b.business_trip_type::text, NULL::timestamptz, NULL::timestamptz, g::date
               FROM hrm_schema.business_trip_requests b
               CROSS JOIN LATERAL generate_series(b.from_date, b.to_date, interval '1 day') g
              WHERE b.tenant_id=$1 AND b.employee_id = ANY($2::uuid[]) AND b.status IN ('APPROVED','PENDING','REJECTED')
                AND b.from_date <= $4::date AND b.to_date >= $3::date
             UNION ALL
             SELECT 'CORRECTION', c.id, c.employee_id, c.status, NULL, NULL::int, NULL, NULL, to_jsonb(c)->>'reason_name', c.reason, c.created_at,
                    NULL::numeric, NULL::text, c.new_check_in_at, c.new_check_out_at, c.request_date
               FROM hrm_schema.attendance_corrections c
              WHERE c.tenant_id=$1 AND c.employee_id = ANY($2::uuid[]) AND c.status IN ('APPROVED','PENDING','REJECTED')
                AND c.request_date BETWEEN $3::date AND $4::date
             UNION ALL
             SELECT 'SHIFT_CHANGE', sc.id, x.employee_id, sc.status, NULL, NULL::int, NULL, NULL, to_jsonb(sc)->>'reason_name', to_jsonb(sc)->>'reason', sc.created_at,
                    NULL::numeric, NULL::text, NULL::timestamptz, NULL::timestamptz, g::date
               FROM hrm_schema.shift_change_requests sc
               CROSS JOIN LATERAL (VALUES (sc.employee_id), (sc.swap_with_employee_id)) x(employee_id)
               CROSS JOIN LATERAL generate_series(sc.from_date, sc.to_date, interval '1 day') g
              WHERE sc.tenant_id=$1 AND x.employee_id = ANY($2::uuid[]) AND sc.status IN ('APPROVED','PENDING','PEER_CONFIRMED','REJECTED')
                AND sc.from_date <= $4::date AND sc.to_date >= $3::date
             UNION ALL
             SELECT 'CUSTOM', q.id, q.employee_id, q.status, q.type_name, q.duration_minutes,
                    to_jsonb(q)->>'from_at', to_jsonb(q)->>'to_at', q.reason_name, q.reason, q.created_at, NULL::numeric, NULL::text,
                    NULL::timestamptz, NULL::timestamptz, g::date
               FROM hrm_schema.custom_requests q
               CROSS JOIN LATERAL generate_series(
                 COALESCE((q.from_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, (q.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date),
                 COALESCE((q.to_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, (q.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), interval '1 day') g
              WHERE q.tenant_id=$1 AND q.employee_id = ANY($2::uuid[]) AND q.status IN ('APPROVED','PENDING','REJECTED')
                AND COALESCE((q.from_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, (q.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) <= $4::date
                AND COALESCE((q.to_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, (q.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) >= $3::date
           ) x
           ORDER BY day, kind, id`,
          [tenant, ids, from, to],
        )
      : empty(),
  ]);

  // --- Chuẩn hóa dữ liệu nạp được ---
  const people = new Map<string, Record<string, unknown>>();
  for (const r of peopleRes.rows) people.set(r.employee_id as string, r);

  const calendarByDate = new Map<string, Record<string, unknown>>();
  for (const r of calendarRes.rows) calendarByDate.set(r.date as string, r);

  const allPolicies = policyRes.rows as (PolicyRow & { policy_type?: string })[];
  const policies = allPolicies.filter((p) => (p.policy_type ?? 'ATTENDANCE') === 'ATTENDANCE');
  // Công chuẩn của bảng công theo chính sách đang hiệu lực của tháng (tách khỏi công chuẩn trong chính sách lương, chỉ dùng cho tính lương).
  let monthStandard = DEFAULT_MONTH_STANDARD;
  try {
    const row = (
      await db.query(
        `SELECT mode, workdays FROM hrm_schema.timesheet_standard_policies
          WHERE tenant_id = $1 AND effective_month <= $2 ORDER BY effective_month DESC LIMIT 1`,
        [tenant, to.slice(0, 7)],
      )
    ).rows[0];
    monthStandard = monthStandardSetting(row);
  } catch {
    monthStandard = DEFAULT_MONTH_STANDARD; // tenant chưa chạy migration 0052
  }
  const hasScopedPolicy = policies.some(
    (p) => Array.isArray(p.config_json?.employeeIds) && (p.config_json.employeeIds as unknown[]).length,
  );
  const policyCache = new Map<string, Record<string, unknown> | null>();
  const policyConfigOf = (employeeId: string | undefined, date: string) => {
    const cacheKey = hasScopedPolicy ? `${date}|${employeeId ?? ''}` : date;
    if (policyCache.has(cacheKey)) return policyCache.get(cacheKey)!;
    let config: Record<string, unknown> | null = null;
    try {
      const effective = policies.filter(
        (p) => p.effective_from <= date && (!p.effective_to || p.effective_to >= date),
      );
      config = pickPolicyVersion(effective, 'ATTENDANCE', date, employeeId)?.config_json ?? null;
    } catch {
      config = null; // chính sách xung đột: không suy luận ngày nghỉ hằng tuần (giống dayKindOf)
    }
    policyCache.set(cacheKey, config);
    return config;
  };

  const scheduleRows = new Map<string, ScheduleDayRow>();
  for (const r of scheduleRes.rows)
    scheduleRows.set(key(r.employee_id, r.date), {
      employeeId: r.employee_id,
      date: r.date,
      dayType: r.day_type,
      shiftId: r.shift_id ?? null,
      holidayPaid: typeof r.holiday_paid === 'boolean' ? r.holiday_paid : null,
      holidayName: r.holiday_name ?? null,
    });
  const ruleByDay = new Map<string, RuleDay>();
  for (const r of ruleDays) ruleByDay.set(key(r.employeeId, r.date), r);

  // Ca cần dùng: một truy vấn theo lô.
  const shiftIds = new Set<string>();
  for (const r of scheduleRows.values()) if (r.shiftId) shiftIds.add(r.shiftId);
  for (const r of ruleDays) if (r.shiftId) shiftIds.add(r.shiftId);
  for (const r of storedRes.rows) if (r.shift_id) shiftIds.add(r.shift_id as string);
  const shifts = new Map<string, BoardShiftDef>();
  if (shiftIds.size) {
    const res = await db.query(
      `SELECT id, code, name, start_time, end_time, break_start_time, break_end_time, cross_midnight, break_minutes, grace_late_minutes, grace_early_minutes
         FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [tenant, [...shiftIds]],
    );
    for (const r of res.rows) shifts.set(r.id as string, mapShiftRow(r));
  }

  const eventsByDay = new Map<string, Punch[]>();
  for (const r of eventsRes.rows) {
    const k = key(r.employee_id, r.work_date);
    const list = eventsByDay.get(k) ?? [];
    list.push({
      id: r.id,
      kind: r.event_kind,
      at: new Date(String(r.occurred_at)).toISOString(),
    });
    eventsByDay.set(k, list);
  }
  const leavesByDay = new Map<string, BoardLeaveInput[]>();
  for (const r of leavesRes.rows) {
    const k = key(r.employee_id, r.work_date);
    const list = leavesByDay.get(k) ?? [];
    list.push({
      requestId: r.request_id,
      reasonName: r.reason_name ?? null,
      paid: r.paid !== false,
      annual: r.is_annual === true,
      days: Number(r.quantity),
      paidMinutes: Number(r.paid_minutes ?? 0),
      legacy: r.legacy === true,
      interval: intervalOfIso(r.from_at, r.to_at),
    });
    leavesByDay.set(k, list);
  }
  const tripsByEmployee = new Map<
    string,
    { id: string; from: string; to: string; interval: CoveredInterval | null; label: string | null }[]
  >();
  for (const r of tripsRes.rows) {
    const list = tripsByEmployee.get(r.employee_id) ?? [];
    list.push({
      id: r.id,
      from: r.from_date,
      to: r.to_date,
      interval: intervalOfIso(r.from_at, r.to_at),
      label: (r.destination as string | null) ?? null,
    });
    tripsByEmployee.set(r.employee_id, list);
  }
  const correctionsByDay = new Map<string, string[]>();
  for (const r of correctionRes.rows) {
    const k = key(r.employee_id, r.work_date);
    const list = correctionsByDay.get(k) ?? [];
    if (!list.includes(r.cid)) list.push(r.cid);
    correctionsByDay.set(k, list);
  }
  const requestsByDay = new Map<string, HrmDayRequest[]>();
  for (const r of requestsRes.rows) {
    const k = key(r.employee_id, r.date);
    const list = requestsByDay.get(k) ?? [];
    list.push({
      kind: r.kind,
      id: r.id,
      status: r.status === 'APPROVED' ? 'APPROVED' : r.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
      label: r.label ?? null,
      minutes: r.minutes == null ? null : Number(r.minutes),
      fromAt: r.from_at ? new Date(String(r.from_at)).toISOString() : null,
      toAt: r.to_at ? new Date(String(r.to_at)).toISOString() : null,
      reasonName: r.reason_name ?? null,
      description: typeof r.description === 'string' && r.description.trim() ? r.description.trim() : null,
      createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      otRate: r.ot_rate == null ? null : Number(r.ot_rate),
      tripType: r.trip_type ?? null,
      punchIn: r.punch_in ? new Date(String(r.punch_in)).toISOString() : null,
      punchOut: r.punch_out ? new Date(String(r.punch_out)).toISOString() : null,
    });
    requestsByDay.set(k, list);
  }
  const shiftChangeIdsOf = (employeeId: string, date: string): string[] =>
    shiftChangeRes.rows
      .filter(
        (r) =>
          (r.employee_id === employeeId || r.swap_with_employee_id === employeeId) &&
          r.from_date <= date &&
          r.to_date >= date,
      )
      .map((r) => r.id as string);
  const otByDay = new Map<string, { id: string; start: string; end: string; approved: number; paid: boolean }[]>();
  for (const r of otRes.rows) {
    const k = key(r.employee_id, r.work_date);
    const list = otByDay.get(k) ?? [];
    list.push({ id: r.id, start: r.start_time, end: r.end_time, approved: Number(r.approved_minutes ?? 0), paid: r.paid !== false });
    otByDay.set(k, list);
  }
  const storedByDay = new Map<string, Record<string, unknown>>();
  for (const r of storedRes.rows) storedByDay.set(key(r.employee_id as string, r.work_date as string), r);

  // --- Lịch chung của công ty ---
  const calendar: HrmBoardCalendarDay[] = dates.map((date) => {
    const cal = calendarByDate.get(date);
    const kind = effectiveDayKind(date, cal?.day_kind as string | undefined, policyConfigOf(undefined, date));
    const normalized = kind === 'OFF' || kind === 'HOLIDAY' ? kind : 'WORK';
    return {
      date,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      kind: normalized,
      holidayName: normalized === 'HOLIDAY' ? ((cal?.name as string | undefined) ?? null) : null,
    };
  });

  // --- Từng nhân viên, từng ngày ---
  const employees: HrmBoardEmployee[] = [];
  for (const employeeId of ids) {
    const person = people.get(employeeId);
    if (!person) continue;
    const joinDate = String(person.join_date);
    const inactiveFrom = person.inactive_from ? String(person.inactive_from) : null;
    const trips = tripsByEmployee.get(employeeId) ?? [];
    const days: Record<string, HrmBoardDay> = {};
    for (const date of dates) {
      const employed = date >= joinDate && (!inactiveFrom || date < inactiveFrom);
      const k = key(employeeId, date);
      const cal = calendarByDate.get(date);
      if (locked) {
        days[date] = employed
          ? storedDay(
              date,
              storedByDay.get(k),
              shifts,
              leavesByDay.get(k) ?? [],
              scheduleRows.get(k)?.holidayName ?? null,
              cal,
            )
          : emptyDay(date, 'NO_SCHEDULE', 'NO_SCHEDULE');
        continue;
      }
      if (!employed) {
        days[date] = emptyDay(date, 'NO_SCHEDULE', 'NO_SCHEDULE');
        continue;
      }
      const config = policyConfigOf(employeeId, date);
      const timezone = validTimezone(config?.timezone);
      const resolved = resolveScheduleBatch(scheduleRows.get(k), ruleByDay.get(k), (id) => shifts.has(id));
      const dayTrips = trips.filter((t) => t.from <= date && t.to >= date);
      const computed = computeBoardDay({
        date,
        today,
        timezone,
        employed,
        calendarKind: (cal?.day_kind as string | undefined) ?? null,
        calendarPaid: Boolean(cal?.paid),
        calendarName: (cal?.name as string | undefined) ?? null,
        policyConfig: config,
        scheduleDayType: resolved.scheduleDayType,
        scheduleHolidayPaid: resolved.holidayPaid,
        scheduleHolidayName: resolved.holidayName,
        shift: resolved.shiftId ? (shifts.get(resolved.shiftId) ?? null) : null,
        events: eventsByDay.get(k) ?? [],
        leaves: leavesByDay.get(k) ?? [],
        tripIds: dayTrips.map((t) => t.id),
        tripIntervals: dayTrips.map((t) => t.interval),
        tripLabels: dayTrips.map((t) => t.label),
        correctionIds: correctionsByDay.get(k) ?? [],
        shiftChangeIds: shiftChangeIdsOf(employeeId, date),
        ot: (otByDay.get(k) ?? []).map((o) => {
          const crosses = o.end <= o.start;
          return {
            id: o.id,
            approvedMinutes: o.approved,
            paid: o.paid,
            startMs: zonedMs(date, o.start, timezone),
            endMs: zonedMs(crosses ? addDays(date, 1) : date, o.end, timezone),
          };
        }),
      });
      days[date] = applyManualAdjustment(computed, storedByDay.get(k));
    }
    // Mọi đơn từ dính tới ngày (kể cả chờ duyệt, từ chối) hiển thị ở ô công để mở xem.
    for (const date of dates) {
      const list = requestsByDay.get(key(employeeId, date));
      if (list?.length && days[date] && days[date].kind !== 'NO_SCHEDULE') days[date] = { ...days[date], requests: list };
      else if (list?.length && days[date]) days[date] = { ...days[date], requests: list };
    }
    const scheduledUnits = Object.values(days)
      .filter((d) => d.kind !== 'OFF' && d.scheduledMinutes > 0)
      .reduce((n, d) => n + dayCapacityUnits(d.scheduledMinutes), 0);
    employees.push({
      employeeId,
      employeeCode: String(person.employee_code ?? ''),
      employeeName: String(person.full_name ?? ''),
      departmentName: (person.department_name as string | null) ?? null,
      positionName: (person.position_name as string | null) ?? null,
      days,
      totals: sumBoardTotals(Object.values(days)),
      standard: { mode: monthStandard.mode, workdays: monthStandardWorkdays(monthStandard, scheduledUnits) },
    });
  }
  return { calendar, employees };
}

/**
 * Dòng công đã điều chỉnh tay (giải trình công, hrm.timesheet.adjust) thắng kết quả tính: số công lấy theo dòng đã lưu;
 * ngày bất thường đã được xử lý thì không còn bị coi là bất thường. Dòng điều chỉnh còn chờ rà soát thì giữ nguyên kết quả tính.
 */
export function applyManualAdjustment(
  day: HrmBoardDay,
  row: Record<string, unknown> | undefined,
): HrmBoardDay {
  if (!row || row.is_manually_adjusted !== true || row.adjustment_needs_review === true)
    return day;
  const status =
    day.status === 'ABNORMAL'
      ? lateEarlyStatus(day.lateMinutes, day.earlyLeaveMinutes)
      : day.status;
  return {
    ...day,
    status,
    paidMinutes: Number(row.paid_minutes ?? day.paidMinutes),
    workdayUnits: Number(row.workday_units ?? day.workdayUnits),
    adjusted: true,
  };
}

function empty(): Promise<{ rows: Record<string, any>[] }> {
  return Promise.resolve({ rows: [] });
}

/** Ngày của tháng đã khóa: dựng từ dòng timesheets bất biến (calculation_snapshot cho ca / bất thường). */
function storedDay(
  date: string,
  row: Record<string, unknown> | undefined,
  shifts: Map<string, BoardShiftDef>,
  leaves: readonly BoardLeaveInput[],
  scheduleHolidayName: string | null,
  calendar: Record<string, unknown> | undefined,
): HrmBoardDay {
  if (!row) return emptyDay(date, 'NO_SCHEDULE', 'NO_SCHEDULE');
  const snapshot = (row.calculation_snapshot ?? {}) as Record<string, unknown>;
  if (snapshot.employmentEligible === false) return emptyDay(date, 'NO_SCHEDULE', 'NO_SCHEDULE');
  const timezone = validTimezone(snapshot.timezone);
  const shift = row.shift_id ? (shifts.get(row.shift_id as string) ?? null) : null;
  const dayKind = snapshot.dayKind as string | undefined;
  const scheduled = Number(row.scheduled_minutes ?? 0);
  const late = Number(row.late_minutes ?? 0);
  const early = Number(row.early_leave_minutes ?? 0);
  const leave = leaveInfoOf(leaves);
  const stored = String(row.status);
  const kind: HrmBoardDayKind =
    dayKind === 'HOLIDAY' || stored === 'HOLIDAY'
      ? 'HOLIDAY'
      : dayKind === 'OFF' || stored === 'OFF'
        ? 'OFF'
        : shift
          ? 'WORK'
          : 'NO_SCHEDULE';
  let status: HrmBoardDayStatus;
  if (kind === 'HOLIDAY') status = 'HOLIDAY';
  else if (kind === 'OFF') status = 'OFF';
  else if (stored === 'ABNORMAL') status = 'ABNORMAL';
  else if (stored === 'BUSINESS_TRIP') status = 'TRIP';
  else if (stored === 'LEAVE') status = leave ? leaveStatus(leave) : 'PAID_LEAVE';
  else if (stored === 'ABSENT') status = shift ? 'ABSENT' : 'NO_SCHEDULE';
  else if (!shift && !scheduled) status = 'NO_SCHEDULE';
  else status = lateEarlyStatus(late, early);
  const showShift = shift && kind !== 'OFF';
  const anomalies = Array.isArray(snapshot.anomalies)
    ? (snapshot.anomalies as string[]).map((a) => ANOMALY_NAMES[a] ?? a)
    : [];
  const holidayName =
    kind === 'HOLIDAY'
      ? ((calendar?.day_kind === 'HOLIDAY' ? (calendar.name as string) : null) ??
        scheduleHolidayName ??
        (calendar?.name as string | undefined) ??
        null)
      : null;
  return emptyDay(date, kind, status, {
    shiftCode: showShift ? shift.code : null,
    shiftName: showShift ? shift.name : null,
    shiftStart: showShift ? shift.startTime.slice(0, 5) : null,
    shiftEnd: showShift ? shift.endTime.slice(0, 5) : null,
    shiftBreakStart: showShift ? (shift.breakStartTime?.slice(0, 5) ?? null) : null,
    shiftBreakEnd: showShift ? (shift.breakEndTime?.slice(0, 5) ?? null) : null,
    shiftBreakMinutes: showShift ? shift.breakMinutes : 0,
    checkIn: localHm((snapshot.firstIn as string | null) ?? null, timezone),
    checkOut: localHm((snapshot.lastOut as string | null) ?? null, timezone),
    scheduledMinutes: scheduled,
    workedMinutes: Number(row.worked_minutes ?? 0),
    paidMinutes: Number(row.paid_minutes ?? 0),
    workdayUnits: Number(row.workday_units ?? 0),
    lateMinutes: late,
    earlyLeaveMinutes: early,
    otMinutes: Number(row.ot_minutes ?? 0),
    anomalies,
    leave,
    tripId: (row.business_trip_request_id as string | null) ?? null,
    holidayName,
    adjusted: row.is_manually_adjusted === true,
    sources: Array.isArray(row.sources) ? (row.sources as HrmDaySource[]) : [],
  });
}

