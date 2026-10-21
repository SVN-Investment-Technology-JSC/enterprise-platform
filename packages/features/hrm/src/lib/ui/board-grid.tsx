'use client';

import type { ReactNode } from 'react';
import { UnitText } from './unit-text';
import type {
  HrmBoardCalendarDay,
  HrmBoardEmployee,
} from '@enterprise-platform/contracts-hrm';
import { formatDateVn, formatMinutes, weekdayVn } from '../hrm-timesheet-format';
import {
  compactTotals,
  gridCellView,
  isFutureDay,
  isLateOrEarly,
} from './my-timesheet-format';
import { RowMenu } from './row-menu';
import {
  boardDayTooltip,
  boardStatusLabel,
  formatDayNumber,
  formatUnits,
} from './timesheet-board-format';

const COL_CHECK = 34;
const COL_NAME = 230;
const COL_MENU = 34;
const COL_TOTAL = 42;
const DAY_MIN = 28;

/** Cột tổng hợp bên phải: chỉ những chỉ số cần nhìn ngay. Chi tiết đầy đủ nằm ở bảng công của từng nhân viên. */
const TOTAL_COLUMNS = [
  { key: 'units', label: 'Công', title: 'Số công thực tế trong tháng' },
  { key: 'lateEarly', label: 'T/S', title: 'Số ngày đi trễ hoặc về sớm' },
  { key: 'leave', label: 'P', title: 'Số ngày nghỉ có đơn (phép năm, nghỉ có lương, không lương)' },
  { key: 'absent', label: 'KP', title: 'Số ngày nghỉ không phép' },
  { key: 'abnormal', label: '!', title: 'Số ngày bất thường (quên chấm vào hoặc ra) cần xử lý' },
  { key: 'ot', label: 'TC', title: 'Giờ tăng ca đã duyệt' },
] as const;

function totalCell(key: (typeof TOTAL_COLUMNS)[number]['key'], employee: HrmBoardEmployee) {
  const t = compactTotals(employee);
  switch (key) {
    case 'units':
      return { text: formatUnits(t.units), bad: false };
    case 'lateEarly':
      return { text: String(t.lateEarlyDays), bad: t.lateEarlyDays > 0 };
    case 'leave':
      return { text: formatUnits(t.leaveDays), bad: false };
    case 'absent':
      return { text: formatUnits(t.absentDays), bad: t.absentDays > 0 };
    case 'abnormal':
      return { text: t.abnormalDays ? String(t.abnormalDays) : '', bad: t.abnormalDays > 0 };
    case 'ot':
      return { text: t.otMinutes ? formatMinutes(t.otMinutes) : '0', bad: false };
  }
}

/**
 * Lưới bảng công tháng của nhiều nhân viên. Mỗi dòng: ô chọn, ảnh đại diện, họ tên, mã và phòng ban; mỗi ngày một cột
 * hẹp có thứ và số ngày (Chủ nhật tô đỏ, hôm nay tô xanh); ngày đã qua hiện chấm xanh (đủ công) hoặc cam (đi trễ, về
 * sớm) hoặc ký hiệu P, KP, CT, !; ngày chưa tới hiện mã ca; OFF và L cho ngày nghỉ và lễ. Cuối dòng là các chỉ số
 * tổng hợp. Bấm một ô để xem chi tiết ngày, bấm tên hoặc "..." để xem cả tháng của nhân viên.
 */
export function BoardGrid({
  calendar,
  employees,
  today,
  standardWorkdays,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  onSelectDay,
  onSelectEmployee,
  footer,
  fullHeight = false,
}: {
  calendar: readonly HrmBoardCalendarDay[];
  employees: readonly HrmBoardEmployee[];
  today: string;
  standardWorkdays?: number;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (employeeId: string) => void;
  onToggleAll?: (checked: boolean) => void;
  onSelectDay: (employeeId: string, date: string) => void;
  onSelectEmployee?: (employeeId: string) => void;
  /** Thanh dưới lưới (phân trang), nằm trong cùng khung. */
  footer?: ReactNode;
  /** Toàn màn hình: lưới giãn hết chiều cao còn lại; bình thường có chiều cao tối thiểu để màn nhỏ vẫn đủ dòng. */
  fullHeight?: boolean;
}) {
  const selectable = Boolean(selectedIds && onToggleSelected);
  const minWidth =
    (selectable ? COL_CHECK : 0) +
    COL_NAME +
    calendar.length * DAY_MIN +
    (onSelectEmployee ? COL_MENU : 0) +
    TOTAL_COLUMNS.length * COL_TOTAL;
  const allSelected = selectable && employees.length > 0 && employees.every((e) => selectedIds?.has(e.employeeId));
  const stickyHead = 'sticky top-0 z-30 border-b border-slate-200 bg-slate-50';
  let nameLeft = 0;
  if (selectable) nameLeft = COL_CHECK;

  return (
    <div
      data-testid="board-grid-frame"
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white ${
        fullHeight ? 'flex-1' : 'h-[max(480px,calc(100dvh-15rem))]'
      }`}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <table
          aria-label="Bảng công theo tháng"
          className="border-separate border-spacing-0 text-[11px]"
          style={{ tableLayout: 'fixed', width: '100%', minWidth }}
        >
          <colgroup>
            {selectable && <col style={{ width: COL_CHECK }} />}
            <col style={{ width: COL_NAME }} />
            {calendar.map((c) => (
              <col key={c.date} />
            ))}
            {onSelectEmployee && <col style={{ width: COL_MENU }} />}
            {TOTAL_COLUMNS.map((c) => (
              <col key={c.key} style={{ width: COL_TOTAL }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {selectable && (
                <th style={{ left: 0 }} className={`${stickyHead} z-40 px-2`}>
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả nhân viên trong trang"
                    checked={allSelected}
                    onChange={(e) => onToggleAll?.(e.target.checked)}
                    className="size-3.5 rounded border-slate-300"
                  />
                </th>
              )}
              <th
                style={{ left: nameLeft }}
                className={`${stickyHead} z-40 border-r border-r-slate-300 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.25)] px-3 py-2 text-left text-[12px] font-bold text-slate-700`}
              >
                Nhân viên
                <span className="block text-[10px] font-normal text-slate-400">
                  ({employees.length} nhân viên
                  {standardWorkdays ? `, công chuẩn ${formatUnits(standardWorkdays)}` : ''})
                </span>
              </th>
              {calendar.map((c) => {
                const sunday = c.weekday === 0;
                const isToday = c.date === today;
                const tone = isToday
                  ? 'bg-blue-100 text-blue-700'
                  : c.kind === 'HOLIDAY' || sunday
                    ? 'bg-red-50 text-red-600'
                    : 'bg-slate-50 text-slate-600';
                return (
                  <th
                    key={c.date}
                    data-testid="board-day-header"
                    data-today={isToday ? 'true' : undefined}
                    title={
                      c.kind === 'HOLIDAY'
                        ? `Lễ: ${c.holidayName ?? ''}`.trim()
                        : c.kind === 'OFF'
                          ? 'Ngày nghỉ'
                          : formatDateVn(c.date)
                    }
                    className={`${stickyHead} z-20 px-0 py-1.5 text-center font-bold ${tone}`}
                  >
                    <div className="text-[9px] font-bold leading-none">{weekdayVn(c.date)}</div>
                    <div className="mt-0.5 text-[12px] leading-tight">{formatDayNumber(c.date)}</div>
                  </th>
                );
              })}
              {onSelectEmployee && (
                <th className={`${stickyHead} z-20 text-center text-slate-400`} aria-hidden="true">
                  ...
                </th>
              )}
              {TOTAL_COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  title={c.title}
                  style={{ right: (TOTAL_COLUMNS.length - 1 - i) * COL_TOTAL }}
                  className={`${stickyHead} z-30 px-0 py-2 text-center text-[11px] font-bold text-slate-700 ${i === 0 ? 'border-l border-l-slate-300 shadow-[-4px_0_6px_-4px_rgba(15,23,42,0.25)]' : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.employeeId} data-testid="board-row" className="group odd:bg-white even:bg-slate-100/70">
                {selectable && (
                  <td style={{ left: 0 }} className="sticky z-10 border-b border-slate-100 bg-inherit px-2 group-hover:bg-blue-50/60">
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${emp.employeeName}`}
                      checked={selectedIds?.has(emp.employeeId) ?? false}
                      onChange={() => onToggleSelected?.(emp.employeeId)}
                      className="size-3.5 rounded border-slate-300"
                    />
                  </td>
                )}
                <td
                  style={{ left: nameLeft }}
                  className="sticky z-10 border-b border-r border-r-slate-300 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.25)] border-slate-100 bg-inherit px-3 py-1.5 group-hover:bg-blue-50/60"
                >
                  <span className="flex items-center">
                    {onSelectEmployee ? (
                      <button
                        type="button"
                        onClick={() => onSelectEmployee(emp.employeeId)}
                        aria-label={`Xem bảng công cả tháng của ${emp.employeeName}`}
                        className="min-w-0 text-left"
                      >
                        <span className="block truncate text-[12px] font-bold leading-tight text-slate-900 hover:text-blue-700">
                          {emp.employeeName}
                        </span>
                        {emp.positionName && (
                          <span className="block truncate text-[11px] leading-tight text-slate-500">{emp.positionName}</span>
                        )}
                      </button>
                    ) : (
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-bold leading-tight">{emp.employeeName}</span>
                        {emp.positionName && (
                          <span className="block truncate text-[11px] leading-tight text-slate-500">{emp.positionName}</span>
                        )}
                      </span>
                    )}
                  </span>
                </td>
                {calendar.map((c) => {
                  const day = emp.days[c.date];
                  if (!day)
                    return (
                      <td key={c.date} className={`border-b border-slate-100 p-0`}>
                        <div className="h-10" />
                      </td>
                    );
                  const future = isFutureDay(day, today);
                  const view = gridCellView(day, today);
                  const late = isLateOrEarly(day);
                  return (
                    <td key={c.date} className={`border-b border-slate-100 p-0`}>
                      <button
                        type="button"
                        data-testid={`board-cell-${emp.employeeId}-${c.date}`}
                        data-status={day.status}
                        data-late={late ? 'true' : undefined}
                        aria-label={`Chi tiết ngày ${formatDateVn(c.date)} của ${emp.employeeName}: ${boardStatusLabel(day.status)}`}
                        title={boardDayTooltip(day)}
                        onClick={() => onSelectDay(emp.employeeId, c.date)}
                        className="relative flex h-10 w-full cursor-pointer items-center justify-center text-[11px] leading-none hover:bg-blue-100/60"
                      >
                        {view.type === 'units' && (
                          <span
                            data-testid="cell-units"
                            data-tone={view.tone}
                            className={`font-mono text-[11px] font-bold ${view.tone === 'bad' ? 'text-red-600' : 'text-emerald-600'}`}
                          >
                            <UnitText text={view.text} />
                          </span>
                        )}
                        {view.type === 'text' &&
                          (future && day.shiftCode ? (
                            <span data-testid="cell-shift-code" className="truncate px-px text-[12px] font-medium leading-4 text-slate-400">
                              {view.text}
                            </span>
                          ) : (
                            <span
                              className={`text-[10px] font-semibold ${view.muted ? 'text-slate-400' : 'text-rose-500'}`}
                            >
                              {view.text}
                            </span>
                          ))}
                      </button>
                    </td>
                  );
                })}
                {onSelectEmployee && (
                  <td className="border-b border-slate-100 px-0 text-center">
                    <RowMenu
                      label={`Thao tác với ${emp.employeeName}`}
                      items={[
                        {
                          key: 'month',
                          label: 'Xem bảng công cả tháng',
                          onSelect: () => onSelectEmployee(emp.employeeId),
                        },
                      ]}
                    />
                  </td>
                )}
                {TOTAL_COLUMNS.map((c, i) => {
                  const cell = totalCell(c.key, emp);
                  return (
                    <td
                      key={c.key}
                      style={{ right: (TOTAL_COLUMNS.length - 1 - i) * COL_TOTAL }}
                      className={`sticky z-10 border-b border-slate-100 bg-inherit px-0 text-center font-mono text-[12px] font-semibold group-hover:bg-blue-50/60 ${i === 0 ? 'border-l border-l-slate-300 shadow-[-4px_0_6px_-4px_rgba(15,23,42,0.25)]' : ''} ${
                        cell.bad ? 'text-red-600' : c.key === 'abnormal' ? 'text-fuchsia-700' : 'text-slate-800'
                      }`}
                    >
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
