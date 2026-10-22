import type { ChangeEvent } from 'react';

/**
 * Giá trị in hoa của ô nhập mã, giữ nguyên vị trí con trỏ.
 *
 * Đổi in hoa rồi đưa qua state thì React ghi lại một chuỗi khác với chuỗi trên ô, và trình duyệt nhảy con trỏ về
 * cuối: gõ hay sửa một ký tự ở giữa mã là con trỏ chạy mất. Ghi chữ in hoa thẳng vào ô (kèm vùng chọn cũ) trước khi
 * React render, để giá trị state trùng với ô và React không đụng tới con trỏ nữa.
 */
export function upperCaseKeepingCaret(event: ChangeEvent<HTMLInputElement>): string {
  const input = event.target;
  const value = input.value.toUpperCase();
  if (value !== input.value) {
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.value = value;
    if (selectionStart !== null && selectionEnd !== null) {
      input.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
    }
  }
  return value;
}
