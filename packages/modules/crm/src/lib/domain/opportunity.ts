import {
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_TRANSITIONS,
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';

/**
 * Máy trạng thái cơ hội (mục 5.1 kế hoạch):
 *
 * - giai đoạn mở tiến hoặc lùi đúng một bước theo thứ tự Mới → Đã liên hệ →
 *   Khảo sát nhu cầu → Báo giá → Đàm phán;
 * - Đàm phán → Thắng;
 * - mọi giai đoạn mở → Thua, bắt buộc lý do;
 * - Thắng, Thua là trạng thái cuối, không chuyển đi đâu.
 *
 * Điều kiện "có báo giá Khách chấp nhận" cho Đàm phán → Thắng thuộc GĐ3 (chưa
 * có bảng báo giá); khi đó service kiểm thêm qua port báo giá, bảng chuyển ở
 * đây giữ nguyên.
 */
export function isOpenStage(stage: OpportunityStage): boolean {
  return OPEN_OPPORTUNITY_STAGES.includes(stage);
}

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === 'string' && (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

/** Cặp `from → to` có trong bảng chuyển không (`OPPORTUNITY_STAGE_TRANSITIONS` ở contracts). */
export function canTransition(from: OpportunityStage, to: OpportunityStage): boolean {
  return OPPORTUNITY_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Mọi giai đoạn đích hợp lệ từ `from` (giao diện dùng để tô cột kéo được). */
export function allowedTransitions(from: OpportunityStage): OpportunityStage[] {
  return OPPORTUNITY_STAGES.filter((to) => canTransition(from, to));
}

/**
 * Kiểm một lần chuyển giai đoạn, trả lý do đã chuẩn hoá (chỉ có khi sang Thua).
 *
 * Chuyển không có trong bảng: 409. Sang Thua thiếu lý do: 400. Chuyển về chính
 * nó cũng là 409 (không phải thao tác).
 */
export function assertStageTransition(
  from: OpportunityStage,
  to: OpportunityStage,
  reason: string | null | undefined,
): string | null {
  if (!canTransition(from, to)) {
    throw new CrmConflictError(
      'INVALID_STAGE_TRANSITION',
      `Không thể chuyển cơ hội từ "${OPPORTUNITY_STAGE_LABELS[from]}" sang "${OPPORTUNITY_STAGE_LABELS[to]}".`,
    );
  }
  if (to !== 'LOST') return null;
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) throw new CrmValidationError('LOST_REASON_REQUIRED', 'Phải ghi lý do thua.');
  if (trimmed.length > 2000) throw new CrmValidationError('LOST_REASON_TOO_LONG', 'Lý do thua tối đa 2000 ký tự.');
  return trimmed;
}

/** Xác suất thắng: số nguyên 0–100. */
export function normalizeProbability(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new CrmValidationError('INVALID_PROBABILITY', 'Xác suất phải là số nguyên từ 0 đến 100.');
  }
  return number;
}
