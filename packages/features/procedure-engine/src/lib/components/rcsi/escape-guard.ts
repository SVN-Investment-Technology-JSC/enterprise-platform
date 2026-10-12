import type { KeyboardEvent } from 'react';

/**
 * Esc đóng dropdown của SearchableSelect trước, không kéo theo đóng cả hộp thoại
 * (MinimalPopupForm nghe Esc ở window nên mất dữ liệu đang nhập). Gắn vào
 * onKeyDown của phần thân hộp thoại.
 */
export function stopEscapeWhenListOpen(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Escape') return;
  if (event.currentTarget.querySelector('[role="listbox"]')) event.stopPropagation();
}
