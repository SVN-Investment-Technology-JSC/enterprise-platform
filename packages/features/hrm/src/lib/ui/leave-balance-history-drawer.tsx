'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { Popconfirm, formatDate } from '@enterprise-platform/shared-ui';
import { Undo2 } from 'lucide-react';
import type {
  HrmLeaveBalanceListItem,
  HrmLeaveTransaction,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from './badge';
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

/** Số ngày có dấu rõ ràng: +1, -0,5. */
function signedDays(value: number): string {
  const text = formatLeaveNumber(value);
  return value > 0 ? `+${text}` : text;
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

  const reversedAdjustmentMap = useMemo(() => {
    const map = new Map<string, HrmLeaveTransaction>();
    for (const r of rows) {
      if (r.transactionType === 'REVERSAL') {
        let originalId = '';
        if (r.operationKey && r.operationKey.startsWith('reverse-adjustment:')) {
          originalId = r.operationKey.slice('reverse-adjustment:'.length);
        } else if (r.note) {
          const match = r.note.match(/Đảo\s+([0-9a-f-]{36})/i);
          if (match) originalId = match[1];
        }
        if (originalId) {
          map.set(originalId, r);
        }
      }
    }
    return map;
  }, [rows]);

  const columns: TableColumnsType<HrmLeaveTransaction> = [
    {
      title: 'Ngày',
      dataIndex: 'createdAt',
      width: 100,
      render: (v: string) => formatDate(v, v),
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
      width: 260,
      render: (v: string | null | undefined) => (
        <span className="block whitespace-normal break-words text-slate-700">
          {v || '—'}
        </span>
      ),
    },
    {
      title: 'Người thực hiện',
      dataIndex: 'actorLabel',
      width: 170,
      render: (v: string | null | undefined, tx: HrmLeaveTransaction) => (
        <div>
          <span className="block">{v || 'Hệ thống'}</span>
          {tx.triggerSource === 'AUTOMATION' && (
            <Badge className="mt-0.5 border-violet-200 bg-violet-50 text-violet-700">
              Job tự động
            </Badge>
          )}
          {tx.triggerSource === 'MANUAL' && (
            <Badge className="mt-0.5 border-slate-200 bg-slate-50 text-slate-600">
              Bấm tay
            </Badge>
          )}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            title: 'Thao tác',
            width: 140,
            render: (_: unknown, tx: HrmLeaveTransaction) => {
              if (tx.transactionType !== 'ADJUSTMENT') return null;
              const reversalTx = reversedAdjustmentMap.get(tx.id);
              if (reversalTx) {
                return (
                  <Badge
                    variant="outline"
                    className="border-amber-200 bg-amber-50 text-[11px] font-medium text-amber-700"
                    title={`Đã ghi bút toán đối ứng ngày ${formatDate(reversalTx.createdAt, reversalTx.createdAt)}${reversalTx.note ? `: ${reversalTx.note}` : ''}`}
                  >
                    Đã đảo điều chỉnh
                  </Badge>
                );
              }
              return (
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
              );
            },
          },
        ]
      : []),
  ];

  const hasPolicyInfo =
    balance.entitledToDate != null || balance.advanceAllowed;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full max-w-[720px] p-0">
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-5">
          <SheetTitle className="text-base font-bold">
            Lịch sử quỹ phép
          </SheetTitle>
          <SheetDescription className="text-xs">
            {balance.employeeCode} - {balance.employeeName}, quỹ phép năm {year}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-5 text-xs">
          {/* Khu vực tổng quan: Thông tin chính sách (bên trái) và 4 chỉ số quỹ gom trong 1 card (bên phải) */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
            {hasPolicyInfo && (
              <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:col-span-5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Thông tin theo chính sách
                </span>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Đã tích luỹ đến nay:</span>
                    <strong className="font-semibold text-slate-900">
                      {formatLeaveNumber(
                        balance.entitledToDate ?? balance.accrued,
                      )}{' '}
                      ngày
                    </strong>
                  </div>
                  {balance.advanceAllowed ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-blue-700">
                        Quyền ứng phép còn lại:
                      </span>
                      <strong className="font-semibold text-blue-900">
                        {formatLeaveNumber(
                          Math.max(
                            0,
                            (balance.projectedEntitlement ??
                              balance.entitlement) -
                              (balance.entitledToDate ?? balance.accrued),
                          ),
                        )}{' '}
                        ngày
                      </strong>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">
                        Chính sách ứng phép:
                      </span>
                      <span className="font-medium text-slate-500">
                        Không cho ứng
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4 chỉ số quỹ gom thành 1 card duy nhất */}
            <div
              className={`flex flex-col justify-center rounded-xl border border-slate-200 bg-white p-3 shadow-2xs ${
                hasPolicyInfo ? 'sm:col-span-7' : 'sm:col-span-12'
              }`}
            >
              <div className="grid grid-cols-4 divide-x divide-slate-100 text-center">
                <div className="px-1.5">
                  <span className="block text-[11px] font-medium text-slate-500">
                    Tổng quỹ năm
                  </span>
                  <strong className="mt-1 block text-sm font-bold text-slate-900 sm:text-base">
                    {formatLeaveNumber(balance.entitlement)}
                  </strong>
                </div>
                <div className="px-1.5">
                  <span className="block text-[11px] font-medium text-slate-500">
                    Đã dùng
                  </span>
                  <strong className="mt-1 block text-sm font-bold text-slate-900 sm:text-base">
                    {formatLeaveNumber(balance.used)}
                  </strong>
                </div>
                <div className="px-1.5">
                  <span className="block text-[11px] font-medium text-slate-500">
                    Chờ duyệt
                  </span>
                  <strong className="mt-1 block text-sm font-bold text-slate-900 sm:text-base">
                    {formatLeaveNumber(balance.pending)}
                  </strong>
                </div>
                <div className="px-1.5">
                  <span className="block text-[11px] font-medium text-slate-500">
                    Có thể dùng
                  </span>
                  <strong
                    className={`mt-1 block text-sm font-bold sm:text-base ${
                      balance.remaining < 0
                        ? 'text-red-600'
                        : balance.remaining === 0
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                    }`}
                  >
                    {formatLeaveNumber(balance.remaining)}
                  </strong>
                </div>
              </div>
            </div>
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
