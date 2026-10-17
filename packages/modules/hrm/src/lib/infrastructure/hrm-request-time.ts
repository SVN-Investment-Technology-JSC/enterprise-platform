import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  HrmRequestTimeDay,
  HrmRequestTimePreview,
} from '@enterprise-platform/contracts-hrm';
import {
  DEFAULT_TIMEZONE,
  addDays,
  enumerateDates,
  validTimezone,
  zonedMs,
} from './hrm-timesheet-board.js';
import {
  leaveDayWeight,
  previewLeaveDays,
  type LeaveDayPreview,
} from './hrm-leave-day-preview.js';
import { resolvePolicy } from './hrm-time.js';

/**
 * Thời gian của đơn từ: "từ ngày giờ đến ngày giờ" theo múi giờ của tenant.
 *
 * Client gửi `fromAt`/`toAt` dạng giờ địa phương không kèm múi giờ (`YYYY-MM-DDTHH:mm[:ss]`, hiểu theo múi giờ tenant)
 * hoặc ISO có múi giờ (`...Z`, `...+07:00`). Server tính số giờ/ngày theo ca thực tế của nhân viên:
 * khoảng chọn được cắt theo khung ca của từng ngày, trừ giờ nghỉ giữa ca, bỏ ngày nghỉ và ngày lễ.
 */

const MAX_SPAN_MS = 366 * 86400000;
/** Dung sai (phút) khi so khoảng nghỉ một phần ngày với đúng nửa ca. */
const HALF_DAY_TOLERANCE_MINUTES = 5;
const round2 = (n: number) => Math.round(n * 100) / 100;

const NAIVE_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(timeZone: string) {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    dateFormatters.set(timeZone, f);
  }
  return f;
}

function localParts(ms: number, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of dateFormatter(timeZone).formatToParts(new Date(ms)))
    if (p.type !== 'literal') out[p.type] = p.value;
  return {
    date: `${out.year}-${out.month}-${out.day}`,
    time: `${out.hour === '24' ? '00' : out.hour}:${out.minute}`,
  };
}

/** Ngày địa phương (YYYY-MM-DD) của một thời điểm. */
export function localDateOf(ms: number, timeZone: string): string {
  return localParts(ms, timeZone).date;
}

/** Giờ địa phương (HH:mm) của một thời điểm. */
export function localTimeOf(ms: number, timeZone: string): string {
  return localParts(ms, timeZone).time;
}

/**
 * Đọc `fromAt`/`toAt` do client gửi. Không kèm múi giờ thì hiểu là giờ địa phương của tenant.
 * Ném 400 tiếng Việt nếu sai định dạng.
 */
export function parseRequestInstant(value: unknown, timeZone: string, label: string): number {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException(`${label}: cần nhập ngày và giờ.`);
  const text = value.trim();
  const naive = NAIVE_LOCAL.exec(text);
  let ms: number;
  if (naive) {
    const [h, m] = naive[2].split(':').map(Number);
    if (h > 23 || m > 59) throw new BadRequestException(`${label}: giờ không hợp lệ.`);
    ms = zonedMs(naive[1], `${naive[2]}${naive[3] ?? ':00'}`, timeZone);
    // zonedMs không báo ngày không tồn tại (ví dụ 30/02): đối chiếu ngược ngày địa phương.
    if (!Number.isFinite(ms) || localDateOf(ms, timeZone) !== naive[1])
      throw new BadRequestException(`${label}: ngày không hợp lệ.`);
  } else if (WITH_ZONE.test(text)) {
    ms = Date.parse(text);
  } else {
    throw new BadRequestException(`${label}: định dạng ngày giờ không hợp lệ (YYYY-MM-DDTHH:mm).`);
  }
  if (!Number.isFinite(ms)) throw new BadRequestException(`${label}: ngày giờ không hợp lệ.`);
  return ms;
}

/** Kiểm tra khoảng từ-đến: đến sau từ và không quá 366 ngày. Trả về hai mốc đã đọc (ms UTC). */
export function parseRequestRange(
  fromAt: unknown,
  toAt: unknown,
  timeZone: string,
): { fromMs: number; toMs: number } {
  const fromMs = parseRequestInstant(fromAt, timeZone, 'Từ ngày giờ');
  const toMs = parseRequestInstant(toAt, timeZone, 'Đến ngày giờ');
  if (toMs <= fromMs) throw new BadRequestException('Đến ngày giờ phải sau từ ngày giờ.');
  if (toMs - fromMs > MAX_SPAN_MS)
    throw new BadRequestException('Khoảng thời gian tối đa 366 ngày.');
  return { fromMs, toMs };
}

/** Các ngày lịch (địa phương) mà khoảng từ-đến chạm vào; ngày kết thúc đúng 00:00 không tính. */
export function calendarDatesOf(fromMs: number, toMs: number, timeZone: string): string[] {
  const first = localDateOf(fromMs, timeZone);
  const last = localDateOf(Math.max(fromMs, toMs - 1), timeZone);
  return enumerateDates(first, last);
}

/** Đơn làm thêm giờ: suy ra ngày làm, giờ bắt đầu/kết thúc (HH:mm) và số phút từ khoảng từ-đến. */
export function deriveOvertimeTime(fromMs: number, toMs: number, timeZone: string) {
  const startTime = localTimeOf(fromMs, timeZone);
  const endTime = localTimeOf(toMs, timeZone);
  const plannedMinutes = Math.round((toMs - fromMs) / 60000);
  if (plannedMinutes <= 0 || plannedMinutes >= 1440)
    throw new BadRequestException('Một đơn làm thêm giờ tối đa dưới 24 giờ.');
  return {
    workDate: localDateOf(fromMs, timeZone),
    startTime,
    endTime,
    plannedMinutes,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tính số giờ / ngày theo ca
// ---------------------------------------------------------------------------------------------------------------

/** Ca của một ngày dưới dạng mốc tuyệt đối (ms UTC). */
export interface RequestShiftDay {
  readonly date: string;
  readonly kind: 'WORK' | 'OFF' | 'HOLIDAY' | 'NO_SHIFT';
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly breakStartMs: number | null;
  readonly breakEndMs: number | null;
  /** Số phút làm việc của cả ca (đã trừ giờ nghỉ). */
  readonly shiftMinutes: number;
}

export interface RequestTimeResult {
  readonly days: readonly HrmRequestTimeDay[];
  readonly totalMinutes: number;
  readonly totalDays: number;
  /** Cảnh báo không chặn (ví dụ ngày nghỉ nằm trong khoảng). */
  readonly warnings: readonly string[];
  /** Lỗi chặn gửi đơn (ví dụ chưa phân ca, nghỉ một phần ngày không đúng nửa ca với đơn vị ngày). */
  readonly errors: readonly string[];
}

const overlapMs = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Tính phần của khoảng [fromMs, toMs) rơi vào ca từng ngày (HÀM THUẦN).
 * - Ngày làm việc: phút = phần giao với khung ca trừ phần giao với giờ nghỉ giữa ca; nếu khoảng phủ cả ca thì đúng bằng số phút của ca.
 * - Đơn vị DAYS: cả ngày (quy theo `leaveDayWeight` của ca) hoặc đúng nửa ca (0.5); nghỉ một phần khác là lỗi.
 * - Đơn vị HOURS: số giờ thực tế (phút/60).
 * Ngày nghỉ, ngày lễ chỉ được ghi chú; ngày làm việc chưa phân ca là lỗi.
 * `strict` (đơn công tác): mọi ngày làm việc trong khoảng đều phải là cả ca hoặc đúng nửa ca, kể cả ngày đầu và ngày cuối
 * của khoảng nhiều ngày (đơn nghỉ được làm tròn về bội số 0.5 ở hai ngày này). `subject` là từ dùng trong thông báo lỗi.
 */
export function computeRequestTime(
  days: readonly RequestShiftDay[],
  fromMs: number,
  toMs: number,
  timeZone: string,
  unit: 'DAYS' | 'HOURS' = 'DAYS',
  options: { strict?: boolean; subject?: string } = {},
): RequestTimeResult {
  const strict = options.strict === true;
  const subject = options.subject ?? 'nghỉ';
  const rangeDates = new Set(calendarDatesOf(fromMs, toMs, timeZone));
  const out: HrmRequestTimeDay[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let totalMinutes = 0;
  let totalDays = 0;

  for (const day of days) {
    const inRange = rangeDates.has(day.date);
    if (day.kind === 'OFF' || day.kind === 'HOLIDAY') {
      if (inRange) {
        out.push({ date: day.date, kind: day.kind, minutes: 0, quantity: 0 });
        warnings.push(
          `${day.date} là ngày ${day.kind === 'OFF' ? 'nghỉ' : 'lễ'}, không tính vào đơn.`,
        );
      }
      continue;
    }
    if (day.kind === 'NO_SHIFT') {
      if (inRange) {
        out.push({ date: day.date, kind: 'NO_SHIFT', minutes: 0, quantity: 0 });
        errors.push(`Chưa phân ca ngày ${day.date}; không thể xác định số giờ.`);
      }
      continue;
    }
    const { startMs, endMs } = day;
    if (startMs === null || endMs === null) continue;
    const shiftMinutes = day.shiftMinutes;
    const covered = overlapMs(fromMs, toMs, startMs, endMs);
    if (!covered) {
      if (inRange) {
        out.push({ date: day.date, kind: 'WORK', minutes: 0, quantity: 0 });
        warnings.push(`${day.date}: khoảng đã chọn không nằm trong ca làm việc.`);
      }
      continue;
    }
    const wholeShift = fromMs <= startMs && toMs >= endMs;
    const breakOverlap =
      day.breakStartMs !== null && day.breakEndMs !== null
        ? overlapMs(fromMs, toMs, day.breakStartMs, day.breakEndMs)
        : 0;
    const minutes = wholeShift
      ? shiftMinutes
      : Math.max(0, Math.round((covered - breakOverlap) / 60000));
    if (!minutes) {
      if (inRange) {
        out.push({ date: day.date, kind: 'WORK', minutes: 0, quantity: 0 });
        warnings.push(`${day.date}: khoảng đã chọn chỉ rơi vào giờ nghỉ giữa ca.`);
      }
      continue;
    }
    const weight = leaveDayWeight(shiftMinutes);
    let quantity: number;
    if (unit === 'HOURS') {
      quantity = round2(minutes / 60);
    } else if (minutes >= shiftMinutes - 1) {
      quantity = weight;
    } else if (Math.abs(minutes - shiftMinutes / 2) <= HALF_DAY_TOLERANCE_MINUTES) {
      quantity = 0.5;
    } else if (rangeDates.size > 1 && !strict) {
      // Nghỉ nhiều ngày: ngày đầu và ngày cuối nghỉ một phần ca quy về bội số 0.5 (tối thiểu 0.5, tối đa trọng số ngày).
      quantity = Math.min(weight, Math.max(0.5, Math.round(((weight * minutes) / shiftMinutes) * 2) / 2));
    } else {
      quantity = Math.round(((weight * minutes) / shiftMinutes) * 2) / 2;
      errors.push(
        `${day.date}: ${subject} theo ngày chỉ nhận cả ngày hoặc đúng nửa ca (${Math.round(shiftMinutes / 2)} phút); đang chọn ${minutes} phút.`,
      );
    }
    out.push({ date: day.date, kind: 'WORK', minutes, quantity });
    totalMinutes += minutes;
    // Đơn vị ngày: số ngày của đơn chính là tổng số lượng từng ngày đã quy đổi (cả ngày, nửa ca, bội số 0.5), khớp số lưu.
    totalDays += unit === 'DAYS' ? quantity : weight * Math.min(1, minutes / shiftMinutes);
  }

  if (!out.some((d) => d.minutes > 0))
    errors.push('Khoảng thời gian không có giờ làm việc nào theo ca của nhân viên.');
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    days: out,
    totalMinutes,
    totalDays: round2(totalDays),
    warnings,
    errors,
  };
}

const vnDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Thời gian đơn LÀM THÊM GIỜ (HÀM THUẦN): chỉ tính khoảng từ-đến đã chọn, tách theo ngày lịch.
 * Khác đơn nghỉ: ngày nghỉ hằng tuần, ngày lễ và ngày chưa phân ca đều hợp lệ (OT tính theo hệ số ngày nghỉ / lễ).
 * Duy nhất một lỗi chặn: phần OT trùng với giờ ca làm việc của chính nhân viên; lỗi chỉ rõ đoạn trùng để người làm đơn sửa.
 */
export function computeOvertimeTime(
  days: readonly RequestShiftDay[],
  fromMs: number,
  toMs: number,
  timeZone: string,
): RequestTimeResult {
  const out: HrmRequestTimeDay[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  let totalMinutes = 0;
  for (const date of calendarDatesOf(fromMs, toMs, timeZone)) {
    const dayStart = zonedMs(date, '00:00', timeZone);
    const dayEnd = zonedMs(addDays(date, 1), '00:00', timeZone);
    const segFrom = Math.max(fromMs, dayStart);
    const segTo = Math.min(toMs, dayEnd);
    const minutes = Math.max(0, Math.round((segTo - segFrom) / 60000));
    const day = byDate.get(date);
    out.push({
      date,
      kind: day?.kind ?? 'WORK',
      minutes,
      quantity: round2(minutes / 60),
    });
    totalMinutes += minutes;
    if (day?.kind === 'OFF' || day?.kind === 'HOLIDAY')
      warnings.push(
        `${vnDate(date)} là ngày ${day.kind === 'OFF' ? 'nghỉ' : 'lễ'}: giờ làm thêm tính theo hệ số ngày ${day.kind === 'OFF' ? 'nghỉ' : 'lễ'}.`,
      );
  }
  // Trùng ca: xét ca của mọi ngày trong danh sách (gồm ngày liền trước, ca qua đêm còn phủ đầu khoảng).
  for (const day of days) {
    if (day.kind !== 'WORK' || day.startMs === null || day.endMs === null) continue;
    const from = Math.max(fromMs, day.startMs);
    const to = Math.min(toMs, day.endMs);
    if (to <= from) continue;
    errors.push(
      `Giờ làm thêm ${localTimeOf(from, timeZone)} - ${localTimeOf(to, timeZone)} ngày ${vnDate(localDateOf(from, timeZone))} trùng ca làm việc (${localTimeOf(day.startMs, timeZone)} - ${localTimeOf(day.endMs, timeZone)}); OT chỉ được đăng ký ngoài ca.`,
    );
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { days: out, totalMinutes, totalDays: 0, warnings, errors };
}

/**
 * Thời gian đơn CÔNG TÁC (HÀM THUẦN): tính theo ngày công tác như đơn nghỉ. Mỗi ngày làm việc trong khoảng phải là cả ca
 * (1 ngày, tức khung ca hành chính) hoặc đúng nửa ca (0.5 ngày); khoảng khác (ví dụ 3 giờ, hoặc ngoài khung ca) là lỗi chặn gửi đơn.
 * Ngày nghỉ hằng tuần và ngày lễ trong khoảng chỉ được ghi chú, không tính vào số ngày; ngày chưa phân ca là lỗi.
 * `totalDays` là số ngày công tác sẽ lưu; `totalMinutes` là số phút làm việc theo ca của các ngày đó.
 */
export function computeTripTime(
  days: readonly RequestShiftDay[],
  fromMs: number,
  toMs: number,
  timeZone: string,
): RequestTimeResult {
  return computeRequestTime(days, fromMs, toMs, timeZone, 'DAYS', { strict: true, subject: 'công tác' });
}

// ---------------------------------------------------------------------------------------------------------------
// Đọc ca của nhân viên
// ---------------------------------------------------------------------------------------------------------------

/** Múi giờ áp dụng cho nhân viên vào một ngày (chính sách chấm công), mặc định giờ Việt Nam. */
export async function requestTimezone(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeId: string,
  date: string,
): Promise<string> {
  const policy = await resolvePolicy(db as PoolClient, tenant, 'ATTENDANCE', date, employeeId);
  return validTimezone(policy?.config_json?.timezone ?? DEFAULT_TIMEZONE);
}

/** Chuyển một ngày xem trước ca (phút trong ngày) sang mốc tuyệt đối. Ca qua đêm: giờ kết thúc không sau giờ bắt đầu thì sang ngày kế. */
export function shiftDayFromPreview(day: LeaveDayPreview, timeZone: string): RequestShiftDay {
  if (day.kind !== 'WORK' || day.startMinutes === null || day.endMinutes === null)
    return {
      date: day.date,
      kind: day.kind,
      startMs: null,
      endMs: null,
      breakStartMs: null,
      breakEndMs: null,
      shiftMinutes: 0,
    };
  const at = (date: string, minutes: number) =>
    zonedMs(
      date,
      `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      timeZone,
    );
  const next = addDays(day.date, 1);
  const cross = day.endMinutes <= day.startMinutes;
  const breakStart =
    day.breakStartMinutes === null
      ? null
      : at(cross && day.breakStartMinutes < day.startMinutes ? next : day.date, day.breakStartMinutes);
  const breakEnd =
    day.breakEndMinutes === null
      ? null
      : at(cross && day.breakEndMinutes <= day.startMinutes ? next : day.date, day.breakEndMinutes);
  return {
    date: day.date,
    kind: 'WORK',
    startMs: at(day.date, day.startMinutes),
    endMs: at(cross ? next : day.date, day.endMinutes),
    breakStartMs: breakStart,
    breakEndMs: breakEnd,
    shiftMinutes: day.shiftMinutes,
  };
}

/**
 * Ca của nhân viên trong khoảng, tính cả ngày liền trước (ca qua đêm bắt đầu hôm trước còn phủ đầu khoảng).
 * Dùng lại `previewLeaveDays` nên cùng quy tắc lịch phân ca, ngày nghỉ hằng tuần, ngày lễ với đơn nghỉ.
 */
export async function loadRequestShiftDays(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  fromMs: number,
  toMs: number,
  timeZone: string,
): Promise<RequestShiftDay[]> {
  const first = addDays(localDateOf(fromMs, timeZone), -1);
  const last = localDateOf(Math.max(fromMs, toMs - 1), timeZone);
  const preview = await previewLeaveDays(db, tenant, employeeId, first, last);
  return preview.map((day) => shiftDayFromPreview(day, timeZone));
}

/**
 * Đọc khoảng từ-đến của một đơn cho một nhân viên: tìm múi giờ theo chính sách chấm công của ngày bắt đầu rồi kiểm tra
 * khoảng. Ném 400 tiếng Việt nếu sai định dạng, đến không sau từ hoặc quá 366 ngày.
 */
export async function resolveRequestRange(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeId: string,
  fromAt: unknown,
  toAt: unknown,
): Promise<{ timezone: string; fromMs: number; toMs: number }> {
  const timezone = await requestTimezone(db, tenant, employeeId, parseRequestInstantDate(fromAt));
  const { fromMs, toMs } = parseRequestRange(fromAt, toAt, timezone);
  return { timezone, fromMs, toMs };
}

/** Tính thời gian của đơn cho một nhân viên (dùng khi tạo đơn và cho xem trước). */
export async function resolveRequestTime(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  fromAt: unknown,
  toAt: unknown,
  unit: 'DAYS' | 'HOURS' = 'DAYS',
  /** Loại đơn quyết định cách tính: nghỉ (theo ca), làm thêm giờ (ngoài ca), công tác (theo giờ của khoảng). */
  mode: 'LEAVE' | 'OT' | 'TRIP' = 'LEAVE',
): Promise<{
  timezone: string;
  fromMs: number;
  toMs: number;
  result: RequestTimeResult;
}> {
  const { timezone, fromMs, toMs } = await resolveRequestRange(db, tenant, employeeId, fromAt, toAt);
  const shifts = await loadRequestShiftDays(db, tenant, employeeId, fromMs, toMs, timezone);
  const result =
    mode === 'OT'
      ? computeOvertimeTime(shifts, fromMs, toMs, timezone)
      : mode === 'TRIP'
        ? computeTripTime(shifts, fromMs, toMs, timezone)
        : computeRequestTime(shifts, fromMs, toMs, timezone, unit);
  return { timezone, fromMs, toMs, result };
}

/** Ngày (YYYY-MM-DD) ghi trong chuỗi từ-ngày-giờ, để chọn chính sách múi giờ trước khi biết múi giờ. */
function parseRequestInstantDate(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T/.exec(value.trim()) : null;
  if (!match) throw new BadRequestException('Từ ngày giờ: định dạng ngày giờ không hợp lệ (YYYY-MM-DDTHH:mm).');
  return match[1];
}

/** Kết quả cho API xem trước. */
export function toTimePreview(
  fromMs: number,
  toMs: number,
  timezone: string,
  result: RequestTimeResult,
): HrmRequestTimePreview {
  return {
    fromAt: new Date(fromMs).toISOString(),
    toAt: new Date(toMs).toISOString(),
    timezone,
    totalMinutes: result.totalMinutes,
    totalHours: round2(result.totalMinutes / 60),
    totalDays: result.totalDays,
    days: result.days,
    warnings: result.warnings,
    errors: result.errors,
  };
}
