'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import {
  DollarSign,
  Plus,
  Pencil,
  Trash2,
  Download,
  RefreshCw,
  Lock,
  Settings,
  ArrowRightLeft,
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
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';

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
  const { can } = useHrmPermissions();
  const mayReadTimesheets = can('hrm.timesheet.read');
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

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <DollarSign className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Tiền lương & Chi trả
              </h1>
              {period && getPeriodStatusBadge(period.status)}
            </div>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Tính từ bảng công đã khóa; lưu công thức và dữ liệu tại lần tính để đối soát minh bạch.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            href="/payroll?view=advances"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
          >
            <ArrowRightLeft className="size-3.5 text-slate-500" />
            <span>Ứng & Thu hồi</span>
          </Link>
          <Link
            href="/settings?view=payroll"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
          >
            <Settings className="size-3.5 text-slate-500" />
            <span>Cấu hình Lương/OT</span>
          </Link>
          <Button
            permission="hrm.payroll.calculate"
            onClick={() =>
              setAction({
                title: 'Tạo kỳ lương mới',
                fields: [
                  { key: 'periodCode', label: 'Mã kỳ (VD: KL-2026-09)' },
                  {
                    key: 'timesheetPeriodId',
                    label: 'Bảng công đã khóa',
                    options: timesheets.map((t) => ({
                      value: t.id,
                      label: `${t.periodCode} (${t.fromDate} → ${t.toDate})`,
                    })),
                  },
                  {
                    key: 'paymentDate',
                    label: 'Ngày trả lương dự kiến',
                    type: 'date',
                  },
                ],
                submit: (v) => {
                  const t = timesheets.find(
                    (t) => t.id === v.timesheetPeriodId,
                  );
                  if (!t) throw new Error('Vui lòng chọn bảng công đã khóa');
                  return command('/payroll-periods', {
                    ...v,
                    fromDate: t.fromDate,
                    toDate: t.toDate,
                  });
                },
              })
            }
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="size-4" />
            <span>Tạo kỳ lương</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Master-Detail Layout */}
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left Sidebar: Periods */}
        <aside className="rounded-xl border border-slate-200 bg-white shadow-xs p-3 flex flex-col max-h-[calc(100vh-220px)]">
          <div className="px-2 py-1.5 mb-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Kỳ lương ({periods.length})
            </span>
          </div>
          <div className="space-y-1.5 overflow-y-auto pr-1">
            {periods.length === 0 ? (
              <p className="text-xs text-slate-400 p-2 text-center">Chưa có kỳ lương</p>
            ) : (
              periods.map((p) => {
                const isActive = selected === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className={`w-full text-left rounded-lg p-2.5 transition-all text-xs border ${
                      isActive
                        ? 'bg-blue-50/80 border-blue-200 text-blue-900 shadow-xs font-medium'
                        : 'border-transparent hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold">{p.periodCode}</span>
                      {getPeriodStatusBadge(p.status)}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {p.fromDate} → {p.toDate}
                    </p>
                    {p.paymentDate && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Dự kiến chi: {p.paymentDate}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Content Area */}
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-xs p-4 space-y-4">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-slate-900">
                  {period?.periodCode || 'Chọn kỳ lương'}
                </span>
                {period && getPeriodStatusBadge(period.status)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  permission="hrm.payroll.calculate"
                  variant="outline"
                  disabled={!period || closed || runs.length > 0 || busy}
                  onClick={() => editPeriod()}
                  className="text-xs h-8"
                >
                  <Pencil className="size-3.5 mr-1" />
                  Sửa kỳ trống
                </Button>
                <Button
                  permission="hrm.payroll.calculate"
                  variant="outline"
                  disabled={!period || closed || runs.length > 0 || busy}
                  onClick={() => editPeriod(true)}
                  className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                >
                  <Trash2 className="size-3.5 mr-1" />
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
                  className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                >
                  <XCircle className="size-3.5 mr-1" />
                  Hủy lần tính
                </Button>
              </div>
            </div>

            {run?.status === 'DRAFT' && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                <span>Cần tính lại trước khi chốt. Kết quả hiện có chỉ dùng đối chiếu lần tính trước.</span>
              </div>
            )}

            {/* Run Controls Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/80">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[220px]">
                  <SearchableSelect
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
                  className="text-xs h-8"
                >
                  <Plus className="size-3.5 mr-1" />
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
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 shadow-xs"
                >
                  <RefreshCw className="size-3.5 mr-1" />
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
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-8 shadow-xs"
                  >
                    <Lock className="size-3.5 mr-1" />
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
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 shadow-xs"
                >
                  <Send className="size-3.5 mr-1" />
                  Phát hành phiếu lương
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  permission="hrm.payroll.export"
                  variant="outline"
                  disabled={!totals || totals.length === 0}
                  onClick={() => {
                    if (!period || !run) return;
                    exportPayrollToExcel({
                      periodCode: period.periodCode,
                      runNo: run.run_no,
                      totals,
                      items,
                    });
                  }}
                  className="text-xs h-8 text-emerald-700 border-emerald-300 hover:bg-emerald-50 bg-white"
                >
                  <FileSpreadsheet className="size-3.5 mr-1 text-emerald-600" />
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
                  className="text-xs h-8"
                >
                  <Download className="size-3.5 mr-1" />
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
                  className="text-xs h-8"
                >
                  <Download className="size-3.5 mr-1" />
                  Xuất đối soát
                </Button>
              </div>
            </div>

            {/* Totals Table */}
            <Table<Total>
              size="small"
              rowKey="id"
              dataSource={totals}
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
                      <span className="font-semibold text-slate-900 block">{r.full_name}</span>
                      <span className="text-[11px] text-slate-500 font-mono">{r.employee_code}</span>
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
                    <span className="font-bold text-emerald-700 text-sm">
                      {money(v)}
                    </span>
                  ),
                },
                {
                  title: 'Thanh toán',
                  width: 150,
                  render: (_, r) =>
                    r.payment_status === 'PAID' ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
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
                        className="text-xs h-7"
                      >
                        Ghi nhận chi trả
                      </Button>
                    ),
                },
                {
                  title: 'Thao tác',
                  fixed: 'right',
                  width: 110,
                  render: (_, r) => (
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
                      className="text-xs h-7"
                    >
                      Điều chỉnh
                    </Button>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (r) => (
                  <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200 space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Chi tiết cấu thành lương ({r.full_name}):</p>
                    {items
                      .filter((i) => i.employeeId === r.employee_id)
                      .map((i) => (
                        <div
                          key={i.id}
                          className="flex items-center justify-between text-xs bg-white p-2.5 rounded border border-slate-200"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">{i.description}</span>
                            <span className="text-[11px] text-slate-500 ml-2">
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
                                  className="h-6 text-[11px] px-2"
                                >
                                  Sửa
                                </Button>
                                <Button
                                  permission="hrm.payroll.adjust"
                                  variant="outline"
                                  disabled={!editable || busy}
                                  onClick={() => editItem(i, true)}
                                  className="h-6 text-[11px] px-2 text-rose-600 hover:bg-rose-50 border-rose-200"
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
          </div>
        </section>
      </div>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
