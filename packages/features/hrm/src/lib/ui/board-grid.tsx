'use client';

import type {
  HrmBoardCalendarDay,
  HrmBoardEmployee,
} from '@enterprise-platform/contracts-hrm';
import { formatDateVn, formatMinutes, weekdayVn } from '../hrm-timesheet-format';
import {
  compactTotals,
  dayLetters,
  gridCellClass,
  gridCellText,
  isFutureDay,
  REQUEST_DOT_CLASS,
} from './my-timesheet-format';
import {
  boardDayTooltip,
  boardStatusLabel,
  formatDayNumber,
  formatUnits,
} from './timesheet-board-format';

const COL_NAME = 168;
const COL_TOTAL = 36;
const DAY_MIN = 23;

/** Cột tổng hợp gọn bên phải: chỉ những chỉ số cần nhìn ngay. Chi tiết đầy đủ nằm ở bảng công của từng nhân viên. */
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
      return { text: t.lateEarlyDays ? String(t.lateEarlyDays) : '', bad: t.lateEarlyDays > 0 };
    case 'leave':
      return { text: t.leaveDays ? formatUnits(t.leaveDays) : '', bad: false };
    case 'absent':
      return { text: t.absentDays ? formatUnits(t.absentDays) : '', bad: t.absentDays > 0 };
    case 'abnormal':
      return { text: t.abnormalDays ? formatUnits(t.abnormalDays) : '', bad: t.abnormalDays > 0 };
    case 'ot':
      return { text: t.otMinutes ? formatMinutes(t.otMinutes) : '', bad: false };
  }
}

/**
 * Lưới bảng công tháng gọn: cả tháng nằm vừa một màn hình. Cột đầu một dòng (mã và tên), mỗi ngày một cột hẹp
 * (ngày chưa tới hiện mã ca, ngày đã qua hiện số công, đi trễ hoặc về sớm tô đỏ, chấm màu cho từng loại đơn từ),
 * cuối dòng 6 chỉ số tổng hợp. Bấm một ô để xem chi tiết ngày, bấm tên để xem cả tháng của nhân viên.
 */
export function BoardGrid({
  calendar,
  employees,
  today,
  standardWorkdays,
  onSelectDay,
  onSelectEmployee,
}: {
  calendar: readonly HrmBoardCalendarDay[];
  employees: readonly HrmBoardEmployee[];
  today: string;
  standardWorkdays?: number;
  onSelectDay: (employeeId: string, date: string) => void;
  onSelectEmployee?: (employeeId: string) => void;
}) {
  const minWidth = COL_NAME + calendar.length * DAY_MIN + TOTAL_COLUMNS.length * COL_TOTAL;
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
      <table
        aria-label="Bảng công theo tháng"
        className="border-separate border-spacing-0 text-[11px]"
        style={{ tableLayout: 'fixed', width: '100%', minWidth }}
      >
        <colgroup>
          <col style={{ width: COL_NAME }} />
          {calendar.map((c) => (
            <col key={c.date} />
          ))}
          {TOTAL_COLUMNS.map((c) => (
            <col key={c.key} style={{ width: COL_TOTAL }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              style={{ left: 0 }}
              className="sticky top-0 z-30 border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-left text-[11px] font-bold text-slate-600"
            >
              Nhân viên
              {standardWorkdays ? (
                <span className="ml-1 font-normal text-slate-400" title="Công chuẩn của tháng">
                  (chuẩn {formatUnits(standardWorkdays)})
                </span>
              ) : null}
            </th>
            {calendar.map((c) => {
              const tone =
                c.kind === 'HOLIDAY'
                  ? 'bg-rose-100 text-rose-700'
                  : c.kind === 'OFF'
                    ? 'bg-slate-200 text-slate-500'
                    : 'bg-slate-100 text-slate-600';
              return (
                <th
                  key={c.date}
                  data-testid="board-day-header"
                  title={
                    c.kind === 'HOLIDAY' ? `Lễ: ${c.holidayName ?? ''}`.trim() : c.kind === 'OFF' ? 'Ngày nghỉ' : formatDateVn(c.date)
                  }
                  className={`sticky top-0 z-20 border-b border-r border-slate-200 px-0 py-0.5 text-center font-bold ${tone} ${c.date === today ? 'ring-2 ring-inset ring-blue-500' : ''}`}
                >
                  <div className="text-[8px] font-semibold leading-none">{weekdayVn(c.date)}</div>
                  <div className="text-[11px] leading-tight">{formatDayNumber(c.date)}</div>
                </th>
              );
            })}
            {TOTAL_COLUMNS.map((c, i) => (
              <th
                key={c.key}
                title={c.title}
                style={{ right: (TOTAL_COLUMNS.length - 1 - i) * COL_TOTAL }}
                className={`sticky top-0 z-30 border-b border-slate-200 bg-slate-100 px-0 py-1 text-center text-[10px] font-bold text-slate-700 ${i === 0 ? 'border-l' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.employeeId} data-testid="board-row" className="group">
              <td
                style={{ left: 0 }}
                className="sticky z-10 border-b border-r border-slate-200 bg-white px-2 py-0.5 group-hover:bg-blue-50"
              >
                {onSelectEmployee ? (
                  <button
                    type="button"
                    onClick={() => onSelectEmployee(emp.employeeId)}
                    aria-label={`Xem bảng công cả tháng của ${emp.employeeName}`}
                    className="block w-full text-left"
                  >
                    <span className="block truncate text-[12px] font-semibold leading-tight text-slate-900 hover:text-blue-700">
                      {emp.employeeName}
                    </span>
                    <span className="block truncate text-[10px] leading-tight text-slate-500">
                      {emp.employeeCode}
                      {emp.departmentName ? ` · ${emp.departmentName}` : ''}
                    </span>
                  </button>
                ) : (
                  <>
                    <span className="block truncate text-[12px] font-semibold leading-tight">{emp.employeeName}</span>
                    <span className="block truncate text-[10px] leading-tight text-slate-500">{emp.employeeCode}</span>
                  </>
                )}
              </td>
              {calendar.map((c) => {
                const day = emp.days[c.date];
                if (!day)
                  return (
                    <td key={c.date} className="border-b border-r border-slate-100 p-0">
                      <div className="h-8" />
                    </td>
                  );
                const future = isFutureDay(day, today);
                const letters = dayLetters(day).filter((l) => l.kind !== 'ABSENT');
                return (
                  <td key={c.date} className="border-b border-r border-slate-100 p-0">
                    <button
                      type="button"
                      data-testid={`board-cell-${emp.employeeId}-${c.date}`}
                      data-status={day.status}
                      data-late={day.lateMinutes > 0 || day.earlyLeaveMinutes > 0 ? 'true' : undefined}
                      aria-label={`Chi tiết ngày ${formatDateVn(c.date)} của ${emp.employeeName}: ${boardStatusLabel(day.status)}`}
                      title={boardDayTooltip(day)}
                      onClick={() => onSelectDay(emp.employeeId, c.date)}
                      className={`relative flex h-8 w-full cursor-pointer items-center justify-center overflow-hidden text-[11px] leading-none hover:ring-2 hover:ring-inset hover:ring-blue-400 ${gridCellClass(day, future)}`}
                    >
                      {future && day.shiftCode ? (
                        <span data-testid="cell-shift-code" className="truncate px-px text-[9px] font-medium">
                          {gridCellText(day, today)}
                        </span>
                      ) : (
                        <span>{gridCellText(day, today)}</span>
                      )}
                      {letters.length > 0 && (
                        <span
                          data-testid="cell-has-requests"
                          aria-hidden="true"
                          className="absolute bottom-[2px] left-1/2 flex -translate-x-1/2 gap-px"
                        >
                          {letters.slice(0, 3).map((l) => (
                            <span
                              key={l.kind}
                              className={`size-[4px] rounded-full ${
                                l.status === 'PENDING'
                                    ? 'border border-amber-500 bg-white'
                                    : l.status === 'REJECTED'
                                      ? 'bg-slate-300'
                                      : REQUEST_DOT_CLASS[l.kind as keyof typeof REQUEST_DOT_CLASS]
                              }`}
                            />
                          ))}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
              {TOTAL_COLUMNS.map((c, i) => {
                const cell = totalCell(c.key, emp);
                return (
                  <td
                    key={c.key}
                    style={{ right: (TOTAL_COLUMNS.length - 1 - i) * COL_TOTAL }}
                    className={`sticky z-10 border-b border-slate-200 bg-white px-0 text-center font-mono text-[11px] font-semibold group-hover:bg-blue-50 ${i === 0 ? 'border-l' : ''} ${
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
  );
}
