'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileClock,
  RefreshCw,
  Search,
  Settings2,
  Users,
} from 'lucide-react';
import type { HrmLeaveBalanceListItem } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { buildCsv, downloadCsv } from '../hrm-csv';
import { employeeInitials, normalizeSearchText } from '../hrm-employee-view';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button, buttonVariants } from '../ui/button';
import { EmployeeAvatar } from '../ui/employee-list-parts';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { Input } from '../ui/input';
import { LeaveBalanceHistoryDrawer } from '../ui/leave-balance-history-drawer';
import { formatLeaveNumber } from '../ui/leave-ledger-format';
import { PageTitle } from '../ui/page-title';
import { RowMenu, type RowMenuItem } from '../ui/row-menu';

type Row = HrmLeaveBalanceListItem;

/** Nhóm cho nhân viên chưa có phòng ban trong dữ liệu quỹ phép. */
const NO_DEPARTMENT_LABEL = 'Chưa có phòng ban';

type StatusFilter = 'ALL' | 'OK' | 'DEPLETED' | 'OVER' | 'NO_BALANCE';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'OK', label: 'Còn phép' },
  { value: 'DEPLETED', label: 'Đã hết phép' },
  { value: 'OVER', label: 'Vượt quỹ phép' },
  { value: 'NO_BALANCE', label: 'Chưa có quỹ' },
];

/** Nhân viên chưa có dòng quỹ của năm (server trả dòng mặc định, `hasBalance=false`): chưa có số liệu. */
const hasNoBalance = (r: Row) => r.hasBalance === false;

function matchesStatus(r: Row, status: StatusFilter): boolean {
  switch (status) {
    case 'ALL':
      return true;
    case 'NO_BALANCE':
      return hasNoBalance(r);
    case 'OK':
      return !hasNoBalance(r) && r.remaining > 0;
    case 'DEPLETED':
      return !hasNoBalance(r) && r.remaining === 0;
    case 'OVER':
      return !hasNoBalance(r) && r.remaining < 0;
  }
}

const sumOf = (rows: readonly Row[], pick: (r: Row) => number | undefined) =>
  rows.reduce(
    (total, r) => total + (hasNoBalance(r) ? 0 : Number(pick(r) || 0)),
    0,
  );

const signed = (value: number) =>
  value > 0 ? `+${formatLeaveNumber(value)}` : formatLeaveNumber(value);

function AdjustedText({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="font-semibold text-emerald-600">{signed(value)}</span>
    );
  if (value < 0)
    return <span className="font-semibold text-red-600">{signed(value)}</span>;
  return <span className="text-slate-500">0</span>;
}

/** Còn lại < 0 là vượt quỹ (đỏ), = 0 là đã hết phép (cam); còn phép thì nền xanh nhạt. */
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
  const chip =
    'inline-block min-w-9 rounded-md px-2 py-0.5 text-center font-semibold';
  if (value < 0)
    return (
      <span
        className={`${chip} bg-red-50 text-red-700`}
        title="Đã dùng vượt quỹ phép"
      >
        {formatLeaveNumber(value)}
      </span>
    );
  if (value === 0)
    return (
      <span className={`${chip} bg-amber-50 text-amber-700`} title="Đã hết phép">
        {formatLeaveNumber(value)}
      </span>
    );
  return (
    <span className={`${chip} bg-emerald-50 text-emerald-700`}>
      {formatLeaveNumber(value)}
    </span>
  );
}

const dateVn = (iso: string) => iso.split('-').reverse().join('/');

/** Căn cứ tính phép: ngày ký HĐLĐ chính thức đầu tiên; chưa có HĐLĐ thì phép năm không được cộng. */
function SignDateNote({ row }: { row: Row }) {
  if (row.signDate === undefined) return null;
  if (!row.signDate)
    return (
      <span
        className="block truncate text-[11px] font-normal text-amber-600"
        title="Chưa có HĐLĐ chính thức đã ký nên chưa phát sinh phép năm"
      >
        Chưa có HĐLĐ
      </span>
    );
  return (
    <span
      className="block truncate text-[11px] font-normal text-slate-500"
      title={
        row.eligibleFrom && row.eligibleFrom !== row.signDate
          ? `Bắt đầu hưởng phép từ ${dateVn(row.eligibleFrom)}`
          : undefined
      }
    >
      Ký HĐLĐ {dateVn(row.signDate)}
    </span>
  );
}

/** Phép thâm niên cả năm (đã gồm trong Được hưởng); chú thích mốc năm làm việc đã đạt. */
function SeniorityCell({ row }: { row: Row }) {
  if (hasNoBalance(row) && !row.seniorityDays) return DASH;
  const days = Number(row.seniorityDays || 0);
  if (days <= 0) return <span className="text-slate-400">0</span>;
  return (
    <span
      className="font-semibold text-violet-700"
      title={
        row.seniorityTierYears
          ? `Mốc thâm niên ${row.seniorityTierYears} năm`
          : 'Phép thâm niên'
      }
    >
      +{formatLeaveNumber(days)}
    </span>
  );
}

/** Thanh tiến độ: đã dùng / được hưởng (tối đa 100%); màu theo còn lại, đồng bộ với ô Còn lại. */
function ProgressCell({ row }: { row: Row }) {
  if (hasNoBalance(row)) return <span className="text-slate-400">—</span>;
  const entitlement = Number(row.entitlement || 0);
  const used = Number(row.used || 0);
  const ratio = entitlement > 0 ? used / entitlement : used > 0 ? 1 : 0;
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  const tone =
    row.remaining < 0
      ? 'bg-red-500'
      : row.remaining === 0
        ? 'bg-amber-400'
        : 'bg-emerald-500';
  return (
    <div
      role="progressbar"
      aria-label={`Đã dùng ${formatLeaveNumber(used)} trên ${formatLeaveNumber(entitlement)} ngày`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-slate-100"
    >
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatCard({
  testId,
  icon,
  tone,
  label,
  value,
  note,
}: {
  testId: string;
  icon: ReactNode;
  tone: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div
      data-testid={testId}
      role="group"
      aria-label={label}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3"
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
        <p className="font-mono text-2xl font-bold leading-tight text-slate-900">
          {value}
        </p>
        <p className="truncate text-[11px] font-semibold text-slate-500">
          {note}
        </p>
      </div>
    </div>
  );
}

interface DepartmentGroup {
  readonly name: string;
  readonly rows: readonly Row[];
}

/** Gom theo phòng ban, nhóm "Chưa có phòng ban" đứng cuối; trong nhóm xếp theo tên. */
function groupByDepartment(rows: readonly Row[]): DepartmentGroup[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const name = (r.department ?? '').trim() || NO_DEPARTMENT_LABEL;
    const list = map.get(name);
    if (list) list.push(r);
    else map.set(name, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) =>
      a === NO_DEPARTMENT_LABEL
        ? 1
        : b === NO_DEPARTMENT_LABEL
          ? -1
          : a.localeCompare(b, 'vi'),
    )
    .map(([name, list]) => ({
      name,
      rows: [...list].sort((a, b) =>
        a.employeeName.localeCompare(b.employeeName, 'vi'),
      ),
    }));
}

const TH = 'px-3 py-2.5 text-[11px] font-bold text-slate-600';
const COLUMN_COUNT = 11;
const DASH = <span className="text-slate-400">—</span>;

/**
 * Phép năm: danh sách quỹ phép năm của từng nhân viên trong năm đang chọn, gom theo phòng ban (thu gọn/mở được).
 * Thao tác phụ theo từng dòng nằm trong menu "...": xem lịch sử (Drawer) và điều chỉnh (Dialog, quyền hrm.leave.manage).
 * Cách tính phép năm cấu hình tại /settings?view=leave.
 */
export default function LeaveBalancesScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canRead = can('hrm.leave.read');
  const canManage = can('hrm.leave.manage');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
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
    return rows.filter(
      (r) =>
        matchesStatus(r, status) &&
        (!needle ||
          normalizeSearchText(`${r.employeeCode} ${r.employeeName}`).includes(
            needle,
          )),
    );
  }, [rows, search, status]);

  const groups = useMemo(() => groupByDepartment(filtered), [filtered]);

  const summary = useMemo(() => {
    const entitlement = sumOf(rows, (r) => r.entitlement);
    const used = sumOf(rows, (r) => r.used);
    return {
      employees: rows.length,
      entitlement,
      used,
      usedPercent:
        entitlement > 0 ? Math.round((used / entitlement) * 1000) / 10 : 0,
      pending: sumOf(rows, (r) => r.pending),
    };
  }, [rows]);

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

  const rowMenuItems = (r: Row): RowMenuItem[] => [
    {
      key: 'history',
      label: 'Xem lịch sử',
      hidden: hasNoBalance(r),
      onSelect: () => setHistoryEmployeeId(r.employeeId),
    },
    {
      key: 'adjust',
      label: 'Điều chỉnh quỹ phép',
      hidden: !canManage,
      onSelect: () => openAdjust(r),
    },
  ];

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected =
    filtered.length > 0 && filtered.every((r) => selectedIds.has(r.employeeId));
  const toggleAll = (checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of filtered) {
        if (checked) next.add(r.employeeId);
        else next.delete(r.employeeId);
      }
      return next;
    });
  const selectedInView = filtered.filter((r) =>
    selectedIds.has(r.employeeId),
  ).length;

  const handleExport = () => {
    // Có tick chọn thì xuất đúng những người đã chọn (còn trong danh sách đang lọc); không thì xuất cả danh sách đang lọc.
    const source =
      selectedInView > 0
        ? filtered.filter((r) => selectedIds.has(r.employeeId))
        : filtered;
    const ordered = groupByDepartment(source).flatMap((g) =>
      g.rows.map((r) => ({ department: g.name, row: r })),
    );
    const num = (r: Row, value: number | undefined) =>
      hasNoBalance(r) ? '' : Number(value || 0);
    const csv = buildCsv([
      [
        'Mã NV',
        'Họ và tên',
        'Phòng ban',
        'Năm',
        'Được hưởng',
        'Đã dùng',
        'Chờ duyệt',
        'Còn lại',
        'Điều chỉnh',
        'Ghi chú',
      ],
      ...ordered.map(({ department, row: r }) => [
        r.employeeCode,
        r.employeeName,
        department,
        r.year,
        num(r, r.entitlement),
        num(r, r.used),
        num(r, r.pending),
        num(r, r.remaining),
        num(r, r.adjusted),
        hasNoBalance(r) ? 'Chưa có quỹ' : '',
      ]),
    ]);
    downloadCsv(`phep-nam-${year}`, csv);
  };

  const emptyText = busy
    ? 'Đang tải…'
    : rows.length === 0
      ? `Chưa có dữ liệu quỹ phép năm ${year}. Cần có nhân viên đang làm việc và đã cấu hình Phép năm.`
      : 'Không có nhân viên nào khớp với bộ lọc hiện tại.';

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          title="Phép năm"
          description="Theo dõi số ngày phép năm của nhân viên. Số liệu được tổng hợp theo cấu hình hiện hành."
        />
        {canRead && (
          <div className="flex items-center gap-2">
            {canManage && (
              <Link
                href="/settings?view=leave"
                className={buttonVariants({
                  variant: 'outline',
                  size: 'lg',
                  className:
                    'border-blue-200 text-xs font-semibold text-blue-700 hover:bg-blue-50',
                })}
              >
                <Settings2 className="size-3.5" />
                Cấu hình phép
              </Link>
            )}
            <Button
              variant="outline"
              size="lg"
              className="border-slate-200 text-xs font-semibold text-slate-700"
              disabled={filtered.length === 0}
              title={
                selectedInView > 0
                  ? `Xuất ${selectedInView} nhân viên đã chọn`
                  : 'Xuất danh sách đang lọc'
              }
              onClick={handleExport}
            >
              <Download className="size-3.5" />
              Xuất dữ liệu{selectedInView > 0 ? ` (${selectedInView})` : ''}
            </Button>
          </div>
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
          <>
            <div
              aria-label="Tổng quan phép năm"
              className="grid grid-cols-2 gap-2 xl:grid-cols-4"
            >
              <StatCard
                testId="leave-stat-employees"
                icon={<Users className="size-5" />}
                tone="bg-blue-50 text-blue-600"
                label="Tổng nhân viên"
                value={formatLeaveNumber(summary.employees)}
                note="Đang theo dõi phép năm"
              />
              <StatCard
                testId="leave-stat-entitlement"
                icon={<Database className="size-5" />}
                tone="bg-emerald-50 text-emerald-600"
                label="Tổng quỹ phép"
                value={formatLeaveNumber(summary.entitlement)}
                note="Tổng số ngày được hưởng"
              />
              <StatCard
                testId="leave-stat-used"
                icon={<Clock className="size-5" />}
                tone="bg-amber-50 text-amber-600"
                label="Đã sử dụng"
                value={formatLeaveNumber(summary.used)}
                note={`${formatLeaveNumber(summary.usedPercent)}% tổng quỹ phép`}
              />
              <StatCard
                testId="leave-stat-pending"
                icon={<FileClock className="size-5" />}
                tone="bg-rose-50 text-rose-500"
                label="Chờ duyệt"
                value={formatLeaveNumber(summary.pending)}
                note="Trong các đơn đã nộp"
              />
            </div>

            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <SearchableSelect
                    value={year}
                    onChange={(v) => v && setYear(v)}
                    options={yearOptions}
                    clearable={false}
                    placeholder="Chọn năm"
                  />
                </div>
                <div className="relative min-w-60 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    aria-label="Tìm theo mã hoặc tên nhân viên"
                    placeholder="Tìm theo tên nhân viên..."
                    className="h-9 border-slate-200 pl-9 text-xs"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="w-52">
                  <SearchableSelect
                    value={status}
                    onChange={(v) => setStatus((v || 'ALL') as StatusFilter)}
                    options={STATUS_OPTIONS}
                    clearable={false}
                    placeholder="Trạng thái"
                  />
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-slate-200 text-xs font-medium text-slate-700"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw
                    className={`size-3.5 ${busy ? 'animate-spin' : ''}`}
                  />
                  Làm mới
                </Button>
              </div>

              <div className="max-h-[calc(100vh-420px)] min-h-[280px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[1060px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
                    <tr>
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả nhân viên đang hiển thị"
                          checked={allSelected}
                          disabled={filtered.length === 0}
                          onChange={(e) => toggleAll(e.target.checked)}
                          className="size-3.5 rounded border-slate-300"
                        />
                      </th>
                      <th className={TH}>Tên nhân viên</th>
                      <th className={TH}>Mã NV</th>
                      <th className={`${TH} text-right`}>Được hưởng</th>
                      <th
                        className={`${TH} text-right`}
                        title="Phép thâm niên cả năm theo mốc năm làm việc tính từ ngày ký HĐLĐ; đã nằm trong cột Được hưởng"
                      >
                        Thâm niên
                      </th>
                      <th className={`${TH} text-right`}>Đã dùng</th>
                      <th className={`${TH} text-right`}>Chờ duyệt</th>
                      <th className={`${TH} text-right`}>Còn lại</th>
                      <th className={`${TH} text-right`}>Điều chỉnh</th>
                      <th className={`${TH} w-40`}>Tiến độ</th>
                      <th className={`${TH} w-16 text-center`}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="font-medium">
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={COLUMN_COUNT}
                          className="p-8 text-center text-slate-400"
                        >
                          {emptyText}
                        </td>
                      </tr>
                    ) : (
                      groups.map((group) => {
                        const isCollapsed = collapsed.has(group.name);
                        const remaining = sumOf(group.rows, (r) => r.remaining);
                        return [
                          <tr
                            key={`group:${group.name}`}
                            data-testid="leave-group-row"
                            className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900"
                          >
                            <td colSpan={3} className="px-3 py-2">
                              <button
                                type="button"
                                aria-expanded={!isCollapsed}
                                aria-label={`${isCollapsed ? 'Mở' : 'Thu gọn'} nhóm ${group.name}`}
                                onClick={() => toggleGroup(group.name)}
                                className="flex items-center gap-2 text-left"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="size-4 text-slate-500" />
                                ) : (
                                  <ChevronDown className="size-4 text-slate-500" />
                                )}
                                <span>{group.name}</span>
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                                  {group.rows.length}
                                </span>
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatLeaveNumber(
                                sumOf(group.rows, (r) => r.entitlement),
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatLeaveNumber(
                                sumOf(group.rows, (r) => r.seniorityDays),
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatLeaveNumber(
                                sumOf(group.rows, (r) => r.used),
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatLeaveNumber(
                                sumOf(group.rows, (r) => r.pending),
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`inline-block min-w-9 rounded-md px-2 py-0.5 text-center ${
                                  remaining < 0
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {formatLeaveNumber(remaining)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <AdjustedText
                                value={sumOf(group.rows, (r) => r.adjusted)}
                              />
                            </td>
                            <td className="px-3 py-2 text-slate-400">-</td>
                            <td className="px-3 py-2" />
                          </tr>,
                          ...(isCollapsed
                            ? []
                            : group.rows.map((r) => {
                                const none = hasNoBalance(r);
                                return (
                                  <tr
                                    key={r.employeeId}
                                    data-testid={`leave-row-${r.employeeId}`}
                                    className="border-t border-slate-100 transition-colors hover:bg-slate-50/80"
                                  >
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        aria-label={`Chọn ${r.employeeName}`}
                                        checked={selectedIds.has(r.employeeId)}
                                        onChange={() => toggleOne(r.employeeId)}
                                        className="size-3.5 rounded border-slate-300"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className="flex items-center gap-2.5">
                                        <EmployeeAvatar
                                          initials={employeeInitials({
                                            fullName: r.employeeName,
                                            employeeCode: r.employeeCode,
                                          })}
                                          seed={r.employeeCode}
                                        />
                                        <span className="min-w-0">
                                          <span className="block truncate font-semibold text-slate-900">
                                            {r.employeeName}
                                          </span>
                                          <SignDateNote row={r} />
                                        </span>
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 font-mono text-slate-600">
                                      {r.employeeCode}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {none
                                        ? DASH
                                        : formatLeaveNumber(r.entitlement)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <SeniorityCell row={r} />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {none ? DASH : formatLeaveNumber(r.used)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {none
                                        ? DASH
                                        : formatLeaveNumber(r.pending)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <RemainingCell row={r} />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {none ? (
                                        DASH
                                      ) : (
                                        <AdjustedText
                                          value={Number(r.adjusted || 0)}
                                        />
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      <ProgressCell row={r} />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <RowMenu
                                        label={`Thao tác ${r.employeeName}`}
                                        items={rowMenuItems(r)}
                                      />
                                    </td>
                                  </tr>
                                );
                              })),
                        ];
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                {filtered.length !== rows.length
                  ? `${filtered.length} / ${rows.length}`
                  : rows.length}{' '}
                nhân viên, quỹ phép năm {year}. Đơn vị tính: ngày.
              </p>
            </section>
          </>
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
