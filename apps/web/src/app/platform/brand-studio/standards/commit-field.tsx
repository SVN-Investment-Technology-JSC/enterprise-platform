'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Ô nhập chỉ lưu khi rời ô hoặc nhấn Enter (Esc để huỷ), không lưu từng phím gõ.
 * Giá trị không được chấp nhận thì ô tự trở về giá trị đang lưu, nên nơi gọi chỉ cần báo lỗi.
 */
export function CommitField({
  value,
  onCommit,
  className,
  ...rest
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'defaultValue'> & {
  value: string;
  onCommit: (next: string) => void;
}) {
  // null: ô đang theo giá trị đã lưu; có chuỗi: người dùng đang gõ dở.
  const [draft, setDraft] = useState<string | null>(null);

  const finish = (commit: boolean) => {
    if (commit && draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <Input
      {...rest}
      className={cn('h-8 rounded-md px-2 text-sm', className)}
      onBlur={() => finish(true)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          finish(false);
        }
      }}
      value={draft ?? value}
    />
  );
}
