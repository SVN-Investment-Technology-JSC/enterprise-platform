'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from '../utils';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** Giải thích hậu quả của hành động. */
  readonly description?: ReactNode;
  /** Nội dung thêm giữa phần giải thích và chân hộp thoại, ví dụ danh sách mục sẽ bị tác động. */
  readonly children?: ReactNode;
  readonly confirmText: string;
  readonly cancelText?: string;
  /** Hành động nguy hiểm (gỡ, xoá): nút xác nhận màu đỏ. */
  readonly destructive?: boolean;
  /** Đang xử lý: khoá nút, không cho đóng giữa chừng. */
  readonly busy?: boolean;
  readonly onConfirm: () => void;
}

/**
 * Hộp thoại xác nhận theo mẫu Dialog của shadcn/ui (Base UI + Tailwind): nền mờ, bấm ra ngoài hoặc nhấn Esc thì đóng,
 * hai nút Huỷ / Xác nhận ở chân. Dùng thay cho Popconfirm khi hành động ảnh hưởng nhiều mục cùng lúc.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmText,
  cancelText = 'Huỷ',
  destructive = false,
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[9998] bg-black/45 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-[9999] flex max-h-[85vh] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-white p-6 shadow-xl outline-none transition-all duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="m-0 text-lg font-bold leading-snug text-slate-900">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="m-0 mt-1.5 text-sm leading-relaxed text-slate-600">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Đóng"
              disabled={busy}
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          {children}

          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="rounded-md px-4"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {cancelText}
            </Button>
            <Button
              type="button"
              size="lg"
              className={cn(
                'rounded-md px-4 font-semibold',
                destructive && 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-200',
              )}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? 'Đang xử lý…' : confirmText}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
