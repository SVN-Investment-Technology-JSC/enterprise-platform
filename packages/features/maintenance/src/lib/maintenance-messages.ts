/**
 * Đổi thông báo kỹ thuật (mã HTTP, tên API, lỗi mạng) thành lời người dùng đọc là hiểu và biết làm gì tiếp.
 * Lời đã là tiếng Việt dễ hiểu từ máy chủ thì giữ nguyên.
 */

/** Lý do gửi sang Quy trình thất bại do máy chủ ghi: `Procedure API trả về 409: Quy trình chưa được công bố.` */
const PROCEDURE_REASON = /^Procedure API trả về (\d{3})(?:\s*:\s*([\s\S]*?))?\.?\s*$/;

const NETWORK_FAILURE = /fetch failed|failed to fetch|networkerror|load failed|econnrefused|econnreset|enotfound|etimedout|socket hang up|timed? ?out|aborted|network request failed/i;
const TECHNICAL = /^(?:[A-Za-z]*Error\b|HTTP \d{3}|Unexpected token|Request failed|status code \d{3})|\b(?:HTTP|status code) \d{3}\b|<!doctype|<html/i;

const PROCEDURE_RETRY_LATER = 'Hệ thống tự thử lại; bạn cũng có thể bấm Thử lại sau ít phút.';

const hasText = (value: string | undefined | null): value is string => typeof value === 'string' && value.trim() !== '';

/** Lời nhắn của Quy trình đã là câu tiếng Việt (có dấu) thì đủ dễ hiểu để hiện kèm. */
const isReadableVietnamese = (text: string) => /[À-ỹ]/.test(text) && !TECHNICAL.test(text) && text.length <= 160;

/**
 * Lý do một phiếu không tạo được bên Quy trình, viết cho người dùng. Chuỗi rỗng khi không có lý do.
 */
export function describeDispatchFailure(reason: string | undefined | null): string {
  if (!hasText(reason)) return '';
  const text = reason.trim();

  const match = PROCEDURE_REASON.exec(text);
  if (match) {
    const status = Number(match[1]);
    const detail = (match[2] ?? '').trim().replace(/\.$/, '');
    if (/chưa được công bố/i.test(detail)) {
      return 'Quy trình đã chọn chưa được công bố. Nhờ người phụ trách quy trình công bố, rồi bấm Thử lại.';
    }
    if (status === 401 || status === 403) {
      return 'Hệ thống chưa có quyền tạo phiếu bên Quy trình. Hãy báo quản trị viên kiểm tra phân quyền.';
    }
    if (status === 404) {
      return 'Không tìm thấy quy trình đã chọn, có thể quy trình đã bị xoá. Hãy chọn lại quy trình cho lịch bảo trì.';
    }
    if (status === 408 || status === 429 || status >= 500) {
      return `Quy trình đang bận hoặc tạm thời không phản hồi. ${PROCEDURE_RETRY_LATER}`;
    }
    if (isReadableVietnamese(detail)) return `Quy trình không nhận yêu cầu: ${detail}.`;
    return 'Quy trình không nhận thông tin của phiếu này. Hãy kiểm tra lại quy trình gắn với lịch bảo trì.';
  }

  if (NETWORK_FAILURE.test(text)) return `Không kết nối được tới Quy trình. ${PROCEDURE_RETRY_LATER}`;
  if (TECHNICAL.test(text)) return `Chưa tạo được phiếu bên Quy trình. ${PROCEDURE_RETRY_LATER}`;
  return text;
}

/**
 * Lời báo cho một thao tác thất bại. `fallback` dùng khi lỗi không có nội dung dùng được.
 * Lỗi kỹ thuật (mất mạng, mã HTTP) được thay bằng lời chung; lời tiếng Việt từ máy chủ giữ nguyên.
 */
export function describeError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  if (!hasText(message)) return fallback;
  const text = message.trim();

  if (PROCEDURE_REASON.test(text)) return describeDispatchFailure(text);
  if (NETWORK_FAILURE.test(text)) return 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.';
  if (TECHNICAL.test(text)) return `${fallback.replace(/[.。]$/, '')}. Máy chủ chưa xử lý được yêu cầu, hãy thử lại sau ít phút.`;
  return text;
}
