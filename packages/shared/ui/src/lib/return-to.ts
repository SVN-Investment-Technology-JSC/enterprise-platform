/**
 * Mở một việc từ trang khác (vd trang chủ) kèm `?returnTo=/dashboard`: xử lý xong việc đó thì module tự quay
 * về. Chỉ nhận đường dẫn nội bộ cùng trang web, để link không đẩy người dùng sang trang ngoài.
 */
export function readReturnTo(search: string): string | undefined {
  const raw = new URLSearchParams(search).get('returnTo')?.trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return undefined;
  return raw;
}

export interface ReturnTarget {
  /** Đường dẫn quay về. */
  readonly path: string;
  /** Hash lúc mở trang: id của việc được mở từ trang kia nằm trong đây. */
  readonly hash: string;
}

let captured: ReturnTarget | undefined | null = null;

/**
 * `returnTo` và hash của LẦN MỞ TRANG ĐẦU TIÊN. Ghi nhớ một lần cho cả trang: người dùng rẽ sang việc khác
 * trong module rồi xử lý việc đó thì không bị đẩy về; chỉ việc được mở từ trang kia mới kích hoạt quay về.
 */
export function initialReturnTarget(): ReturnTarget | undefined {
  if (captured !== null) return captured;
  if (typeof window === 'undefined') return undefined;
  const path = readReturnTo(window.location.search);
  captured = path ? { path, hash: window.location.hash } : undefined;
  return captured;
}

// Chụp ngay khi nạp module trên trình duyệt, trước mọi lần render: hook điều hướng của module có thể chuẩn
// hoá lại hash lúc gắn (bỏ id của việc đang mở), đọc trễ hơn là mất dấu việc được mở từ trang kia.
initialReturnTarget();

/** Việc `id` có phải việc được mở từ trang kia không; phải thì trả đường quay về. */
export function returnPathFor(id: string): string | undefined {
  const target = initialReturnTarget();
  return target && target.hash.includes(id) ? target.path : undefined;
}
