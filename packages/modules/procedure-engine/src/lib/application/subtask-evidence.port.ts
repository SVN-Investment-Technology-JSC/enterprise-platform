/**
 * Đếm bằng chứng đã đính kèm cho một đầu việc E(x).
 *
 * Tách thành cổng riêng vì đính kèm sống ở bảng thường + object storage, còn
 * runtime của quy trình sống trong `runtime_state` jsonb — application không
 * được đọc thẳng bảng đính kèm.
 */
export interface SubtaskEvidenceCounter {
  /** Xoá mọi đính kèm của một hồ sơ; dùng khi xoá hẳn hồ sơ. */
  deleteForInstance?(tenantId: string, instanceId: string): Promise<number>;

  countForSubtask(tenantId: string, instanceId: string, subtaskId: string): Promise<number>;
}
