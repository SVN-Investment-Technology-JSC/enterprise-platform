'use client';

import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { FINANCE_VOUCHER_STATUS_LABELS, type FinanceVoucherStatus } from '@enterprise-platform/contracts-finance';
import { FINANCE_STATUS_STYLE } from '../finance-kinds';
import { money, parseMoneyInput } from '../finance-format';
import { cn } from '../utils';

/** Nhãn + ô nhập + thông báo lỗi; `htmlFor` gắn tự động qua render prop để đọc màn hình đúng. */
export function Field({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="ml-0.5 text-red-500" aria-hidden>*</span> : null}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** Khối thu gọn được của form ("Thông tin chung", "Chi tiết thu"...). */
export function FormSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-b border-slate-100 py-4 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="mb-3 flex w-full items-center gap-2 text-left text-sm font-semibold text-slate-900"
      >
        <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} aria-hidden />
        {title}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Ô nhập tiền: hiện phân cách hàng nghìn, giá trị là số nguyên VND, căn phải. */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = 'Số tiền',
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={value ? money(value) : ''}
      onChange={(event) => onChange(parseMoneyInput(event.target.value))}
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-right text-sm tabular-nums outline-none placeholder:text-slate-400 focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60',
        className,
      )}
    />
  );
}

export function StatusBadge({ status }: { status: FinanceVoucherStatus }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap', FINANCE_STATUS_STYLE[status])}>
      {FINANCE_VOUCHER_STATUS_LABELS[status]}
    </span>
  );
}

/** Ô viết tắt tên người (thay ảnh đại diện). */
export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const text = (name ?? '').trim();
  const letter = (text.split(/\s+/).pop() ?? '').slice(0, 1).toUpperCase() || '?';
  return (
    <span
      title={text || undefined}
      aria-label={text || 'Không rõ'}
      className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-white', className)}
    >
      {letter}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}
