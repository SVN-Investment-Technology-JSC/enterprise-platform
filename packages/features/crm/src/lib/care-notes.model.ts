/** Model thuần của các ghi chú chăm sóc (P2F-03): chân dung khách, đối thủ của dự án, ghi chú đơn hàng. */

export const COMPETITOR_NAME_MAX = 300;

/** Rỗng là xoá ghi chú (`null`); quá độ dài thì báo lỗi tiếng Việt. */
export function parseNoteInput(
  text: string,
  max: number,
  label: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false; readonly message: string } {
  const value = text.trim();
  if (value.length > max) return { ok: false, message: `${label} tối đa ${max} ký tự.` };
  return { ok: true, value: value || null };
}

export type CompetitorParse =
  | { readonly ok: true; readonly name: string | null; readonly price: number | null }
  | { readonly ok: false; readonly message: string };

/** Giá đối thủ rỗng là chưa nhập; số âm hoặc không phải số thì báo lỗi. Chỉ có giá mà không có tên vẫn hợp lệ. */
export function parseCompetitorInput(input: { readonly name: string; readonly price: string }): CompetitorParse {
  const name = parseNoteInput(input.name, COMPETITOR_NAME_MAX, 'Tên đối thủ');
  if (!name.ok) return name;
  const priceText = input.price.trim();
  if (!priceText) return { ok: true, name: name.value, price: null };
  const price = Number(priceText);
  if (!Number.isFinite(price) || price < 0 || price >= 1e16) return { ok: false, message: 'Giá đối thủ phải là số không âm.' };
  return { ok: true, name: name.value, price };
}
