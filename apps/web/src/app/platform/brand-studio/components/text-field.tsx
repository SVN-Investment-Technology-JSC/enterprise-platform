'use client';

import { cn } from '@/lib/utils';
import type { Gesture } from './use-gesture';

const INPUT_CLASS =
  'w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-40';

/**
 * Ô chữ cập nhật ngay khi gõ nhưng cả lượt gõ (từ ký tự đầu tiên tới lúc rời ô) chỉ là một bước hoàn tác.
 * Nhờ vậy lưu hay xuất khi con trỏ còn trong ô vẫn không mất chữ đang gõ, và chỉ bấm vào ô không xoá lịch làm lại.
 */
export function LiveTextField({
  value,
  onChange,
  gesture,
  label,
  placeholder,
  maxLength,
  multiline = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  gesture: Gesture;
  label: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  className?: string;
}) {
  if (multiline) {
    return (
      <textarea
        aria-label={label}
        title={label}
        rows={2}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onBlur={gesture.end}
        onChange={(event) => {
          gesture.start();
          onChange(event.target.value);
        }}
        className={cn(INPUT_CLASS, 'resize-none py-1.5 leading-snug', className)}
      />
    );
  }
  return (
    <input
      type="text"
      aria-label={label}
      title={label}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onBlur={gesture.end}
      onChange={(event) => {
        gesture.start();
        onChange(event.target.value);
      }}
      className={cn(INPUT_CLASS, 'h-7', className)}
    />
  );
}
