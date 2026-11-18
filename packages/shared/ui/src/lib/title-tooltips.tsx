'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './title-tooltips.module.css';

/** Chờ một nhịp ngắn để rê chuột lướt qua nhiều nút không làm tooltip nháy liên tục. */
const SHOW_DELAY_MS = 120;
/** Phần tử mà thuộc tính `title` không phải là chú thích (tên khung nhúng, thẻ meta...). */
const IGNORED_TAGS = new Set(['IFRAME', 'META', 'LINK', 'HTML', 'HEAD', 'TITLE', 'SCRIPT', 'STYLE']);
const GAP = 6;
const MARGIN = 8;

interface Active {
  readonly element: HTMLElement;
  readonly text: string;
}

/** Tìm phần tử gần nhất (từ chính nó lên cha) đang có thuộc tính `title` không rỗng. */
function findTitled(target: EventTarget | null): HTMLElement | null {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement && !IGNORED_TAGS.has(node.tagName)) {
      const title = node.getAttribute('title');
      if (title && title.trim()) return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Tooltip dùng chung thay cho chú thích `title` mặc định của trình duyệt, cùng kiểu với tooltip shadcn/ui (nền đậm, chữ
 * sáng, bo góc, chữ nhỏ, có mũi tên). Gắn một lần ở layout gốc của mỗi ứng dụng: mọi phần tử có thuộc tính `title`
 * đều hiện tooltip này khi rê chuột hoặc focus bàn phím. Thuộc tính `title` được gỡ tạm trong lúc tooltip mở (để
 * trình duyệt không hiện thêm chú thích gốc) rồi trả lại khi đóng, nên tên truy cập và các test dùng `title` không đổi.
 *
 * Đặt bằng CSS thuần để chạy được cả ở các ứng dụng không có Tailwind; lấy màu từ `--foreground` và `--background`
 * của shadcn khi có, không thì dùng màu mặc định tương đương.
 */
export function TitleTooltips() {
  const [active, setActive] = useState<Active | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; side: 'top' | 'bottom'; arrow: number } | null>(
    null,
  );
  const bubbleRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<{ element: HTMLElement; title: string } | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const restore = () => {
      window.clearTimeout(timerRef.current);
      const current = currentRef.current;
      if (current) {
        // Chỉ trả lại khi phần tử chưa được gán `title` mới trong lúc tooltip mở.
        if (!current.element.hasAttribute('title')) current.element.setAttribute('title', current.title);
        currentRef.current = null;
      }
      setActive(null);
      setPosition(null);
    };

    const open = (element: HTMLElement) => {
      if (currentRef.current?.element === element) return;
      restore();
      const title = element.getAttribute('title') ?? '';
      if (!title.trim()) return;
      element.removeAttribute('title');
      currentRef.current = { element, title };
      timerRef.current = window.setTimeout(() => setActive({ element, text: title }), SHOW_DELAY_MS);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const element = findTitled(event.target);
      if (element) open(element);
      else if (currentRef.current && !currentRef.current.element.contains(event.target as Node)) restore();
    };
    const onFocus = (event: FocusEvent) => {
      const element = findTitled(event.target);
      if (element) open(element);
    };
    const onOut = (event: PointerEvent) => {
      const current = currentRef.current;
      if (current && !current.element.contains(event.relatedTarget as Node | null)) restore();
    };
    const onBlur = () => restore();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') restore();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', restore, true);
    window.addEventListener('scroll', restore, true);
    window.addEventListener('blur', restore);
    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', restore, true);
      window.removeEventListener('scroll', restore, true);
      window.removeEventListener('blur', restore);
      restore();
    };
  }, []);

  // Đo tooltip rồi đặt phía trên phần tử; hết chỗ thì lật xuống dưới, và luôn nằm trong khung nhìn.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!active || !bubble) return;
    if (!active.element.isConnected) {
      setActive(null);
      return;
    }
    const anchor = active.element.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const side = anchor.top - height - GAP >= MARGIN ? 'top' : 'bottom';
    const center = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(center - width / 2, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN));
    const top = side === 'top' ? anchor.top - height - GAP : anchor.bottom + GAP;
    setPosition({ left, top, side, arrow: Math.min(Math.max(center - left, 10), Math.max(10, width - 10)) });
  }, [active]);

  if (!active || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      data-slot="tooltip-content"
      data-side={position?.side ?? 'top'}
      className={styles.tooltip}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
        ['--tip-arrow' as string]: `${position?.arrow ?? 0}px`,
      }}
    >
      {active.text}
    </div>,
    document.body,
  );
}
