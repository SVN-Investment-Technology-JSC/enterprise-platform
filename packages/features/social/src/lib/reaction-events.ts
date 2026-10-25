/**
 * Báo cho các khối khác trên trang (thẻ "Thông báo công ty") biết bài vừa đổi phản ứng, để chúng cập nhật ngay không
 * cần chờ nạp lại. Chỉ trong một tab; phản ứng của người khác chưa có kênh realtime riêng.
 */
const EVENT = 'social:reaction-changed';

export function emitReactionChanged(postId: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: postId }));
}

/** Đăng ký nghe; trả hàm huỷ. */
export function onReactionChanged(listener: (postId: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
