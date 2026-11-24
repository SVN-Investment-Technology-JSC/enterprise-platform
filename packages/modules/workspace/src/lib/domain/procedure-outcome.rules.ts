import {
  canTransitionWorkItem,
  CLOSED_WORK_ITEM_STATUSES,
  type ProcedureLinkOnEnded,
  type ProcedureLinkSettings,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';

/** Việc hồ sơ Quy trình đã làm với công việc gắn nó. */
export type ProcedureOutcomeKind = 'started' | 'completed' | 'rejected' | 'cancelled' | 'deleted';

/**
 * Chuỗi trạng thái cần đi qua để từ `from` tới `to`, không gồm `from`. Chuyển thẳng được thì một bước; không thì thử
 * đi vòng qua Đang làm (ví dụ Chờ duyệt → Chưa làm). `undefined` khi không có đường hợp lệ; `[]` khi đã ở đúng đó.
 */
export function statusPath(from: WorkItemStatus, to: WorkItemStatus): WorkItemStatus[] | undefined {
  if (from === to) return [];
  if (canTransitionWorkItem(from, to)) return [to];
  // Việc đã đóng không đi vòng: mở lại việc đã xong là quyết định của người dùng, không phải của hồ sơ.
  if (!CLOSED_WORK_ITEM_STATUSES.includes(from) && from !== 'in_progress' && to !== 'in_progress' && canTransitionWorkItem(from, 'in_progress') && canTransitionWorkItem('in_progress', to)) {
    return ['in_progress', to];
  }
  return undefined;
}

/** Đích của cài đặt "khi hồ sơ bị từ chối / huỷ"; `undefined` là không làm gì. */
export function endedTarget(setting: ProcedureLinkOnEnded): WorkItemStatus | undefined {
  return setting === 'none' ? undefined : setting;
}

/** Trạng thái đang đóng (xong hoặc huỷ): hồ sơ không tự đổi lại. */
export function isClosedStatus(status: WorkItemStatus): boolean {
  return CLOSED_WORK_ITEM_STATUSES.includes(status);
}

/** Lý do ghi vào nhật ký / lý do Vướng mắc của từng kết cục. */
export function procedureOutcomeNote(kind: ProcedureOutcomeKind, instanceCode: string): string {
  switch (kind) {
    case 'started':
      return `Hồ sơ quy trình ${instanceCode} đã bắt đầu chạy.`;
    case 'completed':
      return `Hồ sơ quy trình ${instanceCode} đã hoàn tất.`;
    case 'rejected':
      return `Hồ sơ quy trình ${instanceCode} bị từ chối`;
    case 'cancelled':
      return `Hồ sơ quy trình ${instanceCode} đã bị huỷ`;
    case 'deleted':
      return `Hồ sơ quy trình ${instanceCode} đã bị xoá`;
  }
}

/** Đích trạng thái của một công việc trong dự án theo cài đặt; `undefined` là không đổi trạng thái. */
export function workItemOutcomeTarget(
  kind: ProcedureOutcomeKind,
  settings: ProcedureLinkSettings,
): WorkItemStatus | undefined {
  switch (kind) {
    case 'started':
      return settings.onStarted === 'in_progress' ? 'in_progress' : undefined;
    case 'completed':
      return settings.onCompletedWorkItem === 'review' || settings.onCompletedWorkItem === 'done'
        ? settings.onCompletedWorkItem
        : undefined;
    case 'rejected':
      return endedTarget(settings.onRejected);
    case 'cancelled':
      return endedTarget(settings.onCancelled);
    case 'deleted':
      return settings.onInstanceDeleted === 'cancel_item' ? 'cancelled' : undefined;
  }
}
