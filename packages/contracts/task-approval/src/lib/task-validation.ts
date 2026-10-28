import type { ExecuteTaskActionDto } from './task-action-dto.js';
import type { TaskActionType, UniversalTaskDto } from './task-dto.js';
import { TASK_ERRORS } from './task-errors.js';

/**
 * Lớp lỗi chuẩn cho validation của Task Action
 */
export class TaskValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

/**
 * Kiểm tra tính hợp lệ của DTO gửi lệnh thực thi hành động.
 * QUY TẮC CỐT TỬ: Nếu action là REJECT hoặc RETURN thì bắt buộc phải có reason không rỗng.
 */
export function validateTaskActionInput(dto: ExecuteTaskActionDto): void {
  if (!dto.action || !['APPROVE', 'REJECT', 'RETURN'].includes(dto.action)) {
    throw new TaskValidationError(
      TASK_ERRORS.INVALID_ACTION,
      `Hành động không hợp lệ: ${String(dto.action)}`,
    );
  }

  if (dto.action === 'REJECT' || dto.action === 'RETURN') {
    const reasonText = (dto.reason || '').trim();
    if (!reasonText) {
      throw new TaskValidationError(
        TASK_ERRORS.REASON_REQUIRED,
        dto.action === 'REJECT'
          ? 'Vui lòng nhập lý do từ chối.'
          : 'Vui lòng nhập lý do yêu cầu bổ sung / chỉnh sửa.',
      );
    }

    if (reasonText.length > 2000) {
      throw new TaskValidationError(
        'TASK_REASON_TOO_LONG',
        'Lý do không được vượt quá 2000 ký tự.',
      );
    }
  }

  if (!dto.idempotencyKey || typeof dto.idempotencyKey !== 'string') {
    throw new TaskValidationError(
      'TASK_IDEMPOTENCY_KEY_REQUIRED',
      'Yêu cầu phải có khóa chống gửi trùng (idempotencyKey).',
    );
  }
}

/**
 * Kiểm tra xem hành động có nằm trong danh sách được phép của tác vụ hay không
 */
export function assertActionAvailable(
  task: Pick<UniversalTaskDto, 'availableActions'>,
  action: TaskActionType,
): void {
  if (!task.availableActions || !task.availableActions.includes(action)) {
    throw new TaskValidationError(
      TASK_ERRORS.ACTION_NOT_AVAILABLE,
      `Hành động '${action}' không khả dụng cho tác vụ này.`,
    );
  }
}
