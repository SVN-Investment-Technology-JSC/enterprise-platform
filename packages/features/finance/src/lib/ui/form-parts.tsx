'use client';

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { FINANCE_VOUCHER_STATUS_LABELS, type FinanceVoucherStatus } from '@enterprise-platform/contracts-finance';
import { FINANCE_STATUS_STYLE } from '../finance-kinds';
import { money, reformatMoneyInput } from '../finance-format';
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

/**
 * Ô nhập tiền: định dạng phân cách hàng nghìn NGAY khi gõ hoặc dán ("1500000" hiện "1.500.000"), giá trị là số nguyên VND, căn phải.
 * Con trỏ giữ đúng chỗ khi sửa giữa chuỗi. Mọi ô số tiền của Tài chính dùng đúng component này.
 * `allowNegative`: cho gõ dấu trừ ở đầu (số dư đầu kỳ của tài khoản được phép âm).
 */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = 'Số tiền',
  disabled,
  allowNegative = false,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  allowNegative?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  // Dấu trừ mới gõ (giá trị vẫn 0): phải là state để ô vẽ lại và giữ "-" thay vì bị React xoá về rỗng.
  const [minus, setMinus] = useState(false);
  const shown = value ? money(value) : minus ? '-' : '';

  // Sau khi React ghi lại giá trị, đặt con trỏ về vị trí đã tính (React tự đưa con trỏ về cuối nếu chuỗi hiển thị đổi).
  useLayoutEffect(() => {
    const input = ref.current;
    if (input && caret.current !== null && document.activeElement === input) input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      ref={ref}
      id={id}
      aria-label={ariaLabel}
      inputMode={allowNegative ? 'text' : 'numeric'}
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={shown}
      onChange={(event) => {
        const input = event.target;
        const update = reformatMoneyInput(input.value, input.selectionStart ?? input.value.length, allowNegative);
        if (!update) {
          // Quá dài: giữ số cũ, con trỏ lùi lại đúng một ký tự vừa gõ.
          const position = Math.max(0, (input.selectionStart ?? shown.length) - 1);
          input.value = shown;
          input.setSelectionRange(position, position);
          return;
        }
        setMinus(update.pendingMinus);
        caret.current = update.caret;
        // Ghi ngay vào ô: nếu giá trị số không đổi (gõ chữ, gõ thêm dấu chấm) React không vẽ lại và sẽ để con trỏ nhảy về cuối.
        input.value = update.display;
        input.setSelectionRange(update.caret, update.caret);
        onChange(update.value);
      }}
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
