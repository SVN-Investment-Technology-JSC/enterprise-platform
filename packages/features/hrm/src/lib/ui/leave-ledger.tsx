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
  const identity = [
    { title: 'Mã NV', dataIndex: 'employeeCode', width: 120 },
    { title: 'Nhân viên', dataIndex: 'employeeName', width: 200 },
    { title: 'Loại nghỉ', dataIndex: 'leaveTypeName', width: 160 },
  ];
  return (
    <section className="rounded-lg shadow-md bg-white p-3">
      <h2 className="mb-3 font-semibold">Quỹ và sổ giao dịch phép</h2>
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
                  options: types.map((t) => ({
                    value: t.id,
                    label: `${t.name} (${t.unit === 'HOURS' ? 'giờ' : 'ngày'})`,
                  })),
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
                scroll={{ x: 1250 }}
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
                  { title: 'Đầu kỳ', dataIndex: 'openingBalance' },
                  { title: 'Tích lũy', dataIndex: 'accrued' },
                  { title: 'Điều chỉnh', dataIndex: 'adjusted' },
                  { title: 'Đã dùng', dataIndex: 'used' },
                  { title: 'Giữ chỗ', dataIndex: 'pending' },
                  { title: 'Còn lại', dataIndex: 'remaining' },
                  {
                    title: 'Có thể dùng',
                    render: (_, r) =>
                      (r.remaining - r.pending).toLocaleString('vi-VN'),
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
                  { title: 'Nghiệp vụ', dataIndex: 'transactionType' },
                  { title: 'Biến động', dataIndex: 'daysChanged' },
                  { title: 'Số dư sau', dataIndex: 'balanceAfter' },
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
                              description: `Ghi bút toán đối ứng ${-r.daysChanged} cho giao dịch này. Giữ nguyên bản gốc; gửi lại không đảo hai lần.`,
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
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
