'use client';

import type { FormEvent, ReactNode } from 'react';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Một trường trong hộp thoại: nhãn, ô nhập, gợi ý ngắn bên dưới. */
export function SlotField({
  label,
  htmlFor,
  required,
  hint,
  action,
  footnote,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  /** Nút nhỏ cạnh nhãn (vd: Khôi phục mặc định của trường). */
  action?: ReactNode;
  /** Dòng ghi chú thêm dưới ô nhập (vd: giá trị mặc định trong code). */
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-700" htmlFor={htmlFor}>
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </label>
        {action}
      </div>
      {children}
      {footnote}
      {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </div>
  );
}

/**
 * Khung chung cho các hộp thoại của trang: đầu hộp (biểu tượng, tiêu đề, mô tả) có nền riêng, thân cuộn riêng khi dài,
 * chân hộp (nút Huỷ và nút chính) có nền riêng và đường kẻ. Có `onSubmit` thì thân và chân nằm trong một form.
 */
export function SlotDialogFrame({
  title,
  description,
  error,
  footer,
  onSubmit,
  children,
}: {
  title: string;
  description: ReactNode;
  error?: string | null;
  footer: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const content = (
    <>
      <DialogHeader className="border-b border-slate-200 bg-slate-50 py-4 pl-6 pr-14">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[calc(100vh-16rem)] flex-col gap-4 overflow-y-auto px-6 py-5">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700" role="alert">
            {error}
          </div>
        ) : null}
        {children}
      </div>

      <DialogFooter className="flex-row justify-end border-t border-slate-200 bg-slate-50 px-6 py-3">{footer}</DialogFooter>
    </>
  );

  return onSubmit ? (
    <form className="flex min-h-0 flex-col" onSubmit={onSubmit}>
      {content}
    </form>
  ) : (
    content
  );
}
