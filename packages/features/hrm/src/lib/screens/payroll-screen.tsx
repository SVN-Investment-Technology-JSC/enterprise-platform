'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table } from 'antd';
import {
  SearchableSelect,
  Popconfirm,
  formatDate,
} from '@enterprise-platform/shared-ui';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Download,
  RefreshCw,
  Lock,
  Settings,
  AlertTriangle,
  Send,
  XCircle,
  FileSpreadsheet,
} from 'lucide-react';
import type {
  HrmPayrollPeriod,
  HrmTimesheetPeriod,
  HrmPayrollItem,
} from '@enterprise-platform/contracts-hrm';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { hrmFetch, downloadHrmExport } from '../hrm-api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import {
  PayrollEmptyState,
  PayrollProcessSteps,
  PayrollStatCards,
  latestRunStatus,
  payrollListStats,
  type PayrollLatestRunStatus,
} from '../ui/payroll-list-parts';
import { currentMonthVn, isMonthKey } from '../hrm-timesheet-format';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';
import { PayrollTraceDrawer } from '../ui/payroll-trace-drawer';

type Run = { id: string; run_no: number; status: string; updated_at: string };
type Total = {
  id: string;
  employee_id: string;
  full_name: string;
  employee_code: string;
  gross_salary: string;
  net_salary: string;
  total_statutory_deductions: string;
  personal_income_tax: string;
  advance_deductions: string;
  other_deductions: string;
  payment_status: string;
};

const PERIOD_STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Đang mở' },
  { value: 'PROCESSING', label: 'Đang xử lý' },
  { value: 'LOCKED', label: 'Đã khóa' },
  { value: 'PAID', label: 'Đã chi trả' },
];

/** Bỏ dấu, hạ chữ thường để tìm gõ tiếng Việt không dấu. */
const normalize = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();

const money = (n: unknown) =>
  Number(n || 0).toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
  });

function exportPayrollToExcel({
  periodCode,
  runNo,
  totals,
  items,
}: {
  periodCode: string;
  runNo: number;
  totals: Total[];
  items: HrmPayrollItem[];
}) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tổng hợp lương (Totals)
  const totalsData = totals.map((t, idx) => ({
    'STT': idx + 1,
    'Mã NV': t.employee_code,
    'Họ và tên': t.full_name,
    'Thu nhập Gross (VND)': Number(t.gross_salary || 0),
    'Bảo hiểm bắt buộc (VND)': Number(t.total_statutory_deductions || 0),
    'Thuế TNCN (VND)': Number(t.personal_income_tax || 0),
    'Khấu trừ ứng lương (VND)': Number(t.advance_deductions || 0),
    'Khấu trừ khác (VND)': Number(t.other_deductions || 0),
    'Thực lĩnh Net (VND)': Number(t.net_salary || 0),
    'Trạng thái thanh toán': t.payment_status === 'PAID' ? 'Đã chi trả' : 'Chưa chi trả',
  }));

  const wsTotals = XLSX.utils.json_to_sheet(totalsData);
  // Căn chỉnh độ rộng cột cho sheet 1
  wsTotals['!cols'] = [
    { wch: 6 },
    { wch: 14 },
    { wch: 26 },
    { wch: 22 },
    { wch: 22 },
    { wch: 18 },
    { wch: 22 },
    { wch: 20 },
    { wch: 22 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTotals, 'Tong_Hop_Luong');

  // Sheet 2: Chi tiết khoản mục (Payroll Items) nếu có
  if (items.length > 0) {
    const itemsData = items.map((it, idx) => ({
      'STT': idx + 1,
      'ID Nhân viên': it.employeeId,
      'Mã khoản mục': it.itemCode,
      'Loại khoản': it.itemType === 'EARNING' ? 'Thu nhập' : 'Khấu trừ',
      'Số tiền (VND)': Number(it.amount || 0),
      'Nguồn': it.sourceType || 'CALCULATED',
      'Căn cứ điều chỉnh / Ghi chú': it.description || '',
    }));
    const wsItems = XLSX.utils.json_to_sheet(itemsData);
    wsItems['!cols'] = [
      { wch: 6 },
      { wch: 38 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 16 },
      { wch: 35 },
    ];
    XLSX.utils.book_append_sheet(wb, wsItems, 'Chi_Tiet_Khoan_Muc');
  }

  const fileName = `Bang_Luong_${periodCode.replace(/[^a-zA-Z0-9_-]/g, '_')}_Lan_${runNo}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function getPeriodStatusBadge(status?: string) {
  switch (status) {
    case 'LOCKED':
      return <Badge className="bg-slate-100 text-slate-700 border-slate-300 font-semibold text-xs">Đã khóa</Badge>;
    case 'PAID':
      return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold text-xs">Đã chi trả</Badge>;
    case 'OPEN':
      return <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-semibold text-xs">Đang mở</Badge>;
    case 'PROCESSING':
      return <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-semibold text-xs">Đang xử lý</Badge>;
    default:
      return <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-semibold text-xs">{status || 'Chưa xác định'}</Badge>;
  }
}

function getRunStatusBadge(status?: string) {
  switch (status) {
    case 'FINALIZED':
      return <Badge className="bg-purple-50 text-purple-700 border-purple-200 font-semibold text-xs">Đã chốt</Badge>;
    case 'CALCULATED':
    case 'APPROVED':
      return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold text-xs">Đã tính</Badge>;
    case 'DRAFT':
      return <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-semibold text-xs">Bản nháp</Badge>;
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-700 border-rose-200 font-semibold text-xs">Đã hủy</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-700 border-slate-200 font-semibold text-xs">{status || '—'}</Badge>;
  }
}

export default function PayrollScreen() {
  const { can, any } = useHrmPermissions();
  const mayReadTimesheets = can('hrm.timesheet.read');
  const mayConfigure = any([
    'hrm.payroll.configure',
    'hrm.salary.read',
    'hrm.salary.manage',
  ]);
  const [periods, setPeriods] = useState<HrmPayrollPeriod[]>([]);
  const [timesheets, setTimesheets] = useState<HrmTimesheetPeriod[]>([]);
  const [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState('');
  const [totals, setTotals] = useState<Total[]>([]);
  const [items, setItems] = useState<HrmPayrollItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<HrmAction | null>(null);
  const [traceEmployee, setTraceEmployee] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [latest, setLatest] = useState<PayrollLatestRunStatus>({});
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const run = runs.find((r) => r.id === runId);
  const period = periods.find((p) => p.id === selected);
  const closed = ['LOCKED', 'PAID'].includes(period?.status || '');
  const editable =
    !!run &&
    !closed &&
    !['FINALIZED', 'APPROVED', 'CANCELLED'].includes(run.status);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      hrmFetch<{ data: HrmPayrollPeriod[] }>('/payroll-periods'),
      mayReadTimesheets
        ? hrmFetch<{ data: HrmTimesheetPeriod[] }>('/timesheet-periods')
        : Promise.resolve({ data: [] as HrmTimesheetPeriod[] }),
    ]);
    setPeriods(p.data);
    setTimesheets(t.data.filter((r) => r.status === 'LOCKED'));
    setSelected((id) =>
      p.data.some((row) => row.id === id) ? id : p.data[0]?.id || '',
    );
    setLoaded(true);
    // Số liệu thẻ tổng quan: trạng thái lần tính mới nhất của các kỳ chưa chốt.
    const pending = p.data.filter(
      (row) => row.status === 'OPEN' || row.status === 'PROCESSING',
    );
    const entries = await Promise.all(
      pending.map(async (row) => {
        try {
          const res = await hrmFetch<{ data: Run[] }>(
            `/payroll-periods/${row.id}/runs`,
          );
          return [row.id, latestRunStatus(res.data)] as const;
        } catch {
          return [row.id, undefined] as const;
        }
      }),
    );
    const next: PayrollLatestRunStatus = {};
    for (const [id, status] of entries) if (status !== undefined) next[id] = status;
    setLatest(next);
  }, [mayReadTimesheets]);

  const loadRuns = useCallback(async () => {
    if (!selected) return;
    const result = await hrmFetch<{ data: Run[] }>(
      `/payroll-periods/${selected}/runs`,
    );
    setRuns(result.data);
    setRunId((id) =>
      result.data.some((r) => r.id === id) ? id : result.data[0]?.id || '',
    );
  }, [selected]);

  const loadTotals = useCallback(async () => {
    if (!runId) return;
    const [t, i] = await Promise.all([
      hrmFetch<{ data: Total[] }>(`/payroll-runs/${runId}/totals`),
      hrmFetch<{ data: HrmPayrollItem[] }>(`/payroll-runs/${runId}/items`),
    ]);
    setTotals(t.data);
    setItems(i.data);
  }, [runId]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  useEffect(() => {
    setRuns([]);
    setRunId('');
    setTotals([]);
    void loadRuns().catch((e) => setError(e.message));
  }, [loadRuns]);

  useEffect(() => {
    setTotals([]);
    void loadTotals().catch((e) => setError(e.message));
  }, [loadTotals]);

  const stats = useMemo(() => payrollListStats(periods, latest), [periods, latest]);

  const monthOptions = useMemo(() => {
    const keys = new Set(periods.map((p) => p.toDate.slice(0, 7)));
    keys.add(currentMonthVn());
    return [...keys]
      .filter(isMonthKey)
      .sort()
      .reverse()
      .map((m) => ({ value: m, label: `Tháng ${m.slice(5, 7)}/${m.slice(0, 4)}` }));
  }, [periods]);

  const query = normalize(search.trim());
  const visibleTotals = useMemo(
    () =>
      query
        ? totals.filter((t) =>
            normalize(`${t.employee_code} ${t.full_name}`).includes(query),
          )
        : totals,
    [totals, query],
  );
  const visiblePeriods = useMemo(
    () =>
      periods.filter(
        (p) =>
          (!month || p.toDate.slice(0, 7) === month) &&
          (!statusFilter || p.status === statusFilter) &&
          (!query ||
            normalize(`${p.periodCode} ${p.fromDate} ${p.toDate}`).includes(query) ||
            // Tìm theo nhân viên: giữ kỳ đang chọn nếu có nhân viên khớp trong lần tính đang xem.
            (p.id === selected && visibleTotals.length > 0)),
      ),
    [periods, month, statusFilter, query, selected, visibleTotals],
  );
  const showDetail = !!period && visiblePeriods.some((p) => p.id === period.id);

  // Bộ lọc loại kỳ đang chọn khỏi danh sách thì chuyển sang kỳ đầu tiên còn hiển thị.
  useEffect(() => {
    if (visiblePeriods.length > 0 && !visiblePeriods.some((p) => p.id === selected)) {
      setSelected(visiblePeriods[0].id);
    }
  }, [visiblePeriods, selected]);

  async function command(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(path, { method, body: JSON.stringify(body) });
      await load();
      await loadRuns();
      await loadTotals();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  function editPeriod(remove = false) {
    if (!period) return;
    setAction({
      title: remove ? 'Xóa kỳ lương trống' : 'Sửa kỳ lương trống',
      confirmTitle: remove
        ? 'Xóa kỳ chưa có lần tính hoặc lịch thu hồi?'
        : undefined,
      description: 'Kỳ đã có dữ liệu được giữ lại để đối soát lịch sử.',
      fields: [
        ...(!remove
          ? [
              { key: 'periodCode', label: 'Mã kỳ', value: period.periodCode },
              {
                key: 'paymentDate',
                label: 'Ngày trả lương dự kiến',
                type: 'date' as const,
                value: period.paymentDate || '',
              },
            ]
          : []),
        { key: 'reason', label: 'Lý do' },
      ],
      submit: (v) =>
        command(
          `/payroll-periods/${period.id}`,
          { ...v, expectedUpdatedAt: period.updatedAt },
          remove ? 'DELETE' : 'PATCH',
        ),
    });
  }

  function editItem(item: HrmPayrollItem, remove = false) {
    setAction({
      title: remove ? 'Xóa khoản điều chỉnh' : `Sửa khoản ${item.itemCode}`,
      confirmTitle: remove ? 'Xóa khoản và yêu cầu tính lại lương?' : undefined,
      fields: [
        ...(!remove
          ? [
              {
                key: 'amount',
                label: 'Số tiền',
                type: 'number' as const,
                min: 0,
                step: '0.01',
                value: item.amount,
              },
            ]
          : []),
        { key: 'reason', label: 'Căn cứ điều chỉnh' },
      ],
      submit: (v) =>
        command(
          `/payroll-adjustments/${item.id}`,
          {
            ...v,
            ...(!remove ? { amount: Number(v.amount) } : {}),
            expectedUpdatedAt: item.updatedAt,
          },
          remove ? 'DELETE' : 'PATCH',
        ),
    });
  }

  function openCreatePeriod() {
    setAction({
      title: 'Tạo kỳ lương mới',
      fields: [
        { key: 'periodCode', label: 'Mã kỳ (VD: KL-2026-09)' },
        {
          key: 'timesheetPeriodId',
          label: 'Bảng công đã khóa',
          options: timesheets.map((t) => ({
            value: t.id,
            label: `${t.periodCode} (${formatDate(t.fromDate)} → ${formatDate(t.toDate)})`,
          })),
        },
        {
          key: 'paymentDate',
          label: 'Ngày trả lương dự kiến',
          type: 'date',
        },
      ],
      submit: (v) => {
        const t = timesheets.find((t) => t.id === v.timesheetPeriodId);
        if (!t) throw new Error('Vui lòng chọn bảng công đã khóa');
        return command('/payroll-periods', {
          ...v,
          fromDate: t.fromDate,
          toDate: t.toDate,
        });
      },
    });
  }

  return (
    <div data-testid="payroll-root" className="mx-auto flex max-w-[1600px] flex-col gap-3">
      <PageTitle
        withTabs
        title="Lương và chi trả"
        description="Quản lý kỳ lương, tính lương, phát hành phiếu lương và theo dõi lịch sử chi trả."
        badge={
          <div className="flex flex-wrap items-center gap-2">
            {mayConfigure && (
              <Link
                href="/settings?view=payroll"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <Settings className="size-4 text-slate-500" />
                <span>Cấu hình lương/OT</span>
              </Link>
            )}
            <Button
              permission="hrm.payroll.calculate"
              onClick={openCreatePeriod}
              className="h-9 px-3.5 text-xs font-semibold"
            >
              <Plus className="size-4" />
              <span>Tạo kỳ lương</span>
            </Button>
          </div>
        }
      />

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <PayrollStatCards stats={stats} />

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2.5 md:grid-cols-[220px_minmax(0,1fr)_220px]">
        <SearchableSelect
          height={36}
          value={month}
          onChange={(v) => setMonth(v || '')}
          placeholder="Tất cả các tháng"
          options={monthOptions}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Tìm kỳ lương hoặc nhân viên"
            placeholder="Tìm kỳ lương hoặc nhân viên..."
            className="h-9 pl-9 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SearchableSelect
          height={36}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v || '')}
          placeholder="Tất cả trạng thái"
          options={PERIOD_STATUS_OPTIONS}
        />
      </div>

      {loaded && periods.length === 0 ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
          <PayrollEmptyState onCreate={openCreatePeriod} />
          <PayrollProcessSteps />
        </section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Danh sách kỳ lương */}
          <aside className="flex max-h-[calc(100vh-220px)] flex-col rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between border-b border-slate-100 px-1 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Kỳ lương ({visiblePeriods.length})
              </span>
            </div>
            <div className="space-y-1.5 overflow-y-auto pr-1">
              {visiblePeriods.length === 0 ? (
                <p className="p-2 text-center text-xs text-slate-400">
                  {loaded ? 'Không có kỳ lương phù hợp bộ lọc' : 'Đang tải…'}
                </p>
              ) : (
                visiblePeriods.map((p) => {
                  const isActive = selected === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p.id)}
                      className={`w-full rounded-lg border p-2.5 text-left text-xs transition-all ${
                        isActive
                          ? 'border-blue-200 bg-blue-50/80 font-medium text-blue-900'
                          : 'border-transparent text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className="font-semibold">{p.periodCode}</span>
                        {getPeriodStatusBadge(p.status)}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {formatDate(p.fromDate)} → {formatDate(p.toDate)}
                      </p>
                      {p.paymentDate && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Dự kiến chi: {p.paymentDate}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Chi tiết kỳ lương đang chọn */}
          <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            {!showDetail ? (
              <p className="py-10 text-center text-xs text-slate-400">
                Chọn một kỳ lương ở danh sách bên trái để xem chi tiết.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-slate-900">
                      {period?.periodCode}
                    </span>
                    {period && getPeriodStatusBadge(period.status)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      permission="hrm.payroll.calculate"
                      variant="outline"
                      disabled={!period || closed || runs.length > 0 || busy}
                      onClick={() => editPeriod()}
                      className="h-8 text-xs"
                    >
                      <Pencil className="mr-1 size-3.5" />
                      Sửa kỳ trống
                    </Button>
                    <Button
                      permission="hrm.payroll.calculate"
                      variant="outline"
                      disabled={!period || closed || runs.length > 0 || busy}
                      onClick={() => editPeriod(true)}
                      className="h-8 border-rose-200 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <Trash2 className="mr-1 size-3.5" />
                      Xóa kỳ trống
                    </Button>
                    <Button
                      permission="hrm.payroll.calculate"
                      variant="outline"
                      disabled={!editable || busy}
                      onClick={() =>
                        run &&
                        setAction({
                          title: 'Hủy lần tính lương',
                          confirmTitle: 'Hủy lần tính và giữ lịch sử?',
                          fields: [{ key: 'reason', label: 'Lý do hủy' }],
                          submit: (v) =>
                            command(`/payroll-runs/${run.id}/cancel`, {
                              ...v,
                              expectedUpdatedAt: run.updated_at,
                            }),
                        })
                      }
                      className="h-8 border-rose-200 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <XCircle className="mr-1 size-3.5" />
                      Hủy lần tính
                    </Button>
                  </div>
                </div>

                {run?.status === 'DRAFT' && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                    <span>Cần tính lại trước khi chốt. Kết quả hiện có chỉ dùng đối chiếu lần tính trước.</span>
                  </div>
                )}

                {/* Thao tác theo lần tính */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[220px]">
                      <SearchableSelect
                        height={36}
                        value={runId}
                        options={runs.map((r) => ({
                          value: r.id,
                          label: `Lần tính #${r.run_no} · ${r.status}`,
                        }))}
                        clearable={false}
                        onChange={(v) => setRunId(v || '')}
                      />
                    </div>
                    {run && getRunStatusBadge(run.status)}
                    <Button
                      permission="hrm.payroll.calculate"
                      variant="outline"
                      disabled={!selected || closed || busy}
                      onClick={() =>
                        void command(`/payroll-periods/${selected}/runs`).catch(
                          () => undefined,
                        )
                      }
                      className="h-8 text-xs"
                    >
                      <Plus className="mr-1 size-3.5" />
                      Thêm lần tính
                    </Button>
                    <Button
                      permission="hrm.payroll.calculate"
                      disabled={!editable || busy}
                      onClick={() =>
                        void command(`/payroll-runs/${runId}/calculate`).catch(
                          () => undefined,
                        )
                      }
                      className="h-8 text-xs"
                    >
                      <RefreshCw className="mr-1 size-3.5" />
                      Tính lương
                    </Button>
                    <Popconfirm
                      title="Chốt kết quả lương?"
                      description="Số liệu sẽ được cố định để phát hành phiếu lương."
                      onConfirm={() => command(`/payroll-runs/${runId}/finalize`)}
                    >
                      <Button
                        permission="hrm.payroll.finalize"
                        disabled={
                          !['CALCULATED', 'APPROVED'].includes(run?.status || '') ||
                          busy
                        }
                        className="h-8 bg-purple-600 text-xs text-white hover:bg-purple-700"
                      >
                        <Lock className="mr-1 size-3.5" />
                        Chốt lương
                      </Button>
                    </Popconfirm>
                    <Button
                      permission="hrm.payroll.publish"
                      disabled={run?.status !== 'FINALIZED' || busy}
                      onClick={() =>
                        void command(`/payroll-runs/${runId}/payslips/generate`).catch(
                          () => undefined,
                        )
                      }
                      className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    >
                      <Send className="mr-1 size-3.5" />
                      Phát hành phiếu lương
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      permission="hrm.payroll.export"
                      variant="outline"
                      // Lần tính ở trạng thái nháp (bảng công mở lại hoặc đầu vào đổi) còn số cũ: không xuất cho tới khi tính lại.
                      disabled={!totals || totals.length === 0 || run?.status === 'DRAFT'}
                      title={run?.status === 'DRAFT' ? 'Lần tính đang ở trạng thái nháp, cần tính lại trước khi xuất' : undefined}
                      onClick={() => {
                        if (!period || !run) return;
                        exportPayrollToExcel({
                          periodCode: period.periodCode,
                          runNo: run.run_no,
                          totals,
                          items,
                        });
                      }}
                      className="h-8 border-emerald-300 bg-white text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                      <FileSpreadsheet className="mr-1 size-3.5 text-emerald-600" />
                      Xuất Excel (.xlsx)
                    </Button>
                    <Button
                      permission="hrm.payroll.export"
                      variant="outline"
                      disabled={run?.status !== 'FINALIZED'}
                      onClick={() =>
                        void downloadHrmExport(
                          `/payroll-runs/${runId}/export?kind=payments`,
                        ).catch((e) => setError(e.message))
                      }
                      className="h-8 text-xs"
                    >
                      <Download className="mr-1 size-3.5" />
                      Xuất chi trả CSV
                    </Button>
                    <Button
                      permission="hrm.payroll.export"
                      variant="outline"
                      disabled={run?.status !== 'FINALIZED'}
                      onClick={() =>
                        void downloadHrmExport(
                          `/payroll-runs/${runId}/export?kind=reconciliation`,
                        ).catch((e) => setError(e.message))
                      }
                      className="h-8 text-xs"
                    >
                      <Download className="mr-1 size-3.5" />
                      Xuất đối soát
                    </Button>
                  </div>
                </div>

                {/* Bảng tổng hợp lương theo nhân viên */}
                <Table<Total>
                  size="small"
                  rowKey="id"
                  dataSource={visibleTotals}
                  pagination={{
                    pageSize: 15,
                    showSizeChanger: true,
                    showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} nhân viên`,
                  }}
                  scroll={{ x: 1300, y: 520 }}
                  columns={[
                    {
                      title: 'Nhân viên',
                      fixed: 'left',
                      width: 200,
                      render: (_, r) => (
                        <div>
                          <span className="block font-semibold text-slate-900">{r.full_name}</span>
                          <span className="font-mono text-[11px] text-slate-500">{r.employee_code}</span>
                        </div>
                      ),
                    },
                    {
                      title: 'Thu nhập (Gross)',
                      dataIndex: 'gross_salary',
                      render: (v) => <span className="font-medium text-slate-900">{money(v)}</span>,
                    },
                    {
                      title: 'Bảo hiểm',
                      dataIndex: 'total_statutory_deductions',
                      render: (v) => <span className="text-slate-600">{money(v)}</span>,
                    },
                    {
                      title: 'Thuế TNCN',
                      dataIndex: 'personal_income_tax',
                      render: (v) => <span className="text-slate-600">{money(v)}</span>,
                    },
                    {
                      title: 'Ứng lương',
                      dataIndex: 'advance_deductions',
                      render: (v) => <span className="text-amber-700">{money(v)}</span>,
                    },
                    {
                      title: 'Khấu trừ khác',
                      dataIndex: 'other_deductions',
                      render: (v) => <span className="text-slate-600">{money(v)}</span>,
                    },
                    {
                      title: 'Thực lĩnh (Net)',
                      dataIndex: 'net_salary',
                      render: (v) => (
                        <span className="text-sm font-bold text-emerald-700">
                          {money(v)}
                        </span>
                      ),
                    },
                    {
                      title: 'Thanh toán',
                      width: 150,
                      render: (_, r) =>
                        r.payment_status === 'PAID' ? (
                          <Badge className="border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
                            Đã chi trả
                          </Badge>
                        ) : (
                          <Button
                            permission="hrm.payroll.pay"
                            variant="outline"
                            disabled={run?.status !== 'FINALIZED'}
                            onClick={() =>
                              setAction({
                                title: `Đối soát chi trả — ${r.full_name}`,
                                fields: [
                                  {
                                    key: 'reference',
                                    label: 'Mã chứng từ / giao dịch ngân hàng',
                                  },
                                ],
                                submit: (v) =>
                                  command(
                                    `/payroll-totals/${r.id}/record-payment`,
                                    v,
                                  ),
                              })
                            }
                            className="h-7 text-xs"
                          >
                            Ghi nhận chi trả
                          </Button>
                        ),
                    },
                    {
                      title: 'Thao tác',
                      fixed: 'right',
                      width: 220,
                      render: (_, r) => (
                        <div className="flex gap-1.5">
                          <Button
                            variant="outline"
                            onClick={() => setTraceEmployee(r.employee_id)}
                            aria-label={`Xem công và đơn từ của ${r.full_name}`}
                            className="h-7 text-xs"
                          >
                            Xem công
                          </Button>
                          <Button
                            permission="hrm.payroll.adjust"
                            variant="outline"
                            disabled={!editable || busy}
                            onClick={() =>
                              setAction({
                                title: `Khoản điều chỉnh — ${r.full_name}`,
                                fields: [
                                  { key: 'itemCode', label: 'Mã khoản' },
                                  {
                                    key: 'itemType',
                                    label: 'Loại',
                                    options: [
                                      { value: 'EARNING', label: 'Thu nhập bổ sung' },
                                      {
                                        value: 'OTHER_DEDUCTION',
                                        label: 'Khấu trừ khác',
                                      },
                                    ],
                                  },
                                  {
                                    key: 'amount',
                                    label: 'Số tiền',
                                    type: 'number',
                                    min: 0,
                                    step: '0.01',
                                  },
                                  { key: 'reason', label: 'Căn cứ nghiệp vụ' },
                                ],
                                submit: (v, operationId) =>
                                  command(`/payroll-runs/${runId}/adjustments`, {
                                    ...v,
                                    operationId,
                                    employeeId: r.employee_id,
                                    amount: Number(v.amount),
                                  }),
                              })
                            }
                            className="h-7 text-xs"
                          >
                            Điều chỉnh
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (r) => (
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                        <p className="text-xs font-semibold text-slate-700">Chi tiết cấu thành lương ({r.full_name}):</p>
                        {items
                          .filter((i) => i.employeeId === r.employee_id)
                          .map((i) => (
                            <div
                              key={i.id}
                              className="flex items-center justify-between rounded border border-slate-200 bg-white p-2.5 text-xs"
                            >
                              <div>
                                <span className="font-semibold text-slate-900">{i.description}</span>
                                <span className="ml-2 text-[11px] text-slate-500">
                                  ({String(i.calculationSnapshot?.formula || 'Khoản điều chỉnh')})
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-semibold text-slate-900">{money(i.amount)}</span>
                                {i.sourceType === 'MANUAL_ADJUSTMENT' && (
                                  <div className="flex gap-1.5">
                                    <Button
                                      permission="hrm.payroll.adjust"
                                      variant="outline"
                                      disabled={!editable || busy}
                                      onClick={() => editItem(i)}
                                      className="h-6 px-2 text-[11px]"
                                    >
                                      Sửa
                                    </Button>
                                    <Button
                                      permission="hrm.payroll.adjust"
                                      variant="outline"
                                      disabled={!editable || busy}
                                      onClick={() => editItem(i, true)}
                                      className="h-6 border-rose-200 px-2 text-[11px] text-rose-600 hover:bg-rose-50"
                                    >
                                      Xóa
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    ),
                  }}
                />
              </>
            )}
          </section>
        </div>
      )}

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
      {runId && (
        <PayrollTraceDrawer runId={runId} employeeId={traceEmployee} onClose={() => setTraceEmployee(null)} />
      )}
    </div>
  );
}
