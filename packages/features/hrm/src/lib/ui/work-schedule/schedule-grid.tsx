'use client';

import { memo, useMemo } from 'react';
import type {
  HrmHoliday,
  HrmScheduleDay,
  HrmScheduleEmployee,
  HrmScheduleGrid,
} from '@enterprise-platform/contracts-hrm';
import { cn } from '../../utils';
import {
  WEEKDAY_LABELS,
  cellVisual,
  companyHolidayOn,
  isoWeekday,
  listDates,
  pageCount,
  type CellKind,
} from '../../hrm-work-schedule-model';
import { Button } from '../button';
import { EmptyState, Spinner } from './common';

const KIND_CLASS: Record<CellKind, string> = {
  SHIFT: 'bg-blue-50 text-blue-800 border-blue-200',
  OFF: 'bg-slate-100 text-slate-500 border-slate-200',
  HOLIDAY: 'bg-rose-50 text-rose-700 border-rose-200',
  HOLIDAY_SHIFT: 'bg-orange-50 text-orange-800 border-orange-200',
  EMPTY: 'bg-white text-slate-300 border-dashed border-slate-200',
};

/** Ca ghi tay khác ca sinh từ mẫu tuần: tô sắc xanh chàm để nhận ra nguồn. */
const MANUAL_SHIFT_CLASS = 'bg-indigo-50 text-indigo-800 border-indigo-200';

/** Ca từ lịch định kỳ (không ngày kết thúc): gần màu mẫu tuần nhưng sắc xanh lơ, nét viền liền đậm hơn. */
const RULE_SHIFT_CLASS = 'bg-sky-50 text-sky-800 border-sky-300';

export const SCHEDULE_LEGEND: { key: string; label: string; className: string }[] = [
  { key: 'template', label: 'Ca theo mẫu tuần', className: KIND_CLASS.SHIFT },
  { key: 'rule', label: 'Ca định kỳ (không kết thúc)', className: RULE_SHIFT_CLASS },
  { key: 'manual', label: 'Ca gán thủ công', className: MANUAL_SHIFT_CLASS },
  { key: 'off', label: 'Ngày nghỉ (OFF)', className: KIND_CLASS.OFF },
  { key: 'holiday', label: 'Ngày lễ nghỉ', className: KIND_CLASS.HOLIDAY },
  { key: 'holiday-shift', label: 'Ngày lễ vẫn bố trí ca', className: KIND_CLASS.HOLIDAY_SHIFT },
  { key: 'empty', label: 'Chưa có lịch', className: KIND_CLASS.EMPTY },
];

export function ScheduleLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="Chú giải màu">
      {SCHEDULE_LEGEND.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span className={cn('inline-block h-3.5 w-5 rounded border', item.className)} aria-hidden />
          {item.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="relative inline-block h-3.5 w-5 rounded border border-blue-200 bg-blue-50 ring-1 ring-amber-500"
        >
          <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" />
        </span>
        Ngoại lệ (viền và chấm vàng)
      </li>
    </ul>
  );
}

const ScheduleCell = memo(function ScheduleCell({
  employee,
  date,
  day,
  holidays,
  wide,
  clickable,
  onClick,
}: {
  employee: HrmScheduleEmployee;
  date: string;
  day: HrmScheduleDay | undefined;
  holidays: readonly HrmHoliday[];
  wide: boolean;
  clickable: boolean;
  onClick: (employee: HrmScheduleEmployee, date: string, day?: HrmScheduleDay) => void;
}) {
  const visual = cellVisual(day, date, holidays);
  const tone =
    visual.kind === 'SHIFT' && day?.source === 'MANUAL'
      ? MANUAL_SHIFT_CLASS
      : visual.kind === 'SHIFT' && day?.source === 'RULE'
        ? RULE_SHIFT_CLASS
        : KIND_CLASS[visual.kind];
  const content = (
    <span
      className={cn(
        'relative flex h-8 items-center justify-center rounded border text-[11px] font-semibold',
        wide ? 'min-w-20 px-2' : 'min-w-8 px-1',
        tone,
        visual.exception && 'ring-1 ring-amber-500',
      )}
      title={visual.title}
      data-kind={visual.kind}
      data-exception={visual.exception ? 'true' : undefined}
      data-source={day?.source}
    >
      <span className="truncate">{visual.label}</span>
      {wide && visual.kind === 'SHIFT' && day?.startTime ? (
        <span className="ml-1 hidden text-[10px] font-normal opacity-70 xl:inline">
          {day.startTime}
        </span>
      ) : null}
      {visual.exception ? (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" />
      ) : null}
    </span>
  );
  return (
    <td className="p-0.5 text-center align-middle">
      {clickable ? (
        <button
          type="button"
          className="block w-full cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={`${employee.code}, ${date}: ${visual.title}`}
          onClick={() => onClick(employee, date, day)}
        >
          {content}
        </button>
      ) : (
        <span className="block w-full" aria-label={`${employee.code}, ${date}: ${visual.title}`}>
          {content}
        </span>
      )}
    </td>
  );
});

export function ScheduleGridView({
  grid,
  loading,
  error,
  from,
  to,
  wide,
  selectedEmployeeId,
  canEditCell,
  page,
  onPageChange,
  onSelectEmployee,
  onCellClick,
}: {
  grid: HrmScheduleGrid | null;
  loading: boolean;
  error: string;
  from: string;
  to: string;
  /** Chế độ tuần: ô rộng hơn. */
  wide: boolean;
  selectedEmployeeId: string | null;
  canEditCell: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onSelectEmployee: (employee: HrmScheduleEmployee) => void;
  onCellClick: (employee: HrmScheduleEmployee, date: string, day?: HrmScheduleDay) => void;
}) {
  const dates = useMemo(() => listDates(from, to, 62), [from, to]);
  const dayMap = useMemo(() => {
    const map = new Map<string, HrmScheduleDay>();
    for (const day of grid?.days ?? []) map.set(`${day.employeeId}|${day.date}`, day);
    return map;
  }, [grid]);
  const holidays = grid?.holidays ?? [];

  const total = grid?.meta.total ?? 0;
  const pageSize = grid?.meta.pageSize ?? 50;
  const pages = pageCount(total, pageSize);
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative min-h-0 flex-1 overflow-auto" data-testid="schedule-grid-scroll">
        {error ? (
          <div className="p-4">
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          </div>
        ) : !grid && loading ? (
          <EmptyState>
            <Spinner label="Đang tải lịch phân ca…" />
          </EmptyState>
        ) : grid && grid.employees.length === 0 ? (
          <EmptyState>Không có nhân viên nào khớp bộ lọc trong kỳ này.</EmptyState>
        ) : grid ? (
          <table className={cn('border-separate border-spacing-0 text-xs', loading && 'opacity-60')}>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 left-0 z-30 min-w-60 border-r border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-bold tracking-wide text-slate-600 uppercase"
                >
                  Nhân viên
                </th>
                {dates.map((date) => {
                  const weekday = isoWeekday(date);
                  const holiday = companyHolidayOn(date, holidays);
                  return (
                    <th
                      key={date}
                      scope="col"
                      title={holiday ? holiday.name : undefined}
                      className={cn(
                        'sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-0.5 py-1 text-center text-[11px] font-semibold',
                        wide ? 'min-w-20' : 'min-w-9',
                        weekday === 7 && 'bg-rose-50 text-rose-600',
                        weekday === 6 && 'bg-amber-50 text-amber-700',
                        holiday && 'text-rose-700',
                      )}
                    >
                      <div>{WEEKDAY_LABELS[weekday]}</div>
                      <div className="font-mono text-[10px] font-normal">
                        {date.slice(8, 10)}/{date.slice(5, 7)}
                        {holiday ? <span aria-hidden className="ml-0.5 text-rose-500">*</span> : null}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.employees.map((employee) => {
                const selected = employee.employeeId === selectedEmployeeId;
                return (
                  <tr key={employee.employeeId} className={cn(selected && 'bg-blue-50/40')}>
                    <th
                      scope="row"
                      className={cn(
                        'sticky left-0 z-10 border-r border-b border-slate-100 px-2 py-1 text-left font-normal',
                        selected ? 'bg-blue-50' : 'bg-white',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectEmployee(employee)}
                        aria-pressed={selected}
                        className="block w-full cursor-pointer rounded px-1 py-0.5 text-left outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                        title="Xem chi tiết lịch và lịch sử của nhân viên"
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="font-mono text-[11px] font-semibold text-blue-700">{employee.code}</span>
                          <span className="truncate text-[12px] font-semibold text-slate-900">{employee.name}</span>
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {employee.unitName ?? 'Chưa gán đơn vị'}
                        </span>
                      </button>
                    </th>
                    {dates.map((date) => (
                      <ScheduleCell
                        key={date}
                        employee={employee}
                        date={date}
                        day={dayMap.get(`${employee.employeeId}|${date}`)}
                        holidays={holidays}
                        wide={wide}
                        clickable={canEditCell}
                        onClick={onCellClick}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-500">
        <span>
          {total ? `Hiển thị ${first}-${last} / ${total} nhân viên` : 'Không có nhân viên'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Trước
          </Button>
          <span className="font-bold text-slate-900">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Sau
          </Button>
        </div>
      </div>
    </div>
  );
}
