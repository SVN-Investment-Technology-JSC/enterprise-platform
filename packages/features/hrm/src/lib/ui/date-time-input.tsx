'use client';

import { useRef } from 'react';
import { DatePickerInput } from './date-picker-input';
import { TimeComboInput } from './time-combo-input';
import { TimeTextInput } from './time-text-input';
import { cn } from '../utils';

/** Tách 'YYYY-MM-DDTHH:mm[:ss]' thành ngày và giờ. */
export function splitDateTime(value?: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(value ?? '');
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}

/** Ngày chọn từ DatePickerInput + giờ gõ tay; phát ra 'YYYY-MM-DDTHH:mm[:ss]' như input datetime-local. */
export function DateTimeInput({
  value,
  onChange,
  className,
  disabled,
  required,
  withSeconds = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  withSeconds?: boolean;
  'aria-label'?: string;
}) {
  const { date, time } = splitDateTime(value);
  // Giờ đã chọn gần nhất: khi ngày bị xoá rồi chọn lại, giờ không bị đặt lại về 00:00.
  const lastTime = useRef(time);
  if (time) lastTime.current = time;
  const emit = (d: string, t: string) => {
    if (!d) return onChange('');
    onChange(`${d}T${t || lastTime.current || (withSeconds ? '00:00:00' : '00:00')}`);
  };
  return (
    <div className={cn('grid grid-cols-[1fr_6.5rem] gap-1.5', className)}>
      <DatePickerInput
        value={date}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel ? `${ariaLabel} (ngày)` : undefined}
        onChange={(d) => emit(d, time)}
      />
      {withSeconds ? (
        <TimeTextInput
          value={time}
          disabled={disabled}
          required={required}
          withSeconds
          aria-label={ariaLabel ? `${ariaLabel} (giờ)` : undefined}
          className="h-9 text-xs font-mono"
          onChange={(t) => emit(date, t)}
        />
      ) : (
        // Giờ 24 giờ: gõ tay hoặc chọn từ danh sách mốc giờ.
        <TimeComboInput
          value={time}
          disabled={disabled}
          required={required}
          aria-label={ariaLabel ? `${ariaLabel} (giờ)` : undefined}
          onChange={(t) => emit(date, t)}
        />
      )}
    </div>
  );
}
