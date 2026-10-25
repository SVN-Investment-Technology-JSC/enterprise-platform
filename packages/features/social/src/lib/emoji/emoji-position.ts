export interface PopoverRect {
  readonly top: number;
  readonly left: number;
  readonly placement: 'above' | 'below';
}

export interface AnchorBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

const GAP = 6;
const MARGIN = 8;

/**
 * Vị trí hộp nổi theo nút: ưu tiên phía dưới, lật lên trên khi dưới không đủ chỗ mà trên rộng hơn;
 * căn phải theo nút rồi kẹp vào khung nhìn.
 */
export function placePopover(anchor: AnchorBox, size: { width: number; height: number }, viewport: { width: number; height: number }): PopoverRect {
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const placement = below >= size.height || below >= above ? 'below' : 'above';
  const rawTop = placement === 'below' ? anchor.bottom + GAP : anchor.top - GAP - size.height;
  const top = Math.min(Math.max(rawTop, MARGIN), Math.max(MARGIN, viewport.height - size.height - MARGIN));
  const left = Math.min(Math.max(anchor.right - size.width, MARGIN), Math.max(MARGIN, viewport.width - size.width - MARGIN));
  return { top, left, placement };
}

/** Vị trí cuộn để tiêu đề của danh mục thứ `categoryIndex` chạm đỉnh khung cuộn (theo công thức xếp của frimousse). */
export function categoryScrollTop(
  categoryIndex: number,
  rowsBefore: number,
  rowHeight: number,
  headerHeight: number,
): number {
  return categoryIndex * headerHeight + rowsBefore * rowHeight;
}
