'use client';

import type {
  HrmBoardCalendarDay,
  HrmBoardDay,
  HrmBoardEmployee,
} from '@enterprise-platform/contracts-hrm';
import { formatDateVn } from '../hrm-timesheet-format';
import {
  boardDayTooltip,
  boardStatusCellClass,
  boardStatusLabel,
  formatDayNumber,
} from './timesheet-board-format';
import {
  ABSENT_LETTER,
  calendarWeeks,
  dayLetters,
  isFutureDay,
  isLateOrEarly,
  myCellText,
  REQUEST_LETTERS,
  type DayLetter,
} from './my-timesheet-format';

const WEEKDAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const LETTER_CLASS: Record<DayLetter['status'], string> = {
  APPROVED: 'border-slate-800 bg-slate-800 text-white',
  PENDING: 'border-dashed border-amber-500 bg-amber-50 text-amber-800',
  REJECTED: 'border-slate-300 bg-white text-slate-400 line-through',
  ABSENT: 'border-red-600 bg-red-600 text-white',
};
const LETTER_STATUS_TEXT: Record<DayLetter['status'], string> = {
  APPROVED: 'đã duyệt',
  PENDING: 'chờ duyệt',
  REJECTED: 'từ chối',
  ABSENT: 'không có đơn nghỉ',
};

/** Màu nền ô: đi trễ hoặc về sớm tô đỏ; ngày chưa tới để trắng; còn lại theo trạng thái ngày. */
function cellClass(day: HrmBoardDay, future: boolean): string {
  if (isLateOrEarly(day)) return 'border-red-400 bg-red-100 text-red-700';
  if (future) return 'border-slate-200 bg-white text-slate-700';
  return `border-slate-200 ${boardStatusCellClass(day.status)}`;
}

export function LetterBadge({ letter }: { letter: DayLetter }) {
  return (
    <span
      data-testid={`request-letter-${letter.kind}`}
      title={`${letter.label} (${LETTER_STATUS_TEXT[letter.status]})`}
      className={`inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-sm border px-[2px] text-[8px] font-bold leading-none ${LETTER_CLASS[letter.status]}`}
    >
      {letter.letter}
    </span>
  );
}

/** Chú thích gọn trên một khối: ký tự đơn từ, KP, màu đỏ và cách đọc ô. */
export function MyTimesheetLegend() {
  const items = [...Object.values(REQUEST_LETTERS).filter((r) => r.letter !== 'ĐC'), ABSENT_LETTER];
  return (
    <div aria-label="Quy ước bảng công" className="space-y-1 text-[11px] text-slate-600">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((r) => (
          <li key={r.letter} className="flex items-center gap-1">
            <span
              className={`inline-flex h-3.5 min-w-4 items-center justify-center rounded-sm px-[2px] text-[8px] font-bold text-white ${
                r.letter === 'KP' ? 'bg-red-600' : 'bg-slate-800'
              }`}
            >
              {r.letter}
            </span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-500">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm border border-red-400 bg-red-100 align-middle" />
          Đi trễ hoặc về sớm
        </span>
        <span>Ngày chưa tới: mã ca. Ngày đã qua: số công</span>
        <span>Nền đặc: đã duyệt. Viền đứt: chờ duyệt. Gạch ngang: từ chối</span>
      </p>
    </div>
  );
}

/**
 * Lịch tháng gọn của một nhân viên: ngày chưa tới hiện mã ca, ngày đã qua hiện số công (không hiện mã ca);
 * đi trễ hoặc về sớm tô đỏ; ký tự nhỏ cho từng loại đơn từ dính tới ngày; bấm vào ô để xem chi tiết và đơn từ.
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
                const letters = dayLetters(day);
                const late = isLateOrEarly(day);
                const text = myCellText(day, today);
                const sub = late
                  ? [
                      day.lateMinutes > 0 ? `Trễ ${day.lateMinutes}p` : '',
                      day.earlyLeaveMinutes > 0 ? `Sớm ${day.earlyLeaveMinutes}p` : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : day.status === 'ABNORMAL'
                    ? 'Bất thường'
                    : future && day.kind === 'NO_SCHEDULE'
                      ? 'Chưa có ca'
                      : '';
                return (
                  <td key={date}>
                    <button
                      type="button"
                      data-testid={`my-cell-${date}`}
                      data-late={late ? 'true' : undefined}
                      data-future={future ? 'true' : undefined}
                      aria-label={`Chi tiết ngày ${formatDateVn(date)}: ${boardStatusLabel(day.status)}${
                        letters.length ? `, có ${letters.length} ký hiệu đơn từ` : ''
                      }`}
                      title={boardDayTooltip(day)}
                      onClick={() => onSelect(date)}
                      className={`relative flex h-[52px] w-full cursor-pointer flex-col items-center justify-center rounded-md border px-0.5 text-center leading-none transition hover:ring-2 hover:ring-blue-400 ${cellClass(
                        day,
                        future,
                      )} ${date === today ? 'outline outline-2 outline-offset-0 outline-blue-500' : ''} ${
                        selectedDate === date ? 'ring-2 ring-blue-500' : ''
                      }`}
                    >
                      <span className="absolute left-1 top-0.5 text-[9px] font-semibold text-slate-500">
                        {formatDayNumber(date)}
                      </span>
                      {letters.length > 0 && (
                        <span className="absolute right-0.5 top-0.5 flex max-w-[70%] flex-wrap justify-end gap-px">
                          {letters.map((l) => (
                            <LetterBadge key={l.kind} letter={l} />
                          ))}
                        </span>
                      )}
                      <span className="mt-2 text-[15px] font-bold">{text}</span>
                      {sub && <span className="mt-0.5 text-[8px] font-semibold">{sub}</span>}
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
