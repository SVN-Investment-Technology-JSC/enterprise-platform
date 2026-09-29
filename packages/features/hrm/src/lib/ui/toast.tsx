'use client';

import * as React from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import {
  CheckCircle2,
  CircleAlert,
  Info,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '../utils';

const baseToast = ToastPrimitive.createToastManager();

export type ToastInput =
  | string
  | {
      title?: React.ReactNode;
      description?: React.ReactNode;
      [key: string]: unknown;
    };

function normalizeOptions(input: ToastInput, type?: string) {
  if (typeof input === 'string') {
    return { title: input, type };
  }
  return { ...input, type: type ?? (input.type as string | undefined) };
}

const toast = Object.assign(baseToast, {
  success: (input: ToastInput) =>
    baseToast.add(normalizeOptions(input, 'success')),
  error: (input: ToastInput) =>
    baseToast.add(normalizeOptions(input, 'error')),
  info: (input: ToastInput) =>
    baseToast.add(normalizeOptions(input, 'info')),
  warning: (input: ToastInput) =>
    baseToast.add(normalizeOptions(input, 'warning')),
  loading: (input: ToastInput) =>
    baseToast.add(normalizeOptions(input, 'loading')),
});

function ToastViewport({
  className,
  ...props
}: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        'pointer-events-none fixed inset-x-4 top-4 z-50 mx-auto flex w-auto max-w-sm flex-col gap-3 outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full',
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      className={cn(
        'pointer-events-auto w-full rounded-xl border border-slate-200 bg-white text-slate-950 shadow-lg outline-none transition data-[ending-style]:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({
  className,
  ...props
}: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      className={cn('flex items-center gap-3 p-4', className)}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      className={cn('text-xs text-slate-500', className)}
      {...props}
    />
  );
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      aria-label="Đóng thông báo"
      className={cn(
        'ml-auto shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <X className="size-4" />
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  const className = 'size-5 shrink-0';
  if (type === 'success')
    return <CheckCircle2 className={`${className} text-emerald-600`} />;
  if (type === 'error')
    return <XCircle className={`${className} text-red-600`} />;
  if (type === 'loading')
    return <Loader2 className={`${className} animate-spin text-blue-600`} />;
  if (type === 'warning')
    return <CircleAlert className={`${className} text-amber-600`} />;
  return <Info className={`${className} text-blue-600`} />;
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((item) => (
    <Toast key={item.id} toast={item}>
      <ToastContent>
        <ToastIcon type={item.type} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastClose />
      </ToastContent>
    </Toast>
  ));
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} {...props}>
      {children}
      <ToastPrimitive.Portal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

export { Toaster, toast };
