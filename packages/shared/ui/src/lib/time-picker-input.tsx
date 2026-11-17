'use client';

import { TimePicker } from 'antd';
import dayjs from 'dayjs';

export interface TimePickerInputProps {
  /** "HH:mm" (24 giờ). */
  value?: string;
  onChange?: (val: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
  /** Chiều cao ô nhập (px). Mặc định 32; dùng 38 để thẳng hàng với SearchableSelect. */
  height?: number;
}

const FORMAT = 'HH:mm';

/**
 * Ô chọn giờ 24 giờ (HH:mm) của Ant Design: một ô hiện "09:00", bấm vào xổ ra hai cột (giờ, phút) để chọn, không gõ.
 * Không dùng `<input type="time">` gốc vì nó hiện AM/PM tuỳ ngôn ngữ trình duyệt.
 */
export function TimePickerInput({
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  height = 32,
}: TimePickerInputProps) {
  const parsed = value ? dayjs(value, FORMAT, true) : null;
  const current = parsed && parsed.isValid() ? parsed : null;
  return (
    <TimePicker
      aria-label={ariaLabel}
      className="w-full"
      style={{ height, borderRadius: 6, fontSize: height >= 36 ? 13.5 : 12 }}
      value={current}
      format={FORMAT}
      placeholder="--:--"
      disabled={disabled}
      allowClear={false}
      showNow={false}
      needConfirm={false}
      inputReadOnly
      use12Hours={false}
      onChange={(time) => {
        if (time) onChange?.(time.format(FORMAT));
      }}
    />
  );
}
