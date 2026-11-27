'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Bố cục theo bề rộng KHUNG của màn (không theo cửa sổ: thanh bên của khung module chiếm một phần):
 *  - `wide`   (>= 1000px): danh sách 330px + chi tiết;
 *  - `medium` (720–999px): danh sách 280px;
 *  - `narrow` (< 720px): một cột, chọn hồ sơ thì mở chi tiết, có nút về danh sách.
 * Tương ứng cửa sổ khoảng >= 1280px, 1024–1279px và < 1024px khi thanh bên mở.
 */
export type WidthMode = 'wide' | 'medium' | 'narrow';

export const WIDTH_MEDIUM_MAX = 1000;
export const WIDTH_NARROW_MAX = 720;

/**
 * Cách xếp thanh công cụ:
 *  - `one`   (>= 1680px): một hàng (tab trạng thái, tìm, lọc, rồi các nút bên phải);
 *  - `split` (1240–1679px): hàng 1 tab trạng thái + các nút, hàng 2 ô tìm và bộ lọc;
 *  - `stack` (< 1240px): hàng 1 tab trạng thái, hàng 2 ô tìm, bộ lọc rồi các nút (hết chỗ thì các nút xuống hàng).
 */
export type ToolbarLayout = 'one' | 'split' | 'stack';

export const TOOLBAR_ONE_ROW_MIN = 1680;
export const TOOLBAR_SPLIT_MIN = 1240;

export function widthModeOf(width: number): WidthMode {
  // Chưa đo được (0, như lúc chưa gắn vào trang) thì coi là rộng.
  if (!width || width >= WIDTH_MEDIUM_MAX) return 'wide';
  return width >= WIDTH_NARROW_MAX ? 'medium' : 'narrow';
}

export function toolbarLayoutOf(width: number): ToolbarLayout {
  if (!width || width >= TOOLBAR_ONE_ROW_MIN) return 'one';
  return width >= TOOLBAR_SPLIT_MIN ? 'split' : 'stack';
}

export interface WidthLayout {
  readonly mode: WidthMode;
  readonly toolbar: ToolbarLayout;
}

function layoutKey(width: number): string {
  return `${widthModeOf(width)}:${toolbarLayoutOf(width)}`;
}

/**
 * Kiểu bố cục theo bề rộng của phần tử, theo dõi bằng ResizeObserver (trình duyệt không có thì đo một lần). Chỉ giữ kiểu
 * bố cục trong state nên co giãn trong cùng một khoảng không vẽ lại màn.
 */
export function useWidthLayout(ref: RefObject<HTMLElement | null>): WidthLayout {
  const [key, setKey] = useState(() => layoutKey(0));
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number) => setKey(layoutKey(width));
    measure(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((records) => {
      const record = records[records.length - 1];
      if (record) measure(record.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  const [mode, toolbar] = key.split(':') as [WidthMode, ToolbarLayout];
  return { mode, toolbar };
}
