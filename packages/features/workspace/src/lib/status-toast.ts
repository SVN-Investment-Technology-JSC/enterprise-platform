import type { WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';

/** Ba thao tác người dùng cần biết ngay là đã thực hiện xong. */
export type StatusAction = 'start' | 'complete' | 'reopen';

/**
 * Thao tác của người dùng suy ra từ trạng thái trước và sau; `undefined` cho các chuyển khác (chờ duyệt, vướng mắc,
 * về Chưa làm...) vì chúng không cần toast riêng.
 */
export function statusActionOf(from: WorkItemStatus, to: WorkItemStatus): StatusAction | undefined {
  if (to === 'done' && from !== 'done') return 'complete';
  if (to === 'in_progress' && from === 'done') return 'reopen';
  if (to === 'in_progress' && from === 'todo') return 'start';
  return undefined;
}

/** Nội dung toast thành công; `code` là mã công việc để người dùng biết việc nào vừa đổi. */
export function statusToastText(action: StatusAction, code?: string): string {
  const subject = code ? `công việc ${code}` : 'công việc';
  switch (action) {
    case 'start':
      return `Đã bắt đầu ${subject}.`;
    case 'complete':
      return `Đã hoàn thành ${subject}.`;
    case 'reopen':
      return `Đã hoàn tác ${subject}, trạng thái về "Đang làm".`;
  }
}

/** Báo ngay khi Bắt đầu, Hoàn thành hoặc Hoàn tác thành công; các chuyển trạng thái khác thì im lặng. */
export function toastStatusChanged(from: WorkItemStatus, to: WorkItemStatus, code?: string): void {
  const action = statusActionOf(from, to);
  if (action) toast.success(statusToastText(action, code));
}

/** Sau khi hoàn thành xong ở trang mở từ `?returnTo=`, đợi một nhịp cho người dùng đọc toast rồi mới quay về. */
export const RETURN_AFTER_TOAST_MS = 900;
