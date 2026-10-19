'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlarmClockOff,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  LogIn,
  LogOut,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type {
  HrmBoardCalendarDay,
  HrmBoardDay,
  HrmBoardEmployee,
} from '@enterprise-platform/contracts-hrm';
import { formatDateVn, weekdayVn } from '../hrm-timesheet-format';
import {
  BoardDayDrawer,
  DayAnomalies,
  DayBands,
  PunchTimeline,
} from './board-day-detail';
import { DayRequestList } from './day-request-list';
import { MonthRequestsPanel } from './employee-month-view';
import { MonthNumberLegend, MyTimesheetCalendar } from './my-timesheet-calendar';
import {
  dayLetters,
  dayStatusPill,
  hoursDecimal,
  MY_KPI_TITLE,
  myKpiDays,
  myMonthStats,
  type MyKpiKey,
} from './my-timesheet-format';
import { formatUnits } from './timesheet-board-format';
import { KpiButton, KpiDropdownList } from './kpi-list-sheet';

const MY_KPI_KEYS: readonly string[] = ['units', 'late', 'early', 'leave', 'absent', 'ot'];

interface KpiCardSpec {
  key: string;
  label: string;
  value: string;
  /** Phần đi kèm giá trị lớn: "/ 22.0" hoặc đơn vị "lần", "ngày". */
  unit: string;
  hint?: string;
  icon: LucideIcon;
  box: string;
  alert?: boolean;
  progress?: number | null;
}

function KpiCard({
  spec,
  onOpen,
  expanded,
}: {
  spec: KpiCardSpec;
  onOpen?: () => void;
  expanded?: boolean;
}) {
  const Icon = spec.icon;
  const card = (
    <div
      data-testid={`my-stat-${spec.key}`}
      className="flex h-full min-h-[104px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-xs"
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${spec.box}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-600">
          {spec.label}
        </p>
        <p className="flex items-baseline gap-1.5">
          <span
            className={`font-mono text-2xl font-bold leading-tight ${spec.alert ? 'text-red-700' : 'text-slate-900'}`}
          >
            {spec.value}
          </span>
          <span className="truncate text-xs text-slate-500">{spec.unit}</span>
        </p>
        {spec.hint && (
          <p className="truncate text-[10px] text-slate-500" title={spec.hint}>
            {spec.hint}
          </p>
        )}
        {spec.progress != null && (
          <div
            role="progressbar"
            aria-label="Tiến độ công thực tế so với công chuẩn"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spec.progress)}
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${spec.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
  return onOpen ? (
    <KpiButton onClick={onOpen} label={`Xem các ngày: ${spec.label}`} expanded={expanded}>
      {card}
    </KpiButton>
  ) : (
    card
  );
}

/** Sáu thẻ chỉ số chính của tháng; chỉ số phụ (công tác, bất thường, đơn chờ duyệt...) hiện thành chip khi khác 0. */
export function MyKpiStrip({
  employee,
  onSelectDate,
}: {
  employee: HrmBoardEmployee;
  /** Bấm một ngày trong ngăn kéo: nhảy tới chi tiết ngày đó trên trang. */
  onSelectDate?: (date: string) => void;
}) {
  const [openKpi, setOpenKpi] = useState<MyKpiKey | null>(null);
  // Bấm một thẻ: sổ danh sách các ngày ngay dưới thẻ (như thẻ "Đơn của tôi"); bấm ra ngoài hoặc Esc để đóng.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openKpi) return;
    const onPointer = (event: MouseEvent) => {
      if (!stripRef.current?.contains(event.target as Node)) setOpenKpi(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpenKpi(null);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [openKpi]);
  const kpiItems = useMemo(
    () =>
      openKpi
        ? myKpiDays(employee, openKpi).map(({ date, value }) => ({
            id: date,
            title: weekdayVn(date),
            subtitle: formatDateVn(date),
            trailing: value,
            onSelect: onSelectDate
              ? () => {
                  setOpenKpi(null);
                  onSelectDate(date);
                }
              : undefined,
          }))
        : [],
    [openKpi, employee, onSelectDate],
  );
  const totals = employee.totals;
  const stats = useMemo(() => myMonthStats(employee), [employee]);
  const standard = stats.find((s) => s.key === 'standard');
  const standardDays = employee.standard?.workdays ?? 0;
  const leaveDays =
    totals.annualLeaveDays + totals.paidLeaveDays + totals.unpaidLeaveDays;
  const cards: KpiCardSpec[] = [
    {
      key: 'units',
      label: 'Tổng công thực tế',
      value: Number(totals.workdayUnits).toFixed(1),
      unit: standard ? `/ ${Number(standard.value).toFixed(1)}` : '',
      hint: standard?.hint,
      icon: CalendarCheck,
      box: 'bg-emerald-50 text-emerald-600',
      progress:
        standardDays > 0
          ? Math.max(
              0,
              Math.min(100, (totals.workdayUnits / standardDays) * 100),
            )
          : null,
    },
    {
      key: 'late',
      label: 'Đi trễ',
      value: String(totals.lateDays),
      unit: 'lần',
      hint: totals.lateMinutes > 0 ? `${totals.lateMinutes} phút` : undefined,
      icon: Clock,
      box: 'bg-orange-50 text-orange-500',
      alert: totals.lateDays > 0,
    },
    {
      key: 'early',
      label: 'Về sớm',
      value: String(totals.earlyLeaveDays),
      unit: 'lần',
      hint:
        totals.earlyLeaveMinutes > 0
          ? `${totals.earlyLeaveMinutes} phút`
          : undefined,
      icon: History,
      box: 'bg-violet-50 text-violet-600',
      alert: totals.earlyLeaveDays > 0,
    },
    {
      key: 'leave',
      label: 'Nghỉ phép (P)',
      value: formatUnits(leaveDays),
      unit: 'ngày',
      icon: CalendarDays,
      box: 'bg-blue-50 text-blue-600',
    },
    {
      key: 'absent',
      label: 'Nghỉ không phép (KP)',
      value: formatUnits(totals.absentDays),
      unit: 'ngày',
      icon: AlarmClockOff,
      box: 'bg-red-50 text-red-500',
      alert: totals.absentDays > 0,
    },
    {
      key: 'ot',
      label: 'Tăng ca (TC)',
      value: hoursDecimal(totals.otMinutes),
      unit: 'giờ',
      hint: 'Đã duyệt',
      icon: Timer,
      box: 'bg-sky-50 text-sky-600',
    },
  ];
  const extras = stats.filter(
    (s) =>
      s.optional && !s.zero && !['annual', 'paid', 'unpaid'].includes(s.key),
  );
  return (
    <div
      aria-label="Thống kê công trong tháng"
      data-testid="my-stats"
      className="space-y-1.5"
    >
      <div ref={stripRef} className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        {cards.map((spec, index) => {
          const clickable = MY_KPI_KEYS.includes(spec.key as MyKpiKey);
          const open = clickable && openKpi === spec.key;
          return (
            <div key={spec.key} className="relative h-full min-w-0">
              <KpiCard
                spec={spec}
                expanded={clickable ? open : undefined}
                onOpen={
                  clickable ? () => setOpenKpi((cur) => (cur === spec.key ? null : (spec.key as MyKpiKey))) : undefined
                }
              />
              {open && (
                <KpiDropdownList
                  title={`${MY_KPI_TITLE[spec.key as MyKpiKey]} (${kpiItems.length})`}
                  items={kpiItems}
                  emptyText="Không có ngày nào trong tháng này."
                  align={index >= 3 ? 'right' : 'left'}
                  onClose={() => setOpenKpi(null)}
                />
              )}
            </div>
          );
        })}
      </div>
      {extras.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-[11px]">
          {extras.map((stat) => (
            <li
              key={stat.key}
              data-testid={`my-stat-${stat.key}`}
              className={`rounded-full border px-2.5 py-0.5 font-medium ${
                stat.alert
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {stat.label}: <span className="font-bold">{stat.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ngày hiển thị mặc định ở panel chi tiết: hôm nay nếu nằm trong tháng, không thì ngày đầu tiên của tháng. */
export function defaultSelectedDate(
  calendar: readonly HrmBoardCalendarDay[],
  today: string,
): string | null {
  if (!calendar.length) return null;
  return calendar.some((c) => c.date === today) ? today : calendar[0].date;
}

function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-xs">
      <Icon className="size-4 shrink-0 text-slate-400" />
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 font-medium text-slate-900">{children}</span>
    </div>
  );
}

function ShiftInfo({ day }: { day: HrmBoardDay }) {
  const [open, setOpen] = useState(true);
  if (!day.shiftCode && !day.shiftName) return null;
  const range =
    day.shiftStart && day.shiftEnd ? `${day.shiftStart} - ${day.shiftEnd}` : '';
  return (
    <section
      aria-label="Thông tin ca làm"
      data-testid="day-shift-info"
      className="border-t border-slate-100 pt-2"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-1 text-left text-sm font-bold text-slate-900"
      >
        Thông tin ca làm
        <ChevronDown
          className={`size-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="divide-y divide-slate-50">
          <InfoRow icon={CalendarDays} label="Ca làm việc">
            {day.shiftName ?? day.shiftCode}
            {range ? ` (${range})` : ''}
          </InfoRow>
          {day.scheduledMinutes > 0 && (
            <InfoRow icon={Clock} label="Thời gian làm việc">
              {hoursLabel(day.scheduledMinutes)}
            </InfoRow>
          )}
          {day.shiftBreakStart && day.shiftBreakEnd && (
            <InfoRow icon={Timer} label="Nghỉ giữa ca">
              {day.shiftBreakStart} - {day.shiftBreakEnd}
              {day.shiftBreakMinutes
                ? ` (${hoursLabel(day.shiftBreakMinutes)})`
                : ''}
            </InfoRow>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  unit,
  icon: Icon,
  tone = 'plain',
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: LucideIcon;
  tone?: 'plain' | 'ok' | 'bad';
  testId?: string;
}) {
  const color = tone === 'bad' ? 'text-red-700' : 'text-slate-900';
  const box =
    tone === 'bad'
      ? 'bg-red-50 text-red-500'
      : 'bg-emerald-50 text-emerald-600';
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
    >
      {Icon && (
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${box}`}
        >
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className={`font-mono text-xl font-bold leading-tight ${color}`}>
          {value}
          {unit ? (
            <span className="ml-1 text-[11px] font-medium text-slate-500">
              {unit}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** Panel chi tiết một ngày: kết quả công, giờ vào ra, dòng thời gian, đơn từ và sự kiện của ngày, thông tin ca. */
export function MyDayPanel({
  day,
  today,
  onOpenFull,
}: {
  day: HrmBoardDay | null;
  today: string;
  onOpenFull: () => void;
}) {
  if (!day) {
    return (
      <p className="p-4 text-xs text-slate-500">
        Bấm một ngày trên lịch để xem chi tiết công và đơn từ của ngày đó.
      </p>
    );
  }
  const letters = dayLetters(day);
  const pill = dayStatusPill(day, today);
  const hasPunch = Boolean(day.checkIn || day.checkOut);
  const requestCount = day.requests?.length ?? day.sources?.length ?? 0;
  return (
    <div data-testid="my-day-panel" className="space-y-3 p-4 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <CalendarDays className="size-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">
              {weekdayVn(day.date)}, {formatDateVn(day.date)}
            </p>
            <p className="text-[11px] text-slate-500">
              {day.date === today
                ? 'Hôm nay'
                : day.date > today
                  ? 'Chưa tới ngày'
                  : 'Đã qua'}
              {day.kind === 'HOLIDAY' && day.holidayName
                ? ` · Lễ: ${day.holidayName}`
                : ''}
              {letters.length > 0
                ? ` · ${letters.map((l) => l.letter).join(', ')}`
                : ''}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {day.adjusted && (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
              Đã chỉnh tay
            </span>
          )}
          <span
            data-testid="day-status"
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${pill.className}`}
          >
            {pill.label}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile
          label="Tổng giờ làm"
          value={hoursDecimal(day.workedMinutes)}
          testId="kpi-worked"
        />
        <Tile
          label="Giờ công"
          value={hoursDecimal(day.paidMinutes)}
          testId="kpi-paid"
        />
        <Tile
          label="Giờ vào"
          value={day.checkIn ?? '--:--'}
          icon={LogIn}
          tone={day.lateMinutes > 0 ? 'bad' : 'ok'}
          testId="kpi-in"
        />
        <Tile
          label="Giờ ra"
          value={day.checkOut ?? '--:--'}
          icon={LogOut}
          tone={day.earlyLeaveMinutes > 0 ? 'bad' : 'ok'}
          testId="kpi-out"
        />
      </div>

      {(hasPunch || day.shiftStart) && (
        <section
          aria-label="Dòng thời gian chấm công"
          className="rounded-xl border border-slate-200 px-3 py-2.5"
        >
          <PunchTimeline day={day} />
        </section>
      )}

      <DayBands day={day} />
      {requestCount > 0 && <DayRequestList day={day} canViewAll={false} />}
      <DayAnomalies day={day} />
      <ShiftInfo day={day} />

      <button
        type="button"
        onClick={onOpenFull}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50/50"
      >
        Xem chi tiết chấm công
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

type PanelTab = 'day' | 'requests';

/**
 * Bảng công cả tháng của chính mình: sáu thẻ chỉ số, thẻ lịch tháng kèm chú thích (trái) và panel bên phải có hai tab
 * "Chi tiết ngày" và "Đơn từ trong tháng". "Xem chi tiết chấm công" mở ngăn kéo đầy đủ của ngày.
 */
export function MyTimesheetView({
  month,
  calendar,
  employee,
  today,
  selectedDate,
  onSelectDate,
}: {
  month: string;
  calendar: readonly HrmBoardCalendarDay[];
  employee: HrmBoardEmployee;
  today: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const [tab, setTab] = useState<PanelTab>('day');
  const [fullDate, setFullDate] = useState<string | null>(null);
  const activeDate = selectedDate ?? defaultSelectedDate(calendar, today);
  const day = activeDate ? (employee.days[activeDate] ?? null) : null;
  const fullDay = fullDate ? (employee.days[fullDate] ?? null) : null;
  const requestCount = useMemo(() => {
    const keys = new Set<string>();
    for (const d of Object.values(employee.days))
      for (const r of d.requests ?? []) keys.add(`${r.kind}:${r.id}`);
    return keys.size;
  }, [employee]);

  function pick(date: string) {
    onSelectDate(date);
    setTab('day');
  }

  const tabClass = (active: boolean) =>
    `flex-1 border-b-2 px-3 py-3 text-sm font-semibold transition ${
      active
        ? 'border-blue-600 text-blue-700'
        : 'border-transparent text-slate-500 hover:text-slate-800'
    }`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <MyKpiStrip employee={employee} onSelectDate={pick} />
      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h2 className="mb-2 text-base font-bold text-slate-900">
            Lịch công tháng {month.slice(5, 7)}/{month.slice(0, 4)}
          </h2>
          <MyTimesheetCalendar
            calendar={calendar}
            employee={employee}
            today={today}
            selectedDate={activeDate}
            onSelect={pick}
          />
          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xs">
            <MonthNumberLegend />
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-xs xl:max-h-[calc(100vh-170px)]">
          <div
            role="tablist"
            aria-label="Chi tiết công"
            className="flex shrink-0 border-b border-slate-200"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'day'}
              onClick={() => setTab('day')}
              className={tabClass(tab === 'day')}
            >
              Chi tiết ngày
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'requests'}
              onClick={() => setTab('requests')}
              className={tabClass(tab === 'requests')}
            >
              Đơn từ trong tháng ({requestCount})
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'day' ? (
              <MyDayPanel
                day={day}
                today={today}
                onOpenFull={() => setFullDate(activeDate)}
              />
            ) : (
              <MonthRequestsPanel
                employee={employee}
                onSelectDate={pick}
                embedded
              />
            )}
          </div>
        </section>
      </div>

      <BoardDayDrawer
        employee={employee}
        day={fullDay}
        onClose={() => setFullDate(null)}
        canViewAll={false}
      />
    </div>
  );
}
