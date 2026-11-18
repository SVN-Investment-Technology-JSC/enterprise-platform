import type { MaintenanceOccurrence } from '@enterprise-platform/contracts-maintenance';

/**
 * Định nghĩa "phiếu chưa đóng", "quá hạn", "đến hạn 7 ngày" và "giao cho tôi" dùng chung cho thẻ Tổng quan và danh sách
 * Phiếu phát sinh. Một nơi duy nhất để con số trên thẻ luôn khớp với danh sách mà thẻ dẫn tới.
 */

/** Bộ lọc nhanh của màn Phiếu phát sinh. `all` là không lọc. */
export type OccurrenceQuickFilter = 'all' | 'open' | 'overdue' | 'due7' | 'mine';

export const QUICK_FILTER_LABEL: Readonly<Record<OccurrenceQuickFilter, string>> = {
  all: 'Tất cả',
  open: 'Đang mở',
  overdue: 'Quá hạn',
  due7: 'Đến hạn 7 ngày',
  mine: 'Giao cho tôi',
};

export const QUICK_FILTER_ORDER: readonly OccurrenceQuickFilter[] = ['all', 'open', 'overdue', 'due7', 'mine'];

/** Chưa đóng, kể cả phiếu gửi Quy trình lỗi: nó vẫn cần người xử lý (thử lại hoặc đóng tay). */
export function isOpenOccurrence(occurrence: MaintenanceOccurrence): boolean {
  return occurrence.status !== 'completed';
}

/** Đầu ngày (giờ máy) cách hôm nay `offsetDays` ngày; làm mốc cho "quá hạn" và "7 ngày tới". */
export function startOfDay(offsetDays = 0, now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays).getTime();
}

export function dueTime(occurrence: MaintenanceOccurrence): number {
  const value = Date.parse(occurrence.dueAt);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

export function isOverdueOccurrence(occurrence: MaintenanceOccurrence, now: Date = new Date()): boolean {
  return isOpenOccurrence(occurrence) && dueTime(occurrence) < startOfDay(0, now);
}

/** Chưa đóng và hạn nằm từ đầu hôm nay đến hết 7 ngày kế tiếp. */
export function isDueWithinSevenDays(occurrence: MaintenanceOccurrence, now: Date = new Date()): boolean {
  const due = dueTime(occurrence);
  return isOpenOccurrence(occurrence) && due >= startOfDay(0, now) && due < startOfDay(8, now);
}

export function isAssignedTo(occurrence: MaintenanceOccurrence, userId: string): boolean {
  return Boolean(userId) && occurrence.assigneeId === userId;
}

/** Phiếu có thoả bộ lọc nhanh không. `userId` là người đang xem (cho "Giao cho tôi"). */
export function matchesQuickFilter(
  occurrence: MaintenanceOccurrence,
  filter: OccurrenceQuickFilter,
  userId: string,
  now: Date = new Date(),
): boolean {
  switch (filter) {
    case 'open':
      return isOpenOccurrence(occurrence);
    case 'overdue':
      return isOverdueOccurrence(occurrence, now);
    case 'due7':
      return isDueWithinSevenDays(occurrence, now);
    case 'mine':
      return isOpenOccurrence(occurrence) && isAssignedTo(occurrence, userId);
    default:
      return true;
  }
}
