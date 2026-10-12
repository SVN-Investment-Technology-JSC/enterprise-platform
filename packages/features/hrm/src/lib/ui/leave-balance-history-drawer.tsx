'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { Undo2 } from 'lucide-react';
import type {
  HrmLeaveBalanceListItem,
  HrmLeaveTransaction,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import {
  formatLeaveNumber,
  leaveTransactionLabels,
} from './leave-ledger-format';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './sheet';

/** Ngày dd/mm/yyyy (giờ địa phương); giữ nguyên chuỗi gốc nếu không đọc được. */
function formatTransactionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Số ngày có dấu rõ ràng: +1, -0,5. */
function signedDays(value: number): string {
  const text = formatLeaveNumber(value);
  return value > 0 ? `+${text}` : text;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="block text-[11px] font-semibold text-slate-500">
        {label}
      </span>
      <strong className="text-sm text-slate-900">
        {formatLeaveNumber(value)}
      </strong>
    </div>
  );
}

/**
 * Drawer lịch sử quỹ phép năm của MỘT nhân viên trong MỘT năm: các giao dịch cộng, dùng, điều chỉnh.
 * Giao dịch điều chỉnh thủ công có thể đảo (cần quyền quản lý, xác nhận tại chỗ và nhập lý do).
 */
export function LeaveBalanceHistoryDrawer({
  balance,
  onClose,
  onChanged,
}: {
  balance: HrmLeaveBalanceListItem;
  onClose: () => void;
  /** Gọi sau khi đảo điều chỉnh để màn hình chính tải lại quỹ. */
  onChanged: () => void | Promise<void>;
}) {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const { employeeId, leaveTypeId, year } = balance;
  const [rows, setRows] = useState<HrmLeaveTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        employee_id: employeeId,
        year: String(year),
        leave_type_id: leaveTypeId,
      });
      const result = await hrmFetch<{ data: HrmLeaveTransaction[] }>(
        `/leave-transactions?${query.toString()}`,
      );
      if (seq === loadSeq.current) setRows(result.data);
    } catch (e) {
      if (seq === loadSeq.current) {
        setRows([]);
        setError(
          e instanceof Error ? e.message : 'Không đọc được lịch sử quỹ phép',
        );
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [employeeId, leaveTypeId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const reverse = async (tx: HrmLeaveTransaction, reason?: string) => {
    setError('');
    try {
      await hrmFetch(`/leave-transactions/${tx.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? '' }),
      });
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đảo được điều chỉnh');
    }
  };

  const columns: TableColumnsType<HrmLeaveTransaction> = [
    {
      title: 'Ngày',
      dataIndex: 'createdAt',
      width: 100,
      render: (v: string) => formatTransactionDate(v),
    },
    {
      title: 'Loại giao dịch',
      dataIndex: 'transactionType',
      width: 150,
      render: (v: HrmLeaveTransaction['transactionType']) =>
        leaveTransactionLabels[v] ?? v,
    },
    {
      title: 'Số ngày',
      dataIndex: 'daysChanged',
      width: 90,
      align: 'right',
      render: (v: number) => (
        <span
          className={
            v < 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'
          }
        >
          {signedDays(v)}
        </span>
      ),
    },
    {
      title: 'Ghi chú',
      dataIndex: 'note',
      render: (v: string | null | undefined) => v || '',
    },
    ...(canManage
      ? [
          {
            title: 'Thao tác',
            width: 130,
            render: (_: unknown, tx: HrmLeaveTransaction) =>
              tx.transactionType === 'ADJUSTMENT' ? (
                <Popconfirm
                  title="Đảo điều chỉnh này?"
                  description={`Ghi bút toán đối ứng ${signedDays(-tx.daysChanged)} ngày; giao dịch gốc được giữ nguyên.`}
                  okText="Xác nhận"
                  cancelText="Quay lại"
                  placement="bottom-end"
                  reasonRequired
                  reasonLabel="Lý do đảo điều chỉnh"
                  onConfirm={(reason) => reverse(tx, reason)}
                >
                  <Button variant="outline" size="sm">
                    <Undo2 className="size-3.5" />
                    Đảo điều chỉnh
                  </Button>
                </Popconfirm>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full max-w-[680px] p-0">
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-5">
          <SheetTitle className="text-base font-bold">
            Lịch sử quỹ phép
          </SheetTitle>
          <SheetDescription className="text-xs">
            {balance.employeeCode} - {balance.employeeName}, quỹ phép năm {year}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 text-xs">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Được hưởng" value={balance.entitlement} />
            <Stat label="Đã dùng" value={balance.used} />
            <Stat label="Chờ duyệt" value={balance.pending} />
            <Stat label="Còn lại" value={balance.remaining} />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700"
            >
              {error}
            </p>
          )}
          <Table<HrmLeaveTransaction>
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={rows}
            columns={columns}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            locale={{
              emptyText: loading
                ? 'Đang tải…'
                : `Chưa có giao dịch nào của năm ${year}.`,
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
