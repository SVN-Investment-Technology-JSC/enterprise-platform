'use client';

import {
  formatAttributeValue,
  type ProcedureAttachment,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeValue,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import styles from './attribute-form.module.scss';

export type AttributeDraft = Record<string, ProcedureAttributeValue | null>;

interface Slot {
  readonly key: string;
  readonly definition: ProcedureAttributeDefinition;
  readonly scopeLabel: string;
}

/** Mọi ô thuộc tính của hồ sơ, kèm khoá lưu giá trị (cùng quy ước với server). */
export function attributeSlots(instance: ProcedureInstance): Slot[] {
  const slots: Slot[] = [];
  for (const definition of instance.flow?.attributes ?? []) {
    slots.push({ key: `process:${definition.code}`, definition, scopeLabel: 'Thông tin chung' });
  }
  for (const step of [...instance.steps].sort((left, right) => left.order - right.order)) {
    for (const definition of step.attributes ?? []) {
      slots.push({ key: `step:${step.definitionStepId}:${definition.code}`, definition, scopeLabel: step.name });
    }
  }
  return slots;
}

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

function parseNumber(text: string): number | undefined {
  // Người dùng Việt gõ "1.000.000" (dấu chấm phân tách nghìn) hoặc "12,5" (dấu phẩy thập phân).
  const cleaned = text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function FieldInput({
  definition,
  value,
  disabled,
  members,
  attachments,
  onChange,
}: {
  definition: ProcedureAttributeDefinition;
  value: ProcedureAttributeValue | null | undefined;
  disabled?: boolean;
  members: readonly { userId: string; displayName: string }[];
  attachments: readonly ProcedureAttachment[];
  onChange: (next: ProcedureAttributeValue | null) => void;
}) {
  switch (definition.type) {
    case 'text':
      return (
        <input
          className={styles.input}
          value={value?.type === 'text' ? value.value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value ? { type: 'text', value: event.target.value } : null)}
        />
      );
    case 'number':
    case 'money':
    case 'percent': {
      const current = value && (value.type === 'number' || value.type === 'money' || value.type === 'percent') ? value.value : undefined;
      return (
        <div className={styles.numberBox}>
          <input
            className={styles.input}
            inputMode="decimal"
            // Hiển thị có phân tách nghìn để 1.000.000.000 không bị đọc nhầm thành 100 triệu.
            defaultValue={current === undefined ? '' : numberFormat.format(current)}
            key={current === undefined ? 'empty' : String(current)}
            disabled={disabled}
            onBlur={(event) => {
              const parsed = parseNumber(event.target.value);
              onChange(parsed === undefined ? null : { type: definition.type as 'number' | 'money' | 'percent', value: parsed });
            }}
          />
          {definition.type === 'money' ? <span className={styles.unit}>đ</span> : null}
          {definition.type === 'percent' ? <span className={styles.unit}>%</span> : null}
        </div>
      );
    }
    case 'date':
      return (
        <input
          className={styles.input}
          type="date"
          value={value?.type === 'date' ? value.value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value ? { type: 'date', value: event.target.value } : null)}
        />
      );
    case 'select':
      return (
        <SearchableSelect
          options={(definition.options ?? []).map((option) => ({ value: option.code, label: option.label }))}
          value={value?.type === 'select' ? value.value : ''}
          placeholder="Chọn…"
          disabled={disabled}
          onChange={(next) => onChange(next ? { type: 'select', value: next } : null)}
        />
      );
    case 'boolean': {
      const current = value?.type === 'boolean' ? value.value : undefined;
      return (
        <div className={styles.toggle} role="radiogroup" aria-label={definition.name}>
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={current === option}
              className={current === option ? styles.toggleOn : undefined}
              disabled={disabled}
              onClick={() => onChange(current === option ? null : { type: 'boolean', value: option })}
            >
              {option ? 'Có' : 'Không'}
            </button>
          ))}
        </div>
      );
    }
    case 'user':
      return (
        <SearchableSelect
          options={members.map((member) => ({ value: member.userId, label: member.displayName }))}
          value={value?.type === 'user' ? value.value : ''}
          placeholder="Chọn người…"
          disabled={disabled}
          onChange={(next) =>
            onChange(
              next
                ? { type: 'user', value: next, label: members.find((member) => member.userId === next)?.displayName }
                : null,
            )
          }
        />
      );
    case 'file': {
      const chosen = new Set(value?.type === 'file' ? value.value : []);
      if (!attachments.length) {
        return <p className={styles.hint}>Chưa có tệp nào trong hồ sơ — đính kèm tệp trước rồi chọn ở đây.</p>;
      }
      return (
        <div className={styles.fileList}>
          {attachments.map((file) => (
            <label key={file.id}>
              <input
                type="checkbox"
                checked={chosen.has(file.id)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(file.id);
                  else next.delete(file.id);
                  onChange(next.size ? { type: 'file', value: [...next] } : null);
                }}
              />
              <span>{file.fileName}</span>
            </label>
          ))}
        </div>
      );
    }
  }
}

/**
 * Ô nhập thuộc tính trong khung xử lý.
 *
 * Chỉ mở ô nằm trong `editableAttributeKeys` do server tính; các giá trị đã
 * nhập ở bước trước hiện dạng chỉ đọc để người duyệt thấy căn cứ.
 */
export function AttributeForm({
  instance,
  draft,
  onChange,
  onSaveDraft,
  busy,
  members,
  attachments,
}: {
  instance: ProcedureInstance;
  draft: AttributeDraft;
  onChange: (next: AttributeDraft) => void;
  onSaveDraft?: () => void;
  busy?: boolean;
  members: readonly { userId: string; displayName: string }[];
  attachments: readonly ProcedureAttachment[];
}) {
  const editable = new Set(instance.authorization?.editableAttributeKeys ?? []);
  const slots = attributeSlots(instance);
  const open = slots.filter((slot) => editable.has(slot.key));
  const readonly = slots.filter(
    (slot) => !editable.has(slot.key) && instance.attributeValues?.[slot.key],
  );
  if (!open.length && !readonly.length) return null;

  const valueOf = (key: string) =>
    key in draft ? draft[key] : instance.attributeValues?.[key]?.value;
  const dirty = Object.keys(draft).length > 0;

  return (
    <section className={styles.form} aria-label="Thông tin của hồ sơ">
      {open.length ? (
        <>
          <header className={styles.header}>
            <strong>Thông tin cần nhập</strong>
            {onSaveDraft ? (
              <button type="button" className={styles.saveDraft} disabled={!dirty || busy} onClick={onSaveDraft}>
                Lưu nháp
              </button>
            ) : null}
          </header>
          <div className={styles.grid}>
            {open.map((slot) => (
              <label key={slot.key} className={styles.field}>
                <span className={styles.label}>
                  {slot.definition.name}
                  {slot.definition.required ? <em aria-label="bắt buộc">*</em> : null}
                  <small>{slot.scopeLabel}</small>
                </span>
                <FieldInput
                  definition={slot.definition}
                  value={valueOf(slot.key)}
                  disabled={busy}
                  members={members}
                  attachments={attachments}
                  onChange={(next) => onChange({ ...draft, [slot.key]: next })}
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
      {readonly.length ? (
        <dl className={styles.readonly}>
          {readonly.map((slot) => (
            <div key={slot.key}>
              <dt>
                {slot.definition.name} <small>{slot.scopeLabel}</small>
              </dt>
              <dd>{formatAttributeValue(instance.attributeValues?.[slot.key]?.value, slot.definition)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
