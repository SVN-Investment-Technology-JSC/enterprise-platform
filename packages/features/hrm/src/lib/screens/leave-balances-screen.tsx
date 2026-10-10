'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Table, type TableColumnsType } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  History,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import type { HrmLeaveBalanceListItem } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { normalizeSearchText } from '../hrm-employee-view';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { Input } from '../ui/input';
import { LeaveBalanceHistoryDrawer } from '../ui/leave-balance-history-drawer';
import { formatLeaveNumber } from '../ui/leave-ledger-format';

type Row = HrmLeaveBalanceListItem;

/** Nhân viên chưa có dòng quỹ của năm (server trả dòng mặc định, `hasBalance=false`): chưa có số liệu. */
const hasNoBalance = (r: Row) => r.hasBalance === false;

/** Còn lại < 0 là vượt quỹ (đỏ), = 0 là đã hết phép (cam); cả hai đều được tính là cần chú ý. */
function RemainingCell({ row }: { row: Row }) {
  if (hasNoBalance(row))
    return (
      <Badge
        variant="outline"
        className="border-slate-200 bg-slate-50 text-[11px] text-slate-500"
        title="Nhân viên chưa có quỹ phép của năm này (chưa chạy cộng phép). Có thể điều chỉnh để tạo quỹ."
      >
        Chưa có quỹ
      </Badge>
    );
  const value = row.remaining;
  if (value < 0)
    return (
      <span className="font-semibold text-red-700" title="Đã dùng vượt quỹ phép">
        {formatLeaveNumber(value)}
      </span>
    );
  if (value === 0)
    return (
      <span className="font-semibold text-amber-700" title="Đã hết phép">
        {formatLeaveNumber(value)}
      </span>
    );
  return <span className="font-semibold text-slate-900">{formatLeaveNumber(value)}</span>;
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
    >
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <strong
        className={`text-base ${warn ? 'text-red-700' : 'text-slate-900'}`}
      >
        {value}
      </strong>
    </div>
  );
}

/**
 * Quỹ phép: MỘT danh sách quỹ phép năm của từng nhân viên trong năm đang chọn.
 * Thao tác phụ theo từng dòng: xem lịch sử (Drawer) và điều chỉnh (Dialog, quyền hrm.leave.manage).
 * Cách tính phép năm cấu hình tại /settings?view=leave.
 */
export default function LeaveBalancesScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canRead = can('hrm.leave.read');
  const canManage = can('hrm.leave.manage');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(
    null,
  );
  const [action, setAction] = useState<HrmAction | null>(null);
  const loadSeq = useRef(0);

  const yearOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => currentYear + 1 - i).map((y) => ({
        value: String(y),
        label: `Năm ${y}`,
      })),
    [currentYear],
  );

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setBusy(true);
    setError('');
    try {
      const result = await hrmFetch<{ data: Row[] }>(
        `/leave-balances?year=${year}&annual_only=1`,
      );
      if (seq === loadSeq.current) setRows(result.data);
    } catch (e) {
      if (seq === loadSeq.current) {
        setRows([]);
        setError(e instanceof Error ? e.message : 'Không đọc được quỹ phép');
      }
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }, [year]);

  useEffect(() => {
    if (!canRead) return;
    void load();
  }, [canRead, load]);

  const filtered = useMemo(() => {
    const needle = normalizeSearchText(search);
    if (!needle) return rows;
    return rows.filter((r) =>
      normalizeSearchText(`${r.employeeCode} ${r.employeeName}`).includes(
        needle,
      ),
    );
  }, [rows, search]);

  const summary = useMemo(
    () => ({
      employees: rows.length,
      used: rows.reduce((sum, r) => sum + Number(r.used || 0), 0),
      depleted: rows.filter((r) => !hasNoBalance(r) && r.remaining <= 0)
        .length,
      noBalance: rows.filter(hasNoBalance).length,
    }),
    [rows],
  );

  // Mỗi nhân viên một dòng; `id` rỗng với nhân viên chưa có quỹ nên khóa theo employeeId.
  const historyRow = historyEmployeeId
    ? (rows.find((r) => r.employeeId === historyEmployeeId) ?? null)
    : null;

  const openAdjust = (r: Row) =>
    setAction({
      title: 'Điều chỉnh quỹ phép',
      description: hasNoBalance(r)
        ? `${r.employeeCode} - ${r.employeeName}, quỹ phép năm ${r.year}. Nhân viên chưa có quỹ phép của năm này; điều chỉnh sẽ tạo quỹ.`
        : `${r.employeeCode} - ${r.employeeName}, quỹ phép năm ${r.year}. Còn lại hiện tại: ${formatLeaveNumber(r.remaining)} ngày.`,
      fields: [
        {
          key: 'daysAdjusted',
          label: 'Số ngày (+ cộng, - trừ)',
          type: 'number',
          step: '0.01',
        },
        { key: 'reason', label: 'Ghi chú' },
      ],
      submit: async (v, operationId) => {
        const days = Number(v.daysAdjusted);
        if (!Number.isFinite(days) || days === 0)
          throw new Error('Số ngày điều chỉnh phải khác 0');
        await hrmFetch('/leave-adjustments', {
          method: 'POST',
          body: JSON.stringify({
            employeeId: r.employeeId,
            leaveTypeId: r.leaveTypeId,
            year: r.year,
            daysAdjusted: days,
            reason: v.reason.trim(),
            operationId,
          }),
        });
        await load();
      },
    });

  const numberColumn = (
    title: string,
    key: 'entitlement' | 'carryover' | 'used' | 'pending',
    width: number,
    sortable = false,
  ): TableColumnsType<Row>[number] => ({
    title,
    dataIndex: key,
    width,
    align: 'right',
    render: (v: number, r: Row) =>
      hasNoBalance(r) ? (
        <span className="text-slate-400">—</span>
      ) : (
        formatLeaveNumber(v)
      ),
    ...(sortable ? { sorter: (a: Row, b: Row) => a[key] - b[key] } : {}),
  });

  const columns: TableColumnsType<Row> = [
    {
      title: 'Mã NV',
      dataIndex: 'employeeCode',
      width: 110,
      fixed: 'left',
      sorter: (a, b) => a.employeeCode.localeCompare(b.employeeCode, 'vi'),
    },
    {
      title: 'Họ tên',
      dataIndex: 'employeeName',
      width: 210,
      fixed: 'left',
      sorter: (a, b) => a.employeeName.localeCompare(b.employeeName, 'vi'),
    },
    {
      title: 'Đơn vị',
      dataIndex: 'department',
      width: 190,
      render: (v: string | null) => v || '—',
    },
    numberColumn('Được hưởng năm nay', 'entitlement', 140),
    numberColumn('Chuyển từ năm trước', 'carryover', 140),
    numberColumn('Đã dùng', 'used', 100, true),
    numberColumn('Chờ duyệt', 'pending', 100),
    {
      title: 'Còn lại',
      dataIndex: 'remaining',
      width: 110,
      align: 'right',
      sorter: (a, b) => a.remaining - b.remaining,
      render: (_, r) => <RemainingCell row={r} />,
    },
    {
      title: 'Thao tác',
      width: 200,
      fixed: 'right',
      render: (_, r) => (
        <div className="flex items-center gap-1.5">
          {!hasNoBalance(r) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryEmployeeId(r.employeeId)}
            >
              <History className="size-3.5" />
              Lịch sử
            </Button>
          )}
          <Button
            permission="hrm.leave.manage"
            variant="outline"
            size="sm"
            onClick={() => openAdjust(r)}
          >
            <SlidersHorizontal className="size-3.5" />
            Điều chỉnh
          </Button>
        </div>
      ),
    },
  ];

  const emptyText = busy
    ? 'Đang tải…'
    : rows.length === 0
      ? `Chưa có dữ liệu quỹ phép năm ${year}. Cần có nhân viên đang làm việc và đã cấu hình Phép năm.`
      : 'Không có nhân viên nào khớp với từ khóa tìm kiếm.';

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Wallet className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Quỹ phép
            </h1>
            <p className="max-w-[90ch] text-xs text-slate-500">
              Quỹ phép năm hiện tại của từng nhân viên. Cách tính phép năm cấu
              hình tại Cấu hình, Phép năm và lý do nghỉ.
            </p>
          </div>
        </div>
        {canManage && (
          <Link
            href="/settings?view=leave"
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            <Settings2 className="size-3.5" />
            Cấu hình phép
          </Link>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {!permissionsLoading && !canRead ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
        >
          Bạn không có quyền xem quỹ phép.
        </div>
      ) : (
        canRead && (
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Số nhân viên"
                value={formatLeaveNumber(summary.employees)}
              />
              <Stat
                label="Tổng đã dùng (ngày)"
                value={formatLeaveNumber(summary.used)}
              />
              <Stat
                label="Người còn lại ≤ 0"
                value={formatLeaveNumber(summary.depleted)}
                warn={summary.depleted > 0}
              />
              <Stat
                label="Chưa có quỹ"
                value={formatLeaveNumber(summary.noBalance)}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36 space-y-1">
                <span className="block text-[11px] font-semibold text-slate-500">
                  Năm
                </span>
                <SearchableSelect
                  value={year}
                  onChange={(v) => v && setYear(v)}
                  options={yearOptions}
                  clearable={false}
                  placeholder="Chọn năm"
                />
              </div>
              <div className="w-80 space-y-1">
                <span className="block text-[11px] font-semibold text-slate-500">
                  Tìm nhân viên
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    aria-label="Tìm theo mã hoặc tên nhân viên"
                    placeholder="Mã hoặc tên (gõ không dấu cũng được)"
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <Button variant="outline" onClick={() => void load()}>
                <RefreshCw className="size-3.5" />
                Làm mới
              </Button>
              <p className="ml-auto text-xs text-slate-500">
                {filtered.length !== rows.length
                  ? `${filtered.length} / ${rows.length}`
                  : rows.length}{' '}
                nhân viên, quỹ phép năm {year}. Đơn vị tính: ngày.
              </p>
            </div>

            <Table<Row>
              size="small"
              rowKey="employeeId"
              loading={busy}
              dataSource={filtered}
              columns={columns}
              locale={{ emptyText }}
              pagination={{
                defaultPageSize: 50,
                pageSizeOptions: [20, 50, 100],
                showSizeChanger: true,
                hideOnSinglePage: true,
              }}
              scroll={{ x: 1300, y: 'max(280px, calc(100vh - 480px))' }}
            />
          </section>
        )
      )}

      {historyRow && (
        <LeaveBalanceHistoryDrawer
          balance={historyRow}
          onClose={() => setHistoryEmployeeId(null)}
          onChanged={load}
        />
      )}
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
