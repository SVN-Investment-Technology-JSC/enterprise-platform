/** Một ô trên thanh số trang: số trang, hoặc dấu `…` thay cho dải trang bị ẩn. */
export type PageItem = number | 'gap';

/**
 * Các ô số trang kiểu trang xem phim, đọc truyện: luôn có trang đầu, trang cuối và `around` trang mỗi bên trang
 * đang xem; dải bị ẩn thay bằng `…` (dải chỉ một trang thì hiện luôn số trang đó).
 */
export function pageItems(current: number, pageCount: number, around = 2): PageItem[] {
  if (pageCount <= 1) return [1];
  const page = Math.min(Math.max(current, 1), pageCount);
  const keep = new Set<number>([1, pageCount]);
  for (let index = page - around; index <= page + around; index += 1) {
    if (index >= 1 && index <= pageCount) keep.add(index);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const items: PageItem[] = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && value - previous === 2) items.push(previous + 1);
    else if (previous !== undefined && value - previous > 2) items.push('gap');
    items.push(value);
  });
  return items;
}

/** Số trang từ tổng số dòng; danh sách rỗng vẫn là một trang. */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
