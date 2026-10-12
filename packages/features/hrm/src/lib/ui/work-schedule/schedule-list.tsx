'use client';

import type { HrmScheduleListRow, HrmWorkDaySource } from '@enterprise-platform/contracts-hrm';
import { cn } from '../../utils';
import {
  DAY_TYPE_LABELS,
  SOURCE_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  formatVnDate,
} from '../../hrm-work-schedule-model';
import { EmptyState, Pager, Spinner } from './common';

const SOURCE_CLASS: Record<HrmWorkDaySource, string> = {
  TEMPLATE: 'border-blue-200 bg-blue-50 text-blue-700',
  MANUAL: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  EXCEPTION: 'border-amber-300 bg-amber-50 text-amber-700',
  HOLIDAY: 'border-rose-200 bg-rose-50 text-rose-700',
  RULE: 'border-sky-300 bg-sky-50 text-sky-700',
};

export function ScheduleListView({
  rows,
  total,
  page,
  pageSize,
  loading,
  error,
  onPageChange,
  onSelectEmployee,
}: {
  rows: HrmScheduleListRow[] | null;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string;
  onPageChange: (page: number) => void;
  onSelectEmployee: (employeeId: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <p className="shrink-0 border-b border-slate-100 bg-slate-50 px-3.5 py-1.5 text-[11px] text-slate-500">
        Danh sách này chỉ gồm lịch gán theo khoảng ngày cố định. Lịch định kỳ (không có ngày kết thúc) xem trong
        Lịch định kỳ và trên Lịch tháng, Lịch tuần.
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-4">
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          </div>
        ) : !rows && loading ? (
          <EmptyState>
            <Spinner label="Đang tải danh sách phân ca…" />
          </EmptyState>
        ) : rows && rows.length === 0 ? (
          <EmptyState>Chưa có phân ca nào trong khoảng ngày đã chọn.</EmptyState>
        ) : rows ? (
          <table className={cn('w-full border-separate border-spacing-0 text-xs', loading && 'opacity-60')}>
            <thead>
              <tr className="text-left text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                {['Nhân viên', 'Đơn vị', 'Khoảng ngày', 'Thứ trong tuần', 'Ca', 'Nguồn', 'Trạng thái'].map((h) => (
                  <th key={h} scope="col" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`${row.employeeId}-${row.batchId ?? 'none'}-${row.fromDate}-${row.shiftId ?? row.dayType}-${row.source}-${index}`}
                  className="hover:bg-slate-50"
                >
                  <td className="border-b border-slate-100 px-3 py-1.5">
                    <button
                      type="button"
                      className="cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => onSelectEmployee(row.employeeId)}
                    >
                      <span className="font-mono text-[11px] font-semibold text-blue-700">{row.employeeCode}</span>{' '}
                      <span className="font-semibold text-slate-900">{row.employeeName}</span>
                    </button>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-1.5 text-slate-600">{row.unitName ?? '-'}</td>
                  <td className="border-b border-slate-100 px-3 py-1.5 whitespace-nowrap">
                    {formatVnDate(row.fromDate)} - {formatVnDate(row.toDate)}
                    <span className="ml-1 text-slate-400">({row.days} ngày)</span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-1.5">
                    <span className="inline-flex gap-0.5">
                      {WEEKDAYS.map((weekday) => (
                        <span
                          key={weekday}
                          className={cn(
                            'inline-flex h-5 min-w-6 items-center justify-center rounded text-[10px] font-semibold',
                            row.weekdays.includes(weekday)
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-400',
                          )}
                        >
                          {WEEKDAY_LABELS[weekday]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-1.5">
                    {row.dayType === 'SHIFT' ? (
                      <span title={row.shiftName ?? undefined}>
                        <span className="font-mono font-semibold">{row.shiftCode}</span>
                        {row.shiftName ? <span className="ml-1 text-slate-500">{row.shiftName}</span> : null}
                      </span>
                    ) : (
                      <span className="text-slate-500">{DAY_TYPE_LABELS[row.dayType]}</span>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-1.5">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', SOURCE_CLASS[row.source])}>
                      {SOURCE_LABELS[row.source]}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
                      Đang hiệu lực
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <Pager total={total} page={page} pageSize={pageSize} loading={loading} noun="dòng phân ca" onPageChange={onPageChange} />
    </div>
  );
}
