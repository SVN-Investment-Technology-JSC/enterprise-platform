'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Banknote,
  Bell,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FilePen,
  FileSpreadsheet,
  FileText,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Timer,
} from 'lucide-react';
import {
  formatDate,
  useRealtimeNotificationsOptional,
} from '@enterprise-platform/shared-ui';
import { formatMinutes, weekdayVn } from '../../hrm-timesheet-format';
import type { HrmBoardDay, HrmTimesheetBoard } from '@enterprise-platform/contracts-hrm';
import { BoardDayDrawer } from '../board-day-detail';
import { MonthStepper } from '../month-stepper';
import { anomalyLabel, boardStatusLabel, formatUnits } from '../timesheet-board-format';
import { Button } from '../button';
import {
  clockVn,
  DOT_CLASS,
  dayDotTone,
  firstNameOf,
  formatDmy,
  greetingOf,
  monthSummary,
  payslipPeriod,
  pendingRequestCount,
  recentRequests,
  relativeTime,
  requestHeadline,
  requestStatusTone,
  sortedPayslips,
  todayState,
  weekdayName,
  type DotTone,
} from './dashboard-model';
import { calendarWeeks } from '../my-timesheet-format';
import { loadBoard, type MyDashboardData } from './use-my-dashboard';

/* Bảng màu của Bàn làm việc viết thẳng bằng mã màu để không bị ảnh hưởng bởi việc đổi màu chung của các màn khác. */
const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]';
const LINK = 'inline-flex items-center gap-0.5 text-[12px] font-semibold text-[#2563eb] hover:underline';

function CardTitle({ children, href, hrefLabel = 'Xem chi tiết', icon }: { children: ReactNode; href?: string; hrefLabel?: string; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
        {icon}
        {children}
      </h2>
      {href ? (
        <Link href={href} className={LINK}>
          {hrefLabel}
          <ChevronRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Biểu ngữ chào: lời chào theo giờ, ngày hôm nay và đồng hồ. */
export function HeroBanner({ displayName }: { displayName: string }) {
  const now = useNow();
  const clock = clockVn(now);
  const name = firstNameOf(displayName);
  return (
    <section
      aria-label="Lời chào"
      className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-r from-[#eaf2ff] via-[#f3f8ff] to-[#e6f0ff] px-6 pb-14 pt-5"
    >
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-[#cfe1ff]/60 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute right-40 top-6 size-24 rounded-full bg-[#d9ecdf]/70 blur-xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[#0f1f3d]">
            {greetingOf(clock.hour)}
            {name ? `, ${name}!` : '!'}
          </h1>
          <p className="mt-1 text-[13px] text-slate-600">
            Chúc bạn một ngày làm việc hiệu quả. Hôm nay là {weekdayName(clock.date)}, {formatDmy(clock.date)}.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[30px] font-extrabold leading-none tracking-tight text-[#0f1f3d]" data-testid="hero-clock">
            {clock.time}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Giờ Việt Nam (UTC+7)</p>
        </div>
      </div>
    </section>
  );
}

type KpiTone = 'green' | 'blue' | 'orange' | 'violet';
const KPI_TONE: Record<KpiTone, { tile: string; text: string }> = {
  green: { tile: 'bg-emerald-50 text-emerald-600', text: 'text-emerald-700' },
  blue: { tile: 'bg-blue-50 text-[#2563eb]', text: 'text-[#2563eb]' },
  orange: { tile: 'bg-orange-50 text-orange-500', text: 'text-orange-500' },
  violet: { tile: 'bg-violet-50 text-violet-600', text: 'text-violet-600' },
};

function Kpi({ tone, icon, label, value, testId }: { tone: KpiTone; icon: ReactNode; label: string; value: ReactNode; testId: string }) {
  return (
    <div className={`${CARD} flex items-center gap-3 px-4 py-3.5`} data-testid={testId}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${KPI_TONE[tone].tile}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[12px] text-slate-500">{label}</p>
        <p className={`truncate text-[19px] font-extrabold leading-tight ${KPI_TONE[tone].text}`}>{value}</p>
      </div>
    </div>
  );
}

/** Bốn chỉ số đầu trang, kéo lên đè mép biểu ngữ. */
export function KpiStrip({ data, hasShift }: { data: MyDashboardData; hasShift: boolean }) {
  const state = todayState(data.employee?.days[data.today], hasShift);
  const summary = monthSummary(data.employee);
  const pending = pendingRequestCount(data.employee);
  const monthNo = data.monthKey.slice(5, 7).replace(/^0/, '');
  return (
    <div className="relative z-10 -mt-10 grid grid-cols-1 gap-3 px-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số chính">
      <Kpi tone="green" icon={<CalendarCheck className="size-5" />} label="Trạng thái hôm nay" value={data.loading ? '…' : state.label} testId="kpi-today" />
      <Kpi
        tone="blue"
        icon={<CalendarDays className="size-5" />}
        label="Phép năm: dùng được / cả năm"
        value={data.annual ? `${formatUnits(data.annual.remaining)} / ${formatUnits(data.annual.total)} ngày` : data.loading ? '…' : '—'}
        testId="kpi-leave"
      />
      <Kpi
        tone="orange"
        icon={<ClipboardList className="size-5" />}
        label="Đơn của tôi"
        value={data.loading ? '…' : pending > 0 ? `${pending} đang xử lý` : 'Không có đơn chờ'}
        testId="kpi-requests"
      />
      <Kpi
        tone="violet"
        icon={<FileSpreadsheet className="size-5" />}
        label={`Bảng công tháng ${monthNo}`}
        value={data.loading ? '…' : `${formatUnits(summary.units)} / ${formatUnits(summary.standard)} ngày`}
        testId="kpi-timesheet"
      />
    </div>
  );
}

export interface PunchProps {
  readonly workDate: string;
  readonly shiftName: string | null;
  readonly shiftText: string;
  readonly requireGps: boolean;
  readonly hasShift: boolean;
  readonly canPunch: boolean;
  readonly busy: boolean;
  readonly message: string;
  readonly error: string;
  readonly contextError: string;
  readonly onPunch: (kind: 'check-in' | 'check-out') => void;
}

/** Chấm công hôm nay: ca, phương thức, trạng thái và hai nút vào ca, ra ca. */
export function PunchCard({ punch, data }: { punch: PunchProps; data: MyDashboardData }) {
  const day = data.employee?.days[data.today];
  const state = todayState(day, punch.hasShift);
  const checkedIn = Boolean(day?.checkIn);
  const stateHint =
    state.key === 'NOT_IN'
      ? 'Hãy ghi nhận vào ca để bắt đầu làm việc hôm nay'
      : state.key === 'WORKING'
        ? `Đã vào ca lúc ${day?.checkIn}`
        : state.key === 'DONE'
          ? `Vào ${day?.checkIn} · Ra ${day?.checkOut}`
          : state.key === 'NO_SHIFT'
            ? 'Hôm nay chưa được phân ca'
            : 'Không cần chấm công hôm nay';
  return (
    <section aria-label="Chấm công hôm nay" className={`${CARD} p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-emerald-700">Chấm công hôm nay</h2>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700">{formatDate(punch.workDate)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 p-3.5">
          <p className="text-[12px] text-slate-500">Ca làm việc:</p>
          <p className="mt-0.5 text-[15px] font-bold text-slate-900">
            {punch.shiftName ? `${punch.shiftName} ` : ''}
            <span className="font-mono">({punch.shiftText})</span>
            {punch.hasShift ? (
              <span className="ml-2 rounded-md bg-blue-50 px-1.5 py-0.5 align-middle text-[10.5px] font-semibold text-[#2563eb]">Ca hiện tại</span>
            ) : null}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500">
            <MapPin className="size-3.5" />
            Phương thức: <span className="font-medium text-slate-700">{punch.requireGps ? 'Định vị GPS' : 'Ứng dụng di động'}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50/70 p-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-emerald-500 text-emerald-600">
            <Clock className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-emerald-700" data-testid="punch-state">
              {state.label}
            </p>
            <p className="text-[12px] leading-snug text-slate-600">{stateHint}</p>
          </div>
        </div>
      </div>
      {punch.contextError ? (
        <p role="alert" className="mt-3 text-xs font-semibold text-red-700">
          {punch.contextError}
        </p>
      ) : null}
      {punch.message ? (
        <div role="status" className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span>{punch.message}</span>
        </div>
      ) : null}
      {punch.error ? (
        <div role="alert" className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-700">
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{punch.error}</span>
        </div>
      ) : null}
      {punch.canPunch ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button
            permission="hrm.self.attendance"
            onClick={() => punch.onPunch('check-in')}
            disabled={punch.busy || !punch.hasShift}
            className="h-11 gap-2 rounded-xl border-0 bg-emerald-600 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-600/40"
          >
            {punch.busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            <span>Ghi nhận vào ca</span>
          </Button>
          <Button
            permission="hrm.self.attendance"
            onClick={() => punch.onPunch('check-out')}
            disabled={punch.busy || !punch.hasShift}
            variant="outline"
            className={`h-11 gap-2 rounded-xl text-[13px] font-semibold ${checkedIn ? 'border-emerald-500 text-emerald-700 hover:bg-emerald-50' : 'border-emerald-200 text-emerald-600/70'
              }`}
          >
            {punch.busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            <span>Ghi nhận ra ca</span>
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">Tài khoản không có quyền chấm công trên web. Hãy chấm công trên ứng dụng di động.</p>
      )}
    </section>
  );
}

/** Phép năm của tôi: vòng tròn còn lại / tổng và ba dòng đã dùng, còn lại, đã đăng ký. */
export function LeaveCard({ data }: { data: MyDashboardData }) {
  const a = data.annual;
  const total = a?.total ?? 0;
  const radius = 42;
  const circ = 2 * Math.PI * radius;
  const frac = (n: number) => (total > 0 ? Math.max(0, Math.min(1, n / total)) : 0);
  const usedLen = circ * frac(a?.used ?? 0);
  const remainLen = circ * frac(a?.remaining ?? 0);
  return (
    <section aria-label="Phép năm của tôi" className={`${CARD} p-5`}>
      <CardTitle href="/leave">Phép năm của tôi</CardTitle>
      <div className="flex items-center gap-5">
        <div className="relative size-[118px] shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label="Biểu đồ phép năm">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#e8edf5" strokeWidth="11" />
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#2563eb" strokeWidth="11" strokeDasharray={`${usedLen} ${circ}`} />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#10a37f"
              strokeWidth="11"
              strokeDasharray={`${remainLen} ${circ}`}
              strokeDashoffset={-usedLen}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[17px] font-extrabold text-slate-900">{a ? `${formatUnits(a.remaining)} / ${formatUnits(a.total)}` : '—'}</span>
            <span className="text-[11px] text-slate-500" title="Số ngày dùng được đến hiện tại / định mức cả năm"></span>
          </div>
        </div>
        <ul className="flex-1 space-y-2 text-[12.5px]">
          {(
            [
              ['bg-[#2563eb]', 'Đã sử dụng', a?.used],
              ['bg-[#10a37f]', 'Dùng được', a?.remaining],
              ['bg-slate-300', 'Đã đăng ký', a?.pending],
            ] as const
          ).map(([dot, label, value]) => (
            <li key={label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-slate-600">
                <span className={`size-2 rounded-full ${dot}`} />
                {label}
              </span>
              <span className="font-semibold text-slate-900">{value == null ? '—' : `${formatUnits(value)} ngày`}</span>
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="/requests?create=leave"
        className="mt-4 flex h-9 items-center justify-center rounded-lg border border-[#2563eb]/40 text-[13px] font-semibold text-[#2563eb] hover:bg-blue-50"
      >
        Đăng ký nghỉ phép
      </Link>
    </section>
  );
}

const QUICK: { href: string; label: string; icon: ReactNode; tile: string }[] = [
  { href: '/requests?create=leave', label: 'Đơn nghỉ phép', icon: <CalendarDays className="size-5" />, tile: 'bg-orange-50 text-orange-500' },
  { href: '/requests?create=ot', label: 'Đơn tăng ca', icon: <Timer className="size-5" />, tile: 'bg-violet-50 text-violet-600' },
  { href: '/requests?create=correction', label: 'Giải trình công', icon: <FilePen className="size-5" />, tile: 'bg-blue-50 text-[#2563eb]' },
  { href: '/requests?create=business_trip', label: 'Đơn công tác', icon: <Briefcase className="size-5" />, tile: 'bg-emerald-50 text-emerald-600' },
];

/** Bốn lối tắt tạo đơn: mở thẳng form của loại đơn trong Đơn từ của tôi. */
export function QuickActions() {
  return (
    <section aria-label="Thao tác nhanh" className={`${CARD} p-5`}>
      <CardTitle>Thao tác nhanh</CardTitle>
      <div className="grid grid-cols-2 gap-2.5">
        {QUICK.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="flex flex-col items-center gap-2 rounded-xl border border-slate-200/70 px-2 py-3.5 text-center text-[12.5px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <span className={`flex size-10 items-center justify-center rounded-xl ${q.tile}`}>{q.icon}</span>
            {q.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

const LEGEND: { tone: DotTone; label: string }[] = [
  { tone: 'present', label: 'Đã chấm công' },
  { tone: 'late', label: 'Đi trễ' },
  { tone: 'absent', label: 'Vắng mặt' },
  { tone: 'leave', label: 'Nghỉ phép' },
  { tone: 'future', label: 'Chưa tới' },
];

/** Nhãn ngắn gọn cho một ngày có vấn đề, hiện ở chú giải khi di chuột. */
function dotTitle(date: string, day: HrmBoardDay | undefined, tone: DotTone): string {
  const head = `${weekdayVn(date)} ${formatDmy(date)}`;
  if (!day) return head;
  const parts: string[] = [boardStatusLabel(day.status)];
  if (day.lateMinutes > 0) parts.push(`trễ ${day.lateMinutes} phút`);
  if (day.earlyLeaveMinutes > 0) parts.push(`sớm ${day.earlyLeaveMinutes} phút`);
  if (tone === 'absent' && day.anomalies.length) parts.push(day.anomalies.map(anomalyLabel).join(', '));
  return `${head}: ${parts.join(', ')}. Bấm để xem chi tiết.`;
}

const CAL_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/**
 * Bảng công cả tháng dạng lịch (tuần bắt đầu thứ Hai): mỗi ô là một ngày có số ngày và chấm màu theo trạng thái,
 * vừa khít trong thẻ nên không phải cuộn ngang. Bấm vào một ngày mở chi tiết ngày đó (giờ chấm, trễ sớm, đơn từ,
 * bất thường) ngay trên trang.
 */
export function MonthStrip({ data }: { data: MyDashboardData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState(data.monthKey);
  const [other, setOther] = useState<{ month: string; board: HrmTimesheetBoard | null } | null>(null);
  const isCurrent = month === data.monthKey;
  useEffect(() => {
    if (isCurrent) return;
    let live = true;
    void loadBoard(month).then((board) => {
      if (live) setOther({ month, board });
    });
    return () => {
      live = false;
    };
  }, [month, isCurrent]);
  const otherReady = !isCurrent && other?.month === month;
  const emp = isCurrent ? data.employee : otherReady ? other.board?.employees[0] : undefined;
  const calendar = isCurrent ? data.calendar : otherReady ? (other.board?.calendar ?? []) : [];
  const loading = isCurrent ? data.loading : !otherReady;
  const weeks = useMemo(() => calendarWeeks(calendar), [calendar]);
  function changeMonth(next: string) {
    setSelected(null);
    setMonth(next);
  }
  const problems = emp
    ? Object.values(emp.days).filter((d) => {
      const tone = dayDotTone(d, data.today);
      return tone === 'absent' || tone === 'late';
    }).length
    : 0;
  return (
    <section aria-label="Bảng công tháng" className={`${CARD} p-5`}>
      <CardTitle href="/my-work" icon={<FileText className="size-4 text-[#2563eb]" />}>
        Bảng công tháng
      </CardTitle>
      <div className="mb-3">
        <MonthStepper month={month} onChange={changeMonth} />
      </div>
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600" aria-label="Chú thích">
        {LEGEND.map((l) => (
          <li key={l.tone} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${DOT_CLASS[l.tone]}`} />
            {l.label}
          </li>
        ))}
        {problems > 0 ? <li className="ml-auto font-semibold text-rose-600">{problems} ngày cần xem</li> : null}
      </ul>
      {loading ? (
        <div role="status" className="py-4 text-xs text-slate-500">
          Đang tải bảng công…
        </div>
      ) : (
        <div data-testid="month-strip">
          <div className="grid grid-cols-7 gap-1 pb-1">
            {CAL_HEADERS.map((h, i) => (
              <span key={h} className={`text-center text-[10px] font-semibold ${i === 6 ? 'text-rose-500' : 'text-slate-400'}`}>
                {h}
              </span>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((date, di) => {
                  if (!date) return <span key={`blank-${wi}-${di}`} aria-hidden="true" />;
                  const day = emp?.days[date];
                  const tone = dayDotTone(day, data.today);
                  const isToday = date === data.today;
                  const isSelected = selected === date;
                  return (
                    <button
                      key={date}
                      type="button"
                      data-testid={`strip-dot-${date}`}
                      data-tone={tone}
                      disabled={!day}
                      aria-label={`Chi tiết ngày ${formatDmy(date)}: ${day ? boardStatusLabel(day.status) : 'không có dữ liệu'}`}
                      title={dotTitle(date, day, tone)}
                      onClick={() => setSelected(date)}
                      className={`flex h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-center transition hover:border-[#2563eb] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563eb] disabled:cursor-default disabled:hover:border-slate-100 ${tone === 'late'
                        ? 'border-red-300 bg-red-50'
                        : tone === 'absent'
                          ? 'border-rose-200 bg-rose-50'
                          : 'border-slate-100 bg-white'
                        } ${isSelected ? 'border-[#2563eb] ring-1 ring-[#2563eb]' : ''}`}
                    >
                      <span
                        className={`text-[11px] leading-none ${isToday ? 'rounded bg-[#ffc90a] px-1 py-0.5 font-bold text-slate-900' : 'font-semibold text-slate-600'
                          }`}
                      >
                        {Number(date.slice(8, 10))}
                      </span>
                      <span className={`size-2 rounded-full ${DOT_CLASS[tone]}`} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <BoardDayDrawer
        employee={emp ?? null}
        day={emp && selected ? (emp.days[selected] ?? null) : null}
        onClose={() => setSelected(null)}
        canViewAll={false}
      />
    </section>
  );
}

/** Tổng công tháng: bốn ô số liệu. */
export function MonthTotals({ data }: { data: MyDashboardData }) {
  const s = monthSummary(data.employee);
  const monthNo = data.monthKey.slice(5, 7).replace(/^0/, '');
  const tiles: { label: string; value: string; tone: string; icon: ReactNode }[] = [
    { label: 'Ngày công', value: formatUnits(s.units), tone: 'bg-emerald-50 text-emerald-700', icon: <CalendarCheck className="size-4" /> },
    { label: 'Đi trễ', value: String(s.lateDays), tone: 'bg-orange-50 text-orange-500', icon: <Clock className="size-4" /> },
    { label: 'Thiếu công', value: formatUnits(s.absentDays), tone: 'bg-rose-50 text-rose-500', icon: <AlertTriangle className="size-4" /> },
    { label: 'Nghỉ phép', value: formatUnits(s.leaveDays), tone: 'bg-violet-50 text-violet-600', icon: <CalendarDays className="size-4" /> },
  ];
  return (
    <section aria-label="Tổng công tháng" className={`${CARD} p-5`}>
      <CardTitle href="/my-work">Tổng công tháng {monthNo}</CardTitle>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-xl px-3 py-2.5 text-center ${t.tone}`} data-testid={`total-${t.label}`}>
            <div className="flex justify-center">{t.icon}</div>
            <p className="mt-0.5 text-[20px] font-extrabold leading-tight">{data.loading ? '…' : t.value}</p>
            <p className="text-[11px] font-medium opacity-80">{t.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Đơn từ của tôi: ba đơn mới nhất trong tháng, bấm để mở trang Đơn từ. */
export function MyRequests({ data }: { data: MyDashboardData }) {
  const items = recentRequests(data.employee, 3);
  return (
    <section aria-label="Đơn từ của tôi" className={`${CARD} p-5`}>
      <CardTitle href="/requests" hrefLabel="Xem tất cả" icon={<span className="size-0" />}>
        Đơn từ của tôi
      </CardTitle>
      {data.loading ? (
        <p role="status" className="text-xs text-slate-500">
          Đang tải…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Chưa có đơn từ nào trong tháng này.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(({ request, firstDate }) => {
            const tone = requestStatusTone(request.status);
            return (
              <li key={`${request.kind}-${request.id}`}>
                <Link href={`/requests?request=${encodeURIComponent(request.id)}`} className="flex items-center gap-3 py-2.5 hover:bg-slate-50/60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                    <FileText className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-slate-900">{requestHeadline(request)}</span>
                    <span className="block truncate text-[12px] text-slate-500">
                      Ngày {formatDmy(firstDate)}
                      {request.minutes && request.kind === 'OT' ? ` · ${formatMinutes(request.minutes)} giờ` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.className}`}>{tone.label}</span>
                    <span className="text-[11px] text-slate-400">{relativeTime(request.createdAt)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Phiếu lương gần nhất và các kỳ lương khác đã phát hành. */
export function PayslipCard({ data }: { data: MyDashboardData }) {
  const slips = data.payslips ? sortedPayslips(data.payslips) : [];
  const latest = slips[0];
  const others = slips.slice(1, 3);
  return (
    <section aria-label="Phiếu lương gần nhất" className={`${CARD} p-5`}>
      <CardTitle href="/profile?view=payslips" hrefLabel="Xem tất cả" icon={<Banknote className="size-4 text-emerald-600" />}>
        Phiếu lương gần nhất
      </CardTitle>
      {data.payslips === null ? (
        <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">{data.loading ? 'Đang tải…' : 'Không xem được phiếu lương.'}</p>
      ) : !latest ? (
        <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Chưa có phiếu lương nào được phát hành.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 p-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563eb]">
              <FileText className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-slate-900">{payslipPeriod(latest)}</p>
              <p className="text-[12px] text-slate-500">Đã phát hành ngày {formatDmy((latest.publishedAt ?? latest.issuedAt).slice(0, 10))}</p>
            </div>
            <Link
              href={`/profile?view=payslips&selected=${encodeURIComponent(latest.id)}`}
              className="rounded-lg border border-[#2563eb]/40 px-3 py-1.5 text-[12.5px] font-semibold text-[#2563eb] hover:bg-blue-50"
            >
              Xem chi tiết
            </Link>
          </div>
          {others.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[12px] font-semibold text-slate-600">Các kỳ lương khác</p>
              <ul className="space-y-1">
                {others.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <CheckCircle2 className="size-4 text-emerald-500" />
                      {payslipPeriod(s)}
                    </span>
                    <span className="text-slate-500">{formatDmy((s.publishedAt ?? s.issuedAt).slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Thông báo mới nhất lấy từ trung tâm thông báo dùng chung; không có nhà cung cấp thì báo trống. */
export function NotificationsCard() {
  const center = useRealtimeNotificationsOptional();
  const items = center?.notifications.slice(0, 3) ?? [];
  return (
    <section aria-label="Thông báo" className={`${CARD} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
          Thông báo
          {center && center.unreadCount > 0 ? (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{center.unreadCount}</span>
          ) : null}
        </h2>
        {center ? (
          <button type="button" onClick={() => center.setDrawerOpen(true)} className={LINK}>
            Xem tất cả
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
          <Bell className="size-4" /> Chưa có thông báo mới.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-2.5">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-slate-300' : 'bg-[#2563eb]'}`} />
              <button type="button" onClick={() => void center?.openNotification(n)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] font-medium text-slate-800">{n.title}</span>
              </button>
              <span className="shrink-0 text-[11px] text-slate-400">{relativeTime(n.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
