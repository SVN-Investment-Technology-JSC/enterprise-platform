'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  HrmAttendanceMonitor,
  HrmMonitorRow,
  HrmMonitorStatus,
} from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  LogOut,
  RefreshCw,
  Search,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import {
  EMPTY_FILTER,
  KPI_TITLE,
  MONITOR_STATUS,
  MONITOR_TABS,
  REQUEST_KIND_LABEL,
  REQUEST_STATUS,
  actualText,
  departmentOptions,
  departmentStats,
  filterAttention,
  initialsOf,
  kpiRows,
  longDateVn,
  monitorCsvRows,
  relatedRequests,
  shiftOptions,
  shiftTimeText,
  statusText,
  tabCounts,
  todayVn,
  updatedTimeVn,
  type MonitorFilter,
  type MonitorKpi,
  type MonitorTone,
} from '../attendance-monitor-model';
import { buildCsv, downloadCsv } from '../hrm-csv';
import { Button } from '../ui/button';
import { DatePickerInput } from '../ui/date-picker-input';
import { PageTitle } from '../ui/page-title';
import { KpiButton, KpiListSheet } from '../ui/kpi-list-sheet';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';

const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]';
const REFRESH_MS = 60_000;
const PAGE_SIZES = [5, 10, 20, 50];

const TONE: Record<MonitorTone, string> = {
  red: 'bg-rose-50 text-rose-600 border-rose-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  orange: 'bg-orange-50 text-orange-600 border-orange-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};

function StatusChip({ tone, children }: { tone: MonitorTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function Kpi({
  tone,
  icon,
  label,
  value,
  sub,
  testId,
  onClick,
}: {
  tone: 'blue' | 'green' | 'red' | 'amber' | 'orange' | 'violet';
  icon: React.ReactNode;
  label: React.ReactNode;
  value: number;
  sub?: React.ReactNode;
  testId: string;
  onClick: () => void;
}) {
  const tile = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    red: 'bg-rose-50 text-rose-500',
    amber: 'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-500',
    violet: 'bg-violet-50 text-violet-600',
  }[tone];
  return (
    <KpiButton onClick={onClick} label={`Xem danh sách: ${typeof label === 'string' ? label : testId}`}>
      <div className={`${CARD} flex h-full min-h-[84px] items-center gap-3 px-4 py-3.5`} data-testid={testId}>
        <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tile}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[13px] leading-tight text-slate-500">{label}</p>
          <p className="text-[26px] font-extrabold leading-tight text-slate-900">{value}</p>
          {sub ? <p className="text-[12px] text-slate-400">{sub}</p> : null}
        </div>
      </div>
    </KpiButton>
  );
}

function FilterBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-xl border border-slate-200/80 bg-white px-3 pb-1 pt-1.5">
      <span className="block text-[12px] font-medium text-slate-500">{label}</span>
      {children}
    </div>
  );
}

export default function AttendanceMonitorScreen() {
  const [date, setDate] = useState(() => todayVn());
  const [data, setData] = useState<HrmAttendanceMonitor | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Từ Bàn làm việc sang: ?kpi=LATE mở ngăn kéo của thẻ, ?tab=MISSING_PUNCH lọc sẵn danh sách cần theo dõi.
  const [filter, setFilter] = useState<MonitorFilter>(() => {
    const tab = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab');
    return MONITOR_TABS.some((t) => t.id === tab) ? { ...EMPTY_FILTER, tab: tab as MonitorFilter['tab'] } : EMPTY_FILTER;
  });
  const [shift, setShift] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [detail, setDetail] = useState<HrmMonitorRow | null>(null);
  const [kpi, setKpi] = useState<MonitorKpi | null>(() => {
    const value = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('kpi');
    return value && value in KPI_TITLE ? (value as MonitorKpi) : null;
  });
  const sequence = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const mine = ++sequence.current;
      if (!silent) setLoading(true);
      try {
        const result = await hrmFetch<{ data: HrmAttendanceMonitor }>(
          `/attendance-monitor?date=${encodeURIComponent(date)}`,
        );
        if (mine !== sequence.current) return;
        setData(result.data);
        setError('');
      } catch (e) {
        if (mine !== sequence.current) return;
        setError(e instanceof Error ? e.message : 'Không tải được dữ liệu giám sát chấm công.');
      } finally {
        if (mine === sequence.current) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Hôm nay: tự làm mới mỗi phút để thấy ngay người vừa chấm công.
  useEffect(() => {
    if (date !== todayVn()) return;
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [date, load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const effective: MonitorFilter = useMemo(() => ({ ...filter, shift }), [filter, shift]);
  const attention = useMemo(() => filterAttention(rows, effective), [rows, effective]);
  const counts = useMemo(() => tabCounts(rows, effective), [rows, effective]);
  const requests = useMemo(() => relatedRequests(rows), [rows]);
  const departments = useMemo(() => departmentStats(rows), [rows]);
  const pages = Math.max(1, Math.ceil(attention.length / pageSize));
  const current = Math.min(page, pages);
  const visible = attention.slice((current - 1) * pageSize, current * pageSize);
  const summary = data?.summary;
  const isToday = date === (data?.today ?? todayVn());

  const patch = (next: Partial<MonitorFilter>) => {
    setFilter((f) => ({ ...f, ...next }));
    setPage(1);
  };

  const kpiItems = useMemo(
    () =>
      kpi
        ? kpiRows(rows, kpi).map((row) => ({
          id: row.employeeId,
          title: row.employeeName,
          subtitle: [row.departmentName, row.shiftName].filter(Boolean).join(' · ') || row.employeeCode,
          trailing: statusText(row),
          onSelect: () => {
            setKpi(null);
            setDetail(row);
          },
        }))
        : [],
    [kpi, rows],
  );
  const exportCsv = () =>
    downloadCsv(`giam-sat-cham-cong-${date}.csv`, buildCsv(monitorCsvRows(attention)));

  const statusOptions = (Object.keys(MONITOR_STATUS) as HrmMonitorStatus[])
    .filter((s) => MONITOR_TABS[0].statuses.includes(s))
    .map((s) => ({ value: s, label: MONITOR_STATUS[s].label }));

  return (
    <div className="space-y-4" data-testid="attendance-monitor">
      <PageTitle
        title={isToday ? 'Giám sát chấm công hôm nay' : 'Giám sát chấm công theo ngày'}
        description={
          data?.scope === 'TEAM'
            ? 'Theo dõi tình hình vào ca, đi trễ, về sớm của nhân viên cấp dưới trong ngày.'
            : 'Theo dõi tình hình vào ca, đi trễ, về sớm và các trường hợp cần xử lý trong ngày.'
        }
        actions={
          <>
            <div className="w-[190px]">
              <DatePickerInput
                aria-label="Ngày giám sát"
                value={date}
                onChange={(v) => {
                  if (v) {
                    setDate(v);
                    setPage(1);
                  }
                }}
              />
            </div>
            <div className="w-[200px]">
              <SearchableSelect
                value={shift}
                onChange={(v) => {
                  setShift(v || '');
                  setPage(1);
                }}
                clearable
                placeholder="Tất cả ca làm việc"
                options={shiftOptions(rows)}
              />
            </div>
            <Button onClick={() => void load(false)} disabled={loading} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700">
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              Làm mới
            </Button>
          </>
        }
      />
      <p className="flex items-center justify-end gap-1.5 text-[12px] text-slate-500">
        {longDateVn(date)}
        {data ? (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="updated-at">Cập nhật lần cuối: {updatedTimeVn(data.generatedAt)}</span>
            {isToday ? <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
          </>
        ) : null}
      </p>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <section aria-label="Tổng quan" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          tone="blue"
          icon={<Users className="size-6" />}
          label="Tổng nhân sự đi ca"
          value={summary?.scheduled ?? 0}
          testId="kpi-scheduled"
          onClick={() => setKpi('SCHEDULED')}
        />
        <Kpi
          tone="green"
          icon={<CheckCircle2 className="size-6" />}
          label="Đã vào ca"
          value={summary?.checkedIn ?? 0}
          //sub={percentText(summary?.checkedIn ?? 0, summary?.scheduled ?? 0)}
          testId="kpi-checked-in"
          onClick={() => setKpi('CHECKED_IN')}
        />
        <Kpi
          tone="red"
          icon={<Clock className="size-6" />}
          label="Chưa chấm công"
          value={summary?.notCheckedIn ?? 0}
          //sub={percentText(summary?.notCheckedIn ?? 0, summary?.scheduled ?? 0)}
          testId="kpi-not-checked-in"
          onClick={() => setKpi('NOT_CHECKED_IN')}
        />
        <Kpi
          tone="amber"
          icon={<TriangleAlert className="size-6" />}
          label="Đi trễ"
          value={summary?.late ?? 0}
          //sub={percentText(summary?.late ?? 0, summary?.scheduled ?? 0)}
          testId="kpi-late"
          onClick={() => setKpi('LATE')}
        />
        <Kpi
          tone="orange"
          icon={<LogOut className="size-6" />}
          label="Về sớm"
          value={summary?.earlyLeave ?? 0}
          //sub={percentText(summary?.earlyLeave ?? 0, summary?.scheduled ?? 0)}
          testId="kpi-early"
          onClick={() => setKpi('EARLY_LEAVE')}
        />
        <Kpi
          tone="violet"
          icon={<CalendarDays className="size-6" />}
          label="Đang nghỉ phép"
          value={summary?.onLeave ?? 0}
          //sub={percentText(summary?.onLeave ?? 0, summary?.scheduled ?? 0)}
          testId="kpi-leave"
          onClick={() => setKpi('ON_LEAVE')}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={`${CARD} p-4`} aria-label="Danh sách cần theo dõi">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">Danh sách cần theo dõi ({attention.length})</h2>
              <p className="text-xs text-slate-500">
                Các nhân viên chưa vào ca, đi trễ, về sớm hoặc thiếu lượt chấm công.
              </p>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={!attention.length} className="gap-1.5">
              <Download className="size-4" />
              Xuất Excel
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <label className="flex min-w-[220px] flex-[2] items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 text-sm">
              <Search className="size-4 shrink-0 text-slate-400" />
              <input
                aria-label="Tìm nhân viên"
                value={filter.search}
                onChange={(e) => patch({ search: e.target.value })}
                placeholder="Tìm tên hoặc mã nhân viên..."
                className="h-10 w-full bg-transparent outline-none placeholder:text-slate-400"
              />
            </label>
            <FilterBox label="Phòng ban">
              <SearchableSelect
                value={filter.department}
                onChange={(v) => patch({ department: v || '' })}
                clearable
                placeholder="Tất cả phòng ban"
                options={departmentOptions(rows)}
              />
            </FilterBox>
            <FilterBox label="Trạng thái">
              <SearchableSelect
                value={filter.status}
                onChange={(v) => patch({ status: (v || '') as MonitorFilter['status'] })}
                clearable
                placeholder="Tất cả trạng thái"
                options={statusOptions}
              />
            </FilterBox>
          </div>

          <div role="tablist" aria-label="Nhóm trạng thái" className="mt-3 flex flex-wrap gap-2">
            {MONITOR_TABS.map((tab) => {
              const active = filter.tab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => patch({ tab: tab.id })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? `${TONE[tab.tone]} ring-1 ring-current/20` : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                >
                  {tab.label} ({counts[tab.id]})
                </button>
              );
            })}
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200/80">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Nhân viên</th>
                  <th className="px-3 py-2.5">Phòng ban</th>
                  <th className="px-3 py-2.5">Ca làm</th>
                  <th className="px-3 py-2.5">Ghi nhận thực tế</th>
                  <th className="px-3 py-2.5">Trạng thái</th>
                  <th className="px-3 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !data ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">Đang tải dữ liệu...</td>
                  </tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                      {rows.length
                        ? 'Không có nhân viên nào cần theo dõi theo bộ lọc hiện tại.'
                        : 'Không có nhân viên trong phạm vi giám sát của bạn.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((row) => (
                    <tr key={row.employeeId} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[12px] font-bold text-blue-700">
                            {initialsOf(row.employeeName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{row.employeeName}</p>
                            <p className="truncate text-[12px] text-slate-500">{row.positionName || row.employeeCode}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{row.departmentName || '----'}</td>
                      <td className="px-3 py-2.5 text-slate-700">{row.shiftName || '----'}</td>
                      <td className="px-3 py-2.5 text-slate-700">{actualText(row)}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip tone={MONITOR_STATUS[row.status].tone}>{statusText(row)}</StatusChip>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button variant="outline" size="sm" onClick={() => setDetail(row)} aria-label={`Chi tiết ${row.employeeName}`}>
                          Chi tiết
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Hiển thị {attention.length ? (current - 1) * pageSize + 1 : 0}-{Math.min(current * pageSize, attention.length)} / {attention.length} nhân viên
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" aria-label="Trang trước" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-[72px] text-center font-medium text-slate-700">
                Trang {current}/{pages}
              </span>
              <Button variant="outline" size="icon-sm" aria-label="Trang sau" disabled={current >= pages} onClick={() => setPage(current + 1)}>
                <ChevronRight className="size-4" />
              </Button>
              <div className="w-[110px]">
                <SearchableSelect
                  value={String(pageSize)}
                  onChange={(v) => {
                    setPageSize(Number(v) || 5);
                    setPage(1);
                  }}
                  options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / trang` }))}
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className={`${CARD} p-4`} aria-label="Đơn từ liên quan">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Đơn từ liên quan {isToday ? 'hôm nay' : 'trong ngày'} ({requests.length})
              </h2>
              <Link href="/approvals" className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:underline">
                Mở danh sách đơn
              </Link>
            </div>
            {requests.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">Không có đơn từ nào liên quan tới ngày này.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {requests.slice(0, 6).map((request) => (
                  <li key={request.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
                        {initialsOf(request.employeeName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-slate-900">{request.employeeName}</p>
                        <p className="truncate text-[12px] text-slate-500">{request.departmentName || '----'}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[13px] font-medium text-slate-700">{request.label}</span>
                      <StatusChip tone={REQUEST_STATUS[request.status].tone}>{REQUEST_STATUS[request.status].label}</StatusChip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {requests.length > 6 ? (
              <p className="mt-2 text-xs text-slate-500">và {requests.length - 6} đơn khác</p>
            ) : null}
          </section>

          <section className={`${CARD} p-4`} aria-label="Tình hình theo phòng ban">
            <h2 className="text-base font-bold text-slate-900">Tình hình theo phòng ban</h2>
            {departments.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">Chưa có dữ liệu phòng ban cho ngày này.</p>
            ) : (
              <div className="mt-3">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_52px] gap-2 text-[12px] font-semibold text-slate-500">
                  <span>Phòng ban</span>
                  <span>Đã vào ca / Tổng</span>
                  <span className="text-right">Tỷ lệ</span>
                </div>
                <ul className="mt-1 divide-y divide-slate-100">
                  {departments.slice(0, 8).map((dept) => (
                    <li key={dept.name} className="grid grid-cols-[minmax(0,1fr)_120px_52px] items-center gap-2 py-2 text-[13px]">
                      <span className="truncate text-slate-800" title={dept.name}>{dept.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className={`block h-full rounded-full ${dept.rate >= 90 ? 'bg-emerald-500' : dept.rate >= 70 ? 'bg-blue-500' : 'bg-amber-400'}`}
                            style={{ width: `${Math.min(100, dept.rate)}%` }}
                          />
                        </span>
                        <span className="whitespace-nowrap text-slate-600">{dept.checkedIn}/{dept.total}</span>
                      </span>
                      <span className={`text-right font-semibold ${dept.rate >= 90 ? 'text-emerald-600' : dept.rate >= 70 ? 'text-slate-700' : 'text-amber-600'}`}>
                        {Math.round(dept.rate)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data ? (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-slate-400">
                <CalendarOff className="size-3.5" />
                Số liệu cập nhật lúc {updatedTimeVn(data.generatedAt)}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      <KpiListSheet
        open={kpi !== null}
        onOpenChange={(open) => !open && setKpi(null)}
        title={kpi ? KPI_TITLE[kpi] : ''}
        description={kpi ? `Nhân viên được tính trong thẻ này, ngày ${longDateVn(date)}.` : undefined}
        items={kpiItems}
      />

      <Sheet open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="flex h-full w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[640px]">
          {detail ? <MonitorDetail row={detail} date={date} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2">
      <p className="text-[12px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{children}</p>
    </div>
  );
}

function MonitorDetail({ row, date }: { row: HrmMonitorRow; date: string }) {
  return (
    <>
      <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/70">
        <SheetTitle>{row.employeeName}</SheetTitle>
        <SheetDescription>
          {[row.employeeCode, row.positionName, row.departmentName].filter(Boolean).join(' · ')}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <StatusChip tone={MONITOR_STATUS[row.status].tone}>{statusText(row)}</StatusChip>
          <span className="text-xs text-slate-500">{longDateVn(date)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DetailField label="Ca làm">{row.shiftName || '----'}</DetailField>
          <DetailField label="Giờ dự kiến">{shiftTimeText(row)}</DetailField>
          <DetailField label="Giờ vào">{row.checkIn || 'Chưa chấm'}</DetailField>
          <DetailField label="Giờ ra">{row.checkOut || 'Chưa chấm'}</DetailField>
          <DetailField label="Đi trễ">{row.lateMinutes > 0 ? `${row.lateMinutes} phút` : 'Không'}</DetailField>
          <DetailField label="Về sớm">{row.earlyLeaveMinutes > 0 ? `${row.earlyLeaveMinutes} phút` : 'Không'}</DetailField>
          {row.leaveName || row.leaveDays > 0 ? (
            <DetailField label="Nghỉ phép">
              {[row.leaveName, row.leaveDays > 0 ? `${row.leaveDays} ngày` : null].filter(Boolean).join(' · ')}
            </DetailField>
          ) : null}
        </div>

        <section>
          <h3 className="text-sm font-bold text-slate-900">Đơn từ liên quan ({row.requests.length})</h3>
          {row.requests.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Không có đơn từ nào liên quan tới ngày này.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {row.requests.map((request) => (
                <li key={`${request.kind}:${request.id}`} className="rounded-xl border border-slate-200/80 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{REQUEST_KIND_LABEL[request.kind]}</span>
                    <StatusChip tone={REQUEST_STATUS[request.status].tone}>{REQUEST_STATUS[request.status].label}</StatusChip>
                  </div>
                  {request.reasonName || request.label ? (
                    <p className="mt-1 text-xs text-slate-600">{request.reasonName || request.label}</p>
                  ) : null}
                  {request.description ? <p className="mt-1 text-xs text-slate-500">{request.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Link
          href={`/timekeeping?view=timesheets`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
        >
          Xem bảng công của tháng
        </Link>
      </div>
    </>
  );
}
