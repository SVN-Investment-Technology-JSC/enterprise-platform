import * as React from 'react';
import { cn } from '../utils';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-[13.5px] leading-snug font-medium text-slate-700 select-none has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
