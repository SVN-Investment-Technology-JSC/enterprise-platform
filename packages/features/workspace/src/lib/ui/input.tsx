import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '../utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-[13px] transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-secondary disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
