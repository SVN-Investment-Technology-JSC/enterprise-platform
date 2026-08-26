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

  /**
   * Đính kèm một tệp do hệ thống sinh ra vào hồ sơ.
   *
   * Dùng khi mở đơn kho: bảng kê vật tư phải đi cùng đơn, để người ở bước đầu
   * của đơn đó nộp lên là đã có sẵn danh sách chứ không phải gõ lại.
   *
   * Không bắt buộc — triển khai nào không có kho tệp thì bỏ qua, đơn vẫn mở
   * được, chỉ là không có tệp đính kèm.
   */
  attachGenerated?(
    tenantId: string,
    instanceId: string,
    input: { fileName: string; contentType: string; body: string },
  ): Promise<unknown>;
}
