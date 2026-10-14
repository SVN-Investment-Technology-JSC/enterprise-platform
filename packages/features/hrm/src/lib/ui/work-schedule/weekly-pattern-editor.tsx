'use client';

import { useMemo } from 'react';
import type { HrmShiftDefinition } from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  WEEKDAYS,
  WEEKDAY_FULL_LABELS,
  WEEKDAY_LABELS,
  applySaturdayShortcut,
  applyShortcut,
  applySundayShortcut,
  setPatternDay,
  shiftLabel,
  type PatternRow,
} from '../../hrm-work-schedule-model';
import { Button } from '../button';
import { cn } from '../../utils';

const OFF = '__OFF__';
const SKIP = '__SKIP__';

/** Chỉ ca đang hoạt động (ACTIVE) mới được gán; mọi ca đều lấy từ danh mục ca có sẵn. */
export function useShiftOptions(shifts: readonly HrmShiftDefinition[]): SearchableSelectOption[] {
  return useMemo(
    () =>
      shifts
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => ({ value: s.id, label: shiftLabel(s), badge: s.code })),
    [shifts],
  );
}

/** Ca chung của các thứ đã chọn (cùng một ca, không có ngày nghỉ hoặc bỏ qua xen kẽ); khác nhau thì để trống. */
function sharedShift(pattern: readonly PatternRow[], weekdays: readonly number[]): string {
  const rows = pattern.filter((r) => weekdays.includes(r.weekday));
  const first = rows[0];
  return first?.dayType === 'SHIFT' && first.shiftId && rows.every((r) => r.dayType === 'SHIFT' && r.shiftId === first.shiftId)
    ? first.shiftId
    : '';
}

function valueOf(row: PatternRow): string {
  if (row.dayType === 'OFF') return OFF;
  if (row.dayType === 'SKIP') return SKIP;
  return row.shiftId ?? '';
}

export function WeeklyPatternEditor({
  pattern,
  onChange,
  shifts,
}: {
  pattern: PatternRow[];
  onChange: (next: PatternRow[]) => void;
  shifts: readonly HrmShiftDefinition[];
}) {
  const shiftOptions = useShiftOptions(shifts);
  const skipped = pattern.filter((r) => r.dayType === 'SKIP');
  const rowOptions: SearchableSelectOption[] = useMemo(
    () => [
      { value: OFF, label: 'Nghỉ (OFF)' },
      { value: SKIP, label: 'Không thay đổi (bỏ qua)' },
      ...shiftOptions,
    ],
    [shiftOptions],
  );
  return (
    <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-semibold text-slate-700">Lịch trong tuần</div>
        <ul className="flex flex-col gap-1.5">
          {WEEKDAYS.map((weekday) => {
            const row = pattern.find((r) => r.weekday === weekday) as PatternRow;
            return (
              <li key={weekday} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
                <span
                  className={cn(
                    'whitespace-nowrap text-xs font-semibold',
                    weekday === 7 ? 'text-rose-600' : weekday === 6 ? 'text-amber-700' : 'text-slate-700',
                  )}
                >
                  {WEEKDAY_LABELS[weekday]}
                  <span className="ml-1 font-normal text-slate-400">{WEEKDAY_FULL_LABELS[weekday]}</span>
                </span>
                <SearchableSelect
                  options={rowOptions}
                  value={valueOf(row)}
                  placeholder="Chọn ca, nghỉ hoặc bỏ qua…"
                  emptyText="Không tìm thấy ca phù hợp"
                  clearable={false}
                  onChange={(v) =>
                    onChange(
                      setPatternDay(
                        pattern,
                        weekday,
                        v === OFF
                          ? { dayType: 'OFF' }
                          : v === SKIP || !v
                            ? { dayType: 'SKIP' }
                            : { dayType: 'SHIFT', shiftId: v },
                      ),
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
        {skipped.length > 0 ? (
          <p
            data-testid="pattern-skip-warning"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
          >
            Chưa chọn ca cho: {skipped.map((r) => WEEKDAY_LABELS[r.weekday]).join(', ')}. Những ngày này sẽ không có ca sau khi lưu.
            Chọn ca hoặc Nghỉ cho từng ngày, hoặc dùng lối tắt bên cạnh.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs font-semibold text-slate-700">Lối tắt điền nhanh</div>
        <p className="text-[11px] text-slate-500">
          Chọn ca ở đây là điền ngay vào các dòng T2-CN bên trái; bạn vẫn có thể chỉnh từng ngày.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-slate-600">Ngày thường (T2-T6)</span>
          <SearchableSelect
            options={shiftOptions}
            value={sharedShift(pattern, [1, 2, 3, 4, 5])}
            placeholder="Chọn ca cho T2-T6…"
            clearable={false}
            onChange={(v) => v && onChange(applyShortcut(pattern, [1, 2, 3, 4, 5], { kind: 'SHIFT', shiftId: v }))}
          />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-slate-200 pt-2">
          <span className="text-[11px] font-semibold text-slate-600">Thứ bảy</span>
          <SearchableSelect
            options={shiftOptions}
            value={sharedShift(pattern, [6])}
            placeholder="Chọn ca làm việc thứ bảy (cả ngày hoặc nửa ngày)…"
            clearable={false}
            onChange={(v) => v && onChange(applySaturdayShortcut(pattern, { kind: 'FULL', shiftId: v }))}
          />
          <div>
            <Button variant="outline" size="sm" onClick={() => onChange(applySaturdayShortcut(pattern, { kind: 'OFF' }))}>
              Thứ bảy nghỉ
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-slate-200 pt-2">
          <span className="text-[11px] font-semibold text-slate-600">Chủ nhật</span>
          <SearchableSelect
            options={shiftOptions}
            value={sharedShift(pattern, [7])}
            placeholder="Chọn ca làm việc chủ nhật…"
            clearable={false}
            onChange={(v) => v && onChange(applySundayShortcut(pattern, { kind: 'WORK', shiftId: v }))}
          />
          <div>
            <Button variant="outline" size="sm" onClick={() => onChange(applySundayShortcut(pattern, { kind: 'OFF' }))}>
              Chủ nhật nghỉ
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
