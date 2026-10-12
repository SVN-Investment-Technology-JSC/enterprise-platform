'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../utils';
import { Input } from './input';
import { parseTimeText } from './time-text-input';

/** Các mốc giờ chọn nhanh, định dạng 24 giờ, mỗi 30 phút: 00:00, 00:30, ... 23:30. */
export function timeOptions(stepMinutes = 30): string[] {
  const out: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    out.push(
      `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    );
  }
  return out;
}

/** Mốc gần nhất (không nhỏ hơn) với giờ đang nhập, để cuộn danh sách tới đúng chỗ. */
export function nearestTimeOption(options: readonly string[], value: string): string {
  if (!value) return options[0] ?? '';
  return options.find((option) => option >= value) ?? options[options.length - 1] ?? '';
}

/**
 * Ô giờ 24 giờ vừa gõ tay vừa chọn: gõ "730", "7:30", "7h30" đều được chuẩn hoá về HH:mm khi rời ô hoặc nhấn Enter;
 * bấm vào ô (hoặc nút đồng hồ) mở danh sách mốc giờ để chọn một lần bấm. Phím mũi tên lên xuống đổi mốc, Escape đóng.
 */
export function TimeComboInput({
  value,
  onChange,
  className,
  disabled,
  required,
  stepMinutes = 30,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  stepMinutes?: number;
  'aria-label'?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const options = useMemo(() => timeOptions(stepMinutes), [stepMinutes]);
  const target = nearestTimeOption(options, parseTimeText(draft) ?? value);

  useEffect(() => setDraft(value), [value]);

  // Bấm ra ngoài thì đóng danh sách.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Mở danh sách: cuộn tới mốc đang chọn; mở lên phía trên nếu phía dưới không đủ chỗ.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (root) {
      const rect = root.getBoundingClientRect();
      setOpenUp(window.innerHeight - rect.bottom < 220 && rect.top > 220);
    }
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (list && active) list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2;
  }, [open]);

  const commit = () => {
    const parsed = parseTimeText(draft);
    if (parsed) {
      setDraft(parsed);
      if (parsed !== value) onChange(parsed);
    } else {
      setDraft(value);
    }
  };

  const pick = (option: string) => {
    setDraft(option);
    if (option !== value) onChange(option);
    setOpen(false);
  };

  const move = (delta: number) => {
    const index = options.indexOf(target);
    const next = options[Math.min(options.length - 1, Math.max(0, index + delta))];
    if (next) pick(next);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Input
        type="text"
        inputMode="numeric"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="none"
        aria-label={ariaLabel}
        aria-invalid={parseTimeText(draft) === null}
        disabled={disabled}
        required={required}
        placeholder="HH:mm"
        maxLength={5}
        autoComplete="off"
        value={draft}
        className="h-8 pr-7 font-mono text-xs"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            setOpen(false);
          } else if (e.key === 'Escape') {
            if (open) e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (open) move(1);
            else setOpen(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (open) move(-1);
            else setOpen(true);
          }
        }}
      />
      <Clock
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
      />
      {open && !disabled && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Chọn giờ (24 giờ)"
          className={cn(
            'absolute left-0 z-50 max-h-48 w-full min-w-[5.5rem] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg',
            openUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.map((option) => {
            const selected = option === (parseTimeText(draft) ?? value);
            return (
              <li
                key={option}
                role="option"
                aria-selected={selected}
                data-active={option === target ? 'true' : undefined}
                // Giữ tiêu điểm ở ô nhập để blur không chuẩn hoá lại giá trị cũ trước khi chọn.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                className={cn(
                  'cursor-pointer px-3 py-1 text-center font-mono text-xs',
                  selected ? 'bg-[#ffc90a] font-bold text-slate-900' : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                {option}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
