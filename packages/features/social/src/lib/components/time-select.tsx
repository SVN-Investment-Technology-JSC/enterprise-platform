'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo } from 'react';

const STEP_MINUTES = 15;

/** Các mốc giờ trong ngày cách nhau 15 phút: "00:00", "00:15", … "23:45". */
export const TIME_SLOTS: readonly string[] = Array.from(
  { length: (24 * 60) / STEP_MINUTES },
  (_, index) => {
    const minutes = index * STEP_MINUTES;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  },
);

export interface TimeSelectProps {
  /** "HH:mm" (giờ Việt Nam). */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * Ô chọn giờ: thư viện chưa có ô chọn giờ riêng nên dùng `SearchableSelect` với mốc 15 phút
 * (không dùng `<input type="time">` gốc). Giờ lẻ đã có sẵn (vd 08:07) vẫn hiện được.
 */
export function TimeSelect({ value, onChange, label, disabled }: TimeSelectProps) {
  const options = useMemo(() => {
    const slots =
      value && !TIME_SLOTS.includes(value)
        ? [...TIME_SLOTS, value].sort()
        : TIME_SLOTS;
    return slots.map((slot) => ({ value: slot, label: slot }));
  }, [value]);
  return (
    <div role="group" aria-label={label}>
      <SearchableSelect
        options={options}
        value={value}
        height={38}
        searchInDropdown
        placeholder="--:--"
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
