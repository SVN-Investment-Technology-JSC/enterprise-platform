import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export interface PageBreadcrumbItem {
  readonly label: string;
  /** Có `href` thì là lối tắt bấm được; vắng là nhóm hoặc trang không có đường dẫn riêng. */
  readonly href?: string;
}

/**
 * Breadcrumb đầu trang của Tenant Portal và Platform.
 *
 * Cùng quy ước với breadcrumb của các module: cấp bấm được màu xanh chủ đạo
 * (`blue-600`), rê chuột có nền xanh nhạt và gạch chân; cấp cuối là trang
 * đang đứng nên chỉ là chữ đậm. Mục không có `href` (ví dụ nhóm "Quản trị")
 * giữ màu xám để không bị nhầm là link.
 */
export function PageBreadcrumb({
  items,
  className,
}: {
  items: readonly PageBreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex flex-wrap items-center gap-0.5 text-xs text-slate-500 sm:text-sm', className)}
    >
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <Fragment key={`${index}-${item.label}`}>
            {last ? (
              <span aria-current="page" className="font-semibold text-slate-900">
                {item.label}
              </span>
            ) : item.href ? (
              <Link
                href={item.href}
                className="-mx-0.5 rounded px-1 py-0.5 font-semibold text-blue-600 underline-offset-2 transition-colors hover:bg-blue-50 hover:text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {item.label}
              </Link>
            ) : (
              <span>{item.label}</span>
            )}
            {last ? null : <ChevronRight aria-hidden className="mx-0.5 size-3.5 text-slate-300" />}
          </Fragment>
        );
      })}
    </nav>
  );
}
