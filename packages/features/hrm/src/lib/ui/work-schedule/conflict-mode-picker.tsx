'use client';

import { useId } from 'react';
import type { HrmScheduleConflictMode } from '@enterprise-platform/contracts-hrm';
import { cn } from '../../utils';
import {
  CONFLICT_MODE_LABELS,
  availableConflictModes,
} from '../../hrm-work-schedule-model';

const MODE_HINTS: Partial<Record<HrmScheduleConflictMode, string>> = {
  OVERWRITE_ALL: 'Cần quyền quản lý lịch lễ và ngoại lệ.',
};

const RULE_MODE_LABELS: Partial<Record<HrmScheduleConflictMode, string>> = {
  REPORT: 'Chỉ báo xung đột, không ghi',
  SKIP_EXISTING: 'Bỏ qua phạm vi đã có lịch định kỳ',
  OVERWRITE_KEEP_EXCEPTIONS: 'Ghi đè theo thời gian: lịch mới thay lịch định kỳ và lịch từng ngày cũ',
};
const RULE_MODE_HINTS: Partial<Record<HrmScheduleConflictMode, string>> = {
  OVERWRITE_KEEP_EXCEPTIONS: 'Ngoại lệ và ngày lễ vẫn được giữ.',
};

export function ConflictModePicker({
  value,
  onChange,
  canCalendar,
  compact,
  openEnded,
}: {
  value: HrmScheduleConflictMode;
  onChange: (mode: HrmScheduleConflictMode) => void;
  canCalendar: boolean;
  compact?: boolean;
  /** Lịch không có ngày kết thúc: chỉ còn báo xung đột, bỏ qua, hoặc ghi đè lịch định kỳ đang có. */
  openEnded?: boolean;
}) {
  const name = useId();
  const hintOf = (mode: HrmScheduleConflictMode) => (openEnded ? RULE_MODE_HINTS[mode] : MODE_HINTS[mode]);
  return (
    <fieldset className="flex flex-col gap-1.5">
      {compact ? null : (
        <legend className="mb-1 text-xs font-semibold text-slate-700">Khi ngày đã có lịch khác</legend>
      )}
      {availableConflictModes(canCalendar)
        .filter((mode) => !openEnded || mode !== 'OVERWRITE_ALL')
        .map((mode) => (
        <label
          key={mode}
          className={cn(
            'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            value === mode ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300',
          )}
        >
          <input
            type="radio"
            name={name}
            className="mt-0.5 accent-blue-600"
            checked={value === mode}
            onChange={() => onChange(mode)}
          />
          <span>
            <span className="font-semibold text-slate-900">
              {openEnded ? (RULE_MODE_LABELS[mode] ?? CONFLICT_MODE_LABELS[mode]) : CONFLICT_MODE_LABELS[mode]}
            </span>
            {compact || !hintOf(mode) ? null : <span className="block text-[12px] text-slate-500">{hintOf(mode)}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
