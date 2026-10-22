'use client';

import {
  SearchableSelect,
  type SearchableSelectExtra,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { useRef, type ReactNode } from 'react';

/**
 * Ô chọn duy nhất của Workspace.
 *
 * Quy chuẩn chung của hệ thống: mọi trường chọn đều là combobox gõ để lọc
 * (`SearchableSelect` của `shared-ui`), không dùng `<select>` tĩnh. Lớp bọc
 * này chỉ thêm hai thứ mà `SearchableSelect` không nhận:
 *
 * - `label`: gắn vào `aria-label` của một nhóm bao ngoài, để đọc màn hình và
 *   kịch bản kiểm thử vẫn tìm được ô chọn theo tên như thời còn `<select>`;
 * - `options` dạng `{ value, label }` gọn, kèm tuỳ chọn rỗng (`emptyOption`)
 *   thay cho `<option value="">…</option>` trước đây.
 */
export interface ChoiceProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SearchableSelectOption[];
  readonly onChange: (value: string) => void;
  /** Nhãn của mục rỗng, ví dụ "Chưa giao". Bỏ trống thì không có mục rỗng. */
  readonly emptyOption?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly title?: string;
  readonly className?: string;
  /** Chiều cao ô (px); mặc định của `SearchableSelect` là 38. */
  readonly height?: number;
  /** Vẽ riêng một dòng trong danh sách (vd thêm thẻ); vắng thì chỉ hiện nhãn. */
  readonly renderOption?: (option: SearchableSelectOption) => ReactNode;
  /** Nhóm phụ gập sau một nút, xếp sau danh sách chính (vd "Ngoài dự án"). */
  readonly extra?: SearchableSelectExtra;
}

export function Choice({
  label,
  value,
  options,
  onChange,
  emptyOption,
  placeholder,
  disabled,
  required,
  title,
  className,
  height,
  renderOption,
  extra,
}: ChoiceProps) {
  const all = emptyOption === undefined ? options : [{ value: '', label: emptyOption }, ...options];
  const box = useRef<HTMLDivElement>(null);



  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      data-choice={label}
      // Ô hẹp thì nhãn dài bị cắt; rê chuột luôn đọc được đủ.
      title={
        title ??
        (all.find((option) => option.value === value) ?? extra?.options.find((option) => option.value === value))
          ?.label
      }
    >
      <SearchableSelect
        options={all}
        value={value}
        disabled={disabled}
        required={required}
        className={className}
        height={height}
        extra={extra}
        clearable={emptyOption !== undefined}
        placeholder={placeholder ?? emptyOption ?? `Chọn ${label.toLowerCase()}…`}
        // Chọn xong thì bỏ focus khỏi ô nhập. Danh sách đã tự đóng, nhưng ô
        // còn focus thì bất kỳ sự kiện focus nào sau đó — trình duyệt trả focus
        // sau một lần vẽ lại, hay nhãn bao ngoài kích hoạt — cũng mở nó ra lần
        // nữa, và người dùng thấy danh sách "không chịu đóng".
        onChange={(value) => {
          onChange(value);
          requestAnimationFrame(() => {
            box.current?.querySelector('input')?.blur();
          });
        }}
        // `data-value` để kịch bản kiểm thử chọn được đúng mục theo id, việc mà
        // `<option value=…>` trước đây làm sẵn. Người dùng không thấy gì khác.
        renderOption={(option) => (
          <span data-value={option.value}>{renderOption ? renderOption(option) : option.label}</span>
        )}
      />
    </div>
  );
}
