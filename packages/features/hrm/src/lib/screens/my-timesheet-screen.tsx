'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import {
  currentMonthVn,
  formatDateVn,
  formatMinutes,
  isMonthKey,
  monthRange,
  shiftMonth,
  timesheetPeriodBadge,
  timesheetStatusLabel,
  timesheetStatusTone,
  weekdayVn,
  type TimesheetTone,
} from '../hrm-timesheet-format';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export interface MyTimesheetDay {
  workDate: string;
  status: string;
  shiftCode: string | null;
  shiftName: string | null;
  scheduledMinutes: number;
  workedMinutes: number;
  paidMinutes: number;
  otMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workdayUnits: number;
  adjusted: boolean;
  periodCode: string | null;
  periodStatus: string | null;
}

interface MyTimesheetSummary {
  workdayUnits: number;
  paidMinutes: number;
  otMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

interface MyTimesheetResponse {
  data: MyTimesheetDay[];
  meta?: { total?: number; summary?: Partial<MyTimesheetSummary> };
}

const TONE_CLASS: Record<TimesheetTone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  info: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  bad: 'border-rose-200 bg-rose-50 text-rose-700',
  muted: 'border-slate-200 bg-slate-100 text-slate-600',
};

function formatUnits(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

function summarize(days: MyTimesheetDay[]): MyTimesheetSummary {
  return days.reduce<MyTimesheetSummary>(
    (acc, d) => ({
      workdayUnits: acc.workdayUnits + Number(d.workdayUnits || 0),
      paidMinutes: acc.paidMinutes + Number(d.paidMinutes || 0),
      otMinutes: acc.otMinutes + Number(d.otMinutes || 0),
      lateMinutes: acc.lateMinutes + Number(d.lateMinutes || 0),
      earlyLeaveMinutes: acc.earlyLeaveMinutes + Number(d.earlyLeaveMinutes || 0),
    }),
    {
      workdayUnits: 0,
      paidMinutes: 0,
      otMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    },
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-bold text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export default function MyTimesheetScreen() {
  const [month, setMonth] = useState(() => currentMonthVn());
  const [days, setDays] = useState<MyTimesheetDay[]>([]);
  const [serverSummary, setServerSummary] =
    useState<Partial<MyTimesheetSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isMonthKey(month)) return;
    let live = true;
    const { from, to } = monthRange(month);
    setLoading(true);
    setError('');
    hrmFetch<MyTimesheetResponse>(
      `/my-timesheet?${new URLSearchParams({ from, to })}`,
    )
      .then((result) => {
        if (!live) return;
        setDays(result.data ?? []);
        setServerSummary(result.meta?.summary ?? null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setDays([]);
        setServerSummary(null);
        setError(
          e instanceof Error ? e.message : 'Không tải được bảng công của bạn.',
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [month, reloadKey]);

  const summary = useMemo(
    () => ({ ...summarize(days), ...(serverSummary ?? {}) }),
    [days, serverSummary],
  );
  const provisional = days.some((d) => d.periodStatus !== 'LOCKED');
  const onMonthInput = useCallback((value: string) => {
    if (isMonthKey(value)) setMonth(value);
  }, []);

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            Bảng công của tôi
          </h1>
          <p className="text-xs text-slate-500">
            Số liệu công theo từng ngày. Kỳ chưa chốt chỉ là số liệu tạm tính và
            có thể thay đổi.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Tháng trước"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="month"
            aria-label="Tháng"
            className="w-44"
            value={month}
            onChange={(e) => onMonthInput(e.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Tháng sau"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="Công" value={formatUnits(summary.workdayUnits)} hint="ngày công" />
        <SummaryCard label="Phút có lương" value={formatMinutes(summary.paidMinutes)} hint="giờ:phút" />
        <SummaryCard label="Làm thêm (OT)" value={formatMinutes(summary.otMinutes)} hint="giờ:phút" />
        <SummaryCard label="Đi muộn" value={formatMinutes(summary.lateMinutes)} hint="giờ:phút" />
        <SummaryCard label="Về sớm" value={formatMinutes(summary.earlyLeaveMinutes)} hint="giờ:phút" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {error ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm text-red-700">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Tải lại
            </Button>
          </div>
        ) : loading ? (
          <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            <span>Đang tải bảng công...</span>
          </div>
        ) : days.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Chưa có dữ liệu bảng công trong tháng này.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Ngày</th>
                  <th className="px-3 py-2">Thứ</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Ca</th>
                  <th className="px-3 py-2 text-right">Định mức</th>
                  <th className="px-3 py-2 text-right">Thực tế</th>
                  <th className="px-3 py-2 text-right">Có lương</th>
                  <th className="px-3 py-2 text-right">OT</th>
                  <th className="px-3 py-2 text-right">Muộn</th>
                  <th className="px-3 py-2 text-right">Sớm</th>
                  <th className="px-3 py-2 text-right">Công</th>
                  <th className="px-3 py-2">Kỳ công</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {days.map((d) => {
                  const period = timesheetPeriodBadge(d.periodStatus, d.periodCode);
                  const weekday = weekdayVn(d.workDate);
                  return (
                    <tr key={d.workDate} className="hover:bg-slate-50" data-testid="my-timesheet-row">
                      <td className="px-3 py-2 font-mono">{formatDateVn(d.workDate)}</td>
                      <td className={`px-3 py-2 font-semibold ${weekday === 'CN' ? 'text-rose-600' : 'text-slate-600'}`}>
                        {weekday}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[timesheetStatusTone(d.status)]}`}>
                          {timesheetStatusLabel(d.status)}
                        </span>
                        {d.adjusted && d.status !== 'ADJUSTED' && (
                          <span className="ml-1 text-[11px] text-indigo-600">(đã điều chỉnh)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d.shiftCode || d.shiftName ? (
                          <>
                            <span className="font-mono font-semibold">{d.shiftCode ?? ''}</span>
                            {d.shiftName && <span className="ml-1 text-slate-500">{d.shiftName}</span>}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.scheduledMinutes)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.workedMinutes)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">{formatMinutes(d.paidMinutes)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.otMinutes)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.lateMinutes)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.earlyLeaveMinutes)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{formatUnits(d.workdayUnits)}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={period.locked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}
                        >
                          {period.label}
                        </Badge>
                        {period.code && (
                          <span className="ml-1 font-mono text-[11px] text-slate-500">{period.code}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && days.length > 0 && provisional && (
          <p className="shrink-0 border-t border-slate-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Có ngày thuộc kỳ chưa chốt: số liệu đang là tạm tính.
          </p>
        )}
      </div>
    </div>
  );
}
