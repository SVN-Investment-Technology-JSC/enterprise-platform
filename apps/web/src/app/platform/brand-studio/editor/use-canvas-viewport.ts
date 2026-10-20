'use client';

import { clampZoom, fitViewport, zoomAt, type Point, type Viewport } from '@enterprise-platform/shared-brand-icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { wheelZoomFactor } from './interactions';

export interface CanvasViewport {
  readonly view: Viewport;
  /** Kích thước vùng canvas (pixel). Bằng 0 khi chưa đo được. */
  readonly width: number;
  readonly height: number;
  /** Gán vào phần tử bao canvas: hook đo kích thước và bắt sự kiện cuộn chuột trên đó. */
  readonly containerRef: (element: HTMLDivElement | null) => void;
  readonly setView: (next: Viewport | ((previous: Viewport) => Viewport)) => void;
  /** Phóng to/thu nhỏ theo hệ số, quanh `anchor` (toạ độ trong vùng canvas) hoặc tâm vùng nếu bỏ trống. */
  readonly zoomBy: (factor: number, anchor?: Point) => void;
  readonly fit: () => void;
  /** Số hiển thị: 100% là một pixel màn hình cho một đơn vị lưới. */
  readonly percent: number;
}

const INITIAL_VIEW: Viewport = { zoom: 16, panX: 0, panY: 0 };
const BUTTON_ZOOM_STEP = 1.25;

/**
 * Khung nhìn của canvas: tự vừa khung lần đầu có kích thước, giữ tâm khi vùng canvas đổi cỡ,
 * cuộn chuột để phóng to/thu nhỏ quanh con trỏ, và vừa khung lại khi đổi cạnh lưới.
 */
export function useCanvasViewport(docSize: number): CanvasViewport {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>(INITIAL_VIEW);
  const boxRef = useRef(box);
  const sizeRef = useRef(docSize);
  const fitted = useRef(false);

  useEffect(() => {
    sizeRef.current = docSize;
    const { width, height } = boxRef.current;
    if (fitted.current && width > 0 && height > 0) setView(fitViewport(docSize, width, height));
  }, [docSize]);

  useEffect(() => {
    if (!element) return undefined;
    const apply = (width: number, height: number) => {
      const previous = boxRef.current;
      if (previous.width === width && previous.height === height) return;
      boxRef.current = { width, height };
      setBox({ width, height });
      if (width <= 0 || height <= 0) return;
      if (!fitted.current) {
        fitted.current = true;
        setView(fitViewport(sizeRef.current, width, height));
      } else if (previous.width > 0 && previous.height > 0) {
        const shiftX = (width - previous.width) / 2;
        const shiftY = (height - previous.height) / 2;
        setView((current) => ({ ...current, panX: current.panX + shiftX, panY: current.panY + shiftY }));
      }
    };

    apply(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  useEffect(() => {
    if (!element) return undefined;
    // React gắn onWheel ở chế độ thụ động nên không chặn được cuộn trang; phải gắn trực tiếp.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
      setView((current) => zoomAt(current, factor, anchor));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element]);

  const zoomBy = useCallback((factor: number, anchor?: Point) => {
    const { width, height } = boxRef.current;
    const at = anchor ?? { x: width / 2, y: height / 2 };
    setView((current) => zoomAt(current, factor, at));
  }, []);

  const fit = useCallback(() => {
    const { width, height } = boxRef.current;
    if (width > 0 && height > 0) setView(fitViewport(sizeRef.current, width, height));
  }, []);

  return {
    view,
    width: box.width,
    height: box.height,
    containerRef: setElement,
    setView,
    zoomBy,
    fit,
    percent: Math.round(clampZoom(view.zoom) * 100),
  };
}

export const ZOOM_IN_FACTOR = BUTTON_ZOOM_STEP;
export const ZOOM_OUT_FACTOR = 1 / BUTTON_ZOOM_STEP;
