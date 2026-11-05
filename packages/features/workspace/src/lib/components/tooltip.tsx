'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';
import styles from '../workspace.module.scss';

/** Chờ rê chuột chừng này (ms) mới hiện, để lướt qua không nháy tooltip liên tục. */
const OPEN_DELAY_MS = 250;

export interface TooltipProps {
  /** Nội dung chú thích; rỗng thì không có tooltip. */
  readonly content: ReactNode;
  /** Đúng MỘT phần tử (nút, vạch kéo…) để gắn tooltip; nó giữ nguyên vai trò và thuộc tính của mình. */
  readonly children: ReactElement;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly align?: 'start' | 'center' | 'end';
}

/**
 * Tooltip theo mẫu shadcn/ui (nền tối, chữ trắng nhỏ, bo 6px, mờ dần khi hiện và ẩn), dựng trên Base UI như bộ
 * shadcn của dự án nhưng bằng SCSS vì Workspace không chạy Tailwind. Dùng thay cho thuộc tính `title` của trình duyệt:
 * hiện đồng bộ, theo bàn phím (focus) và không bị che bởi khung cuộn nhờ cổng (portal) ra ngoài `body`.
 */
export function Tooltip({ content, children, side = 'top', align = 'center' }: TooltipProps) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Provider delay={OPEN_DELAY_MS}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={children} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} align={align} sideOffset={6} className={styles.tooltipPositioner}>
            <TooltipPrimitive.Popup className={styles.tooltipPopup}>{content}</TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
