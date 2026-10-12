'use client';
import { useId, type ReactNode } from 'react';

/** Công tắc bật/tắt dùng chung cho các biểu mẫu cấu hình phép năm và lý do nghỉ. */
export function LeaveSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  /** Tên truy cập (đọc bởi trình đọc màn hình); nhãn hiển thị do nơi dùng tự vẽ. */
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-slate-200'
      }`}
    >
      <span
        className={`inline-block size-4.5 rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/**
 * Trường nhập có nhãn. Có `htmlFor` thì nhãn gắn với ô nhập; không có (ví dụ
 * SearchableSelect, không nhận id) thì nhóm được gắn nhãn bằng aria-labelledby.
 */
export function LeaveField({
  label,
  required,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const mark = required ? (
    <span className="ml-1 font-bold text-red-500" aria-hidden="true">
      *
    </span>
  ) : null;
  const labelClass = 'block text-xs font-medium text-slate-700';
  return (
    <div
      className={`space-y-1 ${className ?? ''}`}
      {...(htmlFor ? {} : { role: 'group', 'aria-labelledby': labelId })}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
          {mark}
        </label>
      ) : (
        <span id={labelId} className={labelClass}>
          {label}
          {mark}
        </span>
      )}
      {children}
      {hint ? (
        <p className="text-[11px] leading-snug text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
