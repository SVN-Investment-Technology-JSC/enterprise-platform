'use client';

import { DatePicker } from 'antd';
import dayjs from 'dayjs';

export interface DatePickerInputProps {
  value?: string; // YYYY-MM-DD
  onChange?: (val: string) => void; // emits YYYY-MM-DD ('' khi xóa)
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  /** Bắt buộc nhập: form HTML chặn gửi khi chưa chọn ngày (qua ô ẩn bên dưới). */
  required?: boolean;
  /** Có name thì đóng góp giá trị YYYY-MM-DD vào form không điều khiển (FormData). */
  name?: string;
  'aria-label'?: string;
  /** Chiều cao ô nhập (px). Mặc định 32; dùng 38 để thẳng hàng với SearchableSelect. */
  height?: number;
}

const DISPLAY_FORMAT = 'DD/MM/YYYY';
const ISO_FORMAT = 'YYYY-MM-DD';

/**
 * Ô chọn ngày dùng lịch của Ant Design (không dùng lịch HTML gốc của trình duyệt).
 * Giá trị vào/ra là chuỗi YYYY-MM-DD, hiển thị dd/mm/yyyy; vẫn gõ tay được.
 */
export function DatePickerInput({
  value,
  onChange,
  placeholder = 'dd/mm/yyyy',
  className,
  disabled,
  min,
  max,
  id,
  required,
  name,
  'aria-label': ariaLabel,
  height = 32,
}: DatePickerInputProps) {
  const parsed = value ? dayjs(value) : null;
  const current = parsed && parsed.isValid() ? parsed : null;
  const picker = (
    <DatePicker
      id={id}
      aria-label={ariaLabel}
      className={`w-full ${className ?? ''}`.trim()}
      style={{ height, borderRadius: 8, fontSize: height >= 36 ? 13.5 : 12 }}
      value={current}
      format={DISPLAY_FORMAT}
      placeholder={placeholder}
      disabled={disabled}
      allowClear
      needConfirm={false}
      disabledDate={(date) =>
        Boolean(
          (min && date.isBefore(dayjs(min), 'day')) ||
            (max && date.isAfter(dayjs(max), 'day')),
        )
      }
      onChange={(date) => onChange?.(date ? date.format(ISO_FORMAT) : '')}
    />
  );
  if (!name && !required) return picker;
  // Ô ẩn để form HTML đọc được giá trị (name) và chặn gửi khi thiếu (required).
  return (
    <div className="relative w-full">
      {picker}
      <input
        type="text"
        name={name}
        value={value ?? ''}
        required={required}
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => undefined}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
      />
    </div>
  );
}

export interface MonthPickerInputProps {
  'aria-label'?: string;
  value?: string; // YYYY-MM
  onChange?: (val: string) => void; // emits YYYY-MM ('' khi xóa)
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  height?: number;
}

/** Ô chọn tháng (Ant Design), giá trị vào/ra YYYY-MM, hiển thị mm/yyyy. */
export function MonthPickerInput({
  'aria-label': ariaLabel,
  value,
  onChange,
  placeholder = 'mm/yyyy',
  className,
  disabled,
  id,
  height = 32,
}: MonthPickerInputProps) {
  const parsed = value ? dayjs(`${value}-01`) : null;
  const current = parsed && parsed.isValid() ? parsed : null;
  return (
    <DatePicker
      picker="month"
      id={id}
      aria-label={ariaLabel}
      className={`w-full ${className ?? ''}`.trim()}
      style={{ height, borderRadius: 8, fontSize: height >= 36 ? 13.5 : 12 }}
      value={current}
      format="MM/YYYY"
      placeholder={placeholder}
      disabled={disabled}
      allowClear
      needConfirm={false}
      onChange={(date) => onChange?.(date ? date.format('YYYY-MM') : '')}
    />
  );
}
