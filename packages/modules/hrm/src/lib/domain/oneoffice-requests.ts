/**
 * Đọc cột "Chi tiết ngày" của bản ghi đơn từ xuất từ 1Office. Hàm thuần, dùng cho công cụ nhập dữ liệu một lần.
 * Mọi mốc là giờ địa phương dạng `YYYY-MM-DDTHH:mm` (cùng quy ước với `overtime-classification.ts`).
 *
 * Các dạng gặp trong file:
 *  - Làm thêm: nhiều dòng, mỗi dòng `Từ HH:MM DD/MM/YYYY - HH:MM DD/MM/YYYY` hoặc `Từ HH:MM - HH:MM, DD/MM/YYYY`
 *    (dạng sau có giờ kết thúc không sau giờ bắt đầu thì là qua nửa đêm).
 *  - Công tác: `Từ HH:MM DD/MM/YYYY đến HH:MM DD/MM/YYYY`.
 *  - Nghỉ: `HH:MM:SS - HH:MM:SS, DD/MM/YYYY` hoặc `HH:MM:SS, DD/MM/YYYY - HH:MM:SS, DD/MM/YYYY`.
 *  - Chấm công bổ sung: `HH:MM DD/MM/YYYY`.
 */
import { formatLocalMinutes, localMinutes, splitBlockByMonth, type OvertimeBlock } from './overtime-classification.js';

export interface LocalRange {
  readonly from: string;
  readonly to: string;
}

const pad = (n: number | string) => String(n).padStart(2, '0');
const local = (d: string, mo: string, y: string, h: string, mi: string) => `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;

const OT_FULL = /Từ\s+(\d{1,2}):(\d{2})(?::\d{2})?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::\d{2})?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const OT_SAME_DAY = /Từ\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*-\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const TRIP = /Từ\s+(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+đến\s+(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const LEAVE_SAME_DAY = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*-\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
const LEAVE_MULTI = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
const PUNCH = /^\s*(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;

const lines = (text: unknown) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Các ca làm thêm của một đơn; dòng không đọc được bị bỏ qua (người gọi đối chiếu số dòng). */
export function parseOvertimeBlocks(text: unknown): OvertimeBlock[] {
  const blocks: OvertimeBlock[] = [];
  for (const line of lines(text)) {
    const full = OT_FULL.exec(line);
    if (full) {
      const [, h1, m1, d1, mo1, y1, h2, m2, d2, mo2, y2] = full as unknown as string[];
      blocks.push({ start: local(d1!, mo1!, y1!, h1!, m1!), end: local(d2!, mo2!, y2!, h2!, m2!) });
      continue;
    }
    const same = OT_SAME_DAY.exec(line);
    if (same) {
      const [, h1, m1, h2, m2, d, mo, y] = same as unknown as string[];
      const start = local(d!, mo!, y!, h1!, m1!);
      let end = local(d!, mo!, y!, h2!, m2!);
      if (localMinutes(end) <= localMinutes(start)) end = formatLocalMinutes(localMinutes(end) + 1440);
      blocks.push({ start, end });
    }
  }
  return blocks;
}

/** Khoảng công tác `Từ HH:MM DD/MM/YYYY đến HH:MM DD/MM/YYYY`; null nếu không đọc được. */
export function parseTripRange(text: unknown): LocalRange | null {
  const m = TRIP.exec(String(text ?? '').trim());
  if (!m) return null;
  const [, h1, m1, d1, mo1, y1, h2, m2, d2, mo2, y2] = m as unknown as string[];
  return { from: local(d1!, mo1!, y1!, h1!, m1!), to: local(d2!, mo2!, y2!, h2!, m2!) };
}

/** Khoảng nghỉ một ngày hoặc nhiều ngày; null nếu không đọc được. */
export function parseLeaveRange(text: unknown): LocalRange | null {
  const raw = lines(text).join(' ');
  const multi = LEAVE_MULTI.exec(raw);
  if (multi) {
    const [, h1, m1, d1, mo1, y1, h2, m2, d2, mo2, y2] = multi as unknown as string[];
    return { from: local(d1!, mo1!, y1!, h1!, m1!), to: local(d2!, mo2!, y2!, h2!, m2!) };
  }
  const same = LEAVE_SAME_DAY.exec(raw);
  if (same) {
    const [, h1, m1, h2, m2, d, mo, y] = same as unknown as string[];
    return { from: local(d!, mo!, y!, h1!, m1!), to: local(d!, mo!, y!, h2!, m2!) };
  }
  return null;
}

/** Mốc chấm công bổ sung `HH:MM DD/MM/YYYY`; null nếu không đọc được. */
export function parsePunchAt(text: unknown): string | null {
  const m = PUNCH.exec(String(text ?? ''));
  if (!m) return null;
  const [, h, mi, d, mo, y] = m as unknown as string[];
  return local(d!, mo!, y!, h!, mi!);
}

/** Cắt một khoảng theo tháng tại 00:00 ngày mùng 1 và chỉ giữ các phần thuộc `months` (dạng `YYYY-MM`). */
export function splitRangeByMonths(range: LocalRange, months: readonly string[]): Array<LocalRange & { periodMonth: string }> {
  return splitBlockByMonth({ start: range.from, end: range.to })
    .filter((p) => months.includes(p.periodMonth))
    .map((p) => ({ from: p.block.start, to: p.block.end, periodMonth: p.periodMonth }));
}

/** Chuẩn hóa họ tên để ghép với nhân viên trong DB: NFC, bỏ khoảng trắng thừa, không phân biệt hoa thường. */
export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
