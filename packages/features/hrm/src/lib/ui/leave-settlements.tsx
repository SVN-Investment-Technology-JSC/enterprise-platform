'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import type {
  HrmLeaveSettlement,
  HrmLeaveSettlementStatus,
  HrmPayrollPeriod,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Badge } from './badge';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { formatLeaveNumber } from './leave-ledger-format';

const statusLabels: Record<
  HrmLeaveSettlementStatus,
  { label: string; className: string }
> = {
  PENDING: { label: 'Chờ đưa vào lương', className: 'bg-amber-50 text-amber-700' },
  SCHEDULED: { label: 'Đã gắn kỳ lương', className: 'bg-blue-50 text-blue-700' },
  DEDUCTED: { label: 'Đã khấu trừ', className: 'bg-emerald-50 text-emerald-700' },
  WAIVED: { label: 'Miễn khấu trừ', className: 'bg-slate-100 text-slate-600' },
  CLOSED: { label: 'Không dùng vượt', className: 'bg-slate-100 text-slate-600' },
  REVERSED: { label: 'Đã huỷ', className: 'bg-slate-100 text-slate-500' },
};
const money = (v: number) =>
  Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

/** Quyết toán phép khi nghỉ việc: phần dùng vượt và khoản thu hồi qua lương. */
export function LeaveSettlements({ employee }: { employee: string }) {
  const [rows, setRows] = useState<HrmLeaveSettlement[]>([]),
    [periods, setPeriods] = useState<HrmPayrollPeriod[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [action, setAction] = useState<HrmAction | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await hrmFetch<{ data: HrmLeaveSettlement[] }>(
        `/leave-settlements${employee ? `?employee_id=${employee}` : ''}`,
      );
      setRows(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được quyết toán phép');
    } finally {
      setBusy(false);
    }
    // Danh sách kỳ lương cần quyền đọc lương; thiếu quyền thì chỉ ẩn lựa chọn.
    hrmFetch<{ data: HrmPayrollPeriod[] }>('/payroll-periods')
      .then((r) => setPeriods(r.data))
      .catch(() => setPeriods([]));
  }, [employee]);
  useEffect(() => {
    void load();
  }, [load]);

  const schedule = (r: HrmLeaveSettlement) =>
    setAction({
      title: 'Đưa khoản thu hồi phép vào kỳ lương',
      description: `${r.employeeCode ?? ''} ${r.employeeName ?? ''}: dùng vượt ${formatLeaveNumber(r.excessDays)} ngày × đơn giá ${money(r.dailyRate)} đ. Có thể điều chỉnh số tiền kèm lý do.`,
      fields: [
        {
          key: 'payrollPeriodId',
          label: 'Kỳ lương khấu trừ',
          optional: true,
          value: r.payrollPeriodId ?? '',
          options: periods
            .filter((p) => ['OPEN', 'PROCESSING'].includes(p.status))
            .map((p) => ({
              value: p.id,
              label: `${p.periodCode} (${p.fromDate} → ${p.toDate})`,
            })),
        },
        {
          key: 'recoveryAmount',
          label: 'Số tiền thu hồi (đồng)',
          type: 'number',
          min: 0,
          step: '1',
          value: r.recoveryAmount,
        },
        { key: 'reason', label: 'Lý do' },
      ],
      submit: async (v) => {
        await hrmFetch(`/leave-settlements/${r.id}/schedule`, {
          method: 'POST',
          body: JSON.stringify({
            payrollPeriodId: v.payrollPeriodId || null,
            recoveryAmount: Number(v.recoveryAmount),
            reason: v.reason,
          }),
        });
        await load();
      },
    });
  const waive = (r: HrmLeaveSettlement) =>
    setAction({
      title: 'Miễn khấu trừ phép dùng vượt',
      description:
        'Không trừ tiền lương. Giao dịch thu hồi trong sổ phép vẫn được giữ làm lịch sử.',
      confirmTitle: 'Xác nhận miễn khấu trừ khoản này?',
      fields: [{ key: 'reason', label: 'Lý do miễn khấu trừ' }],
      submit: async (v) => {
        await hrmFetch(`/leave-settlements/${r.id}/waive`, {
          method: 'POST',
          body: JSON.stringify(v),
        });
        await load();
      },
    });

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Table<HrmLeaveSettlement>
        rowKey="id"
        size="small"
        loading={busy}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1500 }}
        columns={[
          { title: 'Mã NV', dataIndex: 'employeeCode', width: 110 },
          { title: 'Nhân viên', dataIndex: 'employeeName', width: 180 },
          { title: 'Loại nghỉ', dataIndex: 'leaveTypeName', width: 140 },
          { title: 'Năm', dataIndex: 'year', width: 70 },
          { title: 'Ngày làm cuối', dataIndex: 'terminationDate', width: 115 },
          {
            title: 'Quỹ thực hưởng',
            dataIndex: 'entitledDays',
            width: 115,
            render: formatLeaveNumber,
          },
          { title: 'Đã dùng', dataIndex: 'usedDays', width: 85, render: formatLeaveNumber },
          {
            title: 'Dùng vượt',
            dataIndex: 'excessDays',
            width: 95,
            render: (v: number) =>
              v > 0 ? (
                <span className="font-semibold text-red-700">
                  {formatLeaveNumber(v)}
                </span>
              ) : (
                '0'
              ),
          },
          { title: 'Chưa dùng', dataIndex: 'unusedDays', width: 90, render: formatLeaveNumber },
          { title: 'Đơn giá ngày', dataIndex: 'dailyRate', width: 115, render: money },
          {
            title: 'Thu hồi (đ)',
            dataIndex: 'recoveryAmount',
            width: 120,
            render: money,
          },
          {
            title: 'Kỳ lương',
            dataIndex: 'payrollPeriodCode',
            width: 100,
            render: (v) => v || '—',
          },
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 150,
            render: (v: HrmLeaveSettlementStatus) => (
              <Badge className={statusLabels[v]?.className}>
                {statusLabels[v]?.label ?? v}
              </Badge>
            ),
          },
          { title: 'Ghi chú', dataIndex: 'note', width: 200 },
          {
            title: 'Thao tác',
            width: 230,
            fixed: 'right',
            render: (_, r) =>
              ['PENDING', 'SCHEDULED'].includes(r.status) && (
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    permission="hrm.leave.manage"
                    onClick={() => schedule(r)}
                  >
                    Đưa vào kỳ lương
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    permission="hrm.leave.manage"
                    onClick={() => waive(r)}
                  >
                    Miễn khấu trừ
                  </Button>
                </div>
              ),
          },
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
