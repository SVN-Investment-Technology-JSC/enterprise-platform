'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Khung bên phải của các trang Tenant Portal (sửa người dùng, gán vai trò, hồ
 * sơ nhân sự…): nằm cạnh danh sách thay cho hộp thoại hay ngăn kéo, nên vẫn
 * thấy dòng đang thao tác.
 *
 * Màn rộng thì bám đầu vùng cuộn và tự cuộn bên trong; màn hẹp thì rơi xuống
 * dưới danh sách, nên mỗi lần mở (đổi `revealKey`) khung tự cuộn vào tầm nhìn.
 */
export function SidePanel({
  ariaLabel,
  title,
  subtitle,
  icon,
  revealKey,
  onClose,
  footer,
  children,
}: {
  ariaLabel?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Ô biểu tượng bên trái tiêu đề. */
  icon?: ReactNode;
  /** Đổi giá trị này (ví dụ id bản ghi) thì khung cuộn lại vào tầm nhìn. */
  revealKey?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealKey]);

  return (
    <aside
      ref={ref}
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className="flex max-w-full flex-[1_1_360px] scroll-mt-4 flex-col self-start overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white text-[12.5px] lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)]"
    >
      <div className="flex shrink-0 items-start gap-2.5 border-b border-[#eef0f3] bg-[#fafbfc] px-[18px] py-3.5">
        {icon ? (
          <span
            aria-hidden
            className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-[#fff6d6] text-[#8a6400]"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[15px] font-bold text-[#18181b]">{title}</h2>
          {subtitle ? <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          title="Đóng"
          className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-[7px] border border-[#eef0f3] bg-white text-slate-600 hover:bg-[#f4f6f9]"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">{children}</div>
      {footer ? (
        <div className="flex shrink-0 justify-end gap-2 border-t border-[#eef0f3] px-[18px] py-3">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}

/** Nút phụ và nút chính ở chân khung, cùng cỡ với các trang khác. */
export const panelButton = {
  secondary:
    'h-9 cursor-pointer rounded-lg border border-[#eef0f3] bg-white px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:opacity-60',
  primary:
    'h-9 cursor-pointer rounded-lg bg-[#18181b] px-3.5 text-[13px] font-semibold text-white hover:bg-[#2a2a2f] disabled:cursor-not-allowed disabled:opacity-60',
};
