'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, Tabs } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveBalance,
  HrmLeaveTransaction,
  HrmLeaveType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { Input } from './input';
import {
  formatLeaveNumber,
  leaveTransactionLabels,
} from './leave-ledger-format';
import { LeaveSettlements } from './leave-settlements';

type Balance = HrmLeaveBalance & {
  employeeName: string;
  employeeCode: string;
  leaveTypeName: string;
};
type Transaction = HrmLeaveTransaction & {
  employeeName: string;
  employeeCode: string;
  leaveTypeName: string;
};
export { formatLeaveNumber } from './leave-ledger-format';

export function LeaveLedger({
  employees,
  types,
}: {
  employees: { value: string; label: string }[];
  types: HrmLeaveType[];
}) {
  const [year, setYear] = useState(String(new Date().getFullYear())),
    [employee, setEmployee] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]),
    [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<HrmAction | null>(null);
  const load = useCallback(async () => {
    if (!/^\d{4}$/.test(year)) return;
    setBusy(true);
    setError('');
    try {
      const [b, t] = await Promise.all([
        hrmFetch<{ data: Balance[] }>(
          `/leave-balances?year=${year}${employee ? `&employee_id=${employee}` : ''}`,
        ),
        hrmFetch<{ data: Transaction[] }>(
          `/leave-transactions${employee ? `?employee_id=${employee}` : ''}`,
        ),
      ]);
      setBalances(b.data);
      setTransactions(t.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được sổ phép');
    } finally {
      setBusy(false);
    }
  }, [year, employee]);
  useEffect(() => {
    void load();
  }, [load]);
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const numberCell = (v: number | string) => formatLeaveNumber(v);
  const noFund = <span className="text-slate-500">Không áp dụng quỹ</span>;
  const remainingCell = (r: Balance) => {
    const type = typeOf(r.leaveTypeId);
    if (type && type.deductBalance === false) return noFund;
    const limit = Number(type?.negativeLimit ?? 0);
    if (r.remaining < -limit)
      return (
        <span className="font-semibold text-red-700">
          {formatLeaveNumber(r.remaining)} (vượt hạn mức âm)
        </span>
      );
    if (r.remaining < 0)
      return (
        <span className="font-semibold text-amber-700">
          {formatLeaveNumber(r.remaining)} (đang ứng)
        </span>
      );
    return formatLeaveNumber(r.remaining);
  };
  // Cố định cột định danh để khi cuộn ngang vẫn biết đang xem quỹ của ai.
  const identity = [
    { title: 'Mã NV', dataIndex: 'employeeCode', width: 110, fixed: 'left' as const },
    { title: 'Nhân viên', dataIndex: 'employeeName', width: 190, fixed: 'left' as const },
    { title: 'Loại nghỉ', dataIndex: 'leaveTypeName', width: 160 },
  ];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <h2 className="mb-3 text-sm font-bold text-slate-900">Quỹ và sổ giao dịch phép</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Năm quỹ phép"
          type="number"
          min={2000}
          max={2200}
          className="w-24"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <div className="w-72">
          <SearchableSelect
            value={employee}
            onChange={setEmployee}
            options={employees}
            clearable
            placeholder="Tất cả nhân viên"
          />
        </div>
        <Button
          permission="hrm.leave.manage"
          onClick={() =>
            setAction({
              title: 'Điều chỉnh quỹ phép',
              fields: [
                {
                  key: 'employeeId',
                  label: 'Nhân viên',
                  options: employees,
                  value: employee,
                },
                {
                  key: 'leaveTypeId',
                  label: 'Loại nghỉ',
                  options: types.map((t) => {
                    const isInactive = !t.active || Boolean(t.mergedIntoId);
                    return {
                      value: t.id,
                      label: `${t.name} (${t.unit === 'HOURS' ? 'giờ' : 'ngày'})${isInactive ? ' [Ngừng sử dụng]' : ''}`,
                    };
                  }),
                },
                {
                  key: 'year',
                  label: 'Năm quỹ',
                  type: 'number',
                  min: 2000,
                  max: 2200,
                  value: year,
                },
                {
                  key: 'daysAdjusted',
                  label: 'Số lượng cộng (+) / trừ (-), theo đơn vị loại nghỉ',
                  type: 'number',
                  step: '0.01',
                },
                { key: 'reason', label: 'Lý do điều chỉnh' },
              ],
              submit: async (v, operationId) => {
                await hrmFetch('/leave-adjustments', {
                  method: 'POST',
                  body: JSON.stringify({
                    ...v,
                    year: Number(v.year),
                    daysAdjusted: Number(v.daysAdjusted),
                    operationId,
                  }),
                });
                await load();
              },
            })
          }
        >
          Điều chỉnh quỹ
        </Button>
        <Button variant="outline" onClick={() => void load()}>
          Làm mới
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <Tabs
        items={[
          {
            key: 'balances',
            label: 'Quỹ theo năm',
            children: (
              <Table<Balance>
                rowKey="id"
                loading={busy}
                dataSource={balances}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                scroll={{ x: 1450 }}
                columns={[
                  ...identity,
                  {
                    title: 'Đơn vị',
                    render: (_, r) =>
                      types.find((t) => t.id === r.leaveTypeId)?.unit ===
                        'HOURS'
                        ? 'Giờ'
                        : 'Ngày',
                  },
                  { title: 'Đầu kỳ', dataIndex: 'openingBalance', render: numberCell },
                  { title: 'Tích lũy', dataIndex: 'accrued', render: numberCell },
                  { title: 'Điều chỉnh', dataIndex: 'adjusted', render: numberCell },
                  { title: 'Đã dùng', dataIndex: 'used', render: numberCell },
                  { title: 'Giữ chỗ', dataIndex: 'pending', render: numberCell },
                  {
                    title: 'Còn lại',
                    dataIndex: 'remaining',
                    render: (_, r) => remainingCell(r),
                  },
                  {
                    title: 'Quỹ dự kiến năm',
                    render: (_, r) =>
                      r.projectedEntitlement == null
                        ? '—'
                        : formatLeaveNumber(r.projectedEntitlement),
                  },
                  {
                    title: 'Có thể dùng',
                    render: (_, r) => {
                      if (typeOf(r.leaveTypeId)?.deductBalance === false)
                        return noFund;
                      const available = r.available ?? r.remaining - r.pending;
                      const ahead = available - (r.remaining - r.pending);
                      return ahead > 0.005 ? (
                        <span
                          title={
                            r.advanceAllowed
                              ? 'Gồm phần được ứng trước đến hết năm'
                              : 'Gồm phần tích luỹ tháng hiện tại chưa chốt'
                          }
                        >
                          {formatLeaveNumber(available)}
                          <span className="ml-1 text-xs text-slate-500">
                            ({r.advanceAllowed ? 'gồm ứng' : 'gồm tháng này'}{' '}
                            {formatLeaveNumber(ahead)})
                          </span>
                        </span>
                      ) : (
                        formatLeaveNumber(available)
                      );
                    },
                  },
                ]}
              />
            ),
          },
          {
            key: 'ledger',
            label: 'Giao dịch (mọi năm)',
            children: (
              <Table<Transaction>
                rowKey="id"
                loading={busy}
                dataSource={transactions}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                scroll={{ x: 1300 }}
                columns={[
                  ...identity,
                  {
                    title: 'Thời điểm',
                    dataIndex: 'createdAt',
                    render: (v) => new Date(v).toLocaleString('vi-VN'),
                  },
                  {
                    title: 'Nghiệp vụ',
                    dataIndex: 'transactionType',
                    render: (v: Transaction['transactionType']) =>
                      leaveTransactionLabels[v] ?? v,
                  },
                  { title: 'Biến động', dataIndex: 'daysChanged', render: numberCell },
                  {
                    title: 'Số dư sau',
                    dataIndex: 'balanceAfter',
                    render: (v, r) =>
                      typeOf(r.leaveTypeId)?.deductBalance === false
                        ? noFund
                        : formatLeaveNumber(v),
                  },
                  { title: 'Diễn giải', dataIndex: 'note' },
                  {
                    title: 'Thao tác',
                    width: 135,
                    render: (_, r) =>
                      r.transactionType === 'ADJUSTMENT' && (
                        <Button
                          permission="hrm.leave.manage"
                          variant="outline"
                          onClick={() =>
                            setAction({
                              title: 'Đảo điều chỉnh quỹ phép',
                              description: `Ghi bút toán đối ứng ${formatLeaveNumber(-r.daysChanged)} cho giao dịch này. Giữ nguyên bản gốc; gửi lại không đảo hai lần.`,
                              confirmTitle: 'Xác nhận đảo điều chỉnh này?',
                              fields: [
                                {
                                  key: 'reason',
                                  label: 'Lý do đảo điều chỉnh',
                                },
                              ],
                              submit: async (v) => {
                                await hrmFetch(
                                  `/leave-transactions/${r.id}/reverse`,
                                  { method: 'POST', body: JSON.stringify(v) },
                                );
                                await load();
                              },
                            })
                          }
                        >
                          Đảo điều chỉnh
                        </Button>
                      ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'settlements',
            label: 'Quyết toán nghỉ việc',
            children: <LeaveSettlements employee={employee} />,
          },
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
