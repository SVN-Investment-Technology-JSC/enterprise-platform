'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type { ReactNode } from 'react';
import { cn } from '../utils';
import { SELECT_CLASS } from './select-class';

export interface TablePagerBarProps {
  /** Phần chữ tóm tắt bên trái, ví dụ "Hiển thị 1–15 / 40 lịch". */
  readonly summary: ReactNode;
  readonly pageSize: number;
  readonly pageSizeOptions: readonly number[];
  readonly onPageSizeChange: (next: number) => void;
  readonly className?: string;
  /** Nút phân trang bên phải. */
  readonly children: ReactNode;
}

/** Chân bảng chuẩn: tóm tắt + chọn số dòng bên trái, nút phân trang bên phải. */
export function TablePagerBar({
  summary,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  className,
  children,
}: TablePagerBarProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 py-2.5 pl-4 pr-20 text-sm text-muted-foreground',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="[&_strong]:font-semibold [&_strong]:text-foreground">{summary}</span>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">Hiển thị:</span>
          <div className="w-[130px] shrink-0">
            <SearchableSelect
              className={SELECT_CLASS}
            height={36}
            searchInDropdown
            hideDropdownSearch
            clearable={false}
            value={String(pageSize)}
            options={pageSizeOptions.map((n) => ({ value: String(n), label: `${n} / trang` }))}
            onChange={(v) => {
              const n = Number(v);
              if (n > 0) onPageSizeChange(n);
            }}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
