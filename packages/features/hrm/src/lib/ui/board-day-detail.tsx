'use client';

import { useEffect, useRef, useState } from 'react';
import type { HrmBoardDay, HrmBoardEmployee } from '@enterprise-platform/contracts-hrm';
import { formatDateVn, formatMinutes, weekdayVn } from '../hrm-timesheet-format';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import { DayRequestList } from './day-request-list';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';
import { BOX_TONE_CLASS, DAY_TONE_DOT, REQUEST_BOX_CLASS, dayTone, isLateOrEarly } from './my-timesheet-format';
import { EmployeeAvatar } from './employee-list-parts';
import { employeeInitials } from '../hrm-employee-view';
import { todayIso } from '../hrm-work-schedule-model';
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
  const color = tone === 'bad' ? 'text-orange-600' : tone === 'muted' ? 'text-slate-400' : 'text-slate-900';
  return (
    <div
      data-testid={testId}
      className={`rounded-xl border px-3 py-2 ${tone === 'bad' ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-white'}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-mono text-xl font-bold leading-tight ${color}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-semibold text-slate-500">{unit}</span> : null}
      </p>
    </div>
  );
}

/** Ô ký hiệu nhỏ giống ô trong lưới bảng công (P, CT, TC...). */
function SymbolBox({ text, className }: { text: string; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-[20px] min-w-[22px] items-center justify-center rounded px-1 text-[10px] font-bold ${className}`}
    >
      {text}
    </span>
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
      ? 'border-orange-200 bg-orange-50 text-orange-700'
      : tone === 'missing'
        ? 'border-slate-200 bg-slate-50 text-slate-400'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return (
    <div className={`rounded-xl border px-3 py-2 ${style}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
        {note ? <span className="text-[10px] font-bold">{note}</span> : null}
      </div>
      <p className="font-mono text-lg font-bold leading-tight">{time ?? '--:--'}</p>
    </div>
  );
}

interface TimelineEvent {
  key: string;
  time: string;
  label: string;
  note?: string;
  tone: 'plan' | 'ok' | 'bad' | 'missing';
}

/** Các mốc trong ngày theo thứ tự thời gian: giờ ca theo kế hoạch và giờ chấm công thực tế. */
export function dayTimelineEvents(day: HrmBoardDay): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (day.shiftStart) events.push({ key: 'shift-start', time: day.shiftStart, label: 'Bắt đầu ca', tone: 'plan' });
  if (day.shiftBreakStart && day.shiftBreakEnd) {
    events.push({ key: 'break-start', time: day.shiftBreakStart, label: 'Bắt đầu nghỉ giữa ca', tone: 'plan' });
    events.push({ key: 'break-end', time: day.shiftBreakEnd, label: 'Kết thúc nghỉ giữa ca', tone: 'plan' });
  }
  if (day.checkIn)
    events.push({
      key: 'in',
      time: day.checkIn,
      label: 'Chấm công vào',
      note: day.lateMinutes > 0 ? `Trễ ${day.lateMinutes} phút` : undefined,
      tone: day.lateMinutes > 0 ? 'bad' : 'ok',
    });
  if (day.checkOut)
    events.push({
      key: 'out',
      time: day.checkOut,
      label: 'Chấm công ra',
      note: day.earlyLeaveMinutes > 0 ? `Sớm ${day.earlyLeaveMinutes} phút` : undefined,
      tone: day.earlyLeaveMinutes > 0 ? 'bad' : 'ok',
    });
  if (day.shiftEnd) events.push({ key: 'shift-end', time: day.shiftEnd, label: 'Kết thúc ca', tone: 'plan' });
  const crossMidnight = day.shiftStart && day.shiftEnd && day.shiftEnd < day.shiftStart;
  // Ca qua đêm: không sắp theo đồng hồ, giữ thứ tự vào - ra theo ca.
  if (crossMidnight) return events;
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

const TIMELINE_DOT: Record<TimelineEvent['tone'], string> = {
  plan: 'border-slate-300 bg-white',
  ok: 'border-emerald-500 bg-emerald-500',
  bad: 'border-orange-500 bg-orange-500',
  missing: 'border-slate-300 bg-slate-100',
};

export function PunchTimeline({ day }: { day: HrmBoardDay }) {
  const events = dayTimelineEvents(day);
  const missingIn = !day.checkIn && day.scheduledMinutes > 0 && day.status !== 'FUTURE';
  const missingOut = !day.checkOut && day.scheduledMinutes > 0 && day.status !== 'FUTURE';
  if (!events.length && !missingIn && !missingOut) return null;
  return (
    <ol data-testid="day-timeline" aria-label="Dòng thời gian chấm công" className="space-y-0">
      {events.map((e, i) => (
        <li key={e.key} className="relative flex items-start gap-3 pb-2.5 last:pb-0">
          {i < events.length - 1 && (
            <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-slate-200" />
          )}
          <span aria-hidden="true" className={`relative mt-1 size-[11px] shrink-0 rounded-full border-2 ${TIMELINE_DOT[e.tone]}`} />
          <span className="flex flex-1 items-baseline justify-between gap-2">
            <span className={e.tone === 'plan' ? 'text-slate-500' : 'font-semibold text-slate-900'}>{e.label}</span>
            <span className="flex items-baseline gap-2">
              {e.note && <span className="text-[11px] font-bold text-orange-600">{e.note}</span>}
              <span className={`font-mono ${e.tone === 'bad' ? 'font-bold text-orange-600' : 'font-semibold text-slate-800'}`}>
                {e.time}
              </span>
            </span>
          </span>
        </li>
      ))}
      {(missingIn || missingOut) && (
        <li className="pt-1 text-[11px] font-semibold text-fuchsia-700">
          {missingIn && missingOut ? 'Chưa có giờ vào và giờ ra' : missingIn ? 'Chưa có giờ vào' : 'Chưa có giờ ra'}
        </li>
      )}
    </ol>
  );
}

/** Các dải thông tin của ngày: tăng ca, nghỉ phép, công tác, ghi chú cách tính trễ sớm. */
export function DayBands({ day }: { day: HrmBoardDay }) {
  const band = 'mt-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5';
  return (
    <>
      {day.otMinutes > 0 && (
        <p className={`${band} bg-violet-50 text-violet-800`}>
          <span className="flex items-center gap-2 font-semibold">
            <SymbolBox text="TC" className={REQUEST_BOX_CLASS.OT} />
            Tăng ca đã duyệt
          </span>
          <span className="font-mono font-bold">{formatMinutes(day.otMinutes)}</span>
        </p>
      )}
      {day.leave && (
        <p className={`${band} bg-blue-50 text-blue-800`}>
          <span className="flex items-center gap-2 font-semibold">
            <SymbolBox text="P" className={BOX_TONE_CLASS.leave} />
            {leaveDescription(day)}
          </span>
          <span className="font-mono font-bold">{formatUnits(day.leave.days)} ngày</span>
        </p>
      )}
      {day.tripId && !day.leave && (
        <p className={`${band} bg-indigo-50 font-semibold text-indigo-800`}>
          <SymbolBox text="CT" className={BOX_TONE_CLASS.trip} />
          <span className="flex-1">Có đơn công tác được duyệt: tính công theo đơn, không cần chấm công.</span>
        </p>
      )}
      {isLateOrEarly(day) && day.tripId == null && day.otMinutes === 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          Trễ và sớm tính theo giờ ca sau khi trừ dung sai của ca.
        </p>
      )}
    </>
  );
}

/** Danh sách bất thường cần xử lý của ngày (rỗng thì không hiện gì). */
export function DayAnomalies({ day }: { day: HrmBoardDay }) {
  if (day.anomalies.length === 0) return null;
  return (
        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3">
          <p className="mb-1 flex items-center gap-2 font-semibold text-fuchsia-800">
            <SymbolBox text="!" className={BOX_TONE_CLASS.abnormal} />
            Cần xử lý
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-fuchsia-900">
            {day.anomalies.map((code) => (
              <li key={code}>{anomalyLabel(code)}</li>
            ))}
          </ul>
        </div>
  );
}

/**
 * Nội dung chi tiết một ngày công (không gồm khung bao): số công, giờ làm, trễ, sớm; ca và giờ chấm công
 * (dạng ô ở ngăn kéo, dạng dòng thời gian ở trang Công của tôi); nghỉ, tăng ca, công tác; đơn từ của ngày; bất thường.
 */
export function BoardDayContent({
  day,
  canViewAll = false,
  punchLayout = 'tiles',
}: {
  day: HrmBoardDay;
  canViewAll?: boolean;
  punchLayout?: 'tiles' | 'timeline';
}) {
  const hasShift = Boolean(day.shiftCode || day.shiftName);
  const requestCount = day.requests?.length ?? day.sources?.length ?? 0;
  return (
    <>
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

      <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Ca làm việc và giờ chấm công">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-slate-800">
            {hasShift ? (
              <>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-700">
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
        {punchLayout === 'timeline' ? (
          <PunchTimeline day={day} />
        ) : (
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
        )}
        <DayBands day={day} />
      </section>

      {requestCount > 0 && <DayRequestList day={day} canViewAll={canViewAll} />}

      <DayAnomalies day={day} />
    </>
  );
}

function DayStatusChip({ day }: { day: HrmBoardDay }) {
  return (
    <>
      <span
        data-testid="day-status"
        className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold ${boardStatusCellClass(day.status)}`}
      >
        <span aria-hidden="true" className={`size-1.5 rounded-full ${DAY_TONE_DOT[dayTone(day, todayIso())]}`} />
        {boardStatusLabel(day.status)}
      </span>
      {day.adjusted && (
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
          Đã chỉnh tay
        </span>
      )}
    </>
  );
}

interface DayPanelProps {
  employee: HrmBoardEmployee;
  day: HrmBoardDay;
  /** Người có quyền xem mọi nhân viên: link đơn mở ở màn Duyệt đơn; nhân viên tự xem mở ở Đơn từ của tôi. */
  canViewAll?: boolean;
  /** Tháng công (YYYY-MM), để điều chỉnh công một ngày. */
  month?: string;
  /** Tháng đã tính công và chưa chốt: cho phép điều chỉnh công từng ngày. */
  adjustable?: boolean;
  onAdjusted?: () => void;
}

/** Nội dung chi tiết một ngày kèm nút điều chỉnh công; dùng trong ngăn kéo và nhúng dưới lịch tháng. */
function DayPanelBody({ employee, day, canViewAll = false, month, adjustable = false, onAdjusted }: DayPanelProps) {
  const { can } = useHrmPermissions();
  const [adjusting, setAdjusting] = useState<HrmAction | null>(null);
  const showAdjust = Boolean(adjustable && month && can('hrm.timesheet.adjust') && day.scheduledMinutes > 0);

  function openAdjust() {
    if (!month) return;
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

  return (
    <>
      <BoardDayContent day={day} canViewAll={canViewAll} />
      {showAdjust && (
        <Button type="button" variant="outline" onClick={openAdjust}>
          Điều chỉnh công ngày này
        </Button>
      )}
      {adjusting && <HrmActionDialog action={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}

/**
 * Chi tiết một ngày công nhúng ngay dưới lịch tháng của nhân viên (không mở thêm ngăn kéo chồng lên ngăn kéo tháng):
 * tiêu đề ngày và trạng thái, rồi cùng nội dung với ngăn kéo (ca, giờ chấm, nghỉ, tăng ca, đơn từ, bất thường).
 */
export function BoardDayInline({ onClose, ...panel }: DayPanelProps & { onClose: () => void }) {
  const { day } = panel;
  const ref = useRef<HTMLElement>(null);
  // Chọn ngày khác thì cuộn tới khối chi tiết để thấy ngay nội dung vừa mở.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [day.date]);
  return (
    <section
      ref={ref}
      data-testid="board-day-inline"
      aria-label={`Chi tiết ngày công ${formatDateVn(day.date)}`}
      className="space-y-3 rounded-xl border border-blue-200 bg-white p-3 text-xs shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-slate-900">
            <span>Chi tiết ngày công</span>
            <span className="font-semibold text-slate-600">
              {' · '}
              {weekdayVn(day.date)}, {formatDateVn(day.date)}
              {day.kind === 'HOLIDAY' && day.holidayName ? ` · Lễ: ${day.holidayName}` : ''}
            </span>
          </p>
          <DayStatusChip day={day} />
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
          Đóng chi tiết
        </Button>
      </div>
      <DayPanelBody {...panel} />
    </section>
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
  ...panel
}: Omit<DayPanelProps, 'employee' | 'day'> & {
  employee: HrmBoardEmployee | null;
  day: HrmBoardDay | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!(employee && day)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[600px]">
        {employee && day && (
          <>
            <SheetHeader className="shrink-0 border-b border-slate-200 bg-white">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span>Chi tiết ngày công</span>
                <DayStatusChip day={day} />
              </SheetTitle>
              <SheetDescription render={<div />}>
                <div className="flex items-center gap-2.5">
                  <EmployeeAvatar
                    initials={employeeInitials({ fullName: employee.employeeName, employeeCode: employee.employeeCode })}
                    seed={employee.employeeId}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{employee.employeeName}</span>
                    <span className="block text-xs text-slate-500">
                      {employee.employeeCode}
                      {employee.departmentName ? ` · ${employee.departmentName}` : ''} · {weekdayVn(day.date)},{' '}
                      {formatDateVn(day.date)}
                      {day.kind === 'HOLIDAY' && day.holidayName ? ` · Lễ: ${day.holidayName}` : ''}
                    </span>
                  </span>
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-3 overflow-y-auto p-5 text-xs">
              <DayPanelBody employee={employee} day={day} {...panel} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
