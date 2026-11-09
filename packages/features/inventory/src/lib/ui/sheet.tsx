'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import * as React from 'react';
import { cn } from './cn';

/**
 * Ngăn kéo bên phải kiểu HRM (Base UI). Giống Dialog: luôn mở khi được render, không tự đóng khi bấm nền;
 * `onEscape` báo phím Esc để màn quyết định đóng hay hỏi lại. Muốn bấm nền để đóng thì truyền `onBackdropClick`.
 */
function Sheet({
  onEscape,
  onBackdropClick,
  onOpenChange,
  open = true,
  ...props
}: Omit<DialogPrimitive.Root.Props, 'onOpenChange'> & {
  onEscape?: () => void;
  onBackdropClick?: () => void;
  onOpenChange?: DialogPrimitive.Root.Props['onOpenChange'];
}) {
  return (
    <DialogPrimitive.Root
      data-slot="sheet"
      open={open}
      disablePointerDismissal={!onBackdropClick}
      onOpenChange={(next, details) => {
        onOpenChange?.(next, details);
        if (next) return;
        if (details.reason === 'escape-key') onEscape?.();
        else if (details.reason === 'outside-press') onBackdropClick?.();
      }}
      {...props}
    />
  );
}

function SheetClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-1000 bg-slate-950/40 backdrop-blur-xs transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-1000 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white text-slate-900 shadow-2xl outline-none transition-transform duration-300 ease-in-out data-ending-style:translate-x-full data-starting-style:translate-x-full',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 p-5', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn('text-base font-bold text-slate-900', className)} {...props} />;
}

function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="sheet-description" className={cn('text-xs text-slate-500', className)} {...props} />;
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-body" className={cn('min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3', className)}
      {...props}
    />
  );
}

export { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle };
