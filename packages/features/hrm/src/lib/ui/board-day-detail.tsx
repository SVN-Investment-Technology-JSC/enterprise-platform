'use client';

import { useState } from 'react';
import type { HrmBoardDay, HrmBoardEmployee } from '@enterprise-platform/contracts-hrm';
import { formatDateVn, formatMinutes, weekdayVn } from '../hrm-timesheet-format';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import { DayRequestList } from './day-request-list';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';
import { isLateOrEarly } from './my-timesheet-format';
import {
  anomalyLabel,
  boardStatusCellClass,
  boardStatusLabel,
  dayKindLabel,
  formatUnits,
  leaveDescription,
} from './timesheet-board-format';

function Kpi({
  label,
  value,
  unit,
  tone = 'normal',
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'normal' | 'bad' | 'muted';
  testId?: string;
}) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'muted' ? 'text-slate-400' : 'text-slate-900';
  return (
    <div
      data-testid={testId}
      className={`rounded-lg border px-3 py-2 ${tone === 'bad' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-mono text-xl font-bold leading-tight ${color}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-semibold text-slate-500">{unit}</span> : null}
      </p>
    </div>
  );
}

function PunchTile({
  label,
  time,
  note,
  tone,
}: {
  label: string;
  time: string | null;
  note?: string;
  tone: 'ok' | 'bad' | 'missing';
}) {
  const style =
    tone === 'bad'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'missing'
        ? 'border-slate-200 bg-slate-50 text-slate-400'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return (
    <div className={`rounded-lg border px-3 py-2 ${style}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
        {note ? <span className="text-[10px] font-bold">{note}</span> : null}
      </div>
      <p className="font-mono text-lg font-bold leading-tight">{time ?? '--:--'}</p>
    </div>
  );
}

/**
 * Chi tiết một ngày công: kết quả (số công, giờ làm, trễ, sớm) ở trên cùng, rồi ca và giờ vào ra, nghỉ và tăng ca,
 * đơn từ của ngày (loại đơn, ngày giờ, lý do) và bất thường. Dùng chung cho bảng công của quản lý và Công của tôi.
 */
export function BoardDayDrawer({
  employee,
  day,
  onClose,
  canViewAll = false,
  month,
  adjustable = false,
  onAdjusted,
}: {
  employee: HrmBoardEmployee | null;
  day: HrmBoardDay | null;
  onClose: () => void;
  /** Người có quyền xem mọi nhân viên: link đơn mở ở màn Duyệt đơn; nhân viên tự xem mở ở Đơn từ của tôi. */
  canViewAll?: boolean;
  /** Tháng công (YYYY-MM), để điều chỉnh công một ngày. */
  month?: string;
  /** Tháng đã tính công và chưa chốt: cho phép điều chỉnh công từng ngày. */
  adjustable?: boolean;
  onAdjusted?: () => void;
}) {
  const { can } = useHrmPermissions();
  const [adjusting, setAdjusting] = useState<HrmAction | null>(null);
  const showAdjust = Boolean(
    adjustable && month && employee && day && can('hrm.timesheet.adjust') && day.scheduledMinutes > 0,
  );

  function openAdjust() {
    if (!employee || !day || !month) return;
    setAdjusting({
      title: `Điều chỉnh công ngày ${formatDateVn(day.date)}`,
      description:
        'Chỉ điều chỉnh khi đơn từ và chấm công chưa phản ánh đúng thực tế. Căn cứ được ghi nhật ký; dòng đã chỉnh được giữ khi tính lại và bị đánh dấu rà soát nếu dữ liệu nguồn đổi.',
      columns: 1,
      fields: [
        {
          key: 'paidMinutes',
          label: `Phút công hưởng lương (tối đa ${day.scheduledMinutes})`,
          type: 'number',
          min: 0,
          max: day.scheduledMinutes,
          value: day.paidMinutes,
          required: true,
        },
        { key: 'reason', label: 'Căn cứ điều chỉnh', required: true },
      ],
      submit: async (values) => {
        await hrmFetch(`/timesheet-months/${month}/adjust`, {
          method: 'POST',
          body: JSON.stringify({
            employeeId: employee.employeeId,
            date: day.date,
            paidMinutes: Number(values.paidMinutes),
            reason: values.reason.trim(),
          }),
        });
        onAdjusted?.();
      },
    });
  }

  const hasShift = Boolean(day && (day.shiftCode || day.shiftName));
  const requestCount = day?.requests?.length ?? day?.sources?.length ?? 0;

  return (
    <Sheet open={!!(employee && day)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[600px]">
        {employee && day && (
          <>
            <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/70">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span>Chi tiết ngày công</span>
                <span
                  data-testid="day-status"
                  className={`rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold ${boardStatusCellClass(day.status)}`}
                >
                  {boardStatusLabel(day.status)}
                </span>
                {day.adjusted && (
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    Đã chỉnh tay
                  </span>
                )}
              </SheetTitle>
              <SheetDescription>
                {employee.employeeCode} - {employee.employeeName} · {weekdayVn(day.date)}, {formatDateVn(day.date)}
                {day.kind === 'HOLIDAY' && day.holidayName ? ` · Lễ: ${day.holidayName}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-3 overflow-y-auto p-5 text-xs">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="Số công" value={formatUnits(day.workdayUnits)} testId="kpi-units" />
                <Kpi
                  label="Giờ làm"
                  value={formatMinutes(day.workedMinutes)}
                  unit={day.scheduledMinutes ? `/ ${formatMinutes(day.scheduledMinutes)}` : undefined}
                  tone={day.workedMinutes ? 'normal' : 'muted'}
                  testId="kpi-worked"
                />
                <Kpi
                  label="Đi trễ"
                  value={String(day.lateMinutes)}
                  unit="phút"
                  tone={day.lateMinutes > 0 ? 'bad' : 'muted'}
                  testId="kpi-late"
                />
                <Kpi
                  label="Về sớm"
                  value={String(day.earlyLeaveMinutes)}
                  unit="phút"
                  tone={day.earlyLeaveMinutes > 0 ? 'bad' : 'muted'}
                  testId="kpi-early"
                />
              </div>

              <section className="rounded-lg border border-slate-200 p-3" aria-label="Ca làm việc và giờ chấm công">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-800">
                    {hasShift ? (
                      <>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-white">
                          {day.shiftCode ?? day.shiftName}
                        </span>
                        {day.shiftCode && day.shiftName ? <span className="ml-2">{day.shiftName}</span> : null}
                      </>
                    ) : (
                      dayKindLabel(day.kind)
                    )}
                  </p>
                  {day.shiftStart && day.shiftEnd ? (
                    <p className="font-mono text-slate-600">
                      {day.shiftStart} - {day.shiftEnd}
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <PunchTile
                    label="Vào"
                    time={day.checkIn}
                    tone={!day.checkIn ? 'missing' : day.lateMinutes > 0 ? 'bad' : 'ok'}
                    note={!day.checkIn ? (day.scheduledMinutes ? 'Chưa có' : undefined) : day.lateMinutes > 0 ? `Trễ ${day.lateMinutes}p` : undefined}
                  />
                  <PunchTile
                    label="Ra"
                    time={day.checkOut}
                    tone={!day.checkOut ? 'missing' : day.earlyLeaveMinutes > 0 ? 'bad' : 'ok'}
                    note={!day.checkOut ? (day.scheduledMinutes ? 'Chưa có' : undefined) : day.earlyLeaveMinutes > 0 ? `Sớm ${day.earlyLeaveMinutes}p` : undefined}
                  />
                </div>
                {day.otMinutes > 0 && (
                  <p className="mt-2 flex items-center justify-between rounded-md bg-violet-50 px-2.5 py-1.5 text-violet-800">
                    <span className="font-semibold">Tăng ca đã duyệt</span>
                    <span className="font-mono font-bold">{formatMinutes(day.otMinutes)}</span>
                  </p>
                )}
                {day.leave && (
                  <p className="mt-2 flex items-center justify-between rounded-md bg-sky-50 px-2.5 py-1.5 text-sky-800">
                    <span className="font-semibold">{leaveDescription(day)}</span>
                    <span className="font-mono font-bold">{formatUnits(day.leave.days)} ngày</span>
                  </p>
                )}
                {day.tripId && !day.leave && (
                  <p className="mt-2 rounded-md bg-indigo-50 px-2.5 py-1.5 font-semibold text-indigo-800">
                    Có đơn công tác được duyệt: tính công theo đơn, không cần chấm công.
                  </p>
                )}
                {isLateOrEarly(day) && day.tripId == null && day.otMinutes === 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Trễ và sớm tính theo giờ ca sau khi trừ dung sai của ca.
                  </p>
                )}
              </section>

              {requestCount > 0 && <DayRequestList day={day} canViewAll={canViewAll} />}

              {day.anomalies.length > 0 && (
                <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3">
                  <p className="mb-1 font-semibold text-fuchsia-800">Cần xử lý</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-fuchsia-900">
                    {day.anomalies.map((code) => (
                      <li key={code}>{anomalyLabel(code)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {showAdjust && (
                <Button type="button" variant="outline" onClick={openAdjust}>
                  Điều chỉnh công ngày này
                </Button>
              )}
            </div>
          </>
        )}
        {adjusting && <HrmActionDialog action={adjusting} onClose={() => setAdjusting(null)} />}
      </SheetContent>
    </Sheet>
  );
}
