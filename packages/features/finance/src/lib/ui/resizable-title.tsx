'use client';

import { useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ThHTMLAttributes } from 'react';

export interface ResizableTitleProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Bề ngang hiện tại (px); vắng thì ô tiêu đề không kéo được (cột ô chọn). */
  width?: number;
  minWidth?: number;
  /** Mã cột, để kiểm thử, để nhận biết tay kéo và cột đang kéo thả. */
  resizeKey?: string;
  onResize?: (width: number) => void;
  /** Thả cột `from` lên cột này: đổi thứ tự cột. Vắng thì ô tiêu đề không kéo thả được. */
  onReorder?: (from: string, to: string) => void;
}

/** Kiểu dữ liệu riêng của thao tác kéo cột, để không nhận nhầm khi người dùng kéo chữ hay tệp vào bảng. */
const DRAG_TYPE = 'application/x-finance-column';

/**
 * Ô tiêu đề bảng antd:
 * - kéo MÉP PHẢI để đổi bề ngang cột (thay cho `react-resizable`, không thêm thư viện): bề ngang mới = bề ngang lúc bấm + quãng
 *   chuột đã đi, không nhỏ hơn `minWidth`;
 * - kéo CẢ Ô TIÊU ĐỀ thả lên cột khác để đổi thứ tự cột (kéo thả HTML5).
 * Bấm vào tay kéo không kích hoạt sắp xếp của cột.
 */
export function ResizableTitle({ width, minWidth = 60, resizeKey, onResize, onReorder, children, style, className, ...rest }: ResizableTitleProps) {
  const [dropTarget, setDropTarget] = useState(false);
  if (!onResize || typeof width !== 'number') {
    return (
      <th style={style} className={className} {...rest}>
        {children}
      </th>
    );
  }
  const start = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: MouseEvent) => onResize(Math.max(minWidth, Math.round(startWidth + moveEvent.clientX - startX)));
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      document.body.style.removeProperty('cursor');
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };
  const reorderable = Boolean(onReorder && resizeKey);
  const isColumnDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DRAG_TYPE);
  return (
    <th
      style={{ ...style, position: 'relative', ...(reorderable ? { cursor: 'grab' } : {}) }}
      className={[className, dropTarget ? 'shadow-[inset_2px_0_0_0_#2563eb]' : ''].filter(Boolean).join(' ')}
      {...rest}
      {...(reorderable
        ? {
            draggable: true,
            title: rest.title ?? 'Kéo để đổi vị trí cột',
            onDragStart: (event: DragEvent<HTMLTableCellElement>) => {
              event.dataTransfer.setData(DRAG_TYPE, resizeKey as string);
              event.dataTransfer.effectAllowed = 'move';
            },
            onDragOver: (event: DragEvent<HTMLTableCellElement>) => {
              if (!isColumnDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (!dropTarget) setDropTarget(true);
            },
            onDragLeave: () => setDropTarget(false),
            onDrop: (event: DragEvent<HTMLTableCellElement>) => {
              setDropTarget(false);
              const from = event.dataTransfer.getData(DRAG_TYPE);
              if (!from) return;
              event.preventDefault();
              if (from !== resizeKey) onReorder?.(from, resizeKey as string);
            },
          }
        : {})}
    >
      {children}
      <span
        aria-hidden
        data-column-resize={resizeKey}
        // Tay kéo bề ngang không được kích hoạt kéo thả cột.
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={start}
        onClick={(event) => event.stopPropagation()}
        // Vạch mờ luôn hiện ở mép phải để người dùng biết kéo được; rê chuột vào thì tô đậm cả tay kéo.
        className="absolute top-0 right-0 z-[1] h-full w-2 cursor-col-resize select-none after:absolute after:top-1/4 after:right-[3px] after:h-1/2 after:w-px after:bg-slate-300 hover:bg-slate-300/60"
      />
    </th>
  );
}
