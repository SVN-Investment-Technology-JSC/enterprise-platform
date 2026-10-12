'use client';

import type { ReactNode } from 'react';
import { HubTabsSlot } from './hrm-tab-hub';

/**
 * Đầu trang kiểu mới: tên trang và mô tả bên trái, nhãn trạng thái (`badge`) và nút thao tác (`actions`) bên phải;
 * `withTabs` đặt thanh tab của trang gộp (nếu có) ngay dưới tiêu đề, ngăn cách bằng đường kẻ.
 * Màn hẹp: khối bên phải tự xuống dưới tiêu đề (không bị ép nhỏ hay tràn).
 */
export function PageTitle({
  title,
  description,
  badge,
  actions,
  withTabs = false,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  withTabs?: boolean;
}) {
  return (
    <header className="shrink-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {description ? <p className="mt-0.5 max-w-[90ch] text-xs text-slate-500">{description}</p> : null}
        </div>
        {badge || actions ? (
          <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 pt-1">
            {badge}
            {actions}
          </div>
        ) : null}
      </div>
      {withTabs ? (
        <div className="border-b border-slate-200">
          <HubTabsSlot />
        </div>
      ) : null}
    </header>
  );
}
