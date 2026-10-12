'use client';

import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

/** Một dòng có thể chọn trong ô tìm nhanh của Tenant Portal. */
export interface QuickSearchEntry {
  readonly id: string;
  /** Nhóm hiển thị, ví dụ "Trang" hoặc "Ứng dụng". */
  readonly group: string;
  readonly label: string;
  readonly hint?: string;
  readonly onSelect: () => void;
}

/** Bỏ dấu và chữ hoa, để gõ "nguoi dung" vẫn ra "Người dùng". */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Ô tìm nhanh của Tenant Portal, mở bằng Ctrl+K hoặc ô "Tìm nhanh" trên thanh
 * bên. Chỉ tìm trong các trang người dùng được vào và các ứng dụng đang bật.
 */
export function TenantQuickSearch({
  open,
  entries,
  onClose,
}: {
  open: boolean;
  entries: readonly QuickSearchEntry[];
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const rows = useMemo(() => {
    const needle = fold(term.trim());
    if (!needle) return entries;
    return entries.filter((entry) => fold(`${entry.label} ${entry.hint ?? ''}`).includes(needle));
  }, [entries, term]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const pick = (entry: QuickSearchEntry | undefined) => {
    if (!entry) return;
    onClose();
    entry.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/35 px-4 pt-[12vh]"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-xl border border-[#eef0f3] bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Tìm nhanh"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="flex items-center gap-2.5 border-b border-[#eef0f3] px-4 py-3 text-slate-500">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={term}
            placeholder="Tìm trang, ứng dụng…"
            aria-label="Từ khoá tìm nhanh"
            aria-controls="tenant-quick-search-results"
            aria-activedescendant={rows[active] ? `tenant-quick-search-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-slate-900 outline-none placeholder:text-slate-400"
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </label>

        <ul
          id="tenant-quick-search-results"
          className="max-h-[50vh] overflow-y-auto p-2"
          role="listbox"
        >
          {rows.map((row, index) => (
            <li key={row.id} role="presentation">
              {index === 0 || rows[index - 1].group !== row.group ? (
                <span className="block px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-400">
                  {row.group}
                </span>
              ) : null}
              <button
                id={`tenant-quick-search-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                  index === active ? 'bg-[#fff8dc] text-slate-900' : 'text-slate-700'
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row)}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{row.label}</span>
                {row.hint ? (
                  <span className="max-w-[45%] truncate text-[12px] text-slate-400">{row.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="px-2.5 py-6 text-center text-[13px] text-slate-400">
              Không có trang hay ứng dụng nào khớp.
            </li>
          ) : null}
        </ul>

        <p className="border-t border-[#eef0f3] px-4 py-2 text-[11.5px] text-slate-400">
          <kbd>↑</kbd> <kbd>↓</kbd> để chọn · <kbd>Enter</kbd> để mở · <kbd>Esc</kbd> để đóng
        </p>
      </div>
    </div>,
    document.body,
  );
}
