'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { isMonthKey, shiftMonth } from '../hrm-timesheet-format';

/**
 * Chọn tháng kiểu gọn: nút tháng trước, nhãn "Tháng MM/YYYY" (bấm để chọn tháng bất kỳ), nút tháng sau.
 * Ô chọn tháng gốc của trình duyệt nằm trong suốt phía trên nhãn để vẫn nhảy được tới tháng xa.
 */
export function MonthStepper({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const valid = isMonthKey(month);
  const label = valid
    ? `Tháng ${month.slice(5, 7)}/${month.slice(0, 4)}`
    : 'Chọn tháng';
  return (
    <div className="inline-flex h-9 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
      <button
        type="button"
        aria-label="Tháng trước"
        disabled={!valid}
        onClick={() => onChange(shiftMonth(month, -1))}
        className="flex w-9 items-center justify-center border-r border-slate-200 text-slate-600 hover:bg-slate-50"
      >
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative flex min-w-[148px] cursor-pointer items-center justify-center gap-2 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
        <CalendarDays className="size-4 text-slate-500" />
        <span>{label}</span>
        <input
          type="month"
          aria-label="Tháng"
          value={valid ? month : ''}
          onChange={(e) => {
            if (isMonthKey(e.target.value)) onChange(e.target.value);
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <button
        type="button"
        aria-label="Tháng sau"
        disabled={!valid}
        onClick={() => onChange(shiftMonth(month, 1))}
        className="flex w-9 items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
