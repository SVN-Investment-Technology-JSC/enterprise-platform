import {
  allowedStandaloneTaskTransitions,
  standaloneTaskProcedureRunning,
  type StandaloneTask,
  type StandaloneTaskRole,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { StandaloneTaskForbiddenError, WorkspaceValidationError } from './workspace.error.js';

/** Nhãn tiếng Việt cho thông điệp lỗi — mã trạng thái thô không nói gì với người dùng. */
const STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  blocked: 'Vướng mắc',
  review: 'Chờ duyệt',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

/**
 * Vai cao nhất của `userId` trên việc; `undefined` khi họ không liên quan.
 *
 * Người giao đứng trên mọi vai khác: tự giao cho chính mình thì vẫn là người
 * giao, nên vẫn được duyệt và huỷ.
 */
export function standaloneTaskRoleOf(
  task: Pick<StandaloneTask, 'createdBy' | 'assigneeUserId' | 'participantUserIds' | 'followerUserIds'>,
  userId: string,
): StandaloneTaskRole | undefined {
  if (task.createdBy === userId) return 'assigner';
  if (task.assigneeUserId === userId) return 'assignee';
  if (task.participantUserIds.includes(userId)) return 'participant';
  if (task.followerUserIds.includes(userId)) return 'follower';
  return undefined;
}

/**
 * Kiểm một lần đổi trạng thái; ném lỗi nếu vai không được làm hoặc thiếu lý do.
 *
 * Lý do bắt buộc ở hai bước có người khác phải hiểu vì sao: người giao trả lại
 * kết quả (`review` → `in_progress`) và huỷ việc.
 */
export function assertStandaloneTaskTransition(
  task: Pick<
    StandaloneTask,
    | 'status'
    | 'createdBy'
    | 'assigneeUserId'
    | 'parentId'
    | 'openChildCount'
    | 'executionType'
    | 'procedure'
    | 'reversal'
  >,
  role: StandaloneTaskRole,
  next: WorkItemStatus,
  note: string | undefined,
): void {
  if (task.reversal) {
    throw new WorkspaceValidationError('Công việc đã huỷ hiệu lực, không mở lại hay đổi trạng thái được.');
  }
  if (next === task.status) {
    throw new WorkspaceValidationError(`Công việc đã ở trạng thái ${STATUS_LABELS[next]}.`);
  }
  const allowed = allowedStandaloneTaskTransitions(task, role);
  if (!allowed.includes(next)) {
    if (role === 'follower' || role === 'viewer') {
      throw new StandaloneTaskForbiddenError('Bạn chỉ được xem công việc này.');
    }
    const closing = next === 'review' || next === 'done' || next === 'cancelled';
    if (closing && task.openChildCount > 0) {
      throw new WorkspaceValidationError(
        `Còn ${task.openChildCount} việc con chưa xong. Hãy hoàn thành hoặc huỷ các việc con trước.`,
      );
    }
    if ((next === 'review' || next === 'done') && standaloneTaskProcedureRunning(task)) {
      throw new WorkspaceValidationError(
        'Công việc chạy theo quy trình: chờ hồ sơ quy trình hoàn tất, công việc sẽ tự chuyển trạng thái.',
      );
    }
    // Việc con không có bước duyệt: người thực hiện tự hoàn thành được.
    if (role !== 'assigner' && next === 'done' && !task.parentId) {
      throw new StandaloneTaskForbiddenError(
        'Chỉ người giao việc được xác nhận hoàn thành. Hãy chuyển sang Chờ duyệt.',
      );
    }
    if (role !== 'assigner' && next === 'cancelled') {
      throw new StandaloneTaskForbiddenError('Chỉ người giao việc được huỷ công việc.');
    }
    throw new WorkspaceValidationError(
      `Không thể chuyển từ ${STATUS_LABELS[task.status]} sang ${STATUS_LABELS[next]}.`,
    );
  }
  const returning = role === 'assigner' && task.status === 'review' && next === 'in_progress';
  if ((returning || next === 'cancelled') && !note?.trim()) {
    throw new WorkspaceValidationError(
      returning ? 'Hãy ghi lý do trả lại công việc.' : 'Hãy ghi lý do huỷ công việc.',
    );
  }
}

/**
 * Xoá chỉ dành cho việc chưa bắt đầu hoặc đã huỷ: việc đang làm thì huỷ, giữ
 * lại vết. Xoá việc cha là xoá cả cây con, nên mọi việc con cũng phải thoả.
 */
export function canDeleteStandaloneTask(
  subtree: readonly Pick<StandaloneTask, 'status'>[],
): boolean {
  return subtree.every((task) => task.status === 'todo' || task.status === 'cancelled');
}
