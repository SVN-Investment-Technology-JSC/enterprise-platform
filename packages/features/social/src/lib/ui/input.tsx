import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '../utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
