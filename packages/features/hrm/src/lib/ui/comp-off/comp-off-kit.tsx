'use client';
import type { ReactNode } from 'react';
import { cn } from '../../utils';

/** Thành phần nhỏ dùng chung của các màn quỹ nghỉ bù và cấu hình làm thêm. */

export const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-xs font-semibold text-slate-700', className)}>
      <span>{label}</span>
      {children}
      {hint ? <span className="text-[11px] font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-lg border px-3 py-2 text-xs', tones[tone])}>
      {children}
    </div>
  );
}

// Cùng kiểu chữ với bảng Số dư phép: chữ thường cỡ 12px cho mọi cột, số căn phải (tabular-nums giữ các chữ số thẳng hàng).
export const th = 'whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-bold text-slate-600';
export const thRight = 'whitespace-nowrap px-3 py-2.5 text-right text-[12px] font-bold text-slate-600';
export const td = 'px-3 py-2 text-xs text-slate-800';
export const tdRight = 'px-3 py-2 text-right text-xs tabular-nums text-slate-800';

/** Khung bảng cuộn ngang có viền, dùng cho mọi bảng của màn này. */
export function TableShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table aria-label={label} className="w-full min-w-[640px] border-collapse">
        {children}
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-xs text-slate-500">
        {children}
      </td>
    </tr>
  );
}
