'use client';

import type { IconCategory, IconStatus } from '@enterprise-platform/shared-brand-icon';
import { CATEGORY_LABELS } from '@enterprise-platform/shared-brand-icon';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { STATUS_LABELS } from './library-filters';

/** Nút chỉ có biểu tượng; `label` vừa là tooltip (title) vừa là tên cho trình đọc màn hình. */
export function IconButton({
  label,
  tone = 'default',
  className,
  children,
  ...rest
}: Omit<ComponentProps<'button'>, 'title' | 'aria-label'> & { label: string; tone?: 'default' | 'danger' | 'primary' }) {
  return (
    <button
      aria-label={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded text-slate-500 transition-colors outline-none',
        'hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600/40 disabled:pointer-events-none disabled:opacity-40',
        tone === 'danger' && 'hover:bg-red-50 hover:text-red-600',
        tone === 'primary' && 'text-blue-600 hover:bg-blue-50 hover:text-blue-700',
        className,
      )}
      title={label}
      type="button"
      {...rest}
    >
      {children}
    </button>
  );
}

const STATUS_STYLE: Record<IconStatus, { chip: string; dot: string }> = {
  draft: { chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  published: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
};

export function StatusChip({ status }: { status: IconStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4', style.chip)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', style.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function categoryLabel(category: IconCategory): string {
  return CATEGORY_LABELS[category];
}

/** Nút lọc dạng chip; `count` là số icon sẽ hiện ra khi chọn. */
export function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40',
        active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
      onClick={onClick}
      type="button"
    >
      {children}
      {count === undefined ? null : (
        <span className={cn('tabular-nums', active ? 'text-blue-100' : 'text-slate-400')}>{count}</span>
      )}
    </button>
  );
}

/** Ô tick chọn icon; dùng input gốc để bàn phím và trình đọc màn hình hoạt động sẵn. */
export function SelectBox({
  checked,
  indeterminate,
  label,
  onChange,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <input
      aria-label={label}
      checked={checked}
      className={cn('size-4 cursor-pointer rounded border-slate-300 accent-blue-600', className)}
      onChange={(event) => onChange(event.target.checked)}
      ref={(node) => {
        if (node) node.indeterminate = Boolean(indeterminate) && !checked;
      }}
      title={label}
      type="checkbox"
    />
  );
}
