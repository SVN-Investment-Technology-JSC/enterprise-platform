/**
 * Bộ hằng số mã lỗi nghiệp vụ chuẩn hóa giữa các Module và Universal Task Drawer
 */
export const TASK_ERRORS = {
  /** 400: Bắt buộc nhập lý do khi từ chối (REJECT) hoặc yêu cầu bổ sung (RETURN) */
  REASON_REQUIRED: 'TASK_REASON_REQUIRED',

  /** 400: Hành động gửi lên không hợp lệ */
  INVALID_ACTION: 'TASK_INVALID_ACTION',

  /** 403: Không có thẩm quyền duyệt đơn này (ngoài chuỗi báo cáo, chức danh, kiêm nhiệm) */
  OUT_OF_SCOPE: 'APPROVAL_OUT_OF_SCOPE',

  /** 403: Không được tự duyệt đơn của chính mình */
  SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_FORBIDDEN',

  /** 404: Không tìm thấy đơn hoặc đơn đã bị hủy/xóa trước đó */
  NOT_FOUND: 'TASK_NOT_FOUND',

  /** 409: Đơn đã được duyệt/từ chối bởi người khác (không còn ở trạng thái PENDING) */
  NOT_PENDING: 'TASK_NOT_PENDING',

  /** 409: Đơn đang chạy trong Procedure Engine, cấm duyệt qua API LOCAL */
  PROCEDURE_IN_PROGRESS: 'PROCEDURE_IN_PROGRESS',

  /** 409: Xung đột phiên bản dữ liệu (Optimistic Concurrency Conflict) */
  VERSION_CONFLICT: 'TASK_VERSION_CONFLICT',

  /** 422: Hành động gửi lên không nằm trong danh sách availableActions của task */
  ACTION_NOT_AVAILABLE: 'TASK_ACTION_NOT_AVAILABLE',
} as const;

export type TaskErrorCode = (typeof TASK_ERRORS)[keyof typeof TASK_ERRORS];
