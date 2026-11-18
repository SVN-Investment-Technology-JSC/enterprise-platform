'use client';

/**
 * Ô nhập dùng trong vùng thuộc tính của trình thiết kế: số có giới hạn (chặn giá trị ngoài khoảng tại ô, kèm thông báo), chữ
 * có nút "Chèn biến", nút căn lề, công tắc.
 */
import type { CustomFieldDefinition, QuoteLayoutAlign } from '@enterprise-platform/contracts-crm';
import { AlignCenter, AlignLeft, AlignRight, Braces } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './layout-designer.module.scss';
import { VariablePicker, insertAtCaret, variableToken } from './variable-picker';

/** Số kiểu Việt Nam để hiện ("0,5"). */
const formatNumber = (value: number) => String(value).replace('.', ',');

/** Đọc số người dùng gõ, nhận cả dấu phẩy thập phân; rỗng hoặc sai thì `null`. */
export function parseLayoutNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

export function FieldRow({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={styles.fieldHint}>{hint}</p>
      ) : null}
    </div>
  );
}

export interface NumberFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** Cho để trống (trường tuỳ chọn): rỗng gọi `onChange(undefined)`. */
  readonly optional?: boolean;
  readonly unit?: string;
  readonly compact?: boolean;
  readonly onChange: (value: number | undefined) => void;
}

/** Ô số: giá trị ngoài khoảng không được ghi vào bố cục, ô hiện lỗi; rời ô thì trả về giá trị đang dùng. */
export function NumberField({ label, value, min, max, step = 1, optional = false, unit, compact = false, onChange }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : formatNumber(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : formatNumber(value));
  }, [value]);

  const change = (next: string) => {
    setText(next);
    if (!next.trim() && optional) {
      setError(null);
      onChange(undefined);
      return;
    }
    const parsed = parseLayoutNumber(next);
    if (parsed === null || parsed < min || parsed > max) {
      setError(`Nhập số từ ${formatNumber(min)} đến ${formatNumber(max)}${unit ? ` ${unit}` : ''}.`);
      return;
    }
    setError(null);
    onChange(parsed);
  };

  const input = (
    <input
      id={id}
      className={error ? `${styles.input} ${styles.inputInvalid}` : styles.input}
      inputMode="decimal"
      value={text}
      step={step}
      aria-invalid={error ? true : undefined}
      aria-label={compact ? label : undefined}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setError(null);
        setText(value === undefined ? '' : formatNumber(value));
      }}
      onChange={(event) => change(event.target.value)}
    />
  );
  if (compact) {
    return (
      <div className={styles.compactNumber}>
        <span className={styles.compactLabel}>{label}</span>
        {input}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <FieldRow label={unit ? `${label} (${unit})` : label} htmlFor={id} error={error}>
      {input}
    </FieldRow>
  );
}

const ALIGN_OPTIONS: readonly { value: QuoteLayoutAlign; label: string; icon: ReactNode }[] = [
  { value: 'left', label: 'Căn trái', icon: <AlignLeft size={15} aria-hidden="true" /> },
  { value: 'center', label: 'Căn giữa', icon: <AlignCenter size={15} aria-hidden="true" /> },
  { value: 'right', label: 'Căn phải', icon: <AlignRight size={15} aria-hidden="true" /> },
];

/** Nhóm nút chọn một trong vài giá trị (căn lề, số cột...). */
export function SegmentedField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  bare = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  bare?: boolean;
}) {
  const group = (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.icon ? option.label : undefined}
          title={option.icon ? option.label : undefined}
          className={option.value === value ? styles.segmentActive : styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
  if (bare) return group;
  return <FieldRow label={label}>{group}</FieldRow>;
}

export function AlignField({ label = 'Căn lề', value, onChange, bare }: { label?: string; value: QuoteLayoutAlign; onChange: (value: QuoteLayoutAlign) => void; bare?: boolean }) {
  return <SegmentedField label={label} value={value} options={ALIGN_OPTIONS} onChange={onChange} bare={bare} />;
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.checkRow}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  /** `typing`: lần sửa do gõ phím (gộp thành một bước hoàn tác); chèn biến là một bước riêng. */
  readonly onChange: (value: string, typing: boolean) => void;
  /** Rời ô: kết thúc lượt gõ. */
  readonly onEndTyping?: () => void;
  readonly maxLength: number;
  readonly multiline?: boolean;
  /** Có nút "Chèn biến". */
  readonly variables?: boolean;
  readonly customFields?: readonly CustomFieldDefinition[];
  readonly placeholder?: string;
  /** Ẩn nhãn (vẫn có `aria-label`), dùng trong danh sách. */
  readonly hideLabel?: boolean;
  readonly error?: string | null;
}

/** Ô chữ; có biến thì thêm nút "Chèn biến" mở danh sách biến, chèn đúng vị trí con trỏ. */
export function TextField({
  label,
  value,
  onChange,
  onEndTyping,
  maxLength,
  multiline = false,
  variables = false,
  customFields,
  placeholder,
  hideLabel = false,
  error,
}: TextFieldProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [picking, setPicking] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    const caret = pendingCaret.current;
    const element = ref.current;
    if (caret === null || !element) return;
    pendingCaret.current = null;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [value]);

  const remember = () => {
    const element = ref.current;
    if (element) selection.current = { start: element.selectionStart, end: element.selectionEnd };
  };

  const pick = (key: string) => {
    const result = insertAtCaret(value, selection.current.start, selection.current.end, variableToken(key));
    setPicking(false);
    if (result.value.length > maxLength) return;
    pendingCaret.current = result.caret;
    onEndTyping?.();
    onChange(result.value, false);
  };

  const common = {
    id,
    ref,
    value,
    maxLength,
    placeholder,
    className: error ? `${styles.input} ${styles.inputInvalid}` : styles.input,
    'aria-label': hideLabel ? label : undefined,
    'aria-invalid': error ? true : undefined,
    onSelect: remember,
    onKeyUp: remember,
    onMouseUp: remember,
    onBlur: () => {
      remember();
      onEndTyping?.();
    },
    onChange: (event: { target: { value: string; selectionStart: number | null; selectionEnd: number | null } }) => {
      selection.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
      onChange(event.target.value, true);
    },
  };
  const control = (
    <div className={styles.textControl}>
      {multiline ? <textarea {...common} rows={3} className={`${common.className} ${styles.textarea}`} /> : <input {...common} />}
      {variables ? (
        <div className={styles.variableAnchor}>
          <button
            type="button"
            className={styles.variableButton}
            aria-label={`Chèn biến vào ${label}`}
            title="Chèn biến"
            aria-expanded={picking}
            onMouseDown={remember}
            onClick={() => setPicking((open) => !open)}
          >
            <Braces size={14} aria-hidden="true" />
            {hideLabel ? null : 'Chèn biến'}
          </button>
          {picking ? <VariablePicker customFields={customFields} onPick={pick} onClose={() => setPicking(false)} /> : null}
        </div>
      ) : null}
    </div>
  );
  if (hideLabel) {
    return (
      <div className={styles.listField}>
        {control}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <FieldRow label={label} htmlFor={id} error={error}>
      {control}
    </FieldRow>
  );
}
