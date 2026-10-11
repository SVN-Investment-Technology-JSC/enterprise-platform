'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { HrmPayrollTrace } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { formatDateVn, formatMinutes } from '../hrm-timesheet-format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';
import { sourceHref, sourceSummary } from './timesheet-board-format';

const INPUT_LABELS: Record<string, string> = {
  SCHEDULED_MINUTES: 'Phút theo phân ca',
  PAID_MINUTES: 'Phút được trả lương',
  WORKED_MINUTES: 'Phút làm việc thực tế',
  OT_MINUTES: 'Phút tăng ca',
  LATE_MINUTES: 'Phút đi muộn',
  EARLY_MINUTES: 'Phút về sớm',
  TRIP_ALLOWANCE_AMOUNT: 'Công tác phí',
};

/** Trạng thái dòng công đã lưu (timesheets.status). */
const DAY_STATUS: Record<string, string> = {
  NORMAL: 'Đi làm',
  LEAVE: 'Nghỉ phép',
  BUSINESS_TRIP: 'Công tác',
  OFF: 'Ngày nghỉ',
  HOLIDAY: 'Ngày lễ',
  ABSENT: 'Vắng không phép',
  ABNORMAL: 'Bất thường',
  ADJUSTED: 'Đã điều chỉnh',
};

const money = (n: number) => n.toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });

/**
 * Truy vết lương của một nhân viên về từng ngày công của bảng công đã khóa và các đơn từ tác động (nghỉ, tăng ca,
 * công tác...). Đối soát tổng từng ngày với con số đã dùng để tính lương; lệch nghĩa là bảng công đã đổi sau khi tính.
 */
export function PayrollTraceDrawer({
  runId,
  employeeId,
  onClose,
}: {
  runId: string;
  employeeId: string | null;
  onClose: () => void;
}) {
  const [trace, setTrace] = useState<HrmPayrollTrace | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!employeeId) return;
    let live = true;
    setTrace(null);
    setError('');
    hrmFetch<{ data: HrmPayrollTrace }>(`/payroll-runs/${runId}/employees/${employeeId}/trace`)
      .then((result) => {
        if (live) setTrace(result.data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Không tải được dữ liệu truy vết.');
      });
    return () => {
      live = false;
    };
  }, [runId, employeeId]);

  return (
    <Sheet open={Boolean(employeeId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[720px]">
        <SheetHeader className="shrink-0">
          <SheetTitle>Công và đơn từ của kỳ lương</SheetTitle>
          <SheetDescription>
            {trace
              ? `${trace.employee.code} - ${trace.employee.name} · ${formatDateVn(trace.period.from)} - ${formatDateVn(trace.period.to)}`
              : 'Đang tải...'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {!trace && !error && (
            <div role="status" className="flex items-center gap-2 text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              <span>Đang tải dữ liệu truy vết...</span>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700">
              {error}
            </p>
          )}
          {trace && (
            <>
              <div
                data-testid="trace-reconciliation"
                role="status"
                className={`rounded-lg border p-3 ${
                  trace.reconciled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                <p className="font-semibold">
                  {trace.reconciled
                    ? 'Khớp: tổng từng ngày công bằng số đã dùng để tính lương.'
                    : trace.inputs
                      ? 'Lệch: bảng công đã thay đổi sau khi tính lương, cần tính lại lương.'
                      : 'Chưa có dòng lương của nhân viên này trong lần tính.'}
                </p>
                {trace.differences.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {trace.differences.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
                {Object.entries(INPUT_LABELS).map(([code, label]) => {
                  const total =
                    code === 'TRIP_ALLOWANCE_AMOUNT'
                      ? trace.totals.tripAllowanceAmount
                      : trace.totals[
                          (
                            {
                              SCHEDULED_MINUTES: 'scheduledMinutes',
                              PAID_MINUTES: 'paidMinutes',
                              WORKED_MINUTES: 'workedMinutes',
                              OT_MINUTES: 'otMinutes',
                              LATE_MINUTES: 'lateMinutes',
                              EARLY_MINUTES: 'earlyMinutes',
                            } as const
                          )[code as 'SCHEDULED_MINUTES']
                        ];
                  return (
                    <div key={code}>
                      <dt className="text-[11px] text-slate-500">{label}</dt>
                      <dd className="font-mono font-semibold text-slate-900">
                        {code === 'TRIP_ALLOWANCE_AMOUNT' ? money(total) : `${total} phút`}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-separate border-spacing-0 text-xs" aria-label="Công từng ngày">
                  <thead>
                    <tr className="text-left text-[11px] font-bold text-slate-600">
                      {['Ngày', 'Trạng thái', 'Công trả', 'Tăng ca', 'Công tác phí', 'Đơn từ'].map((h) => (
                        <th key={h} className="sticky top-0 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trace.days
                      .filter((d) => d.scheduledMinutes > 0 || d.sources.length > 0 || d.anomalies.length > 0)
                      .map((d) => (
                        <tr key={d.date}>
                          <td className="whitespace-nowrap border-b border-slate-100 px-2 py-1">
                            {formatDateVn(d.date)}
                            {d.adjusted && <span className="ml-1 text-indigo-700">(đã chỉnh tay)</span>}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-1">{DAY_STATUS[d.status] ?? d.status}</td>
                          <td className="border-b border-slate-100 px-2 py-1 font-mono">
                            {formatMinutes(d.paidMinutes)}/{formatMinutes(d.scheduledMinutes)}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-1 font-mono">
                            {d.otMinutes ? formatMinutes(d.otMinutes) : '-'}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-1 font-mono">
                            {d.tripAllowanceAmount ? money(d.tripAllowanceAmount) : '-'}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-1">
                            <ul className="space-y-0.5">
                              {d.sources.map((s) => (
                                <li key={`${s.kind}-${s.id}`}>
                                  <a
                                    href={sourceHref(s, true)}
                                    className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                                  >
                                    {sourceSummary(s)}
                                    <ExternalLink className="size-3" />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
