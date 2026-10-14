'use client';

import type {
  HrmBoardCalendarDay,
  HrmBoardEmployee,
} from '@enterprise-platform/contracts-hrm';
import { formatDateVn } from '../hrm-timesheet-format';
import { LetterBadge } from './my-timesheet-calendar';
import {
  calendarWeeks,
  DAY_TONE_DOT,
  dayCoefficient,
  dayLetters,
  dayTone,
  isFutureDay,
  isLateOrEarly,
  myCellContent,
  type DayTone,
} from './my-timesheet-format';
import {
  boardDayTooltip,
  boardStatusLabel,
  formatDayNumber,
} from './timesheet-board-format';

const WEEKDAY_HEADERS = [
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
  'Chủ Nhật',
];

/** Ngày đứng trước/sau tháng để lấp tuần đầu và tuần cuối (chỉ để hiện số mờ). */
function shiftIsoDate(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Màu nền và viền ô: không tô nền khi đi trễ, về sớm, vắng hay thiếu dữ liệu (chỉ hiện số công và chấm màu); nghỉ phép, công tác, ngày nghỉ có nền nhạt. */
function cellSurface(tone: DayTone): string {
  if (tone === 'leave') return 'border-blue-200 bg-blue-50';
  if (tone === 'trip') return 'border-indigo-200 bg-indigo-50';
  if (tone === 'off') return 'border-slate-200 bg-slate-50';
  return 'border-slate-200 bg-white';
}

/** Chú thích chấm màu ở đầu thẻ lịch. */
export function MonthDotLegend() {
  const items: [DayTone, string][] = [
    ['full', 'Đủ công'],
    ['late', 'Đi trễ'],
    ['early', 'Về sớm'],
    ['leave', 'Nghỉ phép'],
    ['absent', 'Nghỉ không phép'],
    ['off', 'Ngày nghỉ'],
  ];
  return (
    <ul
      aria-label="Chú thích màu"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600"
    >
      {items.map(([tone, label]) => (
        <li key={tone} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${DAY_TONE_DOT[tone]}`}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Lịch tháng của tôi: tuần bắt đầu từ thứ Hai, mỗi ô có số ngày, chấm màu theo trạng thái và giờ làm (ngày đã qua),
 * mã ca hoặc OFF (ngày chưa tới), ký hiệu đơn từ ở góc, đi trễ hoặc về sớm không tô nền (chỉ hiện chữ Trễ/Sớm). Bấm ô để xem chi tiết ngày.
 */
export function MyMonthCalendar({
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
  const first = calendar[0]?.date ?? '';
  const last = calendar[calendar.length - 1]?.date ?? '';
  return (
    <table
      aria-label="Bảng công theo tháng"
      className="w-full table-fixed border-separate border-spacing-1.5"
    >
      <thead>
        <tr>
          {WEEKDAY_HEADERS.map((h, i) => (
            <th
              key={h}
              className={`pb-1 text-center text-xs font-semibold ${i === 6 ? 'text-red-600' : 'text-slate-700'}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, wi) => {
          const lead = week.findIndex((d) => d !== null);
          const lastCol = week.reduce(
            (acc, d, i) => (d !== null ? i : acc),
            -1,
          );
          return (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) {
                  // Ô ngoài tháng: số ngày mờ của tháng trước (đầu) hoặc tháng sau (cuối).
                  const filler =
                    wi === 0
                      ? shiftIsoDate(first, di - lead)
                      : shiftIsoDate(last, di - lastCol);
                  return (
                    <td key={`out-${wi}-${di}`}>
                      <div className="h-[84px] rounded-lg border border-slate-100 bg-white px-2 py-1.5 text-xs font-semibold text-slate-300">
                        {formatDayNumber(filler)}
                      </div>
                    </td>
                  );
                }
                const day = employee.days[date];
                if (!day) {
                  return (
                    <td key={date}>
                      <div className="h-[84px] rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-400">
                        {formatDayNumber(date)}
                      </div>
                    </td>
                  );
                }
                const future = isFutureDay(day, today);
                const tone = dayTone(day, today);
                const letters = dayLetters(day);
                const late = isLateOrEarly(day);
                const { text, units } = myCellContent(day, today);
                const sub = late
                  ? [
                      day.lateMinutes > 0 ? `Trễ ${day.lateMinutes}p` : '',
                      day.earlyLeaveMinutes > 0
                        ? `Sớm ${day.earlyLeaveMinutes}p`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : day.status === 'ABNORMAL'
                    ? 'Bất thường'
                    : future && day.kind === 'NO_SCHEDULE'
                      ? 'Chưa có ca'
                      : '';
                const showDot = !future && tone !== 'off' && tone !== 'none';
                const selected = selectedDate === date;
                return (
                  <td key={date}>
                    <button
                      type="button"
                      data-testid={`my-cell-${date}`}
                      data-late={late ? 'true' : undefined}
                      data-future={future ? 'true' : undefined}
                      data-selected={selected ? 'true' : undefined}
                      aria-pressed={selected}
                      aria-label={`Chi tiết ngày ${formatDateVn(date)}: ${boardStatusLabel(day.status)}${
                        letters.length
                          ? `, có ${letters.length} ký hiệu đơn từ`
                          : ''
                      }`}
                      title={boardDayTooltip(day)}
                      onClick={() => onSelect(date)}
                      className={`relative flex h-[84px] w-full cursor-pointer flex-col rounded-lg border px-2 py-1.5 text-left leading-none transition hover:border-blue-400 ${cellSurface(tone)} ${selected ? 'border-blue-500 ring-1 ring-blue-500' : ''}`}
                    >
                      <span className="flex items-start justify-between gap-1">
                        <span
                          className={`text-xs font-bold ${
                            date === today
                              ? 'rounded bg-[#ffc90a] px-1 py-0.5 text-slate-900'
                              : 'text-slate-800'
                          }`}
                        >
                          {formatDayNumber(date)}
                        </span>
                        {letters.length > 0 && (
                          <span className="flex flex-wrap justify-end gap-px">
                            {letters.map((l) => (
                              <LetterBadge key={l.kind} letter={l} />
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="mt-auto mb-1 flex items-center gap-1.5">
                        {showDot && (
                          <span
                            aria-hidden="true"
                            className={`size-2 shrink-0 rounded-full ${DAY_TONE_DOT[tone]}`}
                          />
                        )}
                        {units ? (
                          <span
                            data-testid="my-cell-units"
                            className={`font-mono text-sm font-semibold ${
                              !future && dayCoefficient(day).tone === 'bad' ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {units}
                          </span>
                        ) : (
                          <span
                            className={`text-sm font-semibold ${
                              tone === 'off' || future
                                ? 'text-slate-500'
                                : 'text-slate-500'
                            }`}
                          >
                            {text}
                          </span>
                        )}
                      </span>
                      {sub && (
                        <span
                          className={`text-[10px] font-semibold ${late ? 'text-red-700' : 'text-fuchsia-700'}`}
                        >
                          {sub}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
