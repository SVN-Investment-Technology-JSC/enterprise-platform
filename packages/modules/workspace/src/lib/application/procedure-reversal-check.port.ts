/** Token Symbol: port HTTP gọi sang module khác (xem `EXTERNAL_REFERENCE_READER`). */
export const PROCEDURE_REVERSAL_CHECK = Symbol('PROCEDURE_REVERSAL_CHECK');

export interface ProcedureReversalCheck {
  readonly allowed: boolean;
  readonly reason?: string;
  /** Người đã duyệt (hồ sơ hay đơn) — được huỷ hiệu lực đơn từ của dự án. */
  readonly approverUserIds?: readonly string[];
}

/**
 * Hỏi Quy trình (chỉ đọc) xem hồ sơ gắn công việc có huỷ hiệu lực được không,
 * trước khi Workspace huỷ công việc — để hai module không lệch nhau. Không trả
 * lời được thì coi như không cho huỷ.
 */
export interface ProcedureReversalChecker {
  check(tenantId: string, instanceId: string): Promise<ProcedureReversalCheck>;
  /**
   * Đơn HRM không chạy qua Quy trình: hỏi thẳng HRM. Tuỳ chọn để các test chỉ
   * quan tâm công việc không phải dựng thêm.
   */
  checkHrmRequest?(
    tenantId: string,
    requestKind: string,
    requestId: string,
  ): Promise<ProcedureReversalCheck>;
}
