import type { ProcedureLinkSettings, WorkItemStatus } from '@enterprise-platform/contracts-workspace';

/** Phần cài đặt liên kết Quy trình mà việc kéo tiến độ cần đọc. */
export type ProgressPullSettings = Pick<
  ProcedureLinkSettings,
  'progressPull' | 'progressPullClosedItems' | 'progressPullDirection'
>;

/** Trạng thái đã đóng: không kéo tiến độ vào khi cài đặt chọn bỏ qua. */
const CLOSED_STATUSES: readonly WorkItemStatus[] = ['done', 'review', 'cancelled'];

/**
 * Quyết định có ghi tiến độ của hồ sơ quy trình vào công việc không.
 * Trả về số phần trăm cần ghi, hoặc `undefined` nếu không ghi gì.
 */
export function procedureProgressToWrite(
  item: { readonly status: WorkItemStatus; readonly progressPercent: number; readonly reversal?: unknown },
  instanceProgress: number,
  settings: ProgressPullSettings,
): number | undefined {
  if (settings.progressPull === 'off') return undefined;
  if (instanceProgress === item.progressPercent) return undefined;
  if (settings.progressPullClosedItems === 'skip' && (CLOSED_STATUSES.includes(item.status) || item.reversal)) {
    return undefined;
  }
  if (settings.progressPullDirection === 'increase_only' && instanceProgress < item.progressPercent) {
    return undefined;
  }
  return instanceProgress;
}
