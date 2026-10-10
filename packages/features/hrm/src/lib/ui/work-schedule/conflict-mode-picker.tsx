'use client';

import { useId } from 'react';
import type { HrmScheduleConflictMode } from '@enterprise-platform/contracts-hrm';
import { cn } from '../../utils';
import {
  CONFLICT_MODE_LABELS,
  availableConflictModes,
} from '../../hrm-work-schedule-model';

const MODE_HINTS: Record<HrmScheduleConflictMode, string> = {
  REPORT: 'Mặc định: nếu có ngày đã có lịch khác, hệ thống chỉ báo xung đột và không ghi gì.',
  SKIP_EXISTING: 'Chỉ gán những ngày chưa có lịch; ngày đã có lịch giữ nguyên.',
  OVERWRITE_KEEP_EXCEPTIONS: 'Thay lịch thường bằng lịch mới nhưng không đụng tới ngoại lệ và ngày lễ.',
  OVERWRITE_ALL: 'Ghi đè mọi lịch, kể cả ngoại lệ. Cần quyền quản lý lịch lễ và ngoại lệ.',
};

const RULE_MODE_LABELS: Partial<Record<HrmScheduleConflictMode, string>> = {
  REPORT: 'Chỉ báo xung đột, không ghi',
  SKIP_EXISTING: 'Bỏ qua phạm vi đã có lịch định kỳ',
  OVERWRITE_KEEP_EXCEPTIONS: 'Ghi đè lịch định kỳ đang có (kết thúc hoặc hủy)',
};
const RULE_MODE_HINTS: Partial<Record<HrmScheduleConflictMode, string>> = {
  REPORT: 'Nếu phạm vi đã có lịch định kỳ còn hiệu lực từ ngày bắt đầu, hệ thống chỉ báo và không ghi.',
  SKIP_EXISTING: 'Phạm vi nào đã có lịch định kỳ thì giữ nguyên, chỉ tạo cho phạm vi chưa có.',
  OVERWRITE_KEEP_EXCEPTIONS:
    'Lịch định kỳ cũ bị kết thúc vào ngày trước ngày bắt đầu hoặc hủy. Ngoại lệ và ngày lễ vẫn được giữ vì lưu theo từng ngày.',
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
            {compact ? null : (
              <span className="block text-[11px] text-slate-500">
                {openEnded ? (RULE_MODE_HINTS[mode] ?? MODE_HINTS[mode]) : MODE_HINTS[mode]}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
