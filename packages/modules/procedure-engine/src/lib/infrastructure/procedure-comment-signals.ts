import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';

export interface ProcedureCommentSignalEvent {
  readonly type: 'procedure.comment.posted';
  readonly aggregateType: 'procedure-instance';
  readonly aggregateId: string;
  readonly payload: {
    readonly instanceId: string;
    readonly activityId: string;
    readonly actorUserId: string;
  };
}

/**
 * Tín hiệu thời gian thực "hồ sơ có trao đổi mới", một cái cho mỗi trao đổi mới.
 *
 * Chỉ mang id, không mang nội dung: người đang mở hồ sơ gọi lại API có kiểm quyền để lấy tin.
 * Không có danh sách người nhận: tín hiệu được đưa vào PHÒNG của hồ sơ, nơi chỉ những người đang
 * mở hồ sơ (và đã được kiểm là người tham gia) có mặt. Chỉ tính các mục `comment` chưa có ở bản
 * trước nên các thao tác khác trên hồ sơ không sinh tín hiệu.
 */
export function procedureCommentSignals(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): readonly ProcedureCommentSignalEvent[] {
  const previous = new Map(before.map((instance) => [instance.id, instance]));
  const events: ProcedureCommentSignalEvent[] = [];
  for (const instance of after) {
    const known = new Set((previous.get(instance.id)?.activity ?? []).map((entry) => entry.id));
    for (const entry of instance.activity) {
      if (known.has(entry.id) || entry.action !== 'comment') continue;
      events.push({
        type: 'procedure.comment.posted',
        aggregateType: 'procedure-instance',
        aggregateId: instance.id,
        payload: { instanceId: instance.id, activityId: entry.id, actorUserId: entry.actorId },
      });
    }
  }
  return events;
}
