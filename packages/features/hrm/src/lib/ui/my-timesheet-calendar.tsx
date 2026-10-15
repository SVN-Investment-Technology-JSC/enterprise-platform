'use client';

import type {
  HrmBoardCalendarDay,
  HrmBoardDay,
  HrmBoardEmployee,
} from '@enterprise-platform/contracts-hrm';
import { formatDateVn } from '../hrm-timesheet-format';
import { UnitText } from './unit-text';
import {
  boardDayTooltip,
  boardStatusCellClass,
  boardStatusLabel,
  formatDayNumber,
} from './timesheet-board-format';
import {
  calendarWeeks,
  textOnlyClass,
  isFutureDay,
  isLateOrEarly,
  monthCellNumber,
} from './my-timesheet-format';

const WEEKDAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** Ô không tô nền: chỉ viền và màu chữ (đi trễ hoặc về sớm viền và chữ đỏ; còn lại theo trạng thái ngày). */
function cellClass(day: HrmBoardDay, future: boolean): string {
  if (isLateOrEarly(day)) return 'border-red-400 bg-white text-red-700';
  if (future) return 'border-slate-200 bg-white text-slate-700';
  return `border-slate-200 bg-white ${textOnlyClass(boardStatusCellClass(day.status))}`;
}

/**
 * Lịch tháng gọn, định dạng chuẩn của Bảng công (dùng chung cho Bảng công và Công của tôi): ngày chưa tới hiện mã ca,
 * ngày đã qua hiện số công (không hiện mã ca); đi trễ hoặc về sớm viền và chữ đỏ; bấm vào ô để xem chi tiết và đơn từ.
 */
export function MyTimesheetCalendar({
  calendar,
  employee,
  today,
  selectedDate,
  onSelect,
}: {
  calendar: readonly HrmBoardCalendarDay[];
  employee: HrmBoardEmployee;
  today: string;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const weeks = calendarWeeks(calendar);
  return (
    <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xs">
      <table aria-label="Bảng công theo tháng" className="w-full table-fixed border-separate border-spacing-0.5">
        <thead>
          <tr>
            {WEEKDAY_HEADERS.map((h, i) => (
              <th
                key={h}
                className={`pb-0.5 text-center text-[10px] font-bold ${i === 6 ? 'text-rose-600' : 'text-slate-500'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) return <td key={`blank-${wi}-${di}`} />;
                const day = employee.days[date];
                if (!day) {
                  return (
                    <td key={date}>
                      <div className="h-[52px] rounded-md border border-dashed border-slate-200" />
                    </td>
                  );
                }
                const future = isFutureDay(day, today);
                const late = isLateOrEarly(day);
                const cell = monthCellNumber(day, today);
                return (
                  <td key={date}>
                    <button
                      type="button"
                      data-testid={`my-cell-${date}`}
                      data-late={late ? 'true' : undefined}
                      data-future={future ? 'true' : undefined}
                      aria-label={`Chi tiết ngày ${formatDateVn(date)}: ${boardStatusLabel(day.status)}, công ${cell.text}`}
                      title={boardDayTooltip(day)}
                      onClick={() => onSelect(date)}
                      className={`relative flex h-[52px] w-full cursor-pointer flex-col items-center justify-center rounded-md border px-0.5 text-center leading-none transition hover:ring-2 hover:ring-blue-400 ${cellClass(
                        day,
                        future,
                      )} ${
                        selectedDate === date
                          ? 'z-10 border-blue-600 bg-blue-50 shadow-md ring-2 ring-blue-600'
                          : ''
                      }`}
                    >
                      {date === today && (
                        <span className="absolute right-0.5 top-0.5 rounded bg-blue-600 px-1 py-px text-[9px] font-bold leading-none text-white">
                          Hôm nay
                        </span>
                      )}
                      <span className="absolute left-1 top-0.5 text-[9px] font-semibold text-slate-500">
                        {formatDayNumber(date)}
                      </span>
                      <span
                        className={`mt-2 text-[15px] font-bold ${
                          cell.tone === 'bad' ? 'text-red-600' : cell.tone === 'ok' ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        <UnitText text={cell.text} />
                      </span>
                    </button>
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

/** Chú thích số công của ô lịch tháng (ngăn kéo bảng công): chỉ giải thích các con số và màu. */
export function MonthNumberLegend() {
  const items = [
    { text: '1', tone: 'text-emerald-700', label: 'Công chuẩn' },
    { text: '1P', tone: 'text-emerald-700', label: 'Nghỉ có lương' },
    { text: '1L', tone: 'text-emerald-700', label: 'Ngày lễ' },
    { text: '1CT', tone: 'text-emerald-700', label: 'Công tác' },
    { text: '0', tone: 'text-emerald-700', label: 'Nghỉ không lương' },
    { text: '0', tone: 'text-red-600', label: 'Thiếu dữ liệu chấm công' },
    { text: '0.xx', tone: 'text-red-600', label: 'Đi trễ, về sớm hoặc thiếu công' },
  ];
  return (
    <ul aria-label="Chú thích số công" className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
      {items.map((item) => (
        // Mỗi mục là một ô có viền: số và nhãn đi liền nhau, không đọc nhầm số của mục kế tiếp.
        <li key={item.label} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5">
          <span className={`min-w-6 text-center font-mono text-[13px] font-bold ${item.tone}`}><UnitText text={item.text} /></span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
