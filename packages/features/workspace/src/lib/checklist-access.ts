import type { StandaloneTask, StandaloneTaskRole, WorkItem } from '@enterprise-platform/contracts-workspace';

/**
 * Việc có thể có checklist: loại task, không phải việc đã huỷ hiệu lực, và không có việc con còn hiệu lực. Việc đã
 * xong / huỷ mà chưa có đầu việc nào (`checklistCount === 0`) thì không hiện, đỡ nhiễu.
 */
export function canShowChecklist(item: WorkItem, allItems: readonly WorkItem[], checklistCount?: number): boolean {
  if (item.itemType !== 'task' || item.reversal) return false;
  if (allItems.some((child) => child.parentId === item.id && child.status !== 'cancelled')) return false;
  const closed = item.status === 'done' || item.status === 'cancelled';
  return !(closed && checklistCount === 0);
}

export const CHECKLIST_NOT_TRACKED_NOTE =
  'Công việc đang không tính tiến độ theo đầu việc; đổi cách tính sang theo đầu việc để tích tiếp.';

/**
 * Giao diện chỉ mở thao tác mà server sẽ nhận: tích / sửa / xoá khi cách tính là `checklist`; thêm khi là `checklist`
 * hoặc `manual` chưa có đầu việc nào (thêm đầu việc đầu tiên là đường duy nhất tự chuyển sang `checklist`).
 */
export function checklistPanelState(input: {
  method: string | undefined;
  closed: boolean;
  canEdit: boolean;
  total: number;
  max: number;
  /** Lời giải thích khi người xem không có quyền sửa; mặc định là câu của việc trong dự án. */
  cannotEditReason?: string;
}): { visible: boolean; editable: boolean; canAdd: boolean; reason: string } {
  const method = input.method ?? 'manual';
  const { closed, canEdit, total, max } = input;
  const open = canEdit && !closed;
  const editable = open && method === 'checklist';
  const canAdd = open && total < max && (method === 'checklist' || (method === 'manual' && total === 0));
  const visible = !(total === 0 && (closed || method === 'quantity'));
  let reason = '';
  if (closed) reason = 'Công việc đã đóng nên không sửa được đầu việc.';
  else if (!canEdit)
    reason =
      input.cannotEditReason ?? 'Chỉ người phụ trách, người cùng làm, người tạo việc hoặc quản lý dự án được sửa đầu việc.';
  else if (method === 'quantity') reason = 'Công việc tính tiến độ theo khối lượng nên đầu việc chỉ để xem.';
  else if (method === 'child_weight') reason = CHECKLIST_NOT_TRACKED_NOTE;
  else if (method === 'manual' && total > 0) reason = CHECKLIST_NOT_TRACKED_NOTE;
  return { visible, editable, canAdd, reason };
}

/**
 * Quyền sửa checklist ở giao diện (server mới là nơi chặn thật): có quyền ghi dự án và là quản lý, người phụ trách,
 * người cùng làm hoặc người tạo việc.
 */
export function canEditChecklist(input: {
  item: WorkItem;
  userId: string;
  canWrite: boolean;
  canManage: boolean;
}): boolean {
  const { item, userId, canWrite, canManage } = input;
  if (!canWrite || item.reversal) return false;
  if (canManage) return true;
  if (!userId) return false;
  return (
    item.assigneeUserId === userId ||
    (item.participantUserIds ?? []).includes(userId) ||
    item.createdBy === userId
  );
}

/** Lời giải thích cho người chỉ xem checklist của Công việc khác. */
export const STANDALONE_CHECKLIST_READONLY_NOTE =
  'Chỉ người giao, người phụ trách và người cùng làm được sửa đầu việc.';

/**
 * Công việc khác có thể có checklist: việc lá (không có việc con), không chạy theo quy trình, chưa bị huỷ hiệu lực.
 * Việc đã xong / huỷ mà chưa có đầu việc nào (`checklistCount === 0`) thì không hiện, đỡ nhiễu.
 */
export function canShowStandaloneChecklist(
  task: Pick<StandaloneTask, 'childCount' | 'executionType' | 'reversal' | 'status'>,
  checklistCount?: number,
): boolean {
  if (task.childCount > 0 || task.executionType === 'procedure' || task.reversal) return false;
  const closed = task.status === 'done' || task.status === 'cancelled';
  return !(closed && checklistCount === 0);
}

/** Người giao, người phụ trách và người cùng làm được sửa đầu việc; người theo dõi và người xem qua cây chỉ đọc. */
export function canEditStandaloneChecklist(role: StandaloneTaskRole | undefined): boolean {
  return role === 'assigner' || role === 'assignee' || role === 'participant';
}

/** Phần trăm đầu việc đã tích, làm tròn; 0 khi chưa có đầu việc. */
export function checklistPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** Tách văn bản dán thành nhiều đầu việc: mỗi dòng một đầu việc, bỏ dòng trống, gạch đầu dòng, số thứ tự ngắn (1. / 1)) và ô tích (không giữ trạng thái xong). */
export function splitChecklistLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:(?:[-*•]|\d{1,2}[.)])\s+)?(?:\[[ xX]?\]\s*)?/, '').trim())
    .filter(Boolean);
}
