/**
 * Phân loại giờ làm thêm thành "làm thêm" và "ca đêm" cho từng ca. Hàm thuần: không đọc DB, không biết tenant.
 * Thời gian là giờ địa phương của tenant (chuỗi `YYYY-MM-DDTHH:mm`, không múi giờ); Việt Nam không đổi giờ mùa hè,
 * nên hiệu hai mốc chia 60 là số giờ của ca.
 *
 * Hai chế độ (bộ quy tắc có sẵn, tenant chọn trong chính sách):
 *  - NIGHT_REST: ca không xuyên đêm là làm thêm toàn bộ. Ca xuyên đêm (kết thúc từ 00:00 ngày sau trở đi) có
 *    `ca đêm = min(giờ của ca, số giờ bù mỗi ngày nghỉ × phần ngày nghỉ hôm sau)`, phần còn lại là làm thêm.
 *  - CLOCK_WINDOW: cắt ca tại khung giờ đêm của chính sách; giờ trong khung là ca đêm, ngoài khung là làm thêm.
 * Mọi chế độ trả cùng một kiểu kết quả để phần tổng hợp tháng không phải biết đang dùng chế độ nào.
 */

export type OvertimeRuleSet = 'NIGHT_REST' | 'CLOCK_WINDOW';

export const OVERTIME_RULE_SETS: readonly OvertimeRuleSet[] = ['NIGHT_REST', 'CLOCK_WINDOW'];

/** Phần ngày làm việc kế tiếp được nghỉ sau ca đêm: 0 không nghỉ, 0,5 nghỉ nửa ngày, 1 nghỉ cả ngày. */
export type RestFraction = 0 | 0.5 | 1;

/** Một ca làm thêm theo giờ địa phương; `end` là mốc kết thúc (không bao gồm), phải sau `start`. */
export interface OvertimeBlock {
  readonly start: string;
  readonly end: string;
}

export interface BlockClassification {
  readonly otHours: number;
  readonly nightHours: number;
  /** Cảnh báo không chặn (ví dụ cấu hình không cho nghỉ nửa ngày nhưng ca khai nghỉ nửa ngày). */
  readonly warnings: readonly string[];
}

export interface NightRestConfig {
  /** Số giờ ca đêm được bù cho mỗi ngày nghỉ đủ sau ca đêm (mặc định 8). */
  readonly nightRestHoursPerDay: number;
  /** Cho phép nghỉ nửa ngày; không cho thì phần nghỉ nửa ngày không được tính. */
  readonly allowHalfDay: boolean;
}

export interface ClockWindowConfig {
  /** Phút trong ngày bắt đầu khung đêm (mặc định 1320 = 22:00); phải lớn hơn `nightEndMinute`. */
  readonly nightStartMinute: number;
  /** Phút trong ngày kết thúc khung đêm (mặc định 360 = 06:00). */
  readonly nightEndMinute: number;
}

const MINUTES_PER_DAY = 1440;
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Số phút từ mốc 1970-01-01 theo giờ địa phương (không đổi múi giờ). */
export function localMinutes(value: string): number {
  const m = LOCAL_PATTERN.exec(value);
  if (!m) throw new RangeError(`Mốc thời gian phải có dạng YYYY-MM-DDTHH:mm: ${value}`);
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) / 60000;
}

/** Ngược của `localMinutes`. */
export function formatLocalMinutes(minutes: number): string {
  return new Date(minutes * 60000).toISOString().slice(0, 16);
}

function monthOfMinutes(minutes: number): string {
  return new Date(minutes * 60000).toISOString().slice(0, 7);
}

/** Ngày (từ mốc 1970-01-01) của một mốc phút. */
const dayIndex = (minutes: number) => Math.floor(minutes / MINUTES_PER_DAY);

function assertValidBlock(block: OvertimeBlock): { start: number; end: number } {
  const start = localMinutes(block.start);
  const end = localMinutes(block.end);
  if (!(end > start)) throw new RangeError('Ca làm thêm phải có giờ kết thúc sau giờ bắt đầu');
  return { start, end };
}

export function blockHours(block: OvertimeBlock): number {
  const { start, end } = assertValidBlock(block);
  return round2((end - start) / 60);
}

/** Ca xuyên đêm: kết thúc từ 00:00 của ngày kế tiếp (ngày bắt đầu ca) trở đi, kể cả đúng 00:00. */
export function crossesMidnight(block: OvertimeBlock): boolean {
  const { start, end } = assertValidBlock(block);
  return end >= (dayIndex(start) + 1) * MINUTES_PER_DAY;
}

export interface MonthPart {
  readonly block: OvertimeBlock;
  /** Tháng tính của phần này, dạng `YYYY-MM`. */
  readonly periodMonth: string;
}

/**
 * Ca xuyên tháng được tách tại 00:00 ngày mùng 1; mỗi tháng chỉ tính phần thuộc tháng đó
 * (ca 17:00 ngày 31/08 đến 04:00 ngày 01/09 có 7 giờ của tháng 8 và 4 giờ của tháng 9).
 * Ca kết thúc đúng 00:00 ngày mùng 1 vẫn thuộc trọn tháng trước.
 */
export function splitBlockByMonth(block: OvertimeBlock): MonthPart[] {
  const { start, end } = assertValidBlock(block);
  const parts: MonthPart[] = [];
  let cursor = start;
  while (cursor < end) {
    const month = monthOfMinutes(cursor);
    const [y, mo] = month.split('-').map(Number) as [number, number];
    const nextMonthStart = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) / 60000;
    const partEnd = Math.min(end, nextMonthStart);
    parts.push({
      block: { start: formatLocalMinutes(cursor), end: formatLocalMinutes(partEnd) },
      periodMonth: month,
    });
    cursor = partEnd;
  }
  return parts;
}

/** Chế độ NIGHT_REST (xem đầu file). `restFraction` chỉ có nghĩa với ca xuyên đêm. */
export function classifyNightRest(
  block: OvertimeBlock,
  restFraction: number,
  config: NightRestConfig,
): BlockClassification {
  const hours = blockHours(block);
  if (restFraction !== 0 && restFraction !== 0.5 && restFraction !== 1)
    throw new RangeError('Phần ngày nghỉ sau ca đêm chỉ nhận 0, 0,5 hoặc 1');
  if (!crossesMidnight(block)) return { otHours: hours, nightHours: 0, warnings: [] };
  const warnings: string[] = [];
  let fraction = restFraction;
  if (fraction === 0.5 && !config.allowHalfDay) {
    warnings.push('Chính sách không cho nghỉ nửa ngày sau ca đêm; phần nghỉ nửa ngày không được tính');
    fraction = 0;
  }
  const nightHours = round2(Math.min(hours, config.nightRestHoursPerDay * fraction));
  return { otHours: round2(hours - nightHours), nightHours, warnings };
}

/** Chế độ CLOCK_WINDOW (xem đầu file): giờ nằm trong khung đêm là ca đêm. */
export function classifyClockWindow(block: OvertimeBlock, config: ClockWindowConfig): BlockClassification {
  const { start, end } = assertValidBlock(block);
  const { nightStartMinute, nightEndMinute } = config;
  if (!(nightStartMinute > nightEndMinute))
    throw new RangeError('Khung giờ đêm phải bắt đầu sau 12:00 và kết thúc trước giờ bắt đầu');
  let nightMinutes = 0;
  // Mỗi khung đêm chạy từ `nightStartMinute` của ngày d đến `nightEndMinute` của ngày d+1.
  for (let d = dayIndex(start) - 1; d <= dayIndex(end); d++) {
    const windowStart = d * MINUTES_PER_DAY + nightStartMinute;
    const windowEnd = (d + 1) * MINUTES_PER_DAY + nightEndMinute;
    nightMinutes += Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
  }
  const nightHours = round2(nightMinutes / 60);
  return { otHours: round2((end - start) / 60 - nightHours), nightHours, warnings: [] };
}

export interface ClassifyBlockInput {
  readonly ruleSet: OvertimeRuleSet;
  readonly block: OvertimeBlock;
  /** Chỉ dùng ở NIGHT_REST; thiếu thì coi là không nghỉ. */
  readonly restFraction?: number;
  readonly nightRest: NightRestConfig;
  readonly clockWindow: ClockWindowConfig;
}

/** Điểm vào chung: chọn bộ quy tắc theo chính sách của tenant và trả cùng một kiểu kết quả. */
export function classifyBlock(input: ClassifyBlockInput): BlockClassification {
  switch (input.ruleSet) {
    case 'NIGHT_REST':
      return classifyNightRest(input.block, input.restFraction ?? 0, input.nightRest);
    case 'CLOCK_WINDOW':
      return classifyClockWindow(input.block, input.clockWindow);
    default:
      throw new RangeError(`Bộ quy tắc phân loại không được hỗ trợ: ${String(input.ruleSet)}`);
  }
}
