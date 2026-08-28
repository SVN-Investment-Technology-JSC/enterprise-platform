'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={cn('fixed inset-0 z-50 bg-slate-950/35 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs', className)} {...props} />;
}

function DialogContent({ className, children, showCloseButton = true, ...props }: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return <DialogPortal><DialogOverlay /><DialogPrimitive.Popup data-slot="dialog-content" className={cn('fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-popover text-sm text-popover-foreground shadow-xl outline-none transition duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0', className)} {...props}>{children}{showCloseButton ? <DialogPrimitive.Close data-slot="dialog-close" render={<Button aria-label="Đóng" className="absolute top-3 right-3" size="icon-sm" variant="ghost" />}><XIcon /><span className="sr-only">Đóng</span></DialogPrimitive.Close> : null}</DialogPrimitive.Popup></DialogPortal>;
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold text-foreground', className)} {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle };
