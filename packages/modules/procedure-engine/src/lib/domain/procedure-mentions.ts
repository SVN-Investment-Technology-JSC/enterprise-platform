/** Tối đa bao nhiêu người được nhắc/báo cho một trao đổi: chặn nhắc hàng loạt gây nhiễu. */
export const MAX_MENTION_RECIPIENTS = 20;

/** Id người dùng hợp lệ để lưu: chuỗi không rỗng, ngắn, không chứa khoảng trắng hay ký tự điều khiển. */
const MENTION_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * Làm sạch danh sách người được nhắc trước khi lưu.
 *
 * Danh sách do trình duyệt gửi nên không tin: bỏ phần tử không phải chuỗi/sai dạng, bỏ trùng, và cắt ở
 * `MAX_MENTION_RECIPIENTS`. Không đối chiếu với người tham gia hồ sơ ở đây vì module này không đọc được
 * sơ đồ tổ chức; hệ quả của một id lạ chỉ là một thông báo tới đúng người dùng đó, kèm đường dẫn mở hồ sơ
 * mà họ vẫn bị kiểm quyền khi mở.
 */
export function sanitizeMentions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => MENTION_ID.test(item)),
    ),
  ].slice(0, MAX_MENTION_RECIPIENTS);
  return clean.length > 0 ? clean : undefined;
}
