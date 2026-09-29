'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import Link from 'next/link';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  ArrowRightLeft,
  Search,
  FileText,
  DollarSign,
  AlertTriangle,
  CreditCard,
  Calendar,
} from 'lucide-react';
import type {
  HrmSalaryAdvanceRequest,
  HrmSalaryAdvanceDeduction,
  HrmPayrollPeriod,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';

type Deduction = HrmSalaryAdvanceDeduction & { periodCode: string };

const money = (value: unknown) =>
  Number(value || 0).toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
  });

const statuses: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
  DISBURSED: 'Đang thu hồi',
  REPAID: 'Đã thu đủ',
  SCHEDULED: 'Đã lên lịch',
  DEDUCTED: 'Đã khấu trừ',
  SKIPPED: 'Bỏ qua',
};

function getAdvanceBadge(status: string) {
  switch (status) {
    case 'REPAID':
    case 'DEDUCTED':
      return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Đã thu đủ</Badge>;
    case 'DISBURSED':
      return <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Đang thu hồi</Badge>;
    case 'APPROVED':
    case 'SCHEDULED':
      return <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-xs">Đã duyệt</Badge>;
    case 'PENDING':
      return <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Chờ duyệt</Badge>;
    case 'REJECTED':
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs">{statuses[status] || status}</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs">{statuses[status] || status}</Badge>;
  }
}

export default function AdvancesScreen() {
  const { can } = useHrmPermissions();
  const mayDisburse = can('hrm.advance.disburse');
  const [rows, setRows] = useState<HrmSalaryAdvanceRequest[]>([]);
  const [periods, setPeriods] = useState<HrmPayrollPeriod[]>([]);
  const [selected, setSelected] = useState('');
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const selectedRow = rows.find((r) => r.id === selected);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([
      hrmFetch<{ data: HrmSalaryAdvanceRequest[] }>('/salary-advance-requests'),
      mayDisburse
        ? hrmFetch<{ data: HrmPayrollPeriod[] }>('/payroll-period-options')
        : Promise.resolve({ data: [] as HrmPayrollPeriod[] }),
    ]);
    setRows(a.data);
    setPeriods(p.data);
    setSelected((id) =>
      a.data.some((r) => r.id === id) ? id : a.data[0]?.id || '',
    );
  }, [mayDisburse]);

  const loadDetail = useCallback(async () => {
    if (!selected) {
      setDeductions([]);
      return;
    }
    const result = await hrmFetch<{ data: Deduction[] }>(
      `/salary-advance-requests/${selected}/deductions`,
    );
    setDeductions(result.data);
  }, [selected]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  useEffect(() => {
    setDeductions([]);
    void loadDetail().catch((e) => setError(e.message));
  }, [loadDetail]);

  async function save(path: string, body: unknown, method = 'POST') {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    setError('');
    await load();
    await loadDetail();
  }

  function editDeduction(row: Deduction, cancel = false) {
    setAction({
      title: cancel ? 'Hủy lịch thu hồi' : 'Sửa lịch thu hồi',
      confirmTitle: cancel ? 'Hủy lịch, giữ nguyên dư nợ?' : undefined,
      fields: [
        ...(!cancel
          ? [
              {
                key: 'amount',
                label: 'Số tiền thu hồi',
                type: 'number' as const,
                min: 0.01,
                step: '0.01',
                value: row.scheduledAmount,
              },
            ]
          : []),
        { key: 'reason', label: 'Lý do' },
      ],
      submit: (v) =>
        save(
          `/salary-advance-deductions/${row.id}${cancel ? '/cancel' : ''}`,
          {
            ...v,
            ...(!cancel ? { amount: Number(v.amount) } : {}),
            expectedUpdatedAt: row.updatedAt,
          },
          cancel ? 'POST' : 'PATCH',
        ),
    });
  }

  const normalize = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase();

  const visible = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      normalize(
        `${r.employeeCode || ''} ${r.employeeName || ''} ${r.reason}`,
      ).includes(normalize(search)),
  );

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Ứng & Thu hồi Lương
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Quy trình khép kín: Đề nghị → Phê duyệt → Ghi nhận giải ngân → Tự động khấu trừ khi chốt kỳ lương.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            href="/requests"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
          >
            <FileText className="size-3.5 text-slate-500" />
            <span>Đơn từ & Phê duyệt</span>
          </Link>
          <Link
            href="/payroll"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
          >
            <DollarSign className="size-3.5 text-slate-500" />
            <span>Kỳ lương</span>
          </Link>
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

      {/* 2. Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            aria-label="Tìm khoản ứng lương"
            placeholder="Tìm theo mã, tên nhân viên, lý do..."
            className="pl-9 text-xs h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-52">
          <SearchableSelect
            value={status}
            onChange={(v) => setStatus(v || '')}
            placeholder="Tất cả trạng thái"
            options={[
              'PENDING',
              'APPROVED',
              'DISBURSED',
              'REPAID',
              'REJECTED',
              'CANCELLED',
            ].map((value) => ({ value, label: statuses[value] }))}
          />
        </div>
      </div>

      {/* 3. Master-Detail Layout */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(420px,1fr)]">
        {/* Left: Requests Table */}
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Danh sách khoản ứng ({visible.length})
            </span>
          </div>
          <Table<HrmSalaryAdvanceRequest>
            size="small"
            rowKey="id"
            dataSource={visible}
            pagination={{
              pageSize: 12,
              showSizeChanger: true,
              showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} yêu cầu`,
            }}
            scroll={{ x: 1000, y: 520 }}
            rowClassName={(r) =>
              r.id === selected
                ? 'bg-blue-50/70 cursor-pointer font-medium'
                : 'cursor-pointer hover:bg-slate-50/60'
            }
            onRow={(r) => ({
              onClick: () => setSelected(r.id),
            })}
            columns={[
              {
                title: 'Nhân viên',
                fixed: 'left',
                width: 190,
                render: (_, r) => (
                  <div>
                    <span className="font-semibold text-slate-900 block">{r.employeeName || r.employeeId}</span>
                    <span className="text-[11px] text-slate-500">{r.employeeCode} · {r.requestDate}</span>
                  </div>
                ),
              },
              {
                title: 'Đề nghị',
                dataIndex: 'requestedAmount',
                render: (v) => <span className="text-slate-600">{money(v)}</span>,
              },
              {
                title: 'Được duyệt',
                dataIndex: 'approvedAmount',
                render: (v) => <span className="font-medium text-slate-900">{money(v)}</span>,
              },
              {
                title: 'Đã giải ngân',
                dataIndex: 'disbursedAmount',
                render: (v) => <span className="text-blue-700">{money(v)}</span>,
              },
              {
                title: 'Đã thu',
                dataIndex: 'totalDeductedAmount',
                render: (v) => <span className="text-emerald-700">{money(v)}</span>,
              },
              {
                title: 'Dư nợ',
                dataIndex: 'remainingBalance',
                render: (v) => (
                  <span className="font-semibold text-amber-700">{money(v)}</span>
                ),
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                width: 120,
                render: (v) => getAdvanceBadge(v),
              },
            ]}
          />
        </section>

        {/* Right: Selected Detail & Deduction Schedule */}
        <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white shadow-xs p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {selectedRow?.employeeName || 'Chi tiết khoản ứng'}
              </h2>
              <p className="text-xs text-slate-500">
                {selectedRow ? `Mã NV: ${selectedRow.employeeCode} · Ngày đề nghị: ${selectedRow.requestDate}` : 'Chọn một yêu cầu để xem chi tiết'}
              </p>
            </div>
            {selectedRow && getAdvanceBadge(selectedRow.status)}
          </div>

          {selectedRow ? (
            <div className="space-y-4">
              {/* Financial Snapshot */}
              <div className="grid grid-cols-3 gap-2.5 bg-slate-50/80 p-3 rounded-lg border border-slate-200/80">
                <div>
                  <span className="text-[11px] text-slate-500 block">Được duyệt</span>
                  <span className="text-xs font-semibold text-slate-900">{money(selectedRow.approvedAmount)}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">Đã giải ngân</span>
                  <span className="text-xs font-semibold text-blue-700">{money(selectedRow.disbursedAmount)}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">Dư nợ còn lại</span>
                  <span className="text-xs font-bold text-amber-700">{money(selectedRow.remainingBalance)}</span>
                </div>
              </div>

              {/* Reason & Meta */}
              <div className="text-xs text-slate-600 bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <p>
                  <strong className="text-slate-700">Lý do ứng:</strong> {selectedRow.reason || '—'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Kế hoạch: Tối đa {selectedRow.numberOfInstallments} đợt khấu trừ.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedRow.status === 'APPROVED' && (
                  <Button
                    permission="hrm.advance.disburse"
                    onClick={() =>
                      setAction({
                        title: 'Ghi nhận giải ngân ứng lương',
                        description:
                          'Ghi nhận khoản đã chi thực tế; thao tác này không chuyển tiền ngân hàng.',
                        fields: [
                          {
                            key: 'disbursedAmount',
                            label: 'Số tiền đã giải ngân',
                            type: 'number',
                            min: 0.01,
                            step: '0.01',
                            max: selectedRow.approvedAmount,
                            value: selectedRow.approvedAmount,
                          },
                        ],
                        submit: (v) =>
                          save(
                            `/salary-advance-requests/${selectedRow.id}/disburse`,
                            { disbursedAmount: Number(v.disbursedAmount) },
                          ),
                      })
                    }
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 shadow-xs flex items-center gap-1.5"
                  >
                    <CreditCard className="size-3.5" />
                    <span>Ghi nhận giải ngân</span>
                  </Button>
                )}
                {selectedRow.status === 'DISBURSED' && (
                  <Button
                    permission="hrm.advance.disburse"
                    onClick={() =>
                      setAction({
                        title: 'Lập lịch thu hồi',
                        fields: [
                          {
                            key: 'payrollPeriodId',
                            label: 'Kỳ lương',
                            options: periods
                              .filter(
                                (p) => !['LOCKED', 'PAID'].includes(p.status),
                              )
                              .map((p) => ({ value: p.id, label: p.periodCode })),
                          },
                          {
                            key: 'amount',
                            label: 'Số tiền kỳ này',
                            type: 'number',
                            min: 0.01,
                            step: '0.01',
                            max: selectedRow.remainingBalance,
                          },
                        ],
                        submit: (v) =>
                          save(
                            `/salary-advance-requests/${selectedRow.id}/schedule`,
                            { ...v, amount: Number(v.amount) },
                          ),
                      })
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 shadow-xs flex items-center gap-1.5"
                  >
                    <Calendar className="size-3.5" />
                    <span>Lập lịch thu hồi</span>
                  </Button>
                )}
              </div>

              {/* Deductions Schedule Table */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-700 block">
                  Lịch trình thu hồi các kỳ ({deductions.length})
                </span>
                <Table<Deduction>
                  size="small"
                  rowKey="id"
                  dataSource={deductions}
                  pagination={false}
                  scroll={{ x: 500, y: 320 }}
                  columns={[
                    {
                      title: 'Kỳ / Đợt',
                      render: (_, r) => (
                        <span className="font-semibold text-slate-800">
                          {r.periodCode} <span className="text-slate-400 font-normal">· Đợt #{r.installmentNo}</span>
                        </span>
                      ),
                    },
                    {
                      title: 'Dự kiến',
                      dataIndex: 'scheduledAmount',
                      render: (v) => <span className="text-slate-700">{money(v)}</span>,
                    },
                    {
                      title: 'Đã thu',
                      dataIndex: 'actualDeductedAmount',
                      render: (v) => (
                        <span className="font-medium text-emerald-700">{money(v)}</span>
                      ),
                    },
                    {
                      title: 'Trạng thái',
                      dataIndex: 'status',
                      render: (v) => getAdvanceBadge(v),
                    },
                    {
                      title: 'Thao tác',
                      render: (_, r) =>
                        r.status === 'SCHEDULED' && (
                          <div className="flex gap-1.5">
                            <Button
                              permission="hrm.advance.disburse"
                              variant="outline"
                              onClick={() => editDeduction(r)}
                              className="h-6 text-[11px] px-2"
                            >
                              Sửa
                            </Button>
                            <Button
                              permission="hrm.advance.disburse"
                              variant="outline"
                              onClick={() => editDeduction(r, true)}
                              className="h-6 text-[11px] px-2 text-rose-600 hover:bg-rose-50 border-rose-200"
                            >
                              Hủy
                            </Button>
                          </div>
                        ),
                    },
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 text-center py-12">
              Chọn một yêu cầu ở bảng bên trái để xem lịch thu hồi và thực hiện giải ngân.
            </div>
          )}
        </section>
      </div>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
