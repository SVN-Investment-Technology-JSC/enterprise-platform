import {
  MAX_COMPLETION_CONDITIONS,
  MAX_COMPLETION_CONDITION_LENGTH,
  type CompletionRule,
  type WorkItemCompletionInput,
  type WorkItemCompletionPolicy,
} from '@enterprise-platform/contracts-workspace';

/** Điều kiện hoàn thành đang soạn trong form: `id` có khi là điều kiện đã lưu của một việc đang sửa. */
export interface CompletionDraft {
  rule: CompletionRule;
  /** Chuỗi để gõ được ô trống; chỉ dùng khi `rule = 'at_least'`. */
  minRequired: string;
  conditions: { id?: string; label: string }[];
}

export const COMPLETION_RULE_LABELS: Record<CompletionRule, string> = {
  all: 'Phải đủ tất cả điều kiện',
  at_least: 'Chỉ cần đủ một số điều kiện',
  none: 'Không bắt buộc điều kiện nào',
};

export const COMPLETION_RULE_HINTS: Record<CompletionRule, string> = {
  all: 'Người nhận việc phải tích đủ mọi điều kiện mới hoàn thành được.',
  at_least: 'Người nhận việc chỉ cần tích đủ số điều kiện tối thiểu bạn đặt.',
  none: 'Điều kiện chỉ để nhắc: không tích cũng hoàn thành được, nhưng việc đã tích gì sẽ được ghi lại.',
};

export function emptyCompletion(): CompletionDraft {
  return { rule: 'all', minRequired: '1', conditions: [] };
}

/** Bản nháp từ điều kiện đã lưu; `keepIds = false` khi chép sang việc mới. */
export function completionDraftOf(
  policy: WorkItemCompletionPolicy | undefined,
  keepIds = true,
): CompletionDraft {
  if (!policy || policy.conditions.length === 0) return emptyCompletion();
  return {
    rule: policy.rule,
    minRequired: String(policy.minRequired ?? 1),
    conditions: policy.conditions.map((condition) =>
      keepIds ? { id: condition.id, label: condition.label } : { label: condition.label },
    ),
  };
}

/** Bản sao độc lập; bỏ `id` khi dùng cho việc mới (nhân bản, dán nhiều dòng). */
export function cloneCompletion(draft: CompletionDraft, keepIds = false): CompletionDraft {
  return {
    rule: draft.rule,
    minRequired: draft.minRequired,
    conditions: draft.conditions.map((condition) =>
      keepIds && condition.id ? { id: condition.id, label: condition.label } : { label: condition.label },
    ),
  };
}

/** Các điều kiện có chữ (dòng trống do bấm thêm rồi bỏ đó thì không tính). */
export function filledConditions(draft: CompletionDraft): CompletionDraft['conditions'] {
  return draft.conditions.filter((condition) => condition.label.trim());
}

/** Số điều kiện tối thiểu hợp lệ của bản nháp, hoặc `undefined` khi chưa hợp lệ. */
function minOf(draft: CompletionDraft, total: number): number | undefined {
  const min = Number(draft.minRequired);
  return Number.isInteger(min) && min >= 1 && min <= total ? min : undefined;
}

/** Điều kiện cần sửa trước khi lưu, hoặc `undefined` khi hợp lệ (cùng luật với server). */
export function completionProblem(draft: CompletionDraft): string | undefined {
  const conditions = filledConditions(draft);
  if (conditions.length === 0) return undefined;
  if (conditions.length > MAX_COMPLETION_CONDITIONS) {
    return `Chỉ đặt tối đa ${MAX_COMPLETION_CONDITIONS} điều kiện hoàn thành.`;
  }
  if (conditions.some((condition) => condition.label.trim().length > MAX_COMPLETION_CONDITION_LENGTH)) {
    return `Mỗi điều kiện hoàn thành tối đa ${MAX_COMPLETION_CONDITION_LENGTH} ký tự.`;
  }
  const seen = new Set<string>();
  for (const condition of conditions) {
    const key = condition.label.trim().toLowerCase();
    if (seen.has(key)) return `Điều kiện "${condition.label.trim()}" bị trùng.`;
    seen.add(key);
  }
  if (draft.rule === 'at_least' && minOf(draft, conditions.length) === undefined) {
    return `Số điều kiện tối thiểu phải là số nguyên từ 1 đến ${conditions.length}.`;
  }
  return undefined;
}

/**
 * Điều kiện gửi lên server; `undefined` khi không đặt điều kiện nào.
 * Khi sửa, dùng `completionPatchOf` để phân biệt "không đổi" với "bỏ hết".
 */
export function completionInputOf(draft: CompletionDraft): WorkItemCompletionInput | undefined {
  const conditions = filledConditions(draft).map((condition) => ({
    ...(condition.id ? { id: condition.id } : {}),
    label: condition.label.trim(),
  }));
  if (conditions.length === 0) return undefined;
  return draft.rule === 'at_least'
    ? { rule: 'at_least', minRequired: minOf(draft, conditions.length), conditions }
    : { rule: draft.rule, conditions };
}

/**
 * Điều kiện gửi khi SỬA: `undefined` nếu không đổi so với bản đang lưu (không đụng tới điều kiện, nên người không
 * có quyền sửa điều kiện vẫn lưu được các trường khác); `null` nếu bỏ hết; còn lại là bản mới.
 */
export function completionPatchOf(
  draft: CompletionDraft,
  saved: WorkItemCompletionPolicy | undefined,
): WorkItemCompletionInput | null | undefined {
  const next = completionInputOf(draft);
  const before = completionInputOf(completionDraftOf(saved));
  if (JSON.stringify(next ?? null) === JSON.stringify(before ?? null)) return undefined;
  return next ?? null;
}
