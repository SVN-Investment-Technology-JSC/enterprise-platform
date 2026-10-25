'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '../utils';

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

type PopoverContentProps = PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'anchor' | 'side' | 'align' | 'sideOffset' | 'alignOffset' | 'collisionPadding'>;

/**
 * Nội dung popover theo kiểu shadcn: dựng qua portal, bộ định vị (Floating UI) tự lật hướng, dịch để không tràn khung nhìn
 * và theo dõi neo khi cuộn hay đổi cỡ. `anchor` có thể là phần tử bất kỳ (ví dụ dấu `@` trong ô nhập), không bắt buộc là nút mở.
 */
function PopoverContent({
  className,
  anchor,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  alignOffset = 0,
  collisionPadding = 8,
  children,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        className="z-[1000]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn('outline-none', className)}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
