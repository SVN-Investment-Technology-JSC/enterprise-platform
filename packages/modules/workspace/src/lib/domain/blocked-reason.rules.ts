import { BLOCKED_REASON_MAX_LENGTH } from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from './workspace.error.js';

/**
 * Lý do vướng mắc người thực hiện ghi khi chuyển việc sang "Vướng mắc".
 *
 * Cắt khoảng trắng; không được rỗng và không dài quá `BLOCKED_REASON_MAX_LENGTH`. Dùng chung cho công việc trong
 * dự án và việc giao lẻ để hai nơi cùng một luật.
 */
export function parseBlockedReason(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new WorkspaceValidationError('Hãy ghi lý do vướng mắc.');
  if (text.length > BLOCKED_REASON_MAX_LENGTH) {
    throw new WorkspaceValidationError(
      `Lý do vướng mắc không được dài quá ${BLOCKED_REASON_MAX_LENGTH} ký tự.`,
    );
  }
  return text;
}
