import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
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
  toolbar,
  actions,
  flush = false,
  fill = false,
  sectionRef,
  bodyRef,
  footer,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: ReactNode;
  hint: string;
  /**
   * Thanh thao tác nằm giữa tiêu đề và `actions` (ví dụ thao tác hàng loạt khi đang chọn). Nằm ngay trong thanh tiêu đề nên hiện
   * hay ẩn không làm trang nhảy; thanh tự co khi hẹp (nhãn nút nên ẩn bằng `max-xl:sr-only`).
   */
  toolbar?: ReactNode;
  /** Phần bên phải thanh tiêu đề (nút, bộ đếm...). */
  actions?: ReactNode;
  /** Bỏ đệm quanh nội dung, dùng cho bảng sát mép khối. */
  flush?: boolean;
  /**
   * Khối có chiều cao do nơi dùng đặt (xem `useFillViewportHeight`): tiêu đề và `footer` đứng yên, chỉ phần nội dung cuộn
   * khi dài hơn khối.
   */
  fill?: boolean;
  sectionRef?: Ref<HTMLElement>;
  /** Phần tử cuộn của nội dung (chỉ có tác dụng khi `fill`). */
  bodyRef?: Ref<HTMLDivElement>;
  /** Chân khối (thanh phân trang...), nằm ngoài vùng cuộn. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm', fill && 'flex flex-col')}
      ref={sectionRef}
    >
      <header className={cn('flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5', fill && 'shrink-0')}>
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className={cn('min-w-0', toolbar ? 'shrink-0' : 'flex-1')}>
          <h2 className="text-sm font-semibold text-slate-900" id={id}>
            {title}
          </h2>
          <p className={cn('truncate text-xs text-slate-500', toolbar && 'max-xl:hidden')}>{hint}</p>
        </div>
        {toolbar ? <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{toolbar}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn(!flush && 'px-5 py-4', fill && 'min-h-0 flex-1 overflow-y-auto')} ref={bodyRef}>
        {children}
      </div>
      {footer}
    </section>
  );
}
