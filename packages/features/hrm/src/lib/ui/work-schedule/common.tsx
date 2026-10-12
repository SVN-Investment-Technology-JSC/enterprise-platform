'use client';

import { type ReactNode } from 'react';
import { cn } from '../../utils';
import { InfoNote, type NoteTone } from '../settings-kit';

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Hiện dấu * đỏ sau nhãn. */
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-xs font-semibold text-slate-700">
        {label}
        {required ? (
          <span className="ml-1 font-bold text-red-500" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </div>
  );
}

const NOTICE_TONE: Record<'info' | 'warn' | 'error' | 'success', NoteTone> = {
  info: 'blue',
  warn: 'amber',
  error: 'red',
  success: 'green',
};

/** Ghi chú một khối (dùng `InfoNote` của bộ thành phần cấu hình): info, warn, error, success. */
export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_TONE;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <InfoNote
      tone={NOTICE_TONE[tone]}
      role={tone === 'error' || tone === 'warn' ? 'alert' : 'status'}
      className={className}
    >
      {title ? <div className="font-semibold">{title}</div> : null}
      {children}
    </InfoNote>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
      <span
        aria-hidden
        className="inline-block size-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
      />
      {label}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function SectionTitle({ step, children }: { step?: number; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
      {step ? (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
          {step}
        </span>
      ) : null}
      {children}
    </h3>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="size-3.5 rounded border-slate-300 accent-blue-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export const textareaClass =
  'w-full min-h-16 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100';

export function Pager({
  total,
  page,
  pageSize,
  loading,
  noun,
  onPageChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  const btn =
    'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-600 disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-500">
      <span>{total ? `Hiển thị ${first}-${last} / ${total} ${noun}` : `Không có ${noun}`}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
          Trước
        </button>
        <span className="font-bold text-slate-900">
          {page} / {pages}
        </span>
        <button type="button" className={btn} disabled={page >= pages || loading} onClick={() => onPageChange(page + 1)}>
          Sau
        </button>
      </div>
    </div>
  );
}
