'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '../utils';

/** Ô tích theo shadcn/ui (Base UI). Màu "đã tích" là xanh thành công của khung ModuleShell, khớp thanh tiến độ. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-input bg-background outline-none transition-colors hover:border-success focus-visible:border-success focus-visible:ring-3 focus-visible:ring-success/25 data-checked:border-success data-checked:bg-success data-checked:text-white disabled:cursor-default disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
