/**
 * Một đơn có nhiều khoảng thời gian (nghỉ, làm thêm giờ, công tác): khoảng đầu là các ô chính của form, các khoảng
 * bổ sung nằm trong danh sách riêng. Mỗi khoảng được gửi thành một đơn độc lập với cùng lý do, mô tả và chứng từ.
 * Các hàm thuần ở đây dựng khoảng mới, kiểm tra chồng nhau và lỗi từng khoảng trước khi gửi.
 */
import type { HrmRequestTimePreview } from '@enterprise-platform/contracts-hrm';

/** Số khoảng tối đa trong một lần tạo đơn (gồm khoảng chính). */
export const MAX_REQUEST_RANGES = 10;

export interface TimeRangeInput {
  /** 'YYYY-MM-DDTHH:mm' */
  fromAt: string;
  toAt: string;
}

export interface ExtraRange extends TimeRangeInput {
  id: string;
  /** Kết quả tính của máy chủ cho khoảng này; null khi chưa đủ dữ liệu hoặc đang tính. */
  preview: HrmRequestTimePreview | null;
}

const MS_DAY = 86_400_000;

function toUtcMs(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

/**
 * Khoảng gợi ý kế tiếp: ngày liền sau ngày kết thúc của khoảng cuối, cùng giờ bắt đầu và giờ kết thúc, giữ số ngày
 * trải rộng của khoảng cuối. Khoảng cuối chưa hợp lệ thì trả khoảng rỗng để người dùng tự chọn.
 */
export function nextRange(last: TimeRangeInput | null | undefined): TimeRangeInput {
  const from = last ? toUtcMs(last.fromAt) : NaN;
  const to = last ? toUtcMs(last.toAt) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { fromAt: '', toAt: '' };
  const lastDay = Math.floor(to / MS_DAY) * MS_DAY;
  const startDay = Math.floor(from / MS_DAY) * MS_DAY;
  const spanDays = Math.floor((lastDay - startDay) / MS_DAY);
  const nextStartDay = lastDay + MS_DAY;
  const nextFrom = nextStartDay + (from - startDay);
  const nextTo = nextStartDay + spanDays * MS_DAY + (to - lastDay);
  return { fromAt: format(nextFrom), toAt: format(nextTo) };
}

/** Cặp khoảng đầu tiên chồng nhau về thời gian (chỉ số theo danh sách, từ 0), hoặc null. Khoảng chưa đủ dữ liệu bị bỏ qua. */
export function firstOverlap(ranges: readonly TimeRangeInput[]): [number, number] | null {
  const spans = ranges.map((r) => [toUtcMs(r.fromAt), toUtcMs(r.toAt)] as const);
  for (let a = 0; a < spans.length; a++) {
    if (!(spans[a][1] > spans[a][0])) continue;
    for (let b = a + 1; b < spans.length; b++) {
      if (!(spans[b][1] > spans[b][0])) continue;
      if (spans[a][0] < spans[b][1] && spans[b][0] < spans[a][1]) return [a, b];
    }
  }
  return null;
}

export const rangeLabel = (index: number, kind: 'leave' | 'ot' | 'trip'): string =>
  `Khoảng ${kind === 'leave' ? 'nghỉ' : kind === 'ot' ? 'làm thêm' : 'công tác'} ${index + 1}`;

/**
 * Lỗi của các khoảng bổ sung trước khi gửi (tiếng Việt, kèm tên khoảng) hoặc null nếu hợp lệ.
 * Khoảng chính (chỉ số 0) do form chính kiểm tra; ở đây kiểm tra các khoảng từ chỉ số 1 trở đi và chồng nhau giữa mọi khoảng.
 */
export function extraRangesProblem(
  kind: 'leave' | 'ot' | 'trip',
  main: TimeRangeInput,
  extras: readonly ExtraRange[],
): { title: string; message: string } | null {
  const all: TimeRangeInput[] = [main, ...extras];
  for (let i = 0; i < extras.length; i++) {
    const range = extras[i];
    const label = rangeLabel(i + 1, kind);
    const from = toUtcMs(range.fromAt);
    const to = toUtcMs(range.toAt);
    if (!Number.isFinite(from) || !Number.isFinite(to))
      return { title: `${label} chưa hợp lệ`, message: `${label} chưa chọn đủ từ ngày giờ và đến ngày giờ.` };
    if (to <= from)
      return { title: `${label} chưa hợp lệ`, message: `${label}: thời điểm kết thúc phải sau thời điểm bắt đầu.` };
    if (!range.preview)
      return { title: `${label} chưa hợp lệ`, message: `${label} đang được tính hoặc chưa tính được thời gian; vui lòng đợi hoặc chọn lại.` };
    if (range.preview.errors.length)
      return { title: `${label} chưa hợp lệ`, message: `${label}: ${range.preview.errors[0]}` };
    if (kind === 'leave' && !(range.preview.totalDays > 0))
      return { title: `${label} chưa hợp lệ`, message: `${label} không có ngày làm việc để tính phép.` };
  }
  const clash = firstOverlap(all);
  if (clash)
    return {
      title: `${rangeLabel(clash[0], kind)} trùng thời gian`,
      message: `${rangeLabel(clash[0], kind)} và ${rangeLabel(clash[1], kind)} trùng thời gian; mỗi thời điểm chỉ thuộc một khoảng.`,
    };
  return null;
}
