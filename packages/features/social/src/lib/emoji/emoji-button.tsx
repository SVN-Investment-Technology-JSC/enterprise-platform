'use client';

import { Smile } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placePopover, type PopoverRect } from './emoji-position';
import styles from './emoji-picker.module.scss';

// Hộp chọn (cùng thư viện và dữ liệu) chỉ tải khi mở lần đầu, không nằm trong gói của trang.
const EmojiPickerPanel = lazy(() => import('./emoji-picker-panel').then((module) => ({ default: module.EmojiPickerPanel })));

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 372;

export interface EmojiButtonProps {
  readonly onPick: (emoji: string) => void;
  /** Gọi ngay trước khi mở hộp, lúc ô nhập còn giữ vùng chọn (để nơi gọi ghi nhớ vị trí chèn). */
  readonly onBeforeOpen?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly iconSize?: number;
}

/**
 * Nút mặt cười mở hộp chọn emoji nổi (dựng qua portal, tự lật lên/xuống theo chỗ trống).
 * Chọn một emoji thì chèn và giữ hộp mở để chọn tiếp; Esc, bấm ra ngoài hoặc bấm lại nút để đóng.
 * Esc chỉ đóng hộp này, không đóng hộp thoại soạn bên dưới.
 */
export function EmojiButton({ onPick, onBeforeOpen, disabled, className, iconSize = 16 }: EmojiButtonProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<PopoverRect | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const anchor = button.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    setRect(placePopover(anchor, { width, height: PANEL_HEIGHT }, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

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
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

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
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className={styles.popover}
              role="dialog"
              aria-label="Chọn biểu tượng cảm xúc"
              style={{ top: rect?.top ?? -9999, left: rect?.left ?? -9999 }}
              // Không để cú bấm trong hộp nổi lan qua cây React tới lớp phủ của hộp thoại soạn.
              onMouseDown={(event) => event.stopPropagation()}
            >
              <Suspense fallback={null}>
                <EmojiPickerPanel onPick={onPick} />
              </Suspense>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
