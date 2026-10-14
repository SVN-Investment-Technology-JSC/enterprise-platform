/**
 * Bản thay thế dùng riêng cho test (jest ánh xạ '@enterprise-platform/shared-ui/date-picker' về file này).
 * Ant Design DatePicker cần matchMedia/ResizeObserver mà jsdom không có, nên test dùng ô nhập văn bản dd/mm/yyyy
 * có cùng props và cùng giá trị vào/ra (YYYY-MM-DD) với DatePickerInput thật trong shared-ui.
 */
import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export interface DatePickerInputProps {
  /** Chiều cao ô (bỏ qua trong bản dùng cho test). */
  height?: number;
  value?: string; // YYYY-MM-DD
  onChange?: (val: string) => void; // emits YYYY-MM-DD
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  required?: boolean;
  /** Có name thì đóng góp giá trị YYYY-MM-DD vào form không điều khiển (FormData). */
  name?: string;
  'aria-label'?: string;
}

// Convert YYYY-MM-DD -> DD/MM/YYYY
function toVnDateStr(isoStr?: string): string {
  if (!isoStr) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr);
  if (!match) return '';
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

// Convert DD/MM/YYYY -> YYYY-MM-DD (validates date)
function parseVnDateToIso(vnStr: string): string | null {
  const parts = vnStr.split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;

  const dateObj = new Date(year, month - 1, day);
  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

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
}: DatePickerInputProps) {
  const [displayText, setDisplayText] = React.useState<string>(toVnDateStr(value));
  const hiddenNativeRef = React.useRef<HTMLInputElement>(null);

  // Sync external value change
  React.useEffect(() => {
    setDisplayText(toVnDateStr(value));
  }, [value]);

  // Vào ô: chọn hết chữ để gõ đè ngay, nhưng KHÔNG xoá giá trị. Trước đây bấm vào ô là xoá ngày (và báo lên form cha),
  // nên đổi sang ô giờ bên cạnh mà chưa nhập lại thì ngày bị mất, giờ bị đặt lại về 00:00.
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  // Text typing with automatic slash formatting: gõ số tự động thêm dấu /
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digitsOnly = raw.replace(/\D/g, '');
    let formatted = digitsOnly;
    if (digitsOnly.length > 2 && digitsOnly.length <= 4) {
      formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
    } else if (digitsOnly.length > 4) {
      formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
    }

    setDisplayText(formatted);

    if (formatted.length === 10) {
      const iso = parseVnDateToIso(formatted);
      if (iso) {
        onChange?.(iso);
      }
    } else if (formatted === '') {
      onChange?.('');
    }
  };

  const handleBlur = () => {
    if (displayText && displayText.length === 10) {
      const iso = parseVnDateToIso(displayText);
      if (iso) {
        onChange?.(iso);
      } else {
        // Revert to current valid value if invalid date entered
        setDisplayText(toVnDateStr(value));
      }
    } else if (!displayText) {
      // Chủ động xoá trắng ô thì mới xoá ngày; không báo lại khi vốn đã trống.
      if (value) onChange?.('');
    } else {
      // Partial invalid input -> revert
      setDisplayText(toVnDateStr(value));
    }
  };

  const openCalendar = () => {
    if (disabled) return;
    if (hiddenNativeRef.current) {
      try {
        if ('showPicker' in HTMLInputElement.prototype) {
          hiddenNativeRef.current.showPicker();
        } else {
          hiddenNativeRef.current.focus();
        }
      } catch {
        hiddenNativeRef.current.focus();
      }
    }
  };

  const handleNativeDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange?.(val);
    setDisplayText(toVnDateStr(val));
  };

  return (
    <div className={cn('relative flex items-center w-full', className)}>
      <input
        id={id}
        aria-label={ariaLabel}
        required={required}
        type="text"
        value={displayText}
        onFocus={handleFocus}
        onChange={handleTextChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={10}
        data-slot="input"
        className="h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white pl-2.5 pr-8 py-1 text-xs font-mono transition-colors outline-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50"
      />

      {name && <input type="hidden" name={name} value={value || ''} />}

      {/* Hidden native date input to trigger browser's calendar modal */}
      <input
        ref={hiddenNativeRef}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleNativeDateChange}
        className="sr-only pointer-events-none absolute opacity-0"
      />

      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={openCalendar}
        className="absolute right-2 text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors focus:outline-none"
        title="Chọn ngày từ lịch"
      >
        <CalendarIcon className="size-3.5" />
      </button>
    </div>
  );
}

export interface MonthPickerInputProps {
  value?: string; // YYYY-MM
  onChange?: (val: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  height?: number;
}

export function MonthPickerInput({
  value,
  onChange,
  placeholder = 'mm/yyyy',
  className,
  disabled,
  id,
}: MonthPickerInputProps) {
  return (
    <input
      id={id}
      type="month"
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}
