/**
 * Lấy tối đa `max` đơn vị UTF-16 đầu của `text` mà không cắt đôi một cặp thay thế (surrogate pair).
 * Emoji ngoài BMP chiếm hai đơn vị; cắt giữa chừng sẽ để lại nửa ký tự lỗi trong DB và thông báo.
 */
export function sliceSafe(text: string, max: number): string {
  const end = Math.max(0, max);
  if (text.length <= end) return text;
  const last = text.charCodeAt(end - 1);
  const cutInsidePair = end > 0 && last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, cutInsidePair ? end - 1 : end);
}
