'use client';
import { useState, type ReactNode } from 'react';
import type { HrmRequestTimePreview } from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from './date-picker-input';
import { splitDateTime } from './date-time-input';
import { useRequestTimePreview } from './request-time-range';
import { TimeComboInput } from './time-combo-input';

/** Ngày kế tiếp của 'YYYY-MM-DD' (tính theo UTC để không lệch múi giờ). */
export function nextDateOf(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10);
}

const NEXT_MORNING_OPTIONS = [
  { value: 'WORK', label: 'Làm việc bình thường' },
  { value: 'FULL', label: 'Nghỉ cả ngày' },
  { value: 'HALF', label: 'Nghỉ nửa ngày' },
] as const;

/** Sáng hôm sau của ca qua đêm: làm việc bình thường, nghỉ cả ngày hoặc nghỉ nửa ngày. */
export type NextMorning = 'WORK' | 'FULL' | 'HALF';

/**
 * Khoảng thời gian làm thêm giờ, một dòng: ngày, giờ bắt đầu, giờ kết thúc và (khi qua đêm) ô chọn sáng hôm sau. Giờ kết
 * thúc nhỏ hơn giờ bắt đầu (ví dụ 22:00 đến 04:00) tự hiểu là kết thúc vào ngày hôm sau, không có ô "Làm qua đêm" để chọn
 * nhầm (20:00-22:00 cộng qua đêm thành 26 giờ và trùng giờ hành chính).
 * Giá trị vào/ra vẫn là cặp `fromAt`/`toAt` ('YYYY-MM-DDTHH:mm') như mọi khoảng thời gian khác nên form cha, máy chủ và
 * các khoảng bổ sung không đổi cách xử lý. Chưa chọn ngày thì giờ đang nhập được giữ lại trong ô để dùng khi chọn ngày.
 * Không hiện tổng giờ: tổng của từng khoảng và của cả đơn nằm ở khu vực tổng hợp của form.
 */
export function OvertimeTimeRange({
  employeeId,
  fromAt,
  toAt,
  onChange,
  onPreview,
  disabled,
  label = 'Ngày giờ',
  startTime = '17:30',
  endTime = '20:30',
  idPrefix = 'ot',
  morningWorked,
  onMorningWorkedChange,
  morningHalf,
  onMorningHalfChange,
  compact = false,
  trailing,
}: {
  employeeId: string;
  fromAt: string;
  toAt: string;
  onChange: (next: { fromAt: string; toAt: string }) => void;
  /** Báo kết quả tính của máy chủ cho form cha; null khi chưa đủ dữ liệu hoặc đang tính. */
  onPreview?: (preview: HrmRequestTimePreview | null) => void;
  disabled?: boolean;
  label?: string;
  /** Giờ mặc định khi chưa chọn ngày. */
  startTime?: string;
  endTime?: string;
  idPrefix?: string;
  /** Sáng hôm sau có đi làm việc không; ô chọn chỉ hiện khi khoảng qua đêm và có hàm `onMorningWorkedChange`. */
  morningWorked?: boolean;
  onMorningWorkedChange?: (value: boolean) => void;
  /** Chỉ nghỉ nửa ngày sáng hôm sau (khi `morningWorked` là false): ca đêm tối đa 4 giờ. */
  morningHalf?: boolean;
  onMorningHalfChange?: (value: boolean) => void;
  /** true: dòng gọn cho khoảng bổ sung (không tiêu đề, không nhãn trên ô). */
  compact?: boolean;
  /** Phần cuối dòng (ví dụ nút xoá khoảng). */
  trailing?: ReactNode;
}) {
  const from = splitDateTime(fromAt);
  const to = splitDateTime(toAt);
  const [draft, setDraft] = useState({ start: startTime, end: endTime });
  const start = from.time || draft.start;
  const end = to.time || draft.end;
  const date = from.date;
  const { preview, previewError, ordered } = useRequestTimePreview({ employeeId, fromAt, toAt, kind: 'ot', onPreview });

  const emit = (next: { date: string; start: string; end: string }) => {
    // Giờ kết thúc nhỏ hơn giờ bắt đầu: ca kết thúc vào sáng hôm sau (ví dụ 22:00 đến 04:00), vẫn là MỘT khoảng.
    const overnightNow = Boolean(next.start && next.end && next.end < next.start);
    setDraft({ start: next.start, end: next.end });
    if (!next.date) return onChange({ fromAt: '', toAt: '' });
    onChange({
      fromAt: `${next.date}T${next.start}`,
      toAt: `${overnightNow ? nextDateOf(next.date) : next.date}T${next.end}`,
    });
  };

  const morning: NextMorning = morningWorked !== false ? 'WORK' : morningHalf ? 'HALF' : 'FULL';
  const chooseMorning = (value: NextMorning) => {
    onMorningWorkedChange?.(value === 'WORK');
    onMorningHalfChange?.(value === 'HALF');
  };
  const caption = (text: string) =>
    compact ? null : <span className="text-[12px] font-medium text-slate-600">{text}</span>;

  return (
    <div className="space-y-2" data-testid={compact ? undefined : 'overtime-time-range'}>
      {!compact && (
        <span className="block text-xs font-semibold text-slate-700">
          {label} <span className="text-rose-500">*</span>
        </span>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[10rem] flex-1 space-y-1">
          {caption('Ngày')}
          <DatePickerInput
            value={date}
            disabled={disabled}
            aria-label="Ngày làm thêm"
            onChange={(d) => emit({ date: d, start, end })}
          />
        </label>
        <label className="block w-28 space-y-1">
          {caption('Từ giờ')}
          <TimeComboInput
            value={start}
            disabled={disabled}
            aria-label="Giờ bắt đầu"
            onChange={(t) => emit({ date, start: t, end })}
          />
        </label>
        <label className="block w-28 space-y-1">
          {caption('Đến giờ')}
          <TimeComboInput
            value={end}
            disabled={disabled}
            aria-label="Giờ kết thúc"
            onChange={(t) => emit({ date, start, end: t })}
          />
        </label>
        {onMorningWorkedChange && (
          <label className="block w-48 space-y-1">
            {compact ? <span className="sr-only">Sáng hôm sau</span> : caption('Sáng hôm sau')}
            <SearchableSelect
              options={NEXT_MORNING_OPTIONS}
              value={morning}
              height={36}
              searchInDropdown
              hideDropdownSearch
              clearable={false}
              disabled={disabled}
              onChange={(value) => value && chooseMorning(value as NextMorning)}
            />
          </label>
        )}
        <div className="flex h-9 w-[4.5rem] shrink-0 items-center">{trailing}</div>
      </div>
      {!ordered && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          Giờ kết thúc phải khác giờ bắt đầu.
        </p>
      )}
      {preview?.errors.map((text) => (
        <p key={text} role="alert" className="text-xs font-semibold text-rose-600">
          {text}
        </p>
      ))}
      {previewError && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {previewError}
        </p>
      )}
    </div>
  );
}
