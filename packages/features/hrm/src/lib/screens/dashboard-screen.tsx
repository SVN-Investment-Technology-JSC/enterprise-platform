'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { HrmDashboardOverview } from '@enterprise-platform/contracts-hrm';
import {
  Banknote,
  ChevronRight,
  FileSpreadsheet,
  Inbox,
  Loader2,
  RefreshCw,
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
import { Button } from '../ui/button';
import {
  HeroBanner,
  KpiStrip,
  LeaveCard,
  MonthStrip,
  MonthTotals,
  MyRequests,
  NotificationsCard,
  PayslipCard,
  PunchCard,
  QuickActions,
  type PunchProps,
} from '../ui/dashboard/my-dashboard';
import { useMyDashboard } from '../ui/dashboard/use-my-dashboard';

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
  const permissions = useHrmPermissions();
  const { actions } = permissions;
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

  const my = useMyDashboard({ enabled: plan.personal, canSeePayslip: plan.canSeePayslip });
  const todayDay = my.employee?.days[my.today];
  const punch: PunchProps = {
    workDate: ctx?.workDate || my.today,
    shiftName: todayDay?.shiftName ?? null,
    shiftText,
    requireGps: Boolean(ctx?.requireGps),
    hasShift,
    canPunch: plan.canPunch,
    busy: punchBusy,
    message: punchMessage,
    error: punchError,
    contextError:
      context.status === 'error' ? context.message : context.status === 'forbidden' ? FORBIDDEN_TEXT : '',
    onPunch: (kind) => void handlePunch(kind),
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 pb-6">
      {nothingToShow && (
        <div role="status" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-xs">
          Tài khoản chưa được cấp quyền dùng chức năng nào trên Bàn làm việc.
        </div>
      )}
      <h1 className="sr-only">Bàn làm việc</h1>

      {plan.personal && (
        <>
          <div>
            <HeroBanner displayName={permissions.displayName} />
            <KpiStrip data={my} hasShift={hasShift} />
          </div>
          {my.error && !my.loading ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {my.error}
            </p>
          ) : null}
          <div className="grid items-start gap-4 xl:grid-cols-12">
            <div className="grid gap-4 md:grid-cols-9 xl:col-span-9">
              <div className="md:col-span-6">
                <PunchCard punch={punch} data={my} />
              </div>
              <div className="md:col-span-3">
                <LeaveCard data={my} />
              </div>
              <div className="md:col-span-6">
                <MonthStrip data={my} />
              </div>
              <div className="md:col-span-3">
                <MonthTotals data={my} />
              </div>
              <div className={plan.canSeePayslip ? 'md:col-span-5' : 'md:col-span-9'}>
                <MyRequests data={my} />
              </div>
              {plan.canSeePayslip && (
                <div className="md:col-span-4">
                  <PayslipCard data={my} />
                </div>
              )}
            </div>
            <div className="space-y-4 xl:col-span-3">
              <QuickActions />
              <NotificationsCard />
            </div>
          </div>
        </>
      )}

      {showRight && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-slate-900">Công việc quản lý</h2>
            <Button
              variant="outline"
              size="sm"
              disabled={loadingAll || !planKey}
              onClick={() => void load()}
              className="shrink-0 text-xs text-slate-600 hover:text-slate-900"
            >
              {loadingAll ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
              Làm mới
            </Button>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-12">
        {showRight && (
          <div
            className="space-y-4 lg:col-span-12"
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
      )}
    </div>
  );
}
