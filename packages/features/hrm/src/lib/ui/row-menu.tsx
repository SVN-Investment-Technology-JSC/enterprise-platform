'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Ẩn mục (thiếu quyền hoặc không áp dụng). */
  hidden?: boolean;
  tone?: 'default' | 'danger';
}

/**
 * Nút "..." mở danh sách thao tác của một dòng. Danh sách đặt theo toạ độ của nút (không bị bảng có thanh cuộn cắt),
 * đóng khi bấm ra ngoài, nhấn Escape hoặc chọn một mục. Không có mục nào hiện thì không vẽ nút.
 */
export function RowMenu({
  items,
  label = 'Thao tác khác',
  trigger,
  buttonClassName,
}: {
  items: readonly RowMenuItem[];
  label?: string;
  /** Nội dung nút mở menu thay cho biểu tượng "..." (ví dụ biểu tượng kèm chữ "Công cụ"). */
  trigger?: ReactNode;
  /** Lớp của nút mở menu (thay cho kiểu nút "..." mặc định). */
  buttonClassName?: string;
}) {
  const visible = items.filter((item) => !item.hidden);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setBox({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    };
    place();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  if (visible.length === 0) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ??
          'inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800'
        }
      >
        {trigger ?? <MoreHorizontal className="size-4" />}
      </button>
      {open && box && (
        <ul
          ref={listRef}
          role="menu"
          style={{ position: 'fixed', top: box.top, right: box.right, zIndex: 10000 }}
          className="min-w-[180px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {visible.map((item) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`block w-full px-3 py-1.5 text-left text-xs font-medium hover:bg-slate-50 ${
                  item.tone === 'danger' ? 'text-rose-600' : 'text-slate-700'
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
