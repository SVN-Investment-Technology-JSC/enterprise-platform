'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

const STORAGE_KEY = 'organization.treeColumnWidth';
const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

export interface ResizableColumnOptions {
  /** Độ rộng mặc định (px). */
  defaultWidth: number;
  /** Giới hạn nhỏ nhất (px). */
  minWidth: number;
  /** Giới hạn lớn nhất (px), còn bị kẹp theo bề rộng khung chứa. */
  maxWidth: number;
  /** Bề rộng tối thiểu phải chừa cho các cột còn lại (canvas, thuộc tính node) và khoảng cách giữa cột. */
  reservedWidth: number;
  /** Khung chứa, dùng để kẹp độ rộng không vượt quá chỗ còn lại. */
  containerRef: RefObject<HTMLElement | null>;
}

function readStored(min: number, max: number, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Độ rộng (px) của một cột có thể kéo thả theo chiều ngang. Giá trị được nhớ trong trình duyệt của người dùng;
 * thiếu hoặc không đọc được thì dùng mặc định.
 */
export function useResizableColumn({
  defaultWidth,
  minWidth,
  maxWidth,
  reservedWidth,
  containerRef,
}: ResizableColumnOptions) {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setWidth(readStored(minWidth, maxWidth, defaultWidth));
  }, [defaultWidth, minWidth, maxWidth]);

  /** Giới hạn lớn nhất hiện tại: không để cột chiếm hết chỗ của canvas và cột thuộc tính. */
  const limit = useCallback(() => {
    const total = containerRef.current?.getBoundingClientRect().width ?? 0;
    const room = total > 0 ? total - reservedWidth : maxWidth;
    return Math.max(minWidth, Math.min(maxWidth, Math.floor(room)));
  }, [containerRef, maxWidth, minWidth, reservedWidth]);

  const clamp = useCallback(
    (value: number) => Math.min(limit(), Math.max(minWidth, Math.round(value))),
    [limit, minWidth],
  );

  const persist = useCallback((value: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* trình duyệt chặn lưu trữ: bỏ qua, độ rộng chỉ giữ trong phiên */
    }
  }, []);

  // Giới hạn lớn nhất hiện tại, giữ trong state để hiển thị (aria-valuemax) mà không đọc DOM lúc render.
  const [maxNow, setMaxNow] = useState(maxWidth);

  // Cửa sổ thu hẹp (hoặc cột thuộc tính mở ra) thì kẹp lại để cột không đè lên canvas.
  useEffect(() => {
    const sync = () => {
      setMaxNow(limit());
      setWidth((current) => clamp(current));
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [clamp, limit]);

  const startX = useRef(0);
  const startWidth = useRef(0);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startX.current = event.clientX;
    startWidth.current = width;
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    setWidth(clamp(startWidth.current + event.clientX - startX.current));
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    persist(width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width - step;
    else if (event.key === 'ArrowRight') next = width + step;
    else if (event.key === 'Home') next = minWidth;
    else if (event.key === 'End') next = limit();
    else if (event.key === 'Enter') next = defaultWidth;
    if (next === null) return;
    event.preventDefault();
    const value = clamp(next);
    setWidth(value);
    persist(value);
  };

  return {
    width,
    dragging,
    max: maxNow,
    reset: () => {
      setWidth(defaultWidth);
      persist(defaultWidth);
    },
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  };
}

/**
 * Thanh kéo đặt ở mép phải của cột: kéo chuột hoặc dùng phím mũi tên trái/phải (giữ Shift để nhảy nhanh), Home và End
 * về nhỏ nhất và lớn nhất, nhấp đúp hoặc Enter để về mặc định. Chỉ hiện ở màn rộng, nơi các cột nằm ngang hàng.
 */
export function ColumnResizeHandle({
  width,
  min,
  max,
  dragging,
  label,
  onReset,
  handleProps,
}: {
  width: number;
  min: number;
  max: number;
  dragging: boolean;
  label: string;
  onReset: () => void;
  handleProps: ReturnType<typeof useResizableColumn>['handleProps'];
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Kéo để đổi độ rộng, nhấp đúp để về mặc định"
      data-testid="org-tree-resize-handle"
      onDoubleClick={onReset}
      {...handleProps}
      className="group absolute -right-3 top-0 z-10 hidden h-full w-3 cursor-col-resize touch-none select-none items-center justify-center outline-none xl:flex"
    >
      <span
        aria-hidden="true"
        className={`h-12 w-1 rounded-full transition-colors group-hover:bg-[#ffc90a] group-focus-visible:bg-[#ffc90a] ${
          dragging ? 'bg-[#ffc90a]' : 'bg-slate-300'
        }`}
      />
    </div>
  );
}
