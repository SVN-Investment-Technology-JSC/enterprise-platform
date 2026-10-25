/** Vị trí cuộn để tiêu đề của danh mục thứ `categoryIndex` chạm đỉnh khung cuộn (theo công thức xếp của frimousse). */
export function categoryScrollTop(
  categoryIndex: number,
  rowsBefore: number,
  rowHeight: number,
  headerHeight: number,
): number {
  return categoryIndex * headerHeight + rowsBefore * rowHeight;
}
