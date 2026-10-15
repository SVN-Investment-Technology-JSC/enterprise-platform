'use client';

import type { ReactNode } from 'react';
import { cn } from '../../utils';

/**
 * Bảng co giãn theo bề rộng khung chứa (container query của màn hình): từ `@2xl` là bảng thường, hẹp hơn thì mỗi dòng
 * thành một thẻ, mỗi ô hiện "nhãn cột: giá trị". Cùng một cây DOM (không vẽ hai lần), nên trình đọc màn hình và kiểm thử
 * chỉ thấy một bản.
 */
export function ResponsiveTable({
  columns,
  children,
  className,
  loading,
  label,
}: {
  columns: readonly string[];
  children: ReactNode;
  className?: string;
  loading?: boolean;
  label?: string;
}) {
  return (
    <table
      aria-label={label}
      className={cn('block w-full text-xs @2xl:table @2xl:border-separate @2xl:border-spacing-0', loading && 'opacity-60', className)}
    >
      <thead className="hidden @2xl:table-header-group">
        <tr className="text-left text-[12px] font-bold text-slate-600">
          {columns.map((name) => (
            <th key={name} scope="col" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="block space-y-2 @2xl:table-row-group @2xl:space-y-0">{children}</tbody>
    </table>
  );
}

export function RRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={cn(
        'block rounded-lg border border-slate-200 bg-white p-3 @2xl:table-row @2xl:rounded-none @2xl:border-0 @2xl:bg-transparent @2xl:p-0 @2xl:hover:bg-slate-50',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function RCell({
  label,
  children,
  className,
}: {
  /** Nhãn cột, hiện ở dạng thẻ (hẹp). */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <td
      data-label={label}
      className={cn(
        'flex min-w-0 items-baseline justify-between gap-3 py-1 before:shrink-0 before:text-[12px] before:text-slate-500 before:content-[attr(data-label)] @2xl:table-cell @2xl:border-b @2xl:border-slate-100 @2xl:px-3 @2xl:py-2 @2xl:before:hidden',
        className,
      )}
    >
      {children}
    </td>
  );
}
