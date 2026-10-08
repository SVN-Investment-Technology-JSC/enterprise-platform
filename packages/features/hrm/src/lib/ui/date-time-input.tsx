'use client';

import { DatePickerInput } from './date-picker-input';
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
  const emit = (d: string, t: string) => {
    if (!d) return onChange('');
    onChange(`${d}T${t || (withSeconds ? '00:00:00' : '00:00')}`);
  };
  return (
    <div className={cn('grid grid-cols-[1fr_5.5rem] gap-1.5', className)}>
      <DatePickerInput
        value={date}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel ? `${ariaLabel} (ngày)` : undefined}
        onChange={(d) => emit(d, time)}
      />
      <TimeTextInput
        value={time}
        disabled={disabled}
        required={required}
        withSeconds={withSeconds}
        aria-label={ariaLabel ? `${ariaLabel} (giờ)` : undefined}
        className="h-8 text-xs font-mono"
        onChange={(t) => emit(date, t)}
      />
    </div>
  );
}
