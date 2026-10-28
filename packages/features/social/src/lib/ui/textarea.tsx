import * as React from 'react';
import { cn } from '../utils';

/** Ô nhập nhiều dòng theo kiểu shadcn: cùng viền, bo, vòng focus với `Input`. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-14 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[13.5px] leading-normal transition-colors outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
