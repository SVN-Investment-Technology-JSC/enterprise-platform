'use client';

import type { MouseEventHandler, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Viền nhấn khi dùng bàn phím; dùng chung cho nút và ô nhập của các bảng bên phải. */
export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';

/** Nút chỉ có biểu tượng; nhãn hiện thành gợi ý khi rê chuột và đọc được bằng trình đọc màn hình. */
export function IconButton({
  label,
  onClick,
  children,
  pressed,
  disabled = false,
  danger = false,
  className,
}: {
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
  /** Có giá trị thì nút là nút bật/tắt. */
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded text-slate-600 transition-colors',
        'hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        pressed && 'bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700',
        danger && 'hover:bg-red-50 hover:text-red-600',
        FOCUS_RING,
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface ToggleOption<T extends string | number> {
  readonly value: T;
  /** Gợi ý và nhãn cho trình đọc màn hình. */
  readonly label: string;
  readonly icon?: ReactNode;
  /** Chữ ngắn hiện trong nút (khi không có biểu tượng hoặc đi kèm biểu tượng). */
  readonly text?: string;
  readonly disabled?: boolean;
}

/** Nhóm nút chọn một giá trị, thay cho ô chọn thả xuống. */
export function ToggleGroup<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  wrap = false,
  className,
}: {
  /** `null` khi nhiều lớp có giá trị khác nhau: không nút nào được chọn. */
  value: T | null;
  options: readonly ToggleOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-0.5 rounded border border-slate-200 bg-white p-0.5', wrap && 'flex-wrap', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={selected}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-sm px-1.5 text-[11px] text-slate-600 transition-colors',
              'hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35',
              '[&_svg]:size-3.5 [&_svg]:shrink-0',
              selected && 'bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700',
              FOCUS_RING,
            )}
          >
            {option.icon}
            {option.text ? <span>{option.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Một nhóm điều khiển, ngăn với nhóm trước bằng đường kẻ mảnh (không dùng khung). Không có lề ngang vì khung chứa
 * (mục bảng ở trình thiết kế) đã chừa lề.
 */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-slate-200 py-2.5 first:border-t-0 first:pt-1', className)}>
      {title || action ? (
        <header className="mb-2 flex items-center justify-between gap-2">
          {title ? <h3 className="text-[11px] font-medium text-slate-500">{title}</h3> : <span />}
          {action}
        </header>
      ) : null}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Nhãn ngắn bên trái, điều khiển bên phải. */
export function FieldRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] text-slate-500" title={title ?? label}>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Nút chữ nhỏ (chip) dùng cho các giá trị chọn nhanh. */
export function Chip({
  children,
  onClick,
  pressed,
  label,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center rounded border border-slate-200 bg-white px-2 text-[11px] tabular-nums text-slate-600 transition-colors',
        'hover:border-slate-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-35',
        pressed && 'border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-50',
        FOCUS_RING,
      )}
    >
      {children}
    </button>
  );
}
