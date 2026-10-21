import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Nút nổi nhẹ: viền, bóng mỏng và nhích lên khi rê chuột. */
export const RAISED =
  'rounded-md border-slate-300 bg-white text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all hover:-translate-y-px hover:bg-white hover:shadow-md active:translate-y-0 active:shadow-sm';

/** Nút chính màu xanh, nổi bằng bóng đổ xanh. */
export const RAISED_PRIMARY =
  'rounded-md bg-blue-600 px-3 text-white shadow-md shadow-blue-600/25 transition-all hover:-translate-y-px hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 active:translate-y-0 active:shadow-sm';

/** Một khối lớn của trang: có tiêu đề, mô tả ngắn và nền riêng để tách rõ với các khối khác. */
export function Panel({
  id,
  icon: Icon,
  title,
  hint,
  actions,
  flush = false,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: ReactNode;
  hint: string;
  /** Phần bên phải thanh tiêu đề (nút, bộ đếm...). */
  actions?: ReactNode;
  /** Bỏ đệm quanh nội dung, dùng cho bảng sát mép khối. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900" id={id}>
            {title}
          </h2>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn(!flush && 'px-5 py-4')}>{children}</div>
    </section>
  );
}
