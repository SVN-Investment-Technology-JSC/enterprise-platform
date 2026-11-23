'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../utils';

function TooltipProvider({
  delay = 150,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & {
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        className="z-[100]"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'z-[100] max-w-xs rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-normal leading-relaxed text-white shadow-md transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/**
 * Gắn tooltip shadcn/ui (Base UI) vào đúng MỘT phần tử, dùng thay cho thuộc tính `title` của trình duyệt: hiện đồng
 * bộ, theo bàn phím (focus) và không bị khung cuộn che nhờ cổng (portal). `content` rỗng thì không có tooltip. Nút
 * đang `disabled` không nhận chuột nên muốn có tooltip phải bọc trong một `<span>`.
 */
function Tip({
  content,
  side = 'top',
  children,
}: {
  readonly content: ReactNode;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly children: ReactElement;
}) {
  if (!content) return children;
  return (
    <TooltipProvider delay={250}>
      <Tooltip>
        <TooltipTrigger render={children} />
        <TooltipContent
          side={side}
          // Popup nằm trong portal nhưng sự kiện React vẫn nổi bọt lên phần tử cha: chặn để bấm vào chú thích không
          // kích hoạt nút bọc ngoài (ví dụ Popconfirm).
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Tip };
