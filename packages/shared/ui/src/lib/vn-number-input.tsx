'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type InputHTMLAttributes,
} from 'react';
import { canonicalToDisplay, formatVnWhileTyping, parseVnNumber } from './currency-format';

export interface VnNumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Giá trị chuẩn `500000000.01` hoặc rỗng. */
  readonly value: string;
  /** Nhận giá trị chuẩn `500000000.01` (không ngăn nghìn), hoặc chuỗi rỗng. */
  readonly onChange: (canonical: string) => void;
  /** Tiền: 2; số lượng: 3. */
  readonly maxDecimals?: number;
  readonly allowNegative?: boolean;
}

/** Số ký tự "có nghĩa" (chữ số, dấu phẩy, dấu trừ) nằm bên trái vị trí `caret`. */
function significantBefore(text: string, caret: number): number {
  return text.slice(0, caret).replace(/[^\d,-]/g, '').length;
}

function caretForSignificant(display: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index += 1) {
    if (/[\d,-]/.test(display[index])) seen += 1;
    if (seen === count) return index + 1;
  }
  return display.length;
}

/**
 * Ô nhập số kiểu Việt Nam: tự chèn dấu `.` ngăn nghìn khi gõ, `,` là dấu thập phân, giữ vị trí con trỏ.
 * Không dùng type="number" nên không bị đổi giá trị khi cuộn chuột và không phụ thuộc locale máy.
 */
export function VnNumberInput({
  value,
  onChange,
  maxDecimals = 2,
  allowNegative = false,
  onBlur,
  style,
  ...rest
}: VnNumberInputProps) {
  const [display, setDisplay] = useState(() => canonicalToDisplay(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const lastCanonical = useRef(value);

  // Giá trị bên ngoài đổi (đặt lại form, mở bản ghi khác): đồng bộ lại ô hiển thị.
  if (value !== lastCanonical.current) {
    lastCanonical.current = value;
    const current = formatVnWhileTyping(display, { maxDecimals, allowNegative }).canonical;
    // Form giữ giá trị dạng số (Number) nên "0.0" và "0" là một: không ghi đè khi đang gõ dở "0,0".
    const sameNumber = current !== '' && value !== '' && Number(current) === Number(value);
    if (current !== value && !sameNumber) setDisplay(canonicalToDisplay(value));
  }

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const apply = (text: string, caret: number | null) => {
    const result = formatVnWhileTyping(text, { maxDecimals, allowNegative });
    if (caret !== null) pendingCaret.current = caretForSignificant(result.display, significantBefore(text, caret));
    setDisplay(result.display);
    lastCanonical.current = result.canonical;
    onChange(result.canonical);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    let text = event.target.value;
    const caret = event.target.selectionStart;
    // Phím `.` ở bàn phím số: hiểu là dấu thập phân khi ô chưa có `,`.
    if (caret !== null && text[caret - 1] === '.' && !display.includes(',') && maxDecimals > 0) {
      const dotsBefore = (display.match(/\./g) ?? []).length;
      const dotsNow = (text.match(/\./g) ?? []).length;
      if (dotsNow > dotsBefore) text = `${text.slice(0, caret - 1)},${text.slice(caret)}`;
    }
    apply(text, caret);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseVnNumber(event.clipboardData.getData('text'));
    if (parsed === null || /e/i.test(String(parsed))) return;
    event.preventDefault();
    apply(canonicalToDisplay(String(parsed)), null);
  };

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      onPaste={handlePaste}
      onBlur={(event) => {
        // Bỏ dấu `,` còn dở ở cuối và dấu `-` đứng một mình.
        const normalized = canonicalToDisplay(formatVnWhileTyping(display, { maxDecimals, allowNegative }).canonical);
        if (normalized !== display) setDisplay(normalized);
        onBlur?.(event);
      }}
      style={{ textAlign: 'left', fontVariantNumeric: 'tabular-nums', ...style }}
    />
  );
}
