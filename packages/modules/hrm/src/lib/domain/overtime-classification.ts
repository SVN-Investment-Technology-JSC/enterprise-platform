/**
 * Phân loại giờ làm thêm thành "làm thêm" và "ca đêm" cho từng khoảng. Hàm thuần: không đọc DB, không biết tenant.
 * Thời gian là giờ địa phương của tenant (chuỗi `YYYY-MM-DDTHH:mm`, không múi giờ); Việt Nam không đổi giờ mùa hè,
 * nên hiệu hai mốc chia 60 là số giờ của khoảng.
 *
 * Quy tắc của công ty (đã đối chiếu với dữ liệu 1Office và bảng chấm công tháng 7–10/2026), tính riêng từng khoảng:
 *  - Khoảng không qua đêm: toàn bộ là làm thêm.
 *  - Khoảng bắt đầu vào thứ Bảy: toàn bộ là làm thêm (hôm sau là Chủ nhật, không phải ngày có ca).
 *  - Khoảng qua đêm bắt đầu từ Chủ nhật đến thứ Sáu (hôm sau D+1 là ngày có ca, Chủ nhật bắt đầu thì D+1 là thứ Hai):
 *    sáng hôm sau có đi làm thì toàn bộ là làm thêm; nghỉ cả ngày thì `ca đêm = min(giờ của khoảng, 8)`;
 *    nghỉ nửa ngày (sáng hoặc chiều) thì `ca đêm = min(giờ của khoảng, 4)`; phần vượt là làm thêm.
 * Luôn có `làm thêm + ca đêm = tổng giờ của khoảng`.
 */

/** Một ca làm thêm theo giờ địa phương; `end` là mốc kết thúc (không bao gồm), phải sau `start`. */
export interface OvertimeBlock {
  readonly start: string;
  readonly end: string;
}

export interface BlockClassification {
  readonly otHours: number;
  readonly nightHours: number;
  /** Cảnh báo không chặn. */
  readonly warnings: readonly string[];
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

export interface ClassifyOptions {
  /** Sáng hôm sau có đi làm việc không (chỉ có nghĩa với khoảng qua đêm). */
  readonly nextMorningWorked: boolean;
  /** Chỉ nghỉ nửa ngày hôm sau (chỉ xét khi `nextMorningWorked` là false): ca đêm tối đa một nửa. */
  readonly nextMorningHalf?: boolean;
  /** Số giờ tối đa tính là ca đêm cho một khoảng (mặc định 8). */
  readonly nightMaxHours?: number;
}

/** Thứ trong tuần của ngày bắt đầu khoảng: 0 là Chủ nhật, 6 là thứ Bảy. */
export function weekdayOf(block: OvertimeBlock): number {
  return new Date(localMinutes(block.start) * 60000).getUTCDay();
}

export function classifyBlock(block: OvertimeBlock, options: ClassifyOptions): BlockClassification {
  const hours = blockHours(block);
  const weekday = weekdayOf(block);
  // Bắt đầu thứ Bảy: D+1 là Chủ nhật nên toàn bộ là làm thêm; bắt đầu Chủ nhật thì D+1 là thứ Hai (ngày có ca).
  if (!crossesMidnight(block) || weekday === 6 || options.nextMorningWorked) return { otHours: hours, nightHours: 0, warnings: [] };
  const max = options.nightMaxHours ?? 8;
  const nightHours = round2(Math.min(hours, options.nextMorningHalf ? max / 2 : max));
  return { otHours: round2(hours - nightHours), nightHours, warnings: [] };
}
