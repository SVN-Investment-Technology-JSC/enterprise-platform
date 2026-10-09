'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Drawer, Table, Tabs } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveBalance,
  HrmLeaveTransaction,
  HrmLeaveType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Badge } from './badge';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { Input } from './input';
import {
  formatLeaveNumber,
  leaveTransactionLabels,
} from './leave-ledger-format';
// Ẩn theo yêu cầu: bỏ chức năng Quyết toán nghỉ việc (bỏ comment để dùng lại).
// import { LeaveSettlements } from './leave-settlements';

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

/**
 * Các giao dịch làm thay đổi cột "Điều chỉnh" của quỹ: điều chỉnh tay, đảo điều chỉnh,
 * chuyển phép sang năm sau, reset cuối năm và hết hạn phép chuyển.
 */
function isAdjustmentRow(t: Transaction) {
  switch (t.transactionType) {
    case 'ADJUSTMENT':
    case 'CARRYOVER_OUT':
    case 'YEAR_END_RESET':
    case 'CARRYOVER_EXPIRE':
      return true;
    case 'REVERSAL':
      return (t.note ?? '').startsWith('Đảo ');
    default:
      return false;
  }
}

export function LeaveLedger({
  employees,
  types,
}: {
  employees: { value: string; label: string }[];
  types: HrmLeaveType[];
}) {
  const [year, setYear] = useState(String(new Date().getFullYear())),
    [employee, setEmployee] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);
  // Lịch sử điều chỉnh của đúng nhân viên đang được chọn (mở bằng cách bấm tên nhân viên).
  const [history, setHistory] = useState<{
    year: number;
    employeeId: string;
    employeeName: string;
    employeeCode: string;
  } | null>(null);
  const [historyRows, setHistoryRows] = useState<Transaction[]>([]),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState('');
  // const [transactions, setTransactions] = useState<Transaction[]>([]); // tab Giao dịch (mọi năm) đang ẩn
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<HrmAction | null>(null);
  const load = useCallback(async () => {
    if (!/^\d{4}$/.test(year)) return;
    setBusy(true);
    setError('');
    try {
      const b = await hrmFetch<{ data: Balance[] }>(
        `/leave-balances?year=${year}${employee ? `&employee_id=${employee}` : ''}`,
      );
      setBalances(b.data);
      // Tab Giao dịch (mọi năm) đang ẩn nên không cần tải toàn bộ giao dịch (bỏ comment để dùng lại):
      // const t = await hrmFetch<{ data: Transaction[] }>(
      //   `/leave-transactions${employee ? `?employee_id=${employee}` : ''}`,
      // );
      // setTransactions(t.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được sổ phép');
    } finally {
      setBusy(false);
    }
  }, [year, employee]);
  useEffect(() => {
    void load();
  }, [load]);
  // Chống ghi đè nhầm: chỉ nhận kết quả của lần mở gần nhất, tránh lẫn log giữa các nhân viên.
  const historyRequest = useRef(0);
  const loadHistory = useCallback(async (employeeId: string, balanceYear: number) => {
    const request = ++historyRequest.current;
    setHistoryBusy(true);
    setHistoryError('');
    setHistoryRows([]);
    try {
      const res = await hrmFetch<{ data: Transaction[] }>(
        `/leave-transactions?employee_id=${employeeId}&year=${balanceYear}`,
      );
      if (request !== historyRequest.current) return;
      setHistoryRows(
        res.data.filter(
          (t) =>
            t.employeeId === employeeId &&
            t.balanceYear === balanceYear &&
            isAdjustmentRow(t),
        ),
      );
    } catch (e) {
      if (request !== historyRequest.current) return;
      setHistoryError(
        e instanceof Error ? e.message : 'Không đọc được lịch sử điều chỉnh',
      );
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  }, []);
  const openHistory = (r: Balance) => {
    setHistory({
      year: r.year,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      employeeCode: r.employeeCode,
    });
    void loadHistory(r.employeeId, r.year);
  };
  const closeHistory = () => {
    historyRequest.current++;
    setHistory(null);
    setHistoryRows([]);
  };
  const numberCell = (v: number | string) => formatLeaveNumber(v);
  // typeOf/noFund/remainingCell dùng cho cột Còn lại.
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const noFund = <span className="text-slate-500">Không áp dụng quỹ</span>;
  const remainingCell = (r: Balance) => {
    const type = typeOf(r.leaveTypeId);
    if (type && type.deductBalance === false) return noFund;
    const limit = Number(type?.negativeLimit ?? 0);
    if (r.remaining < -limit)
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-semibold text-red-700">
            {formatLeaveNumber(r.remaining)}
          </span>
          <Badge className="border-red-200 bg-red-50 text-red-700">
            Vượt hạn mức âm
          </Badge>
        </span>
      );
    // Trước đây hiện chữ "(đang ứng)" cạnh số; nay dùng tag Đang ứng kèm số ngày ứng.
    if (r.remaining < 0)
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-semibold text-amber-700">
            {formatLeaveNumber(r.remaining)}
          </span>
          <Badge className="border-amber-200 bg-amber-50 text-amber-700">
            Đang ứng {formatLeaveNumber(-r.remaining)}
          </Badge>
        </span>
      );
    return formatLeaveNumber(r.remaining);
  };
  // Cố định cột định danh để khi cuộn ngang vẫn biết đang xem quỹ của ai.
  const identity = [
    { title: 'Mã NV', dataIndex: 'employeeCode', width: 110, fixed: 'left' as const },
    {
      title: 'Nhân viên',
      dataIndex: 'employeeName',
      width: 190,
      fixed: 'left' as const,
      // Bấm tên để xem lịch sử điều chỉnh quỹ phép của nhân viên đó.
      render: (v: string, r: Balance) => (
        <button
          type="button"
          className="text-left font-medium text-blue-700 hover:underline"
          onClick={() => openHistory(r)}
        >
          {v}
        </button>
      ),
    },
    { title: 'Loại nghỉ', dataIndex: 'leaveTypeName', width: 160 },
  ];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <h2 className="mb-3 text-sm font-bold text-slate-900">Quỹ phép</h2>
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
                scroll={{ x: 1250 }}
                columns={[
                  ...identity,
                  // Ẩn theo yêu cầu: các cột Đơn vị, Giữ chỗ (bỏ comment để hiển thị lại).
                  // {
                  //   title: 'Đơn vị',
                  //   render: (_, r) =>
                  //     types.find((t) => t.id === r.leaveTypeId)?.unit ===
                  //       'HOURS'
                  //       ? 'Giờ'
                  //       : 'Ngày',
                  // },
                  // Ẩn: với chính sách không chuyển phép, Đầu kỳ luôn bằng 0 (bỏ comment nếu cho chuyển phép lại).
                  // { title: 'Đầu kỳ', dataIndex: 'openingBalance', render: numberCell },
                  // Tích lũy chỉ gồm phép cộng theo tháng; phần thâm niên (đã nằm trong accrued) tách sang cột riêng.
                  {
                    title: 'Tích lũy',
                    dataIndex: 'accrued',
                    render: (v: number, r: Balance) =>
                      formatLeaveNumber(Number(v) - Number(r.seniorityAccrued ?? 0)),
                  },
                  // Trước đây đọc cột cũ `seniorityDays` (luôn bằng 0):
                  // { title: 'Phép thâm niên', dataIndex: 'seniorityDays', render: numberCell },
                  {
                    title: 'Phép thâm niên',
                    dataIndex: 'seniorityAccrued',
                    render: numberCell,
                  },
                  {
                    title: (
                      <span title="Gồm điều chỉnh tay, chuyển phép sang năm sau, reset cuối năm và hết hạn phép chuyển. Bấm tên nhân viên để xem chi tiết.">
                        Điều chỉnh
                      </span>
                    ),
                    dataIndex: 'adjusted',
                    render: numberCell,
                  },
                  { title: 'Đã dùng', dataIndex: 'used', render: numberCell },
                  // { title: 'Giữ chỗ', dataIndex: 'pending', render: numberCell },
                  {
                    title: 'Còn lại',
                    dataIndex: 'remaining',
                    render: (_, r) => remainingCell(r),
                  },
                  {
                    title: (
                      <span title="Tổng phép năm dự kiến cả năm theo lịch cộng phép (định mức + thâm niên), tính đến hết hiệu lực lịch.">
                        Quỹ dự kiến năm
                      </span>
                    ),
                    render: (_, r: Balance) =>
                      r.projectedEntitlement == null
                        ? '—'
                        : formatLeaveNumber(r.projectedEntitlement),
                  },
                  {
                    title: (
                    <span title="Số ngày còn xin nghỉ được = Còn lại - Giữ chỗ + phần chưa ghi sổ được phép dùng (gồm phần ứng nếu lịch cho ứng phép).">
                      Có thể dùng
                    </span>
                  ),
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
                              : 'Gồm phần phép chưa ghi sổ được phép dùng'
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
          // Ẩn theo yêu cầu: bỏ tab Giao dịch (mọi năm) và Quyết toán nghỉ việc (bỏ comment để dùng lại).
          // {
          //   key: 'ledger',
          //   label: 'Giao dịch (mọi năm)',
          //   children: (
          //     <Table<Transaction>
          //       rowKey="id"
          //       loading={busy}
          //       dataSource={transactions}
          //       pagination={{ pageSize: 20, showSizeChanger: true }}
          //       scroll={{ x: 1300 }}
          //       columns={[
          //         ...identity,
          //         {
          //           title: 'Thời điểm',
          //           dataIndex: 'createdAt',
          //           render: (v) => new Date(v).toLocaleString('vi-VN'),
          //         },
          //         {
          //           title: 'Nghiệp vụ',
          //           dataIndex: 'transactionType',
          //           render: (v: Transaction['transactionType']) =>
          //             leaveTransactionLabels[v] ?? v,
          //         },
          //         { title: 'Biến động', dataIndex: 'daysChanged', render: numberCell },
          //         {
          //           title: 'Số dư sau',
          //           dataIndex: 'balanceAfter',
          //           render: (v, r) =>
          //             typeOf(r.leaveTypeId)?.deductBalance === false
          //               ? noFund
          //               : formatLeaveNumber(v),
          //         },
          //         { title: 'Diễn giải', dataIndex: 'note' },
          //         {
          //           title: 'Thao tác',
          //           width: 135,
          //           render: (_, r) =>
          //             r.transactionType === 'ADJUSTMENT' && (
          //               <Button
          //                 permission="hrm.leave.manage"
          //                 variant="outline"
          //                 onClick={() =>
          //                   setAction({
          //                     title: 'Đảo điều chỉnh quỹ phép',
          //                     description: `Ghi bút toán đối ứng ${formatLeaveNumber(-r.daysChanged)} cho giao dịch này. Giữ nguyên bản gốc; gửi lại không đảo hai lần.`,
          //                     confirmTitle: 'Xác nhận đảo điều chỉnh này?',
          //                     fields: [
          //                       {
          //                         key: 'reason',
          //                         label: 'Lý do đảo điều chỉnh',
          //                       },
          //                     ],
          //                     submit: async (v) => {
          //                       await hrmFetch(
          //                         `/leave-transactions/${r.id}/reverse`,
          //                         { method: 'POST', body: JSON.stringify(v) },
          //                       );
          //                       await load();
          //                     },
          //                   })
          //                 }
          //               >
          //                 Đảo điều chỉnh
          //               </Button>
          //             ),
          //         },
          //       ]}
          //     />
          //   ),
          // },
          // {
          //   key: 'settlements',
          //   label: 'Quyết toán nghỉ việc',
          //   children: <LeaveSettlements employee={employee} />,
          // },
        ]}
      />
      <Drawer
        open={history !== null}
        onClose={closeHistory}
        width={680}
        destroyOnClose
        title={
          history
            ? `Lịch sử điều chỉnh quỹ phép năm ${history.year} - ${history.employeeName} (${history.employeeCode})`
            : ''
        }
      >
        {historyError && (
          <p role="alert" className="mb-2 text-red-600">
            {historyError}
          </p>
        )}
        <Table<Transaction>
          size="small"
          rowKey="id"
          loading={historyBusy}
          dataSource={historyRows}
          locale={{ emptyText: 'Chưa có lần điều chỉnh nào' }}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 640 }}
          columns={[
            {
              title: 'Thời điểm',
              dataIndex: 'createdAt',
              width: 150,
              render: (v: string) => new Date(v).toLocaleString('vi-VN'),
            },
            { title: 'Loại nghỉ', dataIndex: 'leaveTypeName', width: 130 },
            {
              title: 'Nghiệp vụ',
              dataIndex: 'transactionType',
              width: 130,
              render: (v: Transaction['transactionType']) =>
                leaveTransactionLabels[v] ?? v,
            },
            {
              title: 'Biến động',
              dataIndex: 'daysChanged',
              width: 90,
              render: numberCell,
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
                        { key: 'reason', label: 'Lý do đảo điều chỉnh' },
                      ],
                      submit: async (v) => {
                        await hrmFetch(`/leave-transactions/${r.id}/reverse`, {
                          method: 'POST',
                          body: JSON.stringify(v),
                        });
                        await load();
                        if (history) await loadHistory(history.employeeId, history.year);
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
      </Drawer>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
