'use client';

import type { IconCategory, IconStatus } from '@enterprise-platform/shared-brand-icon';
import { CATEGORY_LABELS } from '@enterprise-platform/shared-brand-icon';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { STATUS_LABELS } from './library-filters';

/** Nút chỉ có biểu tượng (shadcn Button, size icon); `label` vừa là tooltip vừa là tên cho trình đọc màn hình. */
export function IconButton({
  label,
  tone = 'default',
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof Button>, 'title' | 'aria-label' | 'size' | 'variant'> & { label: string; tone?: 'default' | 'danger' | 'primary' }) {
  return (
    <Hint label={label}>
      <Button
        aria-label={label}
        className={cn(
          'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
          tone === 'danger' && 'hover:bg-red-50 hover:text-red-600',
          tone === 'primary' && 'text-blue-600 hover:bg-blue-50 hover:text-blue-700',
          className,
        )}
        size="icon"
        type="button"
        variant="ghost"
        {...rest}
      >
        {children}
      </Button>
    </Hint>
  );
}

const STATUS_STYLE: Record<IconStatus, { chip: string; dot: string }> = {
  draft: { chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  published: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
};

const ARCHIVED_STYLE = { chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };

export function StatusChip({ status, archived = false }: { status: IconStatus; archived?: boolean }) {
  const style = archived ? ARCHIVED_STYLE : STATUS_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4', style.chip)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', style.dot)} />
      {archived ? 'Đã lưu trữ' : STATUS_LABELS[status]}
    </span>
  );
}

export function categoryLabel(category: IconCategory): string {
  return CATEGORY_LABELS[category];
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
    <Hint label={label}>
      <input
        aria-label={label}
        checked={checked}
        className={cn('size-4 cursor-pointer rounded border-slate-300 accent-blue-600', className)}
        onChange={(event) => onChange(event.target.checked)}
        ref={(node) => {
          if (node) node.indeterminate = Boolean(indeterminate) && !checked;
        }}
        type="checkbox"
      />
    </Hint>
  );
}
