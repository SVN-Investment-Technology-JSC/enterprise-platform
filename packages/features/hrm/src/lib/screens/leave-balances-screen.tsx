'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { Popover } from '@base-ui/react/popover';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  CircleHelp,
  Download,
  RefreshCw,
  Search,
  Settings2,
  Upload,
} from 'lucide-react';
import type { HrmLeaveBalanceListItem } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { downloadStyledXlsx } from '../hrm-xlsx';
import { employeeInitials, normalizeSearchText } from '../hrm-employee-view';
import { useHrmPermissions } from '../hrm-permissions';
import { cn } from '../utils';
import { Badge } from '../ui/badge';
import { Button, buttonVariants } from '../ui/button';
import { EmployeeAvatar } from '../ui/employee-list-parts';
import { Input } from '../ui/input';
import { LeaveBalanceHistoryDrawer } from '../ui/leave-balance-history-drawer';
import { LeaveImportDialog } from '../ui/leave-import-dialog';
import { formatLeaveNumber, leaveBalanceFigures } from '../ui/leave-ledger-format';
import { PageTitle } from '../ui/page-title';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

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

/** Còn tồn: < 0 là đã dùng sang phần ứng (đỏ), = 0 là hết (cam), còn phép thì nền xanh nhạt. */
function StockCell({ value }: { value: number }) {
  const chip =
    'inline-block min-w-9 rounded-md px-2 py-0.5 text-center font-semibold';
  const tone =
    value < 0
      ? 'bg-red-50 text-red-700'
      : value === 0
        ? 'bg-amber-50 text-amber-700'
        : 'bg-emerald-50 text-emerald-700';
  return <span className={`${chip} ${tone}`}>{formatLeaveNumber(value)}</span>;
}

type BalanceState = {
  readonly label: string;
  readonly className: string;
  readonly title: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Trạng thái ưu tiên lý do cần lưu ý nhất, rồi mới đến tình trạng số dư. */
function getBalanceState(row: Row): BalanceState {
  if (hasNoBalance(row))
    return {
      label: 'Chưa có quỹ',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
      title: 'Chưa có dòng quỹ phép cho năm này.',
    };
  if (row.signDate === null)
    return {
      label: 'Chưa có HĐLĐ',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      title: 'Chưa có HĐLĐ chính thức đã ký nên chưa phát sinh phép năm.',
    };
  if (row.eligibleFrom && row.eligibleFrom > todayIso())
    return {
      label: 'Chưa đến ngày hưởng',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      title: `Bắt đầu hưởng phép từ ${dateVn(row.eligibleFrom)}.`,
    };
  if (row.remaining < 0)
    return {
      label: 'Vượt quỹ',
      className: 'border-red-200 bg-red-50 text-red-700',
      title: 'Số ngày đã dùng và đang chờ duyệt vượt quá quỹ có thể dùng.',
    };
  if (row.remaining === 0)
    return {
      label: 'Đã hết phép',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      title: 'Không còn ngày phép có thể dùng.',
    };

  const accrued = row.entitledToDate ?? row.accrued;
  const usedAndPending = Number(row.used || 0) + Number(row.pending || 0);

  if (row.advanceAllowed && usedAndPending > accrued && row.remaining > 0) {
    return {
      label: 'Đang ứng phép',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
      title:
        'Đã dùng vượt mức tích luỹ thực tế, đang sử dụng phần phép ứng trước của các tháng sau.',
    };
  }

  if (row.advanceAllowed) {
    return {
      label: 'Còn phép',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      title:
        'Còn phép tích luỹ bình thường và được quyền ứng trước ngày phép của các tháng tới.',
    };
  }

  return {
    label: 'Còn phép',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    title: 'Còn ngày phép có thể dùng theo chính sách hiện hành.',
  };
}

function BalanceStateCell({ row }: { row: Row }) {
  const state = getBalanceState(row);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn('cursor-help', state.className)}
            // title={state.title}
          />
        }
      >
        {state.label}
      </TooltipTrigger>
      <TooltipContent side="top">
        {state.title}
      </TooltipContent>
    </Tooltip>
  );
}

const dateVn = (iso: string) => iso.split('-').reverse().join('/');

/** Căn cứ tính phép: ngày ký HĐLĐ chính thức đầu tiên; chưa có HĐLĐ thì phép năm không được cộng. */
function SignDateNote({ row }: { row: Row }) {
  if (row.signDate === undefined) return null;
  if (!row.signDate)
    return (
      <span
        className="block truncate text-[12px] font-normal text-amber-600"
        title="Chưa có HĐLĐ chính thức đã ký nên chưa phát sinh phép năm"
      >
        Chưa có HĐLĐ
      </span>
    );
  return (
    <span
      className="block truncate text-[12px] font-normal text-slate-500"
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

function ColumnHeader({
  label,
  help,
  className,
}: {
  readonly label: string;
  readonly help: string;
  readonly className?: string;
}) {
  return (
    <th className={className}>
      <span className="inline-flex items-center gap-1">
        {label}
        <Popover.Root>
          <Popover.Trigger
            aria-label={`Giải thích ${label}`}
            className="inline-flex size-3.5 cursor-pointer items-center justify-center rounded-full text-amber-500/80 outline-none transition-colors hover:text-amber-600 data-pressed:text-amber-600 focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <CircleHelp aria-hidden="true" className="size-3.5" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" sideOffset={8} className="z-[100]">
              <Popover.Popup className="relative z-[100] max-w-72 rounded-md border border-slate-200 bg-slate-900 px-2.5 py-2 text-left text-xs font-normal leading-5 text-white shadow-xl outline-none">
                {help}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </span>
    </th>
  );
}

const departmentOf = (r: Row) =>
  (r.department ?? '').trim() || NO_DEPARTMENT_LABEL;

/** Xếp theo phòng ban ("Chưa có phòng ban" đứng cuối), trong phòng ban xếp theo tên. */
function sortByDepartment(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const da = departmentOf(a);
    const db = departmentOf(b);
    if (da !== db) {
      if (da === NO_DEPARTMENT_LABEL) return 1;
      if (db === NO_DEPARTMENT_LABEL) return -1;
      return da.localeCompare(db, 'vi');
    }
    return a.employeeName.localeCompare(b.employeeName, 'vi');
  });
}

const TH = 'px-3 py-2.5';
const COLUMN_COUNT = 9;
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
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
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
    return sortByDepartment(
      rows.filter(
        (r) =>
          matchesStatus(r, status) &&
          (departmentFilter === 'ALL' || departmentOf(r) === departmentFilter) &&
          (!needle ||
            normalizeSearchText(`${r.employeeCode} ${r.employeeName}`).includes(
              needle,
            )),
      ),
    );
  }, [rows, search, status, departmentFilter]);

  const departmentOptions = useMemo(
    () => [
      { value: 'ALL', label: 'Phòng ban: Tất cả' },
      ...sortByDepartment(rows)
        .map(departmentOf)
        .filter((name, i, all) => all.indexOf(name) === i)
        .map((name) => ({ value: name, label: name })),
    ],
    [rows],
  );

  // Mỗi nhân viên một dòng; `id` rỗng với nhân viên chưa có quỹ nên khóa theo employeeId.
  const historyRow = historyEmployeeId
    ? (rows.find((r) => r.employeeId === historyEmployeeId) ?? null)
    : null;

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
    const ordered = sortByDepartment(source).map((r) => ({
      department: departmentOf(r),
      row: r,
    }));
    const header = [
      'STT',
      'Mã NV',
      'Họ và tên',
      'Phòng ban',
      'Năm',
      'Còn tồn',
      'Đã dùng',
      'Có thể ứng',
      'Tổng',
      'Đã điều chỉnh',
      'Trạng thái quỹ',
    ];
    const title: unknown[] = header.map(() => '');
    title[0] = `QUỸ PHÉP NĂM ${year}`;
    downloadStyledXlsx(
      `phep-nam-${year}`,
      {
        rows: [
          title,
          header,
          ...ordered.map(({ department, row: r }, index) => [
            index + 1,
            r.employeeCode,
            r.employeeName,
            department,
            r.year,
            hasNoBalance(r) ? '' : leaveBalanceFigures(r).stock,
            hasNoBalance(r) ? '' : leaveBalanceFigures(r).used,
            hasNoBalance(r) ? '' : leaveBalanceFigures(r).advance,
            hasNoBalance(r) ? '' : leaveBalanceFigures(r).total,
            hasNoBalance(r) ? '' : leaveBalanceFigures(r).adjusted,
            getBalanceState(r).label,
          ]),
        ],
        merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }],
        infoColumns: 4,
        offColumns: [],
        headerRows: 2,
      },
      `Phep nam ${year}`,
    );
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
            {canManage && (
              <Button
                variant="outline"
                size="lg"
                className="border-slate-200 text-xs font-semibold text-slate-700"
                onClick={() => setImporting(true)}
              >
                <Upload className="size-3.5" />
                Import Excel
              </Button>
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
              Xuất Excel{selectedInView > 0 ? ` (${selectedInView})` : ''}
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
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <SearchableSelect
                    height={36}
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
                    height={36}
                    value={status}
                    onChange={(v) => setStatus((v || 'ALL') as StatusFilter)}
                    options={STATUS_OPTIONS}
                    clearable={false}
                    placeholder="Trạng thái"
                  />
                </div>
                <div className="w-56">
                  <SearchableSelect
                    height={36}
                    value={departmentFilter}
                    onChange={(v) => setDepartmentFilter(v || 'ALL')}
                    options={departmentOptions}
                    clearable={false}
                    placeholder="Phòng ban"
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

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-bold text-slate-600">
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
                      <th className={TH}>Phòng ban</th>
                      <ColumnHeader
                        className={`${TH} text-right`}
                        label="Còn tồn"
                        help="Phần phép đã tích luỹ còn lại sau khi trừ đơn đã dùng và đang chờ duyệt. Số âm nghĩa là đã dùng sang phần ứng."
                      />
                      <ColumnHeader
                        className={`${TH} text-right`}
                        label="Đã dùng"
                        help="Số ngày của các đơn đã duyệt và các đơn đang chờ duyệt."
                      />
                      <ColumnHeader
                        className={`${TH} text-right`}
                        label="Có thể ứng"
                        help="Số ngày còn được ứng trước theo chính sách (phép của các tháng sau trong năm). Bằng 0 khi chính sách không cho ứng."
                      />
                      <ColumnHeader
                        className={`${TH} text-right`}
                        label="Tổng"
                        help="Tổng số ngày có thể tạo đơn ngay: Còn tồn cộng Có thể ứng."
                      />
                      <ColumnHeader
                        className={`${TH} text-right`}
                        label="Đã điều chỉnh"
                        help="Tổng bút toán cộng hoặc trừ thủ công trong năm; số này đã nằm trong quỹ phép."
                      />
                      <ColumnHeader
                        className={TH}
                        label="Trạng thái quỹ"
                        help="Cho biết quỹ còn dùng được, đã hết hoặc vượt quỹ, chưa đủ điều kiện, hay chính sách cho ứng phép."
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
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
                      filtered.map((r) => {
                        const none = hasNoBalance(r);
                        const f = leaveBalanceFigures(r);
                        return (
                          <tr
                            key={r.employeeId}
                            data-testid={`leave-row-${r.employeeId}`}
                            tabIndex={0}
                            aria-label={`Xem quỹ phép ${r.employeeName}`}
                            onClick={() => setHistoryEmployeeId(r.employeeId)}
                            onKeyDown={(e) => {
                              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                setHistoryEmployeeId(r.employeeId);
                              }
                            }}
                            className="cursor-pointer transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50"
                          >
                            <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Chọn ${r.employeeName}`}
                                checked={selectedIds.has(r.employeeId)}
                                onChange={() => toggleOne(r.employeeId)}
                                className="size-3.5 rounded border-slate-300"
                              />
                            </td>
                            <td className="px-3 py-2.5">
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
                            <td className="px-3 py-2.5 text-slate-700">
                              {departmentOf(r)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {none ? DASH : <StockCell value={f.stock} />}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {none ? DASH : formatLeaveNumber(f.used)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {none ? DASH : formatLeaveNumber(f.advance)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold">
                              {none ? DASH : formatLeaveNumber(f.total)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {none ? DASH : <AdjustedText value={f.adjusted} />}
                            </td>
                            <td className="px-3 py-2.5">
                              <BalanceStateCell row={r} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>
              <p className="text-[12px] text-slate-500">
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
      {importing && (
        <LeaveImportDialog
          year={Number(year)}
          onClose={() => setImporting(false)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
