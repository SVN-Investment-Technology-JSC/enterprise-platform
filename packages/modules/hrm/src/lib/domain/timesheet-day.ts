/**
 * Quy tắc tính MỘT ngày công của một nhân viên, dùng chung cho bảng công xem trực tiếp (computeBoardDay) và cho
 * lúc tính công để chốt (calculateTimesheet). Hàm thuần: không đọc DB. Hai đường chỉ khác nhau ở cách NẠP dữ liệu,
 * còn số phút, trạng thái bất thường và số công đều do đây quyết định nên bảng và số chốt khớp theo cấu trúc.
 */

/** Khoảng thời gian [startMs, endMs) mà đơn nghỉ hoặc công tác đã duyệt bao phủ (đơn có từ ngày giờ đến ngày giờ). */
export interface CoveredInterval {
  startMs: number;
  endMs: number;
}

export interface DayShiftBounds {
  startMs: number;
  endMs: number;
  breakStartMs: number | null;
  breakEndMs: number | null;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
}

export interface DayLeaveInput {
  /** Số ngày nghỉ rơi vào ngày này (0.5 cho nửa ngày). */
  days: number;
  /** Phút công hưởng lương (leave_request_days.paid_minutes). */
  paidMinutes: number;
  /** Khoảng nghỉ trong ngày; null với đơn cũ chưa có giờ. */
  interval: CoveredInterval | null;
  /** Đơn cũ không có chi tiết từng ngày: cần rà soát tay. */
  legacy?: boolean;
}

/** Công tác từ 4 giờ trở xuống trong một ngày tính nửa ngày (0,5), trên 4 giờ tính cả ngày (1). */
export const HALF_DAY_TRIP_MINUTES = 240;

export interface DayTripInput {
  /** Khoảng công tác trong ngày; null = cả ngày (đơn cũ chưa có giờ). */
  interval: CoveredInterval | null;
  /** Số phút công tác nằm trong ngày này (đã cắt theo ngày); thiếu thì lấy theo độ dài của khoảng. */
  dayMinutes?: number | null;
}

export interface DayOutcomeInput {
  off: boolean;
  holiday: boolean;
  holidayPaid: boolean;
  shift: DayShiftBounds | null;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  firstInMs: number | null;
  lastOutMs: number | null;
  /** Mã bất thường thô từ calculateAttendance (NO_SHIFT, MISSING_OUT, OUT_WITHOUT_IN, ...). */
  anomalies: readonly string[];
  leaves: readonly DayLeaveInput[];
  trips: readonly DayTripInput[];
  /** Ngày có đơn tăng ca đã duyệt: không tính đi trễ / về sớm (giờ tăng ca tính theo số giờ của đơn). */
  hasOt?: boolean;
}

export interface DayOutcome {
  paidMinutes: number;
  /** Bất thường làm ngày công thành ABNORMAL (chặn chốt công). */
  issues: string[];
  /** Phần ca đã được nghỉ/công tác bao phủ (phút, đã trừ giờ nghỉ trưa). */
  coveredMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  /** Nghỉ/công tác đã bao phủ toàn bộ ca: lỗi chấm công chỉ còn là ghi chú. */
  fullyCovered: boolean;
}

const MINUTE = 60000;
const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/** Hợp các khoảng (đã sắp theo đầu) để không tính trùng khi nghỉ và công tác chồng nhau. */
function mergeIntervals(list: CoveredInterval[]): CoveredInterval[] {
  const sorted = list
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: CoveredInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMs <= last.endMs) last.endMs = Math.max(last.endMs, i.endMs);
    else out.push({ ...i });
  }
  return out;
}

/** Phút làm việc của khoảng [a,b) trong ca (đã trừ giờ nghỉ trưa). */
function workMinutesIn(shift: DayShiftBounds, a: number, b: number): number {
  const start = Math.max(a, shift.startMs);
  const end = Math.min(b, shift.endMs);
  if (end <= start) return 0;
  const breakMs =
    shift.breakStartMs != null && shift.breakEndMs != null
      ? overlap(start, end, shift.breakStartMs, shift.breakEndMs)
      : 0;
  return Math.max(0, Math.round((end - start - breakMs) / MINUTE));
}

/**
 * Phút ca đã được nghỉ/công tác bao phủ.
 *  - Công tác: tính theo số giờ công tác trong ngày; từ 4 giờ trở xuống là nửa ngày (0,5 ca), trên 4 giờ là cả ngày (1 ca);
 *    đơn cũ không có giờ tính cả ngày. Ngày công tác được tính công tự động, không cần chấm công (nửa ngày còn lại vẫn chấm).
 *  - Nghỉ: đơn có khoảng giờ thì theo phần giao với ca; không có giờ thì >= 1 ngày là cả ca, ít hơn thì theo phút công hưởng lương.
 */
export function coveredMinutesOf(
  shift: DayShiftBounds | null,
  scheduledMinutes: number,
  leaves: readonly DayLeaveInput[],
  trips: readonly DayTripInput[],
): { minutes: number; intervals: CoveredInterval[]; wholeDay: boolean } {
  const intervals: CoveredInterval[] = [];
  const leaveIntervals: CoveredInterval[] = [];
  let wholeDay = false;
  let halfTrip = false;
  for (const t of trips) {
    if (!t.interval) {
      wholeDay = true;
      continue;
    }
    const minutes = t.dayMinutes ?? Math.round((t.interval.endMs - t.interval.startMs) / MINUTE);
    if (minutes <= 0) continue;
    intervals.push(t.interval);
    if (minutes <= HALF_DAY_TRIP_MINUTES) halfTrip = true;
    else wholeDay = true;
  }
  let fallback = 0;
  for (const l of leaves) {
    if (l.interval) {
      intervals.push(l.interval);
      leaveIntervals.push(l.interval);
    } else if (l.days >= 0.99) wholeDay = true;
    else fallback += l.paidMinutes;
  }
  if (wholeDay) return { minutes: scheduledMinutes, intervals, wholeDay: true };
  if (!shift) return { minutes: 0, intervals, wholeDay: false };
  const byLeave = mergeIntervals(leaveIntervals).reduce((n, i) => n + workMinutesIn(shift, i.startMs, i.endMs), 0);
  const tripHalf = halfTrip ? Math.round(scheduledMinutes / 2) : 0;
  return {
    minutes: Math.min(scheduledMinutes, byLeave + fallback + tripHalf),
    intervals: mergeIntervals(intervals),
    wholeDay: false,
  };
}

export function resolveDayOutcome(input: DayOutcomeInput): DayOutcome {
  const { off, holiday, scheduledMinutes: scheduled } = input;
  const covered = coveredMinutesOf(input.shift, scheduled, input.leaves, input.trips);
  const hasLeave = input.leaves.length > 0;
  const hasTrip = input.trips.length > 0;
  const legacy = input.leaves.some((l) => l.legacy);
  const leavePaid = input.leaves.reduce((n, l) => n + l.paidMinutes, 0);
  // Công tác tính công cho phần ca nó bao phủ; công tác chồng nghỉ được cảnh báo riêng nên không cộng hai lần.
  const tripMinutes = hasTrip
    ? coveredMinutesOf(input.shift, scheduled, [], input.trips).minutes
    : 0;

  let paid = off
    ? 0
    : holiday
      ? input.holidayPaid
        ? scheduled
        : 0
      : Math.min(scheduled, input.workedMinutes + leavePaid + tripMinutes);
  if (!Number.isFinite(paid)) paid = 0;

  const fullyCovered = !off && !holiday && scheduled > 0 && covered.minutes >= scheduled;

  // Ngày có công tác hoặc tăng ca đã duyệt không tính đi trễ / về sớm (công tác tính theo quy tắc công tác, tăng ca theo số giờ
  // của đơn). Ngày chỉ có nghỉ: đi trễ / về sớm chỉ tính trên phần ca chưa được nghỉ bao phủ.
  let late = input.lateMinutes;
  let early = input.earlyMinutes;
  if (hasTrip || input.hasOt) {
    late = 0;
    early = 0;
  } else if (fullyCovered) {
    late = 0;
    early = 0;
  } else if (input.shift && covered.intervals.length && !covered.wholeDay) {
    const shift = input.shift;
    let effStart = shift.startMs;
    let effEnd = shift.endMs;
    for (const i of covered.intervals) {
      if (i.startMs <= effStart && i.endMs > effStart) effStart = Math.min(i.endMs, shift.endMs);
      if (i.endMs >= effEnd && i.startMs < effEnd) effEnd = Math.max(i.startMs, shift.startMs);
    }
    // Điểm cắt rơi vào giờ nghỉ trưa thì ca làm việc thực tế bắt đầu sau giờ nghỉ / kết thúc trước giờ nghỉ.
    if (shift.breakStartMs != null && shift.breakEndMs != null) {
      if (effStart >= shift.breakStartMs && effStart < shift.breakEndMs) effStart = shift.breakEndMs;
      if (effEnd > shift.breakStartMs && effEnd <= shift.breakEndMs) effEnd = shift.breakStartMs;
    }
    if (effStart !== shift.startMs && input.firstInMs != null) {
      const minutes = Math.max(0, Math.round((input.firstInMs - effStart) / MINUTE));
      late = minutes > shift.graceLateMinutes ? minutes : 0;
    } else if (effStart !== shift.startMs) {
      late = 0;
    }
    if (effEnd !== shift.endMs && input.lastOutMs != null) {
      const minutes = Math.max(0, Math.round((effEnd - input.lastOutMs) / MINUTE));
      early = minutes > shift.graceEarlyMinutes ? minutes : 0;
    } else if (effEnd !== shift.endMs) {
      early = 0;
    }
  }

  const issues = input.anomalies.filter(
    (a) => a !== 'NO_SHIFT' || (!off && (!holiday || input.holidayPaid)),
  );
  // Nghỉ/công tác đã bao phủ cả ca thì lỗi chấm công không còn chặn chốt công; ngày chưa phân ca vẫn phải xử lý.
  const kept = fullyCovered ? issues.filter((a) => a === 'NO_SHIFT') : [...issues];
  if (legacy) kept.push('LEGACY_LEAVE_REQUIRES_REVIEW');
  if (hasLeave && hasTrip) kept.push('LEAVE_TRIP_OVERLAP');

  return {
    paidMinutes: paid,
    issues: kept,
    coveredMinutes: covered.minutes,
    lateMinutes: late,
    earlyMinutes: early,
    fullyCovered,
  };
}
