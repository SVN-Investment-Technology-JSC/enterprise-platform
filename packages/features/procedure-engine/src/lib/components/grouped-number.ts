/**
 * Định dạng lại chuỗi số người dùng đang gõ theo kiểu Việt: dấu chấm ngăn nghìn,
 * dấu phẩy thập phân ("1234567,5" → "1.234.567,5"), và tính lại vị trí con trỏ để
 * gõ giữa chuỗi không bị nhảy về cuối.
 *
 * Con trỏ được giữ theo số ký tự có nghĩa (chữ số, dấu phẩy) đứng trước nó: dấu
 * chấm chèn thêm hay bớt đi không làm lệch chỗ người dùng đang gõ.
 */
export function formatGroupedInput(text: string, caret: number): { text: string; caret: number } {
  const significant = (value: string) => value.replace(/[^\d,]/g, '');
  const before = significant(text.slice(0, caret)).length;

  const cleaned = significant(text);
  const comma = cleaned.indexOf(',');
  const integer = (comma >= 0 ? cleaned.slice(0, comma) : cleaned).replace(/^0+(?=\d)/, '');
  const fraction = comma >= 0 ? cleaned.slice(comma + 1).replace(/,/g, '') : undefined;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const formatted = fraction === undefined ? grouped : `${grouped || '0'},${fraction}`;

  // Bỏ số 0 đầu làm chuỗi ngắn đi: không để con trỏ vượt quá số ký tự còn lại.
  const target = Math.min(before - (cleaned.length - significant(formatted).length), significant(formatted).length);
  let seen = 0;
  let position = 0;
  while (position < formatted.length && seen < target) {
    if (/[\d,]/.test(formatted[position])) seen += 1;
    position += 1;
  }
  return { text: formatted, caret: Math.max(position, 0) };
}
