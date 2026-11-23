'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { cn } from '../utils';

/** Thanh tiến độ theo shadcn/ui (Base UI): `value` là phần trăm 0-100; `indicatorClassName` đổi màu phần đã xong. */
function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: ProgressPrimitive.Root.Props & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root value={value} data-slot="progress" className={cn('flex w-full', className)} {...props}>
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className="relative flex h-1.5 w-full items-center overflow-hidden rounded-full bg-border"
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn('h-full rounded-full bg-primary transition-all duration-200', indicatorClassName)}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
