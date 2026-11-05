'use client';

import { COMPLETION_RULES, MAX_COMPLETION_CONDITIONS, type CompletionRule } from '@enterprise-platform/contracts-workspace';
import { ListChecks, Plus, X } from 'lucide-react';
import { useRef } from 'react';
import {
  COMPLETION_RULE_HINTS,
  COMPLETION_RULE_LABELS,
  filledConditions,
  type CompletionDraft,
} from '../completion-draft';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Input, Label } from './form-controls';

export interface CompletionConditionsEditorProps {
  readonly value: CompletionDraft;
  readonly onChange: (next: CompletionDraft) => void;
  /** Tiền tố id/aria để nhiều khối trên cùng một form không trùng nhau. */
  readonly idPrefix: string;
  /** Chỉ xem: người nhận việc, hoặc việc đã hoàn thành. `readOnlyReason` giải thích vì sao. */
  readonly readOnly?: boolean;
  readonly readOnlyReason?: string;
}

/**
 * Cấu hình điều kiện hoàn thành của một công việc: danh sách điều kiện tuỳ ý, và cách tính (đủ tất cả, đủ ít nhất
 * N, hoặc không bắt buộc). Để trống là việc không có điều kiện: hoàn thành chỉ cần xác nhận.
 */
export function CompletionConditionsEditor({
  value,
  onChange,
  idPrefix,
  readOnly = false,
  readOnlyReason,
}: CompletionConditionsEditorProps) {
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const total = filledConditions(value).length;
  const atLimit = value.conditions.length >= MAX_COMPLETION_CONDITIONS;

  const patch = (next: Partial<CompletionDraft>) => onChange({ ...value, ...next });

  const setLabel = (index: number, label: string) =>
    patch({
      conditions: value.conditions.map((condition, at) =>
        at === index ? { ...condition, label } : condition,
      ),
    });

  const remove = (index: number) =>
    patch({ conditions: value.conditions.filter((_, at) => at !== index) });

  /** Thêm một dòng ngay sau dòng `after` (hoặc cuối danh sách) rồi đưa con trỏ vào đó. */
  const add = (after = value.conditions.length - 1) => {
    if (atLimit) return;
    const conditions = [...value.conditions];
    conditions.splice(after + 1, 0, { label: '' });
    patch({ conditions });
    requestAnimationFrame(() => inputs.current.get(after + 1)?.focus());
  };

  return (
    <div className={styles.completionBox} data-readonly={readOnly || undefined}>
      <div className={styles.completionHead}>
        <span className={styles.completionBadge} aria-hidden="true">
          <ListChecks size={16} />
        </span>
        <div className={styles.completionHeadText}>
          <Label className={styles.completionTitle}>
            Điều kiện hoàn thành
            {value.conditions.length > 0 ? (
              <span className={styles.completionCount}>{value.conditions.length}</span>
            ) : null}
          </Label>
          <span className={styles.completionSub}>
            {value.conditions.length === 0
              ? 'Không bắt buộc. Có điều kiện thì người nhận việc phải xác nhận trước khi hoàn thành.'
              : 'Người nhận việc xác nhận các mục này trước khi hoàn thành.'}
          </span>
        </div>
        {readOnly ? null : (
          <button
            type="button"
            className={styles.completionAdd}
            disabled={atLimit}
            onClick={() => add()}
            aria-label={`Thêm điều kiện hoàn thành (${idPrefix})`}
          >
            <Plus size={14} /> Thêm điều kiện
          </button>
        )}
      </div>

      {readOnly && readOnlyReason ? (
        <p className={`${styles.fieldHint} ${styles.completionNote}`}>{readOnlyReason}</p>
      ) : null}

      {value.conditions.length > 0 ? (
        <div className={styles.completionBody}>
          <div className={styles.completionRule}>
            <Choice
              label={`Cách tính điều kiện hoàn thành (${idPrefix})`}
              value={value.rule}
              height={36}
              selectOnly
              disabled={readOnly}
              options={COMPLETION_RULES.map((rule) => ({
                value: rule,
                label: COMPLETION_RULE_LABELS[rule],
              }))}
              onChange={(rule) => patch({ rule: rule as CompletionRule })}
            />
            {value.rule === 'at_least' ? (
              <span className={styles.completionMin}>
                Cần đủ ít nhất
                <Input
                  type="number"
                  min={1}
                  max={Math.max(total, 1)}
                  step={1}
                  inputMode="numeric"
                  aria-label={`Số điều kiện tối thiểu (${idPrefix})`}
                  value={value.minRequired}
                  disabled={readOnly}
                  onChange={(event) => patch({ minRequired: event.target.value })}
                />
                / {total} điều kiện
              </span>
            ) : null}
          </div>
          <p className={`${styles.fieldHint} ${styles.completionHint}`}>{COMPLETION_RULE_HINTS[value.rule]}</p>

          <ol className={styles.completionList}>
            {value.conditions.map((condition, index) => (
              <li key={condition.id ?? `new-${index}`} className={styles.completionRow}>
                <span className={styles.completionIndex} aria-hidden="true">
                  {index + 1}
                </span>
                <Input
                  ref={(element) => {
                    if (element) inputs.current.set(index, element);
                    else inputs.current.delete(index);
                  }}
                  id={`${idPrefix}-condition-${index}`}
                  aria-label={`Điều kiện hoàn thành ${index + 1}`}
                  placeholder="Ví dụ: Có biên bản nghiệm thu có chữ ký"
                  maxLength={300}
                  value={condition.label}
                  readOnly={readOnly}
                  onChange={(event) => setLabel(index, event.target.value)}
                  onKeyDown={(event) => {
                    // Enter ở ô điều kiện thêm dòng kế tiếp thay vì gửi cả form.
                    if (event.key !== 'Enter' || readOnly) return;
                    event.preventDefault();
                    if (condition.label.trim()) add(index);
                  }}
                />
                {readOnly ? null : (
                  <button
                    type="button"
                    className={`${styles.draftIconButton} ${styles.draftIconRemove}`}
                    aria-label={`Bỏ điều kiện ${index + 1}`}
                    title="Bỏ điều kiện này"
                    onClick={() => remove(index)}
                  >
                    <X size={15} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
