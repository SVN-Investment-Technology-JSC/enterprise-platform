'use client';
import { useState } from 'react';
import type { HrmRequestTimePreview } from '@enterprise-platform/contracts-hrm';
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

/**
 * Khoảng thời gian làm thêm giờ: một ô ngày, giờ bắt đầu, giờ kết thúc và ô "Làm xuyên đêm" (kết thúc vào ngày hôm sau).
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
}) {
  const from = splitDateTime(fromAt);
  const to = splitDateTime(toAt);
  const [draft, setDraft] = useState({ start: startTime, end: endTime, overnight: false });
  const start = from.time || draft.start;
  const end = to.time || draft.end;
  const date = from.date;
  const overnight = date ? Boolean(to.date && to.date > date) : draft.overnight;
  const { preview, previewError, ordered } = useRequestTimePreview({ employeeId, fromAt, toAt, kind: 'ot', onPreview });

  const emit = (next: { date: string; start: string; end: string; overnight: boolean }) => {
    setDraft({ start: next.start, end: next.end, overnight: next.overnight });
    if (!next.date) return onChange({ fromAt: '', toAt: '' });
    onChange({
      fromAt: `${next.date}T${next.start}`,
      toAt: `${next.overnight ? nextDateOf(next.date) : next.date}T${next.end}`,
    });
  };

  return (
    <div className="space-y-2" data-testid="overtime-time-range">
      <span className="block text-xs font-semibold text-slate-700">
        {label} <span className="text-rose-500">*</span>
      </span>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] lg:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
        <label className="block space-y-1">
          <span className="text-[12px] font-medium text-slate-600">Ngày</span>
          <DatePickerInput
            value={date}
            disabled={disabled}
            aria-label="Ngày làm thêm"
            onChange={(d) => emit({ date: d, start, end, overnight })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] font-medium text-slate-600">Từ giờ</span>
          <TimeComboInput
            value={start}
            disabled={disabled}
            aria-label="Giờ bắt đầu"
            onChange={(t) => emit({ date, start: t, end, overnight })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] font-medium text-slate-600">Đến giờ</span>
          <TimeComboInput
            value={end}
            disabled={disabled}
            aria-label="Giờ kết thúc"
            onChange={(t) => emit({ date, start, end: t, overnight })}
          />
        </label>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
          <input
            id={`${idPrefix}-overnight`}
            type="checkbox"
            className="size-4 rounded border-slate-300"
            checked={overnight}
            disabled={disabled}
            onChange={(e) => emit({ date, start, end, overnight: e.target.checked })}
          />
          Làm xuyên đêm
        </label>
      </div>
      {!ordered && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          Giờ kết thúc phải sau giờ bắt đầu; nếu làm qua đêm, hãy chọn &quot;Làm xuyên đêm&quot;.
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
