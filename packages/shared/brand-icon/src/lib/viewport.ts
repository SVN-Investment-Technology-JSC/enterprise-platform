import type { Point } from './model.js';

/** Khung nhìn của canvas: `zoom` là số pixel màn hình trên một đơn vị lưới; `panX/panY` là vị trí gốc lưới trên màn hình. */
export interface Viewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export const MIN_ZOOM = 4;
export const MAX_ZOOM = 120;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const screenToDoc = (view: Viewport, point: Point): Point => ({
  x: (point.x - view.panX) / view.zoom,
  y: (point.y - view.panY) / view.zoom,
});

export const docToScreen = (view: Viewport, point: Point): Point => ({
  x: point.x * view.zoom + view.panX,
  y: point.y * view.zoom + view.panY,
});

/** Phóng to/thu nhỏ quanh một điểm màn hình, điểm đó giữ nguyên vị trí dưới con trỏ. */
export function zoomAt(view: Viewport, factor: number, anchor: Point): Viewport {
  const zoom = clampZoom(view.zoom * factor);
  const docPoint = screenToDoc(view, anchor);
  return { zoom, panX: anchor.x - docPoint.x * zoom, panY: anchor.y - docPoint.y * zoom };
}

/** Khung nhìn vừa khít lưới `size` trong vùng `width x height` (có chừa lề). */
export function fitViewport(size: number, width: number, height: number, margin = 24): Viewport {
  const zoom = clampZoom(Math.min((width - margin * 2) / size, (height - margin * 2) / size));
  return { zoom, panX: (width - size * zoom) / 2, panY: (height - size * zoom) / 2 };
}
