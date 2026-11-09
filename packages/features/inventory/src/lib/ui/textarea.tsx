import * as React from 'react';
import { cn } from './cn';

/** Ô nhập nhiều dòng, cùng dáng với Input (HRM). */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-16 w-full min-w-0 resize-y rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
