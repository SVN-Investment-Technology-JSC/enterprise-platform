'use client';

import { roundTo } from '@enterprise-platform/shared-brand-icon';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FOCUS_RING } from './controls';

export interface NumberRules {
  readonly min?: number;
  readonly max?: number;
  /** Số chữ số thập phân giữ lại; mặc định 3. */
  readonly digits?: number;
}

const NUMBER_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Đọc số từ chữ người dùng gõ: nhận cả dấu phẩy lẫn dấu chấm thập phân, bỏ khoảng trắng,
 * kẹp vào [min, max] và làm tròn. Trả `null` khi không phải số.
 */
export function normalizeNumber(text: string, rules: NumberRules = {}): number | null {
  const cleaned = text.replace(/\s+/g, '').replace(',', '.');
  if (!NUMBER_PATTERN.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? clampNumber(value, rules) : null;
}

/** Kẹp giá trị vào [min, max] rồi làm tròn theo số chữ số thập phân. */
export function clampNumber(value: number, rules: NumberRules = {}): number {
  let result = value;
  if (rules.min !== undefined) result = Math.max(rules.min, result);
  if (rules.max !== undefined) result = Math.min(rules.max, result);
  return roundTo(result, rules.digits ?? 3);
}

/** Chữ hiển thị trong ô số: dấu phẩy thập phân, không có số 0 thừa. */
export function formatDecimal(value: number, digits = 3): string {
  const rounded = roundTo(value, digits);
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',');
}

export interface NumberFieldProps {
  /** `null` khi nhiều lớp có giá trị khác nhau hoặc ô chỉ để nhập một lần. */
  readonly value: number | null;
  readonly onCommit: (value: number) => void;
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly digits?: number;
  /** Chữ ngắn đứng trước ô, ví dụ `X`. */
  readonly prefix?: ReactNode;
  /** Đơn vị đứng sau ô, ví dụ `%` hoặc `°`. */
  readonly suffix?: string;
  readonly placeholder?: string;
  /** Hiện dấu gạch ngang khi ô trống vì nhiều giá trị khác nhau. */
  readonly mixed?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Ô số: gõ tự do, áp dụng khi Enter hoặc rời ô (Esc để huỷ), mũi tên lên/xuống tăng giảm theo `step`
 * (giữ Shift để nhảy mười bước). Mỗi lần áp dụng là một thay đổi nên chỉ tạo một bước hoàn tác.
 */
export function NumberField({
  value,
  onCommit,
  label,
  min,
  max,
  step = 1,
  digits = 3,
  prefix,
  suffix,
  placeholder,
  mixed = false,
  disabled = false,
  className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : formatDecimal(value, digits));

  const commit = () => {
    if (draft === null) return;
    const parsed = normalizeNumber(draft, { min, max, digits });
    setDraft(null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      if (draft !== null) event.stopPropagation();
      setDraft(null);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = (draft !== null ? normalizeNumber(draft, { digits }) : null) ?? value ?? 0;
      const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
      const next = clampNumber(base + delta, { min, max, digits });
      setDraft(null);
      if (next !== null && next !== value) onCommit(next);
    }
  };

  return (
    <label
      className={cn(
        'flex h-7 min-w-0 items-center rounded border border-slate-200 bg-white text-xs text-slate-800 transition-colors',
        'focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20',
        disabled && 'opacity-40',
        className,
      )}
      title={label}
    >
      {prefix ? <span className="shrink-0 pl-1.5 text-[10px] text-slate-400">{prefix}</span> : null}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={shown}
        placeholder={placeholder ?? (mixed ? '—' : '')}
        onFocus={(event) => {
          setDraft(shown);
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-right tabular-nums outline-none placeholder:text-slate-400"
      />
      {suffix ? <span className="shrink-0 pr-1.5 text-[10px] text-slate-400">{suffix}</span> : null}
    </label>
  );
}

export interface SliderNumberProps {
  readonly value: number | null;
  readonly onChange: (value: number) => void;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly digits?: number;
  readonly suffix?: string;
  readonly mixed?: boolean;
  readonly disabled?: boolean;
  /**
   * Bắt đầu/kết thúc kéo thanh trượt, để gộp cả lượt kéo thành một bước hoàn tác. Bắt đầu được báo ở lần đổi giá trị
   * đầu tiên của lượt kéo (bấm vào mà không kéo thì không báo), dùng phím mũi tên thì mỗi lần là một bước riêng.
   */
  readonly onScrubStart?: () => void;
  readonly onScrubEnd?: () => void;
}

/** Thanh trượt đi kèm ô số; kéo thanh trượt thay đổi liên tục, ô số áp dụng khi Enter hoặc rời ô. */
export function SliderNumber({
  value,
  onChange,
  label,
  min,
  max,
  step,
  digits = 2,
  suffix,
  mixed = false,
  disabled = false,
  onScrubStart,
  onScrubEnd,
}: SliderNumberProps) {
  const armed = useRef(false);
  const endScrub = () => {
    armed.current = false;
    onScrubEnd?.();
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="range"
        aria-label={`${label} (thanh trượt)`}
        title={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value ?? min}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          armed.current = true;
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onBlur={endScrub}
        onChange={(event) => {
          const next = normalizeNumber(event.target.value, { min, max, digits });
          if (next === null) return;
          if (armed.current) {
            armed.current = false;
            onScrubStart?.();
          }
          onChange(next);
        }}
        className={cn('h-1 min-w-0 flex-1 cursor-pointer accent-blue-600 disabled:opacity-40', mixed && 'opacity-50', FOCUS_RING)}
      />
      <NumberField
        value={mixed ? null : value}
        onCommit={onChange}
        label={label}
        min={min}
        max={max}
        step={step}
        digits={digits}
        suffix={suffix}
        mixed={mixed}
        disabled={disabled}
        className="w-[72px] shrink-0"
      />
    </div>
  );
}
