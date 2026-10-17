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

interface Options {
  /** Khoá localStorage để nhớ độ rộng giữa các lần mở. */
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  /** Phần tối thiểu phải chừa cho cột còn lại trong khung chứa (px). */
  reserve?: number;
  /** Bước khi dùng phím mũi tên (px). */
  step?: number;
  /** Biến CSS trên khung chứa mang độ rộng; khi kéo được ghi thẳng vào DOM để không render lại cả màn hình. */
  cssVar: string;
}

/**
 * Độ rộng cột kéo thả được: kéo thanh chia (chuột/cảm ứng), phím mũi tên khi thanh được focus,
 * nhấp đúp hoặc Home để về mặc định. Giá trị được kẹp trong [min, max] và không vượt khung chứa.
 */
export function useResizableWidth(
  container: RefObject<HTMLElement | null>,
  { storageKey, initial, min, max, reserve = 480, step = 16, cssVar }: Options,
) {
  const [width, setWidth] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const live = useRef(initial);
  const frame = useRef(0);

  const clamp = useCallback(
    (value: number) => {
      const room = container.current?.clientWidth;
      const upper = room ? Math.min(max, Math.max(min, room - reserve)) : max;
      return Math.round(Math.min(upper, Math.max(min, value)));
    },
    [container, max, min, reserve],
  );

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) setWidth(clamp(saved));
    } catch {
      // localStorage không dùng được (chế độ riêng tư...): giữ mặc định.
    }
  }, [clamp, storageKey]);

  const persist = useCallback(
    (value: number) => {
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // bỏ qua
      }
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    const next = clamp(initial);
    setWidth(next);
    persist(next);
  }, [clamp, initial, persist]);

  const handleProps = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': width,
    tabIndex: 0,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Con trỏ không còn hoạt động (sự kiện giả lập): vẫn cho kéo theo toạ độ.
      }
      start.current = { x: event.clientX, width };
      live.current = width;
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!start.current) return;
      // Đang kéo: chỉ đổi biến CSS (mỗi khung hình một lần), không setState nên cây React và sơ đồ không bị render lại liên tục.
      live.current = clamp(start.current.width + event.clientX - start.current.x);
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        container.current?.style.setProperty(cssVar, `${live.current}px`);
      });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!start.current) return;
      const next = clamp(start.current.width + event.clientX - start.current.x);
      start.current = null;
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      setDragging(false);
      setWidth(next);
      persist(next);
    },
    onPointerCancel: () => {
      start.current = null;
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      // Huỷ kéo: trả biến CSS về giá trị đang lưu trong state.
      container.current?.style.setProperty(cssVar, `${width}px`);
      setDragging(false);
    },
    onDoubleClick: reset,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Home') {
        event.preventDefault();
        reset();
        return;
      }
      const delta =
        event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      if (!delta) return;
      event.preventDefault();
      const next = clamp(width + delta);
      setWidth(next);
      persist(next);
    },
  };

  return { width, dragging, handleProps };
}
