'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { HrmDashboardOverview } from '@enterprise-platform/contracts-hrm';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  FileText,
  Inbox,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  UserCheck,
  Workflow,
} from 'lucide-react';
import { HrmApiError, hrmFetch } from '../hrm-api';
import {
  approvalHref,
  approvalListPath,
  isPendingStatus,
  PROCEDURE_INSTANCES_PATH,
} from '../hrm-approval-kinds';
import { dashboardPlan, formatShiftWindow } from '../hrm-dashboard-access';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

type TimeContext = {
  employeeId: string;
  workDate: string;
  timezone: string;
  requireGps: boolean;
  shift: {
    window: {
      start: string;
      end: string;
      graceLateMinutes: number;
      graceEarlyMinutes: number;
    };
  } | null;
};

type Section<T> =
  | { status: 'idle' }
  | { status: 'ok'; data: T }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

const idle = { status: 'idle' } as const;

async function settle<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { status: 'ok', data: await fn() };
  } catch (e) {
    if (e instanceof HrmApiError && e.status === 403) {
      return { status: 'forbidden' };
    }
    return {
      status: 'error',
      message: e instanceof Error ? e.message : 'Không tải được dữ liệu',
    };
  }
}

type PeriodSummary = { open: number; locked: number };

const FORBIDDEN_TEXT = 'Không có quyền xem';

function SectionNote({ section }: { section: Section<unknown> }) {
  if (section.status === 'forbidden') {
    return <p className="text-xs text-slate-500">{FORBIDDEN_TEXT}</p>;
  }
  if (section.status === 'error') {
    return (
      <p role="alert" className="text-xs font-semibold text-red-700">
        {section.message}
      </p>
    );
  }
  return null;
}

export default function HrmDashboardPage() {
  const { actions } = useHrmPermissions();
  const actionKey = actions.join('|');
  const plan = useMemo(
    () => dashboardPlan(actionKey ? actionKey.split('|') : []),
    [actionKey],
  );
  // Khóa ổn định theo danh sách endpoint: chỉ tải lại khi tập quyền ảnh hưởng thay đổi.
  const planKey = plan.endpoints.join('|');

  const [context, setContext] = useState<Section<TimeContext>>(idle);
  const [counts, setCounts] = useState<Record<string, Section<number>>>({});
  const [overview, setOverview] = useState<Section<HrmDashboardOverview>>(idle);
  const [timesheets, setTimesheets] = useState<Section<PeriodSummary>>(idle);
  const [payrolls, setPayrolls] = useState<Section<PeriodSummary>>(idle);
  const [loadingAll, setLoadingAll] = useState(false);

  const [punchBusy, setPunchBusy] = useState(false);
  const [punchMessage, setPunchMessage] = useState('');
  const [punchError, setPunchError] = useState('');
  const eventKey = useRef<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const current = () => id === requestId.current;
    setLoadingAll(true);
    const jobs: Promise<void>[] = [];
    if (plan.personal) {
      jobs.push(
        settle(async () => {
          const res = await hrmFetch<{ data: TimeContext }>(
            '/my-attendance-context',
          );
          return res.data;
        }).then((s) => {
          if (current()) setContext(s);
        }),
      );
    }
    for (const source of plan.approvals) {
      jobs.push(
        settle(async () => {
          const res = await hrmFetch<{ data: { status: string }[] }>(
            approvalListPath(source),
          );
          return res.data.filter((r) => isPendingStatus(r.status)).length;
        }).then((s) => {
          if (current()) setCounts((prev) => ({ ...prev, [source.kind]: s }));
        }),
      );
    }
    if (plan.overview) {
      jobs.push(
        settle(async () => {
          const res = await hrmFetch<{ data: HrmDashboardOverview }>(
            '/dashboard/overview',
          );
          return res.data;
        }).then((s) => {
          if (current()) setOverview(s);
        }),
      );
    }
    if (plan.timesheetPeriods) {
      jobs.push(
        settle(async () => {
          const res = await hrmFetch<{ data: { status: string }[] }>(
            '/timesheet-periods',
          );
          return {
            open: res.data.filter((p) => p.status === 'OPEN').length,
            locked: res.data.filter((p) => p.status === 'LOCKED').length,
          };
        }).then((s) => {
          if (current()) setTimesheets(s);
        }),
      );
    }
    if (plan.payrollPeriods) {
      jobs.push(
        settle(async () => {
          const res = await hrmFetch<{ data: { status: string }[] }>(
            '/payroll-periods',
          );
          return {
            open: res.data.filter((p) => p.status === 'OPEN').length,
            locked: res.data.filter((p) => p.status === 'LOCKED').length,
          };
        }).then((s) => {
          if (current()) setPayrolls(s);
        }),
      );
    }
    await Promise.all(jobs);
    if (current()) setLoadingAll(false);
  }, [planKey]);

  useEffect(() => {
    if (!planKey) return;
    void load();
    return () => {
      requestId.current++;
    };
  }, [planKey, load]);

  async function handlePunch(kind: 'check-in' | 'check-out') {
    if (punchBusy) return;
    setPunchBusy(true);
    setPunchError('');
    setPunchMessage('');
    try {
      const ctx = context.status === 'ok' ? context.data : null;
      let position: Record<string, number> = {};
      if (ctx?.requireGps) {
        if (!navigator.geolocation) {
          throw new Error('Trình duyệt không hỗ trợ định vị GPS.');
        }
        const gps = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () => reject(new Error('Không lấy được GPS. Hãy cấp quyền vị trí.')),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          ),
        );
        position = {
          latitude: gps.coords.latitude,
          longitude: gps.coords.longitude,
          accuracy: gps.coords.accuracy,
        };
      }
      eventKey.current ||= crypto.randomUUID();
      await hrmFetch(`/attendance/${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          ...position,
          externalEventId: eventKey.current,
        }),
      });
      eventKey.current = null;
      const nowStr = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setPunchMessage(
        kind === 'check-in'
          ? `Đã ghi nhận lượt vào lúc ${nowStr}.`
          : `Đã ghi nhận lượt ra lúc ${nowStr}.`,
      );
    } catch (e) {
      setPunchError(
        e instanceof Error ? e.message : 'Không ghi nhận được chấm công',
      );
    } finally {
      setPunchBusy(false);
    }
  }

  const ctx = context.status === 'ok' ? context.data : null;
  const shiftText =
    context.status === 'ok'
      ? (formatShiftWindow(ctx?.shift?.window, ctx?.timezone) ?? 'Chưa phân ca')
      : context.status === 'idle'
        ? '—'
        : 'Không xác định';
  const hasShift = Boolean(ctx?.shift);
  const showApprovals = plan.approvals.length > 0;
  const showRight =
    showApprovals ||
    plan.overview ||
    plan.timesheetPeriods ||
    plan.payrollPeriods;
  const nothingToShow = !plan.personal && !showRight;
  const overviewData = overview.status === 'ok' ? overview.data : null;

  const personalLinks = [
    { href: '/my-work?view=calendar', label: 'Lịch của tôi', icon: CalendarDays, show: true },
    { href: '/my-work?view=attendance', label: 'Chấm công của tôi', icon: Clock, show: true },
    {
      href: '/my-work?view=timesheet',
      label: 'Bảng công của tôi',
      icon: FileSpreadsheet,
      show: true,
    },
    { href: '/requests', label: 'Đơn từ của tôi', icon: FileText, show: true },
    { href: '/profile', label: 'Hồ sơ của tôi', icon: UserCheck, show: true },
    {
      href: '/profile?view=payslips',
      label: 'Phiếu lương của tôi',
      icon: Banknote,
      show: plan.canSeePayslip,
    },
  ].filter((item) => item.show);

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto pb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Bàn làm việc
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Việc cá nhân và các việc cần xử lý theo quyền của bạn.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loadingAll || !planKey}
          onClick={() => void load()}
          className="text-xs text-slate-600 hover:text-slate-900 shrink-0"
        >
          {loadingAll ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5 mr-1.5" />
          )}
          Làm mới
        </Button>
      </div>

      {nothingToShow && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-xs"
        >
          Tài khoản chưa được cấp quyền dùng chức năng nào trên Bàn làm việc.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12 items-start">
        {plan.personal && (
          <section
            aria-label="Khu vực cá nhân"
            className={`space-y-4 ${showRight ? 'lg:col-span-5' : 'lg:col-span-12'}`}
          >
            <div className="rounded-xl border border-emerald-200/80 bg-linear-to-br from-emerald-50/60 via-white to-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Chấm công hôm nay
                </span>
                <Badge className="bg-emerald-100/80 text-emerald-800 border-emerald-300 font-mono text-[11px]">
                  {ctx?.workDate || new Date().toISOString().slice(0, 10)}
                </Badge>
              </div>

              <div className="bg-white/90 rounded-lg border border-emerald-100 p-3 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Ca làm việc:</span>
                  <span className="font-semibold text-slate-900">{shiftText}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Phương thức:</span>
                  <span className="text-[11px] font-mono text-slate-700">
                    {ctx?.requireGps ? 'Yêu cầu định vị GPS' : 'Web'}
                  </span>
                </div>
              </div>

              {context.status === 'error' && (
                <p role="alert" className="text-xs font-semibold text-red-700">
                  {context.message}
                </p>
              )}
              {context.status === 'forbidden' && (
                <p className="text-xs text-slate-500">{FORBIDDEN_TEXT}</p>
              )}

              {punchMessage && (
                <div
                  role="status"
                  className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span>{punchMessage}</span>
                </div>
              )}
              {punchError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-1.5"
                >
                  <AlertTriangle className="size-4 text-red-600 shrink-0" />
                  <span>{punchError}</span>
                </div>
              )}

              {plan.canPunch ? (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Button
                    permission="hrm.self.attendance"
                    onClick={() => void handlePunch('check-in')}
                    disabled={punchBusy || !hasShift}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-10 shadow-xs gap-1.5"
                  >
                    {punchBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LogIn className="size-4" />
                    )}
                    <span>Ghi nhận vào ca</span>
                  </Button>
                  <Button
                    permission="hrm.self.attendance"
                    onClick={() => void handlePunch('check-out')}
                    disabled={punchBusy || !hasShift}
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold text-xs h-10 shadow-xs gap-1.5"
                  >
                    {punchBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LogOut className="size-4" />
                    )}
                    <span>Ghi nhận ra ca</span>
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Tài khoản không có quyền chấm công trên web.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                Việc của tôi
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {personalLinks.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-800 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 text-blue-600" />
                      {label}
                    </span>
                    <ChevronRight className="size-3.5 text-slate-400 group-hover:text-blue-600" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {showRight && (
          <div
            className={`space-y-4 ${plan.personal ? 'lg:col-span-7' : 'lg:col-span-12'}`}
          >
            {showApprovals && (
              <section
                aria-label="Cần xử lý"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                      <Inbox className="size-4" />
                    </div>
                    <h2 className="text-sm font-bold text-slate-900">Cần xử lý</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/approvals"
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Mở Đơn từ cần xử lý
                    </Link>
                    <a
                      href={PROCEDURE_INSTANCES_PATH}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      <Workflow className="size-3.5" />
                      <span>Theo dõi quy trình</span>
                    </a>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {plan.approvals.map((source) => {
                    const section = counts[source.kind] ?? idle;
                    return (
                      <Link
                        key={source.kind}
                        href={approvalHref(source)}
                        className="rounded-lg border border-slate-200 p-3 hover:border-amber-300 hover:bg-amber-50/40 transition-colors flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-semibold text-slate-800">
                          {source.label}
                        </span>
                        {section.status === 'ok' ? (
                          <span
                            className={`font-mono text-lg font-bold ${section.data > 0 ? 'text-amber-700' : 'text-slate-400'}`}
                          >
                            {section.data}
                          </span>
                        ) : section.status === 'forbidden' ? (
                          <span className="text-[11px] text-slate-500">
                            {FORBIDDEN_TEXT}
                          </span>
                        ) : section.status === 'error' ? (
                          <span className="text-[11px] text-red-700">
                            Không tải được
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">...</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {plan.overview && (
              <section
                aria-label="Chấm công hôm nay của toàn đơn vị"
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Chấm công hôm nay của toàn đơn vị
                  </h2>
                  <Link
                    href="/timekeeping?view=data"
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Mở Dữ liệu chấm công
                  </Link>
                </div>
                <SectionNote section={overview} />
                {(overviewData?.todayDayKind === 'OFF' ||
                  overviewData?.todayDayKind === 'HOLIDAY') && (
                  <div
                    role="status"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  >
                    {overviewData.todayDayKind === 'HOLIDAY'
                      ? 'Hôm nay là ngày lễ theo lịch làm việc.'
                      : 'Hôm nay là ngày nghỉ hằng tuần theo chính sách chấm công.'}{' '}
                    Số liệu hôm nay không tính thiếu lượt hay đi trễ cho ngày nghỉ.
                  </div>
                )}
                {overviewData && (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      {
                        label: 'Đã vào ca',
                        value: overviewData.todayAttendance.checkedInCount,
                        color: 'text-emerald-600',
                      },
                      {
                        label: 'Đi trễ',
                        value: overviewData.todayAttendance.lateCount,
                        color: 'text-amber-600',
                      },
                      {
                        label: 'Thiếu lượt chấm',
                        value: overviewData.todayAttendance.missingPunchCount,
                        color: 'text-rose-600',
                      },
                      {
                        label: 'Đang nghỉ phép',
                        value: overviewData.todayAttendance.onLeaveCount,
                        color: 'text-indigo-600',
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="bg-white p-3 rounded-lg border border-slate-200"
                      >
                        <span className="text-[11px] text-slate-500 block">
                          {item.label}
                        </span>
                        <span
                          className={`text-xl font-bold font-mono mt-1 block ${item.color}`}
                        >
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {(plan.timesheetPeriods || plan.payrollPeriods) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {plan.timesheetPeriods && (
                  <section
                    aria-label="Kỳ công"
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="size-4 text-blue-600" />
                      <h2 className="text-sm font-bold text-slate-900">Kỳ công</h2>
                    </div>
                    <SectionNote section={timesheets} />
                    {timesheets.status === 'ok' && (
                      <p className="text-xs text-slate-600">
                        <strong className="text-blue-600 font-mono">
                          {timesheets.data.open}
                        </strong>{' '}
                        kỳ đang mở,{' '}
                        <strong className="text-emerald-600 font-mono">
                          {timesheets.data.locked}
                        </strong>{' '}
                        kỳ đã khóa.
                      </p>
                    )}
                    <Link
                      href="/timekeeping?view=timesheets"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Mở Bảng công
                      <ChevronRight className="size-3" />
                    </Link>
                  </section>
                )}
                {plan.payrollPeriods && (
                  <section
                    aria-label="Kỳ lương"
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <Banknote className="size-4 text-emerald-600" />
                      <h2 className="text-sm font-bold text-slate-900">Kỳ lương</h2>
                    </div>
                    <SectionNote section={payrolls} />
                    {payrolls.status === 'ok' && (
                      <p className="text-xs text-slate-600">
                        <strong className="text-amber-600 font-mono">
                          {payrolls.data.open}
                        </strong>{' '}
                        kỳ lương đang mở.
                      </p>
                    )}
                    <Link
                      href="/payroll"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Mở Bảng lương
                      <ChevronRight className="size-3" />
                    </Link>
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
