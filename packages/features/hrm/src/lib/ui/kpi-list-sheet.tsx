'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';

/** Một dòng trong ngăn kéo liệt kê dữ liệu mà thẻ tổng quan đang tổng hợp. */
export interface KpiListItem {
  readonly id: string;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Nội dung bên phải dòng (trạng thái, số liệu). */
  readonly trailing?: ReactNode;
  /** Có thì dòng bấm được (mở chi tiết hoặc nhảy tới dữ liệu tương ứng). */
  readonly onSelect?: () => void;
}

/** Bao một thẻ tổng quan thành nút bấm được: hiện con trỏ, viền khi rê chuột và vòng focus bàn phím. */
export function KpiButton({
  onClick,
  label,
  testId,
  active = false,
  expanded,
  children,
}: {
  onClick: () => void;
  /** Mô tả cho trình đọc màn hình, ví dụ "Xem danh sách: Đi trễ". */
  label: string;
  testId?: string;
  active?: boolean;
  /** Thẻ sổ xuống một danh sách: trạng thái mở cho trình đọc màn hình. */
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={expanded === undefined ? active || undefined : undefined}
      aria-expanded={expanded}
      data-testid={testId}
      className={`block w-full min-w-0 cursor-pointer rounded-xl text-left transition hover:ring-2 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Ngăn kéo bên phải liệt kê dữ liệu mà một thẻ tổng quan đang tổng hợp. `action` là nút nhảy tới / lọc trang theo thẻ
 * (nếu trang có danh sách tương ứng); bấm một dòng thì gọi `onSelect` của dòng đó.
 */
export function KpiListSheet({
  open,
  onOpenChange,
  title,
  description,
  items,
  action,
  emptyText = 'Không có dữ liệu.',
  testId = 'kpi-list-sheet',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  items: readonly KpiListItem[];
  /** Nút cuối ngăn kéo: `onClick` lọc/cuộn trong trang, `href` mở trang tương ứng. */
  action?: { label: string; onClick?: () => void; href?: string };
  emptyText?: string;
  testId?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-testid={testId}
        className="flex h-full w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[560px]"
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>
            {title} ({items.length})
          </SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">{emptyText}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((item) => (
                <li key={item.id}>
                  {item.onSelect ? (
                    <button
                      type="button"
                      onClick={item.onSelect}
                      className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50"
                    >
                      <KpiItemBody item={item} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-5 py-2.5">
                      <KpiItemBody item={item} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {action ? (
          <div className="border-t border-slate-200 px-5 py-3">
            {action.href ? (
              <Link
                href={action.href}
                className="flex h-9 w-full items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {action.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className="h-9 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {action.label}
              </button>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function KpiItemBody({ item }: { item: KpiListItem }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{item.title}</span>
        {item.subtitle ? <span className="block truncate text-xs text-slate-500">{item.subtitle}</span> : null}
      </span>
      {item.trailing ? <span className="shrink-0 text-xs text-slate-600">{item.trailing}</span> : null}
    </>
  );
}
