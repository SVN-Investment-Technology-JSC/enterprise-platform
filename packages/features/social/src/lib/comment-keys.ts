export interface EnterKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode?: number;
}

/**
 * Enter gửi bình luận (cả Ctrl/Cmd+Enter); Shift+Enter giữ hành vi mặc định là xuống dòng.
 * Đang gõ tiếng Việt qua bộ gõ (IME) thì Enter chỉ chốt chữ, không gửi.
 */
export function shouldSubmitOnEnter(event: EnterKeyEvent): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false;
  return !event.isComposing && event.keyCode !== 229;
}
