'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MenuActionId, MenuEntry, MenuItem } from '../context-menu.model';
import styles from '../shared.module.scss';

/** Điểm mở menu, theo toạ độ khung nhìn. */
export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

export const anchorFromMouse = (event: MouseEvent): MenuAnchor => ({ x: event.clientX, y: event.clientY });

/** Phím bàn phím tương đương chuột phải: phím Menu, hoặc Shift + F10. */
export const isMenuKey = (event: KeyboardEvent): boolean =>
  event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

/** Mở menu từ bàn phím: dưới phần đầu dòng đang focus. */
export function anchorFromElement(element: Element): MenuAnchor {
  const box = element.getBoundingClientRect();
  return { x: box.left + Math.min(48, box.width / 2), y: box.bottom - 6 };
}

/** Khoảng đệm giữa menu và mép khung nhìn. */
const MARGIN = 8;

/**
 * Trình duyệt có thể cuộn dòng vừa bấm chuột phải cho vào hẳn khung nhìn (dòng bị cắt
 * một phần trên màn hình hẹp). Cuộn ngay sau khi mở không phải ý người dùng nên không đóng menu.
 */
const SCROLL_GRACE_MS = 250;

const isItem = (entry: MenuEntry): entry is MenuItem => entry.kind === 'item';

export interface ContextMenuProps {
  readonly anchor: MenuAnchor;
  readonly entries: readonly MenuEntry[];
  readonly label: string;
  readonly onClose: () => void;
  readonly onPick: (id: MenuActionId) => void;
}

/**
 * Menu chuột phải, dựng qua portal vào `document.body` và kẹp vào khung nhìn.
 *
 * Bàn phím: ↑ ↓ Home End chọn mục, Enter hoặc Space chạy, Esc đóng và trả
 * focus về chỗ đã mở, Tab đóng. Bấm ra ngoài, cuộn, đổi cỡ cửa sổ cũng đóng.
 * Mục có `disabledReason` vẫn chọn được bằng phím để đọc lý do nhưng không chạy.
 */
export function ContextMenu({ anchor, entries, label, onClose, onPick }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const opener = useRef<Element | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const [active, setActive] = useState(0);

  const items = useMemo(() => entries.filter(isItem), [entries]);

  // Chỉ đo được khi đã dựng; kẹp vào khung nhìn để mở sát mép dưới không bị cắt.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - box.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - box.height - MARGIN)),
    });
  }, [anchor, entries]);

  useEffect(() => {
    opener.current = document.activeElement;
  }, []);

  useEffect(() => {
    itemRefs.current[active]?.focus({ preventScroll: true });
  }, [active, position]);

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      onClose();
    };
    // `capture`: menu đóng trước khi cú bấm rơi vào phần tử bên dưới; cuộn của
    // chính menu (menu cao hơn màn hình) thì không đóng.
    const openedAt = performance.now();
    const onScroll = (event: Event) => {
      if (performance.now() - openedAt < SCROLL_GRACE_MS) return;
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('contextmenu', dismiss, true);
    document.addEventListener('keydown', onEscape, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('contextmenu', dismiss, true);
      document.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  const move = (step: number) => setActive((index) => (index + step + items.length) % items.length);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(items.length - 1);
        break;
      case 'Tab':
        event.preventDefault();
        onClose();
        break;
      default:
    }
  };

  const pick = (entry: MenuItem) => {
    if (entry.disabledReason) return;
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    onPick(entry.id);
  };

  let itemIndex = -1;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={styles.contextMenu}
      style={{ left: position?.left ?? anchor.x, top: position?.top ?? anchor.y, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') {
          return <div key={`sep-${index}`} role="separator" className={styles.contextSeparator} />;
        }
        itemIndex += 1;
        const own = itemIndex;
        return (
          <button
            key={entry.id}
            ref={(node) => {
              itemRefs.current[own] = node;
            }}
            type="button"
            role="menuitem"
            tabIndex={own === active ? 0 : -1}
            aria-disabled={entry.disabledReason ? true : undefined}
            title={entry.disabledReason}
            className={[
              styles.contextItem,
              entry.danger ? styles.contextItemDanger : '',
              entry.disabledReason ? styles.contextItemDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onMouseMove={() => setActive(own)}
            onClick={() => pick(entry)}
          >
            {entry.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
