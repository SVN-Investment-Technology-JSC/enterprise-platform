export interface InsertResult {
  readonly text: string;
  /** Vị trí con trỏ sau phần vừa chèn (đơn vị UTF-16, như `selectionStart`). */
  readonly caret: number;
}

/** Chèn `insert` thay cho đoạn `[start, end)` của `text`; vị trí ngoài khoảng được kẹp lại. */
export function insertAtSelection(text: string, start: number, end: number, insert: string): InsertResult {
  const from = Math.min(Math.max(start, 0), text.length);
  const to = Math.min(Math.max(end, from), text.length);
  return { text: `${text.slice(0, from)}${insert}${text.slice(to)}`, caret: from + insert.length };
}
