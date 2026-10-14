import type { Assignment } from './organization-workspace';

/**
 * Quy tắc "Vị trí chính":
 * - Một chức danh có thể có nhiều người cùng giữ vị trí chính.
 * - Một người chỉ được giữ vị trí chính ở đúng một chức danh; ở các chức danh còn lại là kiêm nhiệm.
 */

type AssignmentLike = Pick<Assignment, 'id' | 'nodeId' | 'userId' | 'isPrimary' | 'status'>;

/** Phân công đang hiệu lực mà người này đang giữ làm vị trí chính ở một chức danh KHÁC `nodeId`. */
export function findPrimaryElsewhere<T extends AssignmentLike>(
  assignments: readonly T[],
  userId: string,
  nodeId: string,
  excludeAssignmentId?: string,
): T | undefined {
  return assignments.find(
    (a) =>
      a.userId === userId &&
      a.status === 'active' &&
      a.isPrimary &&
      a.nodeId !== nodeId &&
      a.id !== excludeAssignmentId,
  );
}

/** Số chức danh (khác nhau) mà người này đang có phân công hiệu lực. */
export function countHeldPositions(
  assignments: readonly AssignmentLike[],
  userId: string,
): number {
  return new Set(
    assignments
      .filter((a) => a.userId === userId && a.status === 'active')
      .map((a) => a.nodeId),
  ).size;
}

/** Người này đang kiêm nhiệm khi (không giữ vị trí chính ở chức danh này và) có mặt trong từ 2 chức danh trở lên. */
export function isConcurrentHolder(
  assignments: readonly AssignmentLike[],
  assignment: AssignmentLike,
): boolean {
  return !assignment.isPrimary && countHeldPositions(assignments, assignment.userId) >= 2;
}
