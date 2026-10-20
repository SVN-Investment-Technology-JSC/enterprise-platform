'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-slate-600 transition-colors outline-none ' +
  'hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-40';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'aria-label' | 'aria-pressed'> {
  /** Tên hành động; vừa là chú thích khi rê chuột vừa là nhãn cho trình đọc màn hình. */
  readonly label: string;
  /** Phím tắt, hiện trong chú thích. */
  readonly shortcut?: string;
  /** Có giá trị thì nút là công tắc (bật/tắt). */
  readonly pressed?: boolean;
  readonly size?: 'sm' | 'md';
  readonly children: ReactNode;
}

/** Nút chỉ có biểu tượng kèm chú thích; công tắc đang bật có nền xanh nhạt. */
export function IconButton({ label, shortcut, pressed, size = 'md', className = '', children, type = 'button', ...rest }: IconButtonProps) {
  const dimension = size === 'sm' ? 'size-7' : 'size-8';
  const state = pressed ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-700' : '';
  return (
    <button
      type={type}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={pressed}
      className={`${BASE} ${dimension} ${state} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Đường kẻ dọc mảnh ngăn các nhóm nút trên thanh ngang. */
export function VerticalRule() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;
}
