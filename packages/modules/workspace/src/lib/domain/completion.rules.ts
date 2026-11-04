import {
  MAX_COMPLETION_CONDITIONS,
  MAX_COMPLETION_CONDITION_LENGTH,
  COMPLETION_RULES,
  requiredConfirmations,
  type CompletionRule,
  type WorkItemCompletionEvidence,
  type WorkItemCompletionInput,
  type WorkItemCompletionPolicy,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import { CompletionConditionsUnmetError, WorkspaceValidationError } from './workspace.error.js';

/** Điều kiện đã làm sạch, sẵn sàng ghi: `id` có khi giữ lại điều kiện đã có. */
export interface ParsedCompletion {
  readonly rule: CompletionRule;
  readonly minRequired?: number;
  readonly conditions: readonly { readonly id?: string; readonly label: string }[];
}

/**
 * Kiểm và làm sạch điều kiện hoàn thành người dùng gửi lên.
 *
 * Trả `undefined` khi không đặt điều kiện nào (bỏ trống hay danh sách rỗng): công việc đó hoàn thành chỉ cần
 * xác nhận. Nhóm công việc không có điều kiện vì nó tự hoàn thành khi việc con xong.
 */
export function parseCompletionInput(
  input: WorkItemCompletionInput | null | undefined,
  itemType: WorkItemType,
): ParsedCompletion | undefined {
  if (!input) return undefined;
  const conditions = (input.conditions ?? [])
    .map((condition) => ({
      id: typeof condition.id === 'string' && condition.id ? condition.id : undefined,
      label: String(condition.label ?? '').trim(),
    }))
    // Dòng trống do người dùng bấm thêm rồi bỏ đó: bỏ qua, không coi là lỗi.
    .filter((condition) => condition.label.length > 0);
  if (conditions.length === 0) return undefined;

  if (itemType === 'phase') {
    throw new WorkspaceValidationError(
      'Nhóm công việc không đặt điều kiện hoàn thành; hãy đặt ở từng việc con.',
    );
  }
  if (!COMPLETION_RULES.includes(input.rule)) {
    throw new WorkspaceValidationError('Cách tính điều kiện hoàn thành không hợp lệ.');
  }
  if (conditions.length > MAX_COMPLETION_CONDITIONS) {
    throw new WorkspaceValidationError(
      `Một công việc chỉ đặt tối đa ${MAX_COMPLETION_CONDITIONS} điều kiện hoàn thành.`,
    );
  }
  if (conditions.some((condition) => condition.label.length > MAX_COMPLETION_CONDITION_LENGTH)) {
    throw new WorkspaceValidationError(
      `Mỗi điều kiện hoàn thành tối đa ${MAX_COMPLETION_CONDITION_LENGTH} ký tự.`,
    );
  }
  const seen = new Set<string>();
  for (const condition of conditions) {
    const key = condition.label.toLowerCase();
    if (seen.has(key)) {
      throw new WorkspaceValidationError(`Điều kiện "${condition.label}" bị trùng.`);
    }
    seen.add(key);
  }

  if (input.rule !== 'at_least') return { rule: input.rule, conditions };
  const min = Number(input.minRequired);
  if (!Number.isInteger(min) || min < 1 || min > conditions.length) {
    throw new WorkspaceValidationError(
      `Số điều kiện tối thiểu phải là số nguyên từ 1 đến ${conditions.length}.`,
    );
  }
  return { rule: 'at_least', minRequired: min, conditions };
}

/**
 * Kiểm các điều kiện người dùng đã tích có đủ để hoàn thành không, rồi trả ảnh chụp để ghi vào nhật ký.
 *
 * Id lạ (điều kiện đã bị sửa/xoá, hoặc của việc khác) là lỗi chứ không lặng lẽ bỏ qua: người dùng đang xác nhận
 * một danh sách khác với danh sách hiện hành thì phải tải lại. Trả `undefined` khi công việc không có điều kiện.
 */
export function evaluateCompletion(
  policy: WorkItemCompletionPolicy | undefined,
  confirmedIds: readonly string[] | undefined,
): WorkItemCompletionEvidence | undefined {
  if (!policy || policy.conditions.length === 0) return undefined;
  const ids = new Set(confirmedIds ?? []);
  const known = new Set(policy.conditions.map((condition) => condition.id));
  for (const id of ids) {
    if (!known.has(id)) {
      throw new WorkspaceValidationError(
        'Danh sách điều kiện hoàn thành đã thay đổi; hãy tải lại công việc rồi xác nhận lại.',
      );
    }
  }
  const required = requiredConfirmations(policy);
  if (ids.size < required) {
    throw new CompletionConditionsUnmetError(required, ids.size, policy.conditions.length);
  }
  return {
    rule: policy.rule,
    minRequired: policy.minRequired,
    conditions: policy.conditions.map((condition) => ({
      id: condition.id,
      label: condition.label,
      confirmed: ids.has(condition.id),
    })),
  };
}
