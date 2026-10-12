'use client';

import { useEffect, useState } from 'react';
import { Input } from './input';

/**
 * Chuẩn hoá giờ gõ tay về HH:mm. Nhận "730", "0730", "7:30", "7h30", "7.30", "7".
 * Trả về null nếu không phải giờ hợp lệ (00:00 - 23:59).
 */
export function parseTimeText(raw: string, withSeconds = false): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const full = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (full) {
    const [h, m, sec] = [Number(full[1]), Number(full[2]), Number(full[3])];
    if (h > 23 || m > 59 || sec > 59) return null;
    const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return withSeconds ? `${base}:${String(sec).padStart(2, '0')}` : base;
  }
  let hh: string;
  let mm: string;
  const sep = text.match(/^(\d{1,2})\s*[:h.]\s*(\d{1,2})?$/);
  if (sep) {
    hh = sep[1];
    mm = sep[2] ?? '0';
  } else if (/^\d{1,2}$/.test(text)) {
    hh = text;
    mm = '0';
  } else if (/^\d{3,4}$/.test(text)) {
    hh = text.slice(0, -2);
    mm = text.slice(-2);
  } else {
    return null;
  }
  const h = Number(hh);
  const m = Number(mm);
  if (h > 23 || m > 59) return null;
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return withSeconds ? `${base}:00` : base;
}

/** Ô nhập giờ gõ tay (không dùng bộ chọn giờ của trình duyệt). */
export function TimeTextInput({
  value,
  onChange,
  className,
  disabled,
  required,
  withSeconds = false,
  id,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  /** Hiển thị và nhập thêm giây (HH:mm:ss). */
  withSeconds?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const parsed = parseTimeText(draft, withSeconds);
    if (parsed) {
      setDraft(parsed);
      if (parsed !== value) onChange(parsed);
    } else {
      setDraft(value);
    }
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      required={required}
      placeholder={withSeconds ? 'HH:mm:ss' : 'HH:mm'}
      maxLength={withSeconds ? 8 : 5}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      aria-invalid={parseTimeText(draft, withSeconds) === null}
      className={className}
    />
  );
}
