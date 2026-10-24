import { UnprocessableEntityException } from '@nestjs/common';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';

export const REQUEST_CROSSES_MONTH = 'REQUEST_CROSSES_MONTH';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Ngày YYYY-MM-DD của cột `date` (pg trả về Date theo giờ máy) hoặc của mốc thời gian theo múi giờ Việt Nam. */
function dayOf(value: unknown, isTimestamp: boolean): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (isTimestamp) {
    const at = new Date(value as string | number | Date);
    return Number.isNaN(at.getTime()) ? null : at.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
  }
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
}

/**
 * Khoảng ngày mà đơn nói đến (theo ngày ghi trên đơn, không theo ngày tạo); null khi đơn không gắn với ngày nào
 * (đơn sửa hồ sơ, đơn tùy chỉnh không có thời gian).
 */
export function requestDateRange(kind: HrmRequestKind, row: Record<string, unknown>): { from: string; to: string } | null {
  let from: string | null;
  let to: string | null;
  switch (kind) {
    case 'leave':
    case 'business_trip':
    case 'shift_change':
      from = dayOf(row.from_date, false);
      to = dayOf(row.to_date, false) ?? from;
      break;
    case 'ot':
      from = to = dayOf(row.work_date, false);
      break;
    case 'correction':
    case 'advance':
      from = to = dayOf(row.request_date, false);
      break;
    case 'custom':
      from = dayOf(row.from_at, true) ?? dayOf(row.to_at, true);
      to = dayOf(row.to_at, true) ?? from;
      break;
    default:
      return null;
  }
  if (!from || !to) return null;
  return to < from ? { from: to, to: from } : { from, to };
}

const display = (iso: string) => iso.split('-').reverse().join('/');

/** Mọi đơn chỉ nằm trong một tháng; đơn kéo dài qua hai tháng phải tách thành từng đơn theo tháng. */
export function assertRequestWithinMonth(kind: HrmRequestKind, row: Record<string, unknown>): void {
  const range = requestDateRange(kind, row);
  if (!range || range.from.slice(0, 7) === range.to.slice(0, 7)) return;
  throw new UnprocessableEntityException({
    code: REQUEST_CROSSES_MONTH,
    message: `Đơn không được kéo dài qua hai tháng (từ ${display(range.from)} đến ${display(range.to)}); hãy tách thành từng đơn theo tháng.`,
  });
}
