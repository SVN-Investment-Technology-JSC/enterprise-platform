/**
 * Báo cho trang chi tiết nhóm biết danh sách chủ đề của nhóm vừa đổi (tạo nhanh chủ đề trong hộp soạn bài), để các chip
 * lọc chủ đề cập nhật ngay. Chỉ trong một tab.
 */
const EVENT = 'social:group-topics-changed';

export function emitGroupTopicsChanged(groupId: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: groupId }));
}

/** Đăng ký nghe; trả hàm huỷ. */
export function onGroupTopicsChanged(listener: (groupId: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
