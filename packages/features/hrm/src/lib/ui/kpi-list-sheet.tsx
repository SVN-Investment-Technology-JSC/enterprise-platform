'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';

/** Một dòng trong ngăn kéo liệt kê dữ liệu mà thẻ tổng quan đang tổng hợp. */
export interface KpiListItem {
  readonly id: string;
  readonly title: ReactNode;
  /** Nội dung đầu dòng (ô ngày, avatar). */
  readonly leading?: ReactNode;
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
      className={`block h-full w-full min-w-0 cursor-pointer rounded-xl text-left transition hover:ring-2 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Danh sách sổ xuống ngay dưới thẻ tổng quan (cùng kiểu thẻ "Đơn của tôi" ở trang chủ): đặt trong phần tử `relative`
 * bao thẻ. Bấm một dòng thì gọi `onSelect` của dòng đó; việc đóng khi bấm ra ngoài do nơi dùng đảm nhiệm.
 */
export function KpiDropdownList({
  items,
  title,
  emptyText = 'Không có dữ liệu.',
  testId = 'kpi-dropdown-list',
  align = 'left',
  onClose,
}: {
  items: readonly KpiListItem[];
  title: string;
  emptyText?: string;
  testId?: string;
  /** Neo mép trái hoặc phải của thẻ; thẻ ở nửa phải màn hình nên neo phải để không tràn khỏi trang. */
  align?: 'left' | 'right';
  onClose?: () => void;
}) {
  return (
    <div
      data-testid={testId}
      role="region"
      aria-label={title}
      className={`absolute top-full z-30 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-slate-900/5 ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <p className="text-[13px] font-bold text-slate-900">{title}</p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng danh sách"
            className="rounded-md px-2 py-0.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-200/70"
          >
            Đóng
          </button>
        ) : null}
      </div>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-4 py-4 text-center text-xs text-slate-500">{emptyText}</li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              {item.onSelect ? (
                <button
                  type="button"
                  onClick={item.onSelect}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-blue-50/60"
                >
                  <KpiItemBody item={item} />
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <KpiItemBody item={item} />
                </div>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
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
      {item.leading ? <span className="shrink-0">{item.leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{item.title}</span>
        {item.subtitle ? <span className="block truncate text-xs text-slate-500">{item.subtitle}</span> : null}
      </span>
      {item.trailing ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
          {item.trailing}
        </span>
      ) : null}
    </>
  );
}
