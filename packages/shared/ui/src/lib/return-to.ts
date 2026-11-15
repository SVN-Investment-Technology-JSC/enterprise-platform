/**
 * Mở một việc từ trang khác (vd trang chủ) kèm `?returnTo=/dashboard`: xử lý xong việc đó thì module tự quay
 * về. Chỉ nhận đường dẫn nội bộ cùng trang web, để link không đẩy người dùng sang trang ngoài.
 */
export function readReturnTo(search: string): string | undefined {
  const value = new URLSearchParams(search).get('returnTo');
  if (!value || hasControlChar(value)) return undefined;
  const raw = value.trim();
  if (!isSameOriginPath(raw)) return undefined;
  // Giá trị có thể bị mã hoá thêm một lớp (`/%09/...`, `/%5C%5C...`): kiểm cả bản đã giải mã.
  const decoded = safeDecode(raw);
  if (decoded === undefined || (decoded !== raw && !isSameOriginPath(decoded))) return undefined;
  return raw;
}

/** Có ký tự điều khiển U+0000–U+001F, U+007F (tab, xuống dòng...): trình duyệt bỏ chúng khi dựng URL, `/\t/x` thành `//x`. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Origin giả chỉ để dựng URL tương đối; không bao giờ là origin thật. */
const PROBE_ORIGIN = 'https://return-to.invalid';

function isSameOriginPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || hasControlChar(path)) return false;
  try {
    return new URL(path, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
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
