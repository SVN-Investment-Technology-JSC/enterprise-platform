import { useEffect, useRef } from 'react';

/**
 * Nơi đăng ký "việc đang làm dở" (bình luận chưa gửi, tệp đã chọn chưa đăng...). Chuyển trang kiểu SPA không kích hoạt
 * `beforeunload`, nên chỗ nào định chuyển trang hỏi `hasUnsavedWork()` trước rồi mới xác nhận với người dùng.
 */
const sources = new Set<() => boolean>();

export function registerUnsavedWork(isDirty: () => boolean): () => void {
  sources.add(isDirty);
  return () => {
    sources.delete(isDirty);
  };
}

export function hasUnsavedWork(): boolean {
  for (const isDirty of sources) if (isDirty()) return true;
  return false;
}

/** Đăng ký trong suốt vòng đời component; `dirty` được đọc mới nhất mỗi lần hỏi. */
export function useUnsavedWork(dirty: boolean): void {
  const latest = useRef(dirty);
  latest.current = dirty;
  useEffect(() => registerUnsavedWork(() => latest.current), []);
}
