/** Kiểu dữ liệu kéo thả: mã bài đã lưu được kéo từ danh sách vào chip thư mục. */
export const BOOKMARK_DRAG_TYPE = 'application/x-social-bookmark-post';

export function isBookmarkDrag(event: { readonly dataTransfer: DataTransfer | null }): boolean {
  return Boolean(event.dataTransfer?.types.includes(BOOKMARK_DRAG_TYPE));
}
