/**
 * Báo cho các khối khác trên trang (thẻ "Bài đã lưu gần đây") biết người dùng vừa lưu, bỏ lưu hoặc đổi thư mục của một
 * bài, để chúng nạp lại ngay. Chỉ trong một tab.
 */
const EVENT = 'social:bookmark-changed';

export function emitBookmarkChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Đăng ký nghe; trả hàm huỷ. */
export function onBookmarkChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
