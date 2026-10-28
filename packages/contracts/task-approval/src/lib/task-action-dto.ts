import type { TaskActionType, TaskStatus } from './task-dto.js';

/**
 * DTO Gửi lệnh thực thi hành động phê duyệt từ Client lên Server
 */
export interface ExecuteTaskActionDto {
  /** Hành động cần thực thi */
  action: TaskActionType;

  /**
   * Lý do / Ghi chú phê duyệt:
   * - BẮT BUỘC khi action === 'REJECT' hoặc 'RETURN' (length > 0 sau khi trim)
   * - Tùy chọn khi action === 'APPROVE'
   */
  reason?: string;

  /**
   * Khóa chống gửi trùng do client sinh (UUID).
   * Giúp an toàn khi mạng chập chờn hoặc người dùng bấm đúp.
   */
  idempotencyKey: string;

  /**
   * Phiên bản kỳ vọng của Task (nếu module có hỗ trợ cột version).
   */
  expectedVersion?: number;

  /** Metadata mở rộng tùy theo nghiệp vụ */
  metadata?: Record<string, unknown>;
}

/**
 * DTO Kết quả phản hồi sau khi thực thi hành động phê duyệt
 */
export interface TaskActionResultDto {
  success: boolean;
  taskId: string;
  action: TaskActionType;
  newStatus: TaskStatus;
  completedAt: string;
  message: string;

  /** Thông tin chỉ dẫn bước tiếp theo (nếu có trong quy trình PE) */
  nextStep?: {
    stepId: string;
    stepName: string;
    nextAssigneeName?: string;
  };
}
