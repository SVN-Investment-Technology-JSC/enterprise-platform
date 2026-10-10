'use client';

import { useMemo, useState } from 'react';
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
  const rowOptions: SearchableSelectOption[] = useMemo(
    () => [
      { value: OFF, label: 'Nghỉ (OFF)' },
      { value: SKIP, label: 'Không thay đổi (bỏ qua ngày này)' },
      ...shiftOptions,
    ],
    [shiftOptions],
  );
  const [weekdayShift, setWeekdayShift] = useState('');
  const [fullShift, setFullShift] = useState('');
  const [halfShift, setHalfShift] = useState('');
  const [sundayShift, setSundayShift] = useState('');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-semibold text-slate-700">Lịch trong tuần</div>
        <ul className="flex flex-col gap-1.5">
          {WEEKDAYS.map((weekday) => {
            const row = pattern.find((r) => r.weekday === weekday) as PatternRow;
            return (
              <li key={weekday} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
                <span
                  className={cn(
                    'text-xs font-semibold',
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
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs font-semibold text-slate-700">Lối tắt điền nhanh</div>
        <p className="text-[11px] text-slate-500">
          Các nút dưới đây chỉ điền sẵn các dòng T2-CN bên trái từ danh mục ca; bạn vẫn có thể chỉnh từng ngày.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-slate-600">Ngày thường (T2-T6)</span>
          <SearchableSelect
            options={shiftOptions}
            value={weekdayShift}
            placeholder="Chọn ca cho T2-T6…"
            onChange={setWeekdayShift}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!weekdayShift}
              onClick={() => onChange(applyShortcut(pattern, [1, 2, 3, 4, 5], { kind: 'SHIFT', shiftId: weekdayShift }))}
            >
              Áp ca cho T2-T6
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-slate-200 pt-2">
          <span className="text-[11px] font-semibold text-slate-600">Thứ bảy</span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <SearchableSelect options={shiftOptions} value={fullShift} placeholder="Ca cả ngày…" onChange={setFullShift} />
            <Button
              variant="outline"
              size="sm"
              disabled={!fullShift}
              onClick={() => onChange(applySaturdayShortcut(pattern, { kind: 'FULL', shiftId: fullShift }))}
            >
              Cả ngày
            </Button>
            <SearchableSelect options={shiftOptions} value={halfShift} placeholder="Ca nửa ngày…" onChange={setHalfShift} />
            <Button
              variant="outline"
              size="sm"
              disabled={!halfShift}
              onClick={() => onChange(applySaturdayShortcut(pattern, { kind: 'HALF', shiftId: halfShift }))}
            >
              Nửa ngày
            </Button>
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={() => onChange(applySaturdayShortcut(pattern, { kind: 'OFF' }))}>
              Thứ bảy nghỉ
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-slate-200 pt-2">
          <span className="text-[11px] font-semibold text-slate-600">Chủ nhật</span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <SearchableSelect options={shiftOptions} value={sundayShift} placeholder="Ca làm việc Chủ nhật…" onChange={setSundayShift} />
            <Button
              variant="outline"
              size="sm"
              disabled={!sundayShift}
              onClick={() => onChange(applySundayShortcut(pattern, { kind: 'WORK', shiftId: sundayShift }))}
            >
              Làm việc
            </Button>
          </div>
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
