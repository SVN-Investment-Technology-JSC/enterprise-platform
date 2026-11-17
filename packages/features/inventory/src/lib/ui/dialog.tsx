'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { Button } from './button';
import { cn } from './cn';

/**
 * Hộp thoại kiểu HRM, dựa trên Base UI (có sẵn khoá focus, khoá cuộn nền, aria-modal).
 *
 * Các form của Kho được hiển thị có điều kiện (`{open && <Form/>}`) và tự lo việc hỏi xác nhận khi đóng
 * (`CloseGuard`), nên hộp thoại luôn ở trạng thái mở và KHÔNG tự đóng khi bấm nền. Phím Esc chỉ báo lên
 * `onEscape` (nếu có) để form quyết định đóng hay hỏi lại.
 */
function Dialog({
  onEscape,
  onOpenChange,
  open = true,
  ...props
}: Omit<DialogPrimitive.Root.Props, 'onOpenChange'> & {
  onEscape?: () => void;
  onOpenChange?: DialogPrimitive.Root.Props['onOpenChange'];
}) {
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        onOpenChange?.(next, details);
        if (!next && details.reason === 'escape-key') onEscape?.();
      }}
      {...props}
    />
  );
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  className,
  backdropClassName,
  children,
  ...props
}: DialogPrimitive.Popup.Props & { backdropClassName?: string }) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className={cn(
          'fixed inset-0 z-1000 bg-slate-950/55 backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0',
          backdropClassName,
        )}
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-1000 flex max-h-[calc(100vh-4rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-sm text-slate-900 shadow-2xl outline-none transition duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/** Đầu hộp thoại: tiêu đề bên trái, nút đóng (bọc CloseGuard nếu cần) bên phải. */
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('flex items-center gap-2 text-base font-bold text-slate-900', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-xs text-slate-500', className)} {...props} />;
}

function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3', className)}
      {...props}
    />
  );
}

/** Nút X của đầu hộp thoại. Dùng làm con của CloseGuard (CloseGuard gắn onClick) hoặc truyền onClick trực tiếp. */
function DialogCloseButton({ className, ...props }: Omit<React.ComponentProps<typeof Button>, 'children'>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title="Đóng"
      aria-label="Đóng"
      className={cn('text-slate-400 hover:text-slate-700', className)}
      {...props}
    >
      <X size={18} />
    </Button>
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
};
