'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import Link from 'next/link';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmSalaryAdvanceRequest,
  HrmSalaryAdvanceDeduction,
  HrmPayrollPeriod,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
type Deduction = HrmSalaryAdvanceDeduction & { periodCode: string };
const money = (value: unknown) => Number(value || 0).toLocaleString('vi-VN');
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
export default function AdvancesScreen() {
  const { can } = useHrmPermissions(),
    mayDisburse = can('hrm.advance.disburse');
  const [rows, setRows] = useState<HrmSalaryAdvanceRequest[]>([]),
    [periods, setPeriods] = useState<HrmPayrollPeriod[]>([]),
    [selected, setSelected] = useState(''),
    [deductions, setDeductions] = useState<Deduction[]>([]);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [action, setAction] = useState<HrmAction | null>(null);
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
    <main className="space-y-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ứng và thu hồi lương</h1>
          <p className="text-sm text-slate-500">
            Đề nghị → duyệt → ghi nhận giải ngân → khấu trừ khi chốt kỳ lương.
          </p>
        </div>
        <Link href="/requests" className="rounded border px-3 py-2 text-sm">
          Đơn từ và phê duyệt
        </Link>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Input
          aria-label="Tìm khoản ứng lương"
          placeholder="Mã, tên nhân viên, nội dung"
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="w-56">
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(400px,1fr)]">
        <section className="min-w-0 rounded-xl border bg-white p-3">
          <Table<HrmSalaryAdvanceRequest>
            size="small"
            rowKey="id"
            dataSource={visible}
            pagination={{ pageSize: 15 }}
            scroll={{ x: 1100, y: 560 }}
            rowClassName={(r) => (r.id === selected ? 'bg-blue-50' : '')}
            columns={[
              {
                title: 'Nhân viên',
                fixed: 'left',
                width: 200,
                render: (_, r) => (
                  <button
                    className="text-left text-blue-700"
                    onClick={() => setSelected(r.id)}
                  >
                    <strong>{r.employeeName || r.employeeId}</strong>
                    <p className="text-xs text-slate-500">
                      {r.employeeCode} · {r.requestDate}
                    </p>
                  </button>
                ),
              },
              { title: 'Đề nghị', dataIndex: 'requestedAmount', render: money },
              {
                title: 'Được duyệt',
                dataIndex: 'approvedAmount',
                render: money,
              },
              {
                title: 'Đã giải ngân',
                dataIndex: 'disbursedAmount',
                render: money,
              },
              {
                title: 'Đã thu',
                dataIndex: 'totalDeductedAmount',
                render: money,
              },
              { title: 'Dư nợ', dataIndex: 'remainingBalance', render: money },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => statuses[v] || v,
              },
            ]}
          />
        </section>
        <section className="min-w-0 space-y-3 overflow-auto rounded-xl border bg-white p-4">
          <h2 className="font-semibold">
            {selectedRow?.employeeName || 'Chi tiết khoản ứng'}
          </h2>
          {selectedRow && (
            <>
              <p className="text-sm">{selectedRow.reason}</p>
              <p className="text-xs text-slate-500">
                Tối đa {selectedRow.numberOfInstallments} đợt · Dư nợ{' '}
                {money(selectedRow.remainingBalance)} VND
              </p>
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
                >
                  Ghi nhận giải ngân
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
                >
                  Lập lịch thu hồi
                </Button>
              )}
            </>
          )}
          <Table<Deduction>
            size="small"
            rowKey="id"
            dataSource={deductions}
            pagination={false}
            scroll={{ x: 650, y: 420 }}
            columns={[
              {
                title: 'Kỳ / đợt',
                render: (_, r) => `${r.periodCode} / ${r.installmentNo}`,
              },
              { title: 'Dự kiến', dataIndex: 'scheduledAmount', render: money },
              {
                title: 'Đã thu',
                dataIndex: 'actualDeductedAmount',
                render: money,
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => statuses[v] || v,
              },
              {
                title: 'Thao tác',
                render: (_, r) =>
                  r.status === 'SCHEDULED' && (
                    <div className="flex gap-2">
                      <Button
                        permission="hrm.advance.disburse"
                        variant="outline"
                        onClick={() => editDeduction(r)}
                      >
                        Sửa
                      </Button>
                      <Button
                        permission="hrm.advance.disburse"
                        variant="outline"
                        onClick={() => editDeduction(r, true)}
                      >
                        Hủy
                      </Button>
                    </div>
                  ),
              },
            ]}
          />
        </section>
      </div>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
