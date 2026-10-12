'use client';

import { useMemo } from 'react';
import type { HrmBoardCalendarDay, HrmBoardEmployee } from '@enterprise-platform/contracts-hrm';
import { formatDateVn } from '../hrm-timesheet-format';
import { MyTimesheetCalendar, MyTimesheetLegend } from './my-timesheet-calendar';
import {
  monthRequests,
  myMonthStats,
  requestTimeRange,
  requestTitle,
  REQUEST_LETTERS,
} from './my-timesheet-format';
import { requestStatusLabel } from './timesheet-board-format';

const REQUEST_STATUS_TONE = {
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
  REJECTED: 'border-slate-200 bg-white text-slate-500',
} as const;

/** Thanh thống kê gọn của tháng: các chỉ số chính luôn hiện, chỉ số phụ chỉ hiện khi khác 0. */
export function MonthStatsBar({ employee }: { employee: HrmBoardEmployee }) {
  const stats = useMemo(() => myMonthStats(employee).filter((s) => !(s.optional && s.zero)), [employee]);
  return (
    <div aria-label="Thống kê công trong tháng" data-testid="my-stats" className="flex flex-wrap gap-1.5">
      {stats.map((stat, index) => (
        <div
          key={stat.key}
          data-testid={`my-stat-${stat.key}`}
          className={`min-w-[104px] flex-1 rounded-md border bg-white px-2.5 py-1 shadow-xs ${
            stat.alert ? 'border-red-200 bg-red-50/60' : index === 0 ? 'border-blue-200 bg-blue-50/60' : 'border-slate-200'
          }`}
        >
          <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-500">{stat.label}</p>
          <p className="flex items-baseline gap-1">
            <span
              className={`font-mono text-[15px] font-bold leading-tight ${stat.alert ? 'text-red-600' : 'text-slate-900'}`}
            >
              {stat.value}
            </span>
            {stat.hint && (
              <span className="truncate text-[10px] text-slate-500" title={stat.hint}>
                {stat.hint}
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Danh sách đơn từ trong tháng của một nhân viên; bấm một đơn để mở chi tiết ngày đầu tiên của đơn. */
export function MonthRequestsPanel({
  employee,
  onSelectDate,
  embedded = false,
}: {
  employee: HrmBoardEmployee;
  onSelectDate: (date: string) => void;
  /** Nằm trong một tab: bỏ khung và tiêu đề riêng (tiêu đề đã nằm ở tab). */
  embedded?: boolean;
}) {
  const requests = useMemo(() => monthRequests(employee), [employee]);
  return (
    <div
      data-testid="my-month-requests"
      className={`flex min-h-0 flex-col ${embedded ? '' : 'max-h-[480px] rounded-xl border border-slate-200 bg-white shadow-xs'}`}
    >
      {!embedded && (
        <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800">
          Đơn từ trong tháng ({requests.length})
        </p>
      )}
      {requests.length === 0 ? (
        <p className="p-3 text-xs text-slate-500">Không có đơn từ nào trong tháng này.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {requests.map(({ request, firstDate }) => (
            <li key={`${request.kind}-${request.id}`}>
              <button
                type="button"
                onClick={() => onSelectDate(firstDate)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-slate-800 px-1 text-[10px] font-bold text-white"
                >
                  {REQUEST_LETTERS[request.kind].letter}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-900">
                      {requestTitle(request)}
                      {request.kind !== 'CUSTOM' && request.label ? `: ${request.label}` : ''}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${REQUEST_STATUS_TONE[request.status]}`}
                    >
                      {requestStatusLabel(request.status)}
                    </span>
                  </span>
                  <span className="block text-slate-500">{requestTimeRange(request) || formatDateVn(firstDate)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Bảng công cả tháng của một nhân viên: thanh thống kê, lịch tháng gọn, chú thích và danh sách đơn từ.
 * `wide` xếp lịch và danh sách đơn cạnh nhau (trang Công của tôi); không `wide` xếp dọc (ngăn kéo xem nhân viên).
 */
export function EmployeeMonthView({
  calendar,
  employee,
  today,
  selectedDate,
  onSelectDate,
  wide = false,
}: {
  calendar: readonly HrmBoardCalendarDay[];
  employee: HrmBoardEmployee;
  today: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <MonthStatsBar employee={employee} />
      <div className={wide ? 'grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_340px]' : 'flex flex-col gap-2'}>
        <div className="flex min-w-0 flex-col gap-2">
          <MyTimesheetCalendar
            calendar={calendar}
            employee={employee}
            today={today}
            selectedDate={selectedDate}
            onSelect={onSelectDate}
          />
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xs">
            <MyTimesheetLegend />
          </div>
        </div>
        <MonthRequestsPanel employee={employee} onSelectDate={onSelectDate} />
      </div>
    </div>
  );
}
