'use client';

import { Smile } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent } from '../ui/popover';
import styles from './emoji-picker.module.scss';

// Hộp chọn (cùng thư viện và dữ liệu) chỉ tải khi mở lần đầu, không nằm trong gói của trang.
const EmojiPickerPanel = lazy(() => import('./emoji-picker-panel').then((module) => ({ default: module.EmojiPickerPanel })));

export interface EmojiButtonProps {
  readonly onPick: (emoji: string) => void;
  /** Gọi ngay trước khi mở hộp, lúc ô nhập còn giữ vùng chọn (để nơi gọi ghi nhớ vị trí chèn). */
  readonly onBeforeOpen?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly iconSize?: number;
}

/**
 * Nút mặt cười mở hộp chọn emoji (Popover kiểu shadcn: tự lật lên/xuống và không tràn khung nhìn).
 * Chọn một emoji thì chèn và giữ hộp mở để chọn tiếp; Esc, bấm ra ngoài hoặc bấm lại nút để đóng.
 * Esc chỉ đóng hộp này, không đóng hộp thoại soạn bên dưới.
 */
export function EmojiButton({ onPick, onBeforeOpen, disabled, className, iconSize = 16 }: EmojiButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Pha bắt: chặn Esc trước khi tới hộp thoại bên dưới.
      event.stopImmediatePropagation();
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Ô nhập bị khoá (đang gửi) thì đóng hộp.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label="Chèn biểu tượng cảm xúc"
        title="Chèn biểu tượng cảm xúc"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        // Giữ vùng chọn trong trình soạn khi bấm nút.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          onBeforeOpen?.();
          setOpen(true);
        }}
      >
        <Smile size={iconSize} />
      </button>
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          if (next) return;
          // Sau khi chọn emoji, tiêu điểm quay về ô nhập: không phải lý do để đóng hộp.
          if (details.reason === 'focus-out') return;
          // Bấm đúng nút mở: để `onClick` của nút tự bật/tắt, tránh đóng rồi mở lại.
          if (details.reason === 'outside-press' && buttonRef.current?.contains(details.event.target as Node)) return;
          setOpen(false);
        }}
      >
        <PopoverContent
          anchor={buttonRef}
          side="bottom"
          align="end"
          finalFocus={false}
          className={styles.popover}
          aria-label="Chọn biểu tượng cảm xúc"
          // Không để cú bấm trong hộp nổi lan qua cây React tới lớp phủ của hộp thoại soạn.
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Suspense fallback={null}>
            <EmojiPickerPanel onPick={onPick} />
          </Suspense>
        </PopoverContent>
      </Popover>
    </>
  );
}
