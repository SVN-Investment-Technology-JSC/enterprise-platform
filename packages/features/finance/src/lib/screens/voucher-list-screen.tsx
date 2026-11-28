'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCheck, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, Search, TriangleAlert, Workflow } from 'lucide-react';
import { Table } from 'antd';
import type { ColumnType } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput, MonthPickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { ContextMenu, anchorFromElement, anchorFromMouse, isMenuKey, type MenuAnchor, type MenuEntry } from '@enterprise-platform/feature-shared';
import {
  FINANCE_BULK_SKIP_REASON_LABELS,
  FINANCE_VOUCHER_DISPLAY_STATUSES,
  FINANCE_VOUCHER_STATUS_LABELS,
  financeAllocationLabel,
  financeDisplayStatusTotals,
  financeMissingFieldsMessage,
  type FinanceAccount,
  type FinanceBulkApproveResult,
  type FinanceCancelVoucherResult,
  type FinanceListColumns,
  type FinanceCatalogs,
  type FinanceVoucher,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceSortDirection,
  type FinanceVoucherDisplayStatus,
  type FinanceVoucherSortKey,
  type FinanceVoucherStatus,
  type FinanceVoucherSummary,
} from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, financePost, financePut, toQuery } from '../finance-api';
import { buildCsv, downloadCsv } from '../finance-csv';
import { dateVn, isMonth, money, monthLabel, monthRange, newFinanceIdempotencyKey, shiftMonth, todayVn, voucherCsvRows } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { useFinancePermissions } from '../finance-permissions';
import { APPROVE_MENU_LABEL, buildVoucherMenu, type FinanceMenuActionId } from '../voucher-context-menu';
import {
  loadVoucherCellMode,
  loadVoucherColumnOrder,
  loadVoucherColumnWidths,
  moveVoucherColumn,
  orderVoucherColumns,
  saveVoucherCellMode,
  saveVoucherColumnOrder,
  saveVoucherColumnWidths,
  visibleVoucherColumns,
  voucherColumnCatalog,
  voucherColumnWidths,
  type VoucherCellMode,
  type VoucherColumnKey,
} from '../voucher-list-columns';
import { loadWorkspaceProjects, projectLabel, type WorkspaceProjectOption } from '../workspace-links';
import { Button } from '../ui/button';
import { ColumnPicker } from '../ui/column-picker';
import { ResizableTitle, type ResizableTitleProps } from '../ui/resizable-title';
import { Avatar, ErrorBanner, StatusBadge } from '../ui/form-parts';
import { cn } from '../utils';

/** `procedure` là bộ lọc "Từ quy trình" (tham số `source`), các giá trị còn lại là tham số `scope`. */
type Scope = 'all' | 'mine' | 'to-approve' | 'to-post' | 'awaiting-post' | 'procedure';

/**
 * Kỳ xem mặc định: tháng hiện tại, để danh sách gọn và theo dõi từng tháng. `?month=all` xem toàn bộ thời gian
 * (các liên kết từ danh sách tài khoản dùng cách này để số phiếu khớp số đếm của tài khoản); `?month=YYYY-MM` mở đúng tháng đó.
 */
export function initialMonth(param: string | null, today: string = todayVn()): string {
  if (param === 'all') return '';
  return isMonth(param) ? param : today.slice(0, 7);
}

/** Mật độ bảng danh sách phiếu (gọn như danh sách phiếu chi của 1Office): ghi đè kiểu mặc định của antd. */
const VOUCHER_TABLE_DENSITY = cn(
  '[&_.ant-table]:text-[13px]',
  '[&_.ant-table-thead>tr>th]:font-normal! [&_.ant-table-thead>tr>th]:text-slate-500! [&_.ant-table-thead>tr>th]:py-2! [&_.ant-table-thead>tr>th]:text-[13px]!',
  '[&_.ant-table-tbody>tr>td]:py-2! [&_.ant-table-tbody>tr>td]:leading-5',
);

/**
 * Vì sao phiếu không chọn được để duyệt hàng loạt (null: chọn được). Chỉ chặn trước những gì biết chắc từ danh sách; điều kiện cần
 * máy chủ kiểm (tự duyệt, khoá sổ, số dư, loại phiếu gán quy trình...) thì phiếu vẫn chọn được và bị bỏ qua kèm lý do.
 */
export function bulkApproveBlockReason(row: FinanceVoucherSummary): string | null {
  if (row.status === 'APPROVED' || row.status === 'CANCELLED') return 'Phiếu đã duyệt và ghi sổ';
  if (row.status === 'PENDING' && row.approvalMode === 'PROCEDURE') return 'Phiếu đang duyệt qua quy trình';
  if (row.missingFields?.length) return `Chưa đủ thông tin để duyệt. ${financeMissingFieldsMessage(row.kind, row.missingFields)}`;
  return null;
}

export default function VoucherListScreen({ kind }: { kind: FinanceVoucherKind }) {
  const config = FINANCE_KIND_CONFIG[kind];
  const router = useRouter();
  const params = useSearchParams();
  const { capabilities } = useFinancePermissions();
  const kindCaps = capabilities?.[kind === 'RECEIPT' ? 'receipt' : kind === 'PAYMENT' ? 'payment' : 'transfer'];

  // Hai trạng thái hiển thị: "Nháp" (gồm chờ duyệt, bị từ chối) và "Đã duyệt"; phiếu đã huỷ không hiện.
  const [status, setStatus] = useState<FinanceVoucherDisplayStatus | ''>('');
  const [scope, setScope] = useState<Scope>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [accountId, setAccountId] = useState(params.get('accountId') ?? '');
  const [reasonId, setReasonId] = useState('');
  const [projectId, setProjectId] = useState('');
  // Dự án lấy từ Workspace; không có (Workspace tắt hoặc chưa kết nối) thì ẩn ô lọc dự án, danh sách vẫn chạy bình thường.
  const [projects, setProjects] = useState<WorkspaceProjectOption[]>([]);
  // '' = tất cả thời gian. Chọn tháng thì khoảng ngày lấy theo tháng; ở chế độ "Tất cả" mới có ô Từ ngày / Đến ngày.
  const [month, setMonth] = useState(() => initialMonth(params.get('month')));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = month ? monthRange(month) : { from, to };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<FinanceVoucherList | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  // Menu chuột phải: Sửa, Duyệt ghi sổ, Huỷ, Nhân bản — thao tác nhanh không cần mở từng phiếu.
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; voucherId: string; entries: MenuEntry<FinanceMenuActionId>[]; voucher?: FinanceVoucher } | null>(null);
  // Chỉ "Duyệt ghi sổ" còn hỏi xác nhận (tiền vào sổ); "Huỷ" chạy ngay.
  const [pendingAction, setPendingAction] = useState<{ action: 'approve'; voucher: FinanceVoucher; anchor: MenuAnchor } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingTriggerRef = useRef<HTMLDivElement>(null);

  // Duyệt hàng loạt: chỉ phiếu thường chưa ghi sổ mới chọn được (phiếu qua quy trình duyệt trong quy trình).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Kết quả lần duyệt hàng loạt gần nhất: số phiếu đã ghi sổ và các phiếu bị bỏ qua kèm lý do. */
  const [bulkReport, setBulkReport] = useState<{ approved: number; skipped: FinanceBulkApproveResult['failed'] } | null>(null);

  // Sắp xếp ở máy chủ (danh sách phân trang ở máy chủ); null = mặc định mới nhất trước.
  const [sort, setSort] = useState<{ key: VoucherColumnKey; sortKey: FinanceVoucherSortKey; direction: FinanceSortDirection } | null>(null);
  // Chữ dài trong ô: xuống dòng (mặc định) hoặc gọn một dòng; nhớ trên trình duyệt của người dùng.
  const [cellMode, setCellMode] = useState<VoucherCellMode>(() => loadVoucherCellMode());
  function changeCellMode(next: VoucherCellMode) {
    setCellMode(next);
    saveVoucherCellMode(next);
  }
  // Bề ngang cột người dùng đã kéo (px), nhớ trên trình duyệt theo từng loại phiếu.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadVoucherColumnWidths(kind));
  useEffect(() => setColumnWidths(loadVoucherColumnWidths(kind)), [kind]);
  function resizeColumn(key: VoucherColumnKey, width: number) {
    setColumnWidths((current) => {
      const next = { ...current, [key]: width };
      saveVoucherColumnWidths(kind, next);
      return next;
    });
  }
  // Thứ tự cột người dùng đã kéo thả (mã cột), nhớ trên trình duyệt theo từng loại phiếu; rỗng = thứ tự mặc định.
  const [columnOrder, setColumnOrder] = useState<string[]>(() => loadVoucherColumnOrder(kind));
  useEffect(() => setColumnOrder(loadVoucherColumnOrder(kind)), [kind]);
  function resetColumnWidths() {
    setColumnWidths({});
    saveVoucherColumnWidths(kind, null);
    setColumnOrder([]);
    saveVoucherColumnOrder(kind, null);
  }

  // Cột hiển thị riêng của người dùng; null = bộ mặc định. Chưa tải xong thì dùng mặc định, không chặn danh sách.
  const [savedColumns, setSavedColumns] = useState<string[] | null>(null);
  useEffect(() => {
    let active = true;
    void financeFetch<FinanceListColumns>(`/preferences/list-columns/${kind}`)
      .then((result) => active && setSavedColumns(result.columns))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind]);
  function changeColumns(next: string[] | null) {
    setSavedColumns(next);
    void financePut<FinanceListColumns>(`/preferences/list-columns/${kind}`, { columns: next }).catch((e) =>
      setActionError(financeErrorMessage(e, 'Không lưu được cột hiển thị.')),
    );
  }

  useEffect(() => {
    if (pendingAction) pendingTriggerRef.current?.click();
  }, [pendingAction]);

  const LOADING_MENU: MenuEntry<FinanceMenuActionId>[] = [{ kind: 'item', id: 'edit', label: 'Đang tải…', disabledReason: 'Đang tải…' }];

  async function openRowMenu(row: FinanceVoucherSummary, anchor: MenuAnchor) {
    setMenu({ anchor, voucherId: row.id, entries: LOADING_MENU });
    try {
      const voucher = await financeFetch<FinanceVoucher>(`/vouchers/${row.id}`);
      setMenu((current) => (current?.voucherId === row.id ? { anchor, voucherId: row.id, entries: buildVoucherMenu(voucher, Boolean(kindCaps?.create)), voucher } : current));
    } catch (e) {
      setMenu(null);
      setActionError(financeErrorMessage(e, 'Không mở được menu thao tác.'));
    }
  }

  function pickMenuAction(action: FinanceMenuActionId) {
    if (!menu) return;
    const { voucherId, anchor, voucher } = menu;
    setMenu(null);
    if (action === 'edit') router.push(`${config.path}/${voucherId}/edit`);
    else if (action === 'duplicate') router.push(`${config.path}/new?from=${voucherId}`);
    else if (action === 'cancel') void cancelVoucher(voucherId);
    else if (voucher) setPendingAction({ action, voucher, anchor });
  }

  /** Huỷ không hỏi lại: phiếu chưa ghi sổ bị xoá hẳn, phiếu đã ghi sổ được đảo bút toán; cả hai biến khỏi danh sách. */
  async function cancelVoucher(voucherId: string) {
    try {
      const result = await financePost<FinanceCancelVoucherResult>(`/vouchers/${voucherId}/cancel`, {});
      toast.success(result.deleted ? `Đã huỷ và xoá ${result.code}` : `Đã huỷ ${result.code} và đảo bút toán`);
      void load();
    } catch (e) {
      setActionError(financeErrorMessage(e));
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    void Promise.all([financeFetch<FinanceAccount[]>('/accounts'), financeFetch<FinanceCatalogs>('/catalogs')])
      .then(([loadedAccounts, loadedCatalogs]) => {
        if (!active) return;
        setAccounts(loadedAccounts);
        setCatalogs(loadedCatalogs);
      })
      .catch(() => undefined);
    if (kind !== 'TRANSFER') void loadWorkspaceProjects().then((result) => active && setProjects(result.items)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setLoading(true);
    try {
      const result = await financeFetch<FinanceVoucherList>(
        `/vouchers${toQuery({ kind, status, scope: scope === 'all' || scope === 'procedure' ? undefined : scope, source: scope === 'procedure' ? 'procedure' : undefined, search: debouncedSearch, accountId, reasonId, projectId, from: range.from, to: range.to, sort: sort?.sortKey, direction: sort?.direction, page, pageSize })}`,
      );
      if (mine !== sequence.current) return;
      setData(result);
      setSelectedIds((current) => current.filter((id) => result.items.some((item) => item.id === id)));
      setError(null);
    } catch (e) {
      if (mine === sequence.current) setError(financeErrorMessage(e, 'Không tải được danh sách.'));
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [kind, status, scope, debouncedSearch, accountId, reasonId, projectId, range.from, range.to, sort, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runPendingAction() {
    if (!pendingAction) return;
    const { voucher } = pendingAction;
    try {
      // Phiếu có nguồn (hồ sơ Quy trình, Bán hàng): ghi sổ kèm phiên bản đang xem; phiếu qua quy trình duyệt: duyệt bước của mình.
      if (voucher.approvalMode === 'INHERITED') await financePost(`/vouchers/${voucher.id}/post-sourced`, { revision: voucher.revision });
      else if (voucher.approvalMode === 'PROCEDURE' && voucher.status === 'PENDING')
        await financePost(`/vouchers/${voucher.id}/procedure-action`, { action: 'approve', idempotencyKey: newFinanceIdempotencyKey() });
      else await financePost(`/vouchers/${voucher.id}/approve`, { note: undefined });
      toast.success(voucher.approvalMode === 'PROCEDURE' && voucher.status === 'PENDING' ? 'Đã duyệt bước của bạn' : 'Đã duyệt và ghi sổ');
      void load();
    } catch (e) {
      setActionError(financeErrorMessage(e));
    } finally {
      setPendingAction(null);
    }
  }

  async function bulkApprove() {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    setActionError(null);
    setBulkReport(null);
    try {
      const result = await financePost<FinanceBulkApproveResult>('/vouchers/bulk-approve', { ids: selectedIds });
      if (result.approved.length) toast.success(`Đã duyệt và ghi sổ ${result.approved.length} phiếu`);
      // Phiếu bị bỏ qua hiện thành danh sách kèm lý do; bỏ chọn hết để lần bấm sau không lặp lại đúng các phiếu đó.
      if (result.failed.length) setBulkReport({ approved: result.approved.length, skipped: result.failed });
      setSelectedIds([]);
      void load();
    } catch (e) {
      setActionError(financeErrorMessage(e, 'Không duyệt được các phiếu đã chọn.'));
    } finally {
      setBulkBusy(false);
    }
  }

  // Đổi bộ lọc thì về trang 1.
  const filter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const accountOptions = useMemo(() => accounts.map((a) => ({ value: a.id, label: a.name })), [accounts]);
  const reasonOptions = useMemo(
    () => (catalogs?.reasons ?? []).filter((r) => r.kind === kind).map((r) => ({ value: r.id, label: r.name })),
    [catalogs, kind],
  );

  const total = data ? Object.values(data.statusCounts).reduce((sum, n) => sum + n, 0) : 0;
  const displayCounts = data ? financeDisplayStatusTotals(data.statusCounts) : { DRAFT: 0, APPROVED: 0 };
  const displayAmounts = data ? financeDisplayStatusTotals(data.statusAmounts) : { DRAFT: 0, APPROVED: 0 };
  const changeMonth = (next: string) => {
    setMonth(next);
    setPage(1);
  };
  const summary = data
    ? [
        { id: 'total', label: 'Tổng số phiếu', count: total, amount: null as number | null },
        { id: 'approved', label: 'Đã duyệt', count: displayCounts.APPROVED, amount: displayAmounts.APPROVED },
        { id: 'open', label: 'Nháp', count: displayCounts.DRAFT, amount: displayAmounts.DRAFT },
      ]
    : [];

  const columnCatalog = voucherColumnCatalog(kind, config);
  const shownColumns = orderVoucherColumns(visibleVoucherColumns(columnCatalog, savedColumns), columnOrder);
  const widths = voucherColumnWidths(shownColumns, columnWidths);
  /** Kéo tiêu đề cột `from` thả lên cột `to`: đổi chỗ, lưu thứ tự của mọi cột đang hiện. */
  function reorderColumn(from: string, to: string) {
    const next = moveVoucherColumn(
      shownColumns.map((column) => column.key),
      from,
      to,
    );
    setColumnOrder(next);
    saveVoucherColumnOrder(kind, next);
  }
  const compact = cellMode === 'compact';
  /**
   * Ô chữ: chế độ "Xuống dòng" hiện đủ chữ (ngắt cả chuỗi dài không dấu cách); "Gọn một dòng" cắt bằng dấu ba chấm và hiện đủ chữ
   * khi rê chuột (antd tự đặt chú thích cho ô chữ).
   */
  const text = (dataIndex: keyof FinanceVoucherSummary | undefined, value: (row: FinanceVoucherSummary) => string): ColumnType<FinanceVoucherSummary> => ({
    dataIndex,
    ellipsis: compact,
    render: (_: unknown, row) => (compact ? value(row) : <span className="[overflow-wrap:anywhere]">{value(row)}</span>),
  });
  /** Ô một dòng (mã, ngày, số tiền, trạng thái, người tạo): không ngắt giữa chữ; quá hẹp thì cắt kèm chú thích. */
  const oneLine = 'block truncate whitespace-nowrap';
  const renderers: Record<VoucherColumnKey, ColumnType<FinanceVoucherSummary>> = {
    code: {
      dataIndex: 'code',
      render: (code: string, row) => (
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          <a
            href={`${config.path}/${row.id}`}
            // Phiếu chưa ghi sổ chỉ có mã nháp: hiện nhạt hơn để phân biệt với mã chính thức.
            className={cn('min-w-0 truncate font-medium hover:underline', row.officialCode ? 'text-link' : 'text-slate-500 hover:text-link')}
            title={code}
            onClick={(event) => {
              event.preventDefault();
              router.push(`${config.path}/${row.id}`);
            }}
          >
            {code}
          </a>
          {row.sourceCode ? (
            // Phiếu từ hồ sơ quy trình: chỉ một biểu tượng nhỏ, mã hồ sơ khi rê chuột (đã có bộ lọc "Từ quy trình").
            <span role="img" aria-label={`Từ hồ sơ ${row.sourceCode}`} title={`Từ hồ sơ ${row.sourceCode}`} className="inline-flex shrink-0 text-slate-400">
              <Workflow className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </span>
      ),
    },
    date: { dataIndex: 'voucherDate', render: (value: string) => <span className={oneLine}>{dateVn(value)}</span> },
    content: text('content', (row) => row.content),
    accounts: text(undefined, (row) => `${row.accountName ?? ''} → ${row.destAccountName ?? ''}`),
    reason: text('reasonName', (row) => row.reasonName ?? ''),
    account: text('accountName', (row) => row.accountName ?? ''),
    counterparty: text('counterpartyGroupName', (row) => row.counterpartyGroupName ?? ''),
    person: text('counterpartyName', (row) => row.counterpartyName ?? ''),
    // Hạch toán: chỉ mã dự án cho gọn, tên đầy đủ khi rê chuột.
    allocation: {
      render: (_: unknown, row) =>
        row.allocation ? (
          <span className={oneLine} title={financeAllocationLabel(row.allocation)}>
            {row.allocation.projectCode}
          </span>
        ) : null,
    },
    project: text(undefined, (row) => (row.allocation ? financeAllocationLabel(row.allocation) : '')),
    'created-by': {
      dataIndex: 'createdByName',
      render: (name: string | null) => (
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={name ?? undefined}>
          <Avatar name={name} className="size-5 text-[10px]" />
          <span className="min-w-0 truncate">{name ?? ''}</span>
        </span>
      ),
    },
    amount: {
      dataIndex: 'totalAmount',
      align: 'right',
      render: (value: number) => <span className="whitespace-nowrap tabular-nums font-medium">{money(value)}</span>,
    },
    status: {
      dataIndex: 'status',
      render: (value: FinanceVoucherStatus, row) => (
        <span className="flex items-center gap-1 whitespace-nowrap">
          <StatusBadge status={value} />
          {row.missingFields?.length ? (
            // Phiếu nháp còn thiếu trường bắt buộc: biểu tượng nhỏ, rê chuột thấy các trường cần bổ sung trước khi duyệt.
            <span
              role="img"
              aria-label="Thiếu thông tin"
              title={financeMissingFieldsMessage(row.kind, row.missingFields)}
              className="inline-flex shrink-0 text-amber-600"
            >
              <TriangleAlert className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </span>
      ),
    },
  };
  const sortOrderOf = (key: VoucherColumnKey) => (sort?.key === key ? (sort.direction === 'asc' ? 'ascend' : 'descend') : null);
  const columns: ColumnType<FinanceVoucherSummary>[] = shownColumns.map((column) => ({
    ...renderers[column.key],
    key: column.key,
    title: column.label,
    width: widths[column.key],
    // Mọi cột sắp xếp được; sắp xếp ở máy chủ nên bảng chỉ báo cột và chiều (bấm lần ba trả về thứ tự mặc định).
    sorter: true,
    sortOrder: sortOrderOf(column.key),
    // Kéo mép phải tiêu đề để đổi bề ngang cột (xem `ResizableTitle`).
    onHeaderCell: () =>
      ({
        width: widths[column.key],
        minWidth: column.minWidth,
        resizeKey: column.key,
        onResize: (width: number) => resizeColumn(column.key, width),
        onReorder: reorderColumn,
      }) as ResizableTitleProps,
  }));
  /** Tổng bề ngang (kể cả ô chọn): vượt khung thì bảng cuộn ngang thay vì bóp cột. */
  const tableWidth = Object.values(widths).reduce((sum, width) => sum + width, 0) + (kindCaps?.approve ? 36 : 0);
  function changeSort(sorter: SorterResult<FinanceVoucherSummary> | SorterResult<FinanceVoucherSummary>[]) {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const column = single?.order ? columnCatalog.find((candidate) => candidate.key === single.columnKey) : undefined;
    setSort(column ? { key: column.key, sortKey: column.sortKey, direction: single.order === 'descend' ? 'desc' : 'asc' } : null);
    setPage(1);
  }
  const canBulkApprove = Boolean(kindCaps?.approve);

  const scopes: { id: Scope; label: string; visible: boolean }[] = [
    { id: 'all', label: 'Tất cả phiếu', visible: true },
    { id: 'mine', label: 'Của tôi', visible: true },
    { id: 'to-approve', label: 'Chờ tôi duyệt', visible: Boolean(kindCaps?.approve) },
    // Phiếu tạo từ bước Tài chính của quy trình (lệnh chuyển tiền không đi qua quy trình).
    { id: 'to-post', label: 'Chờ tôi ghi sổ', visible: kind !== 'TRANSFER' && Boolean(kindCaps?.approve) },
    { id: 'awaiting-post', label: 'Chờ ghi sổ (tất cả)', visible: kind !== 'TRANSFER' && Boolean(kindCaps?.approve) },
    { id: 'procedure', label: 'Từ quy trình', visible: kind !== 'TRANSFER' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">{config.listTitle}</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" aria-label="Làm mới" onClick={() => void load()}>
            <RefreshCw aria-hidden /> Làm mới
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!data?.items.length}
            onClick={() => downloadCsv(`${config.singular.replace(/\s+/g, '-')}-${dateVn(new Date().toISOString().slice(0, 10)).replace(/\//g, '-')}`, buildCsv(voucherCsvRows(data?.items ?? [])))}
          >
            <Download aria-hidden /> Xuất Excel
          </Button>
          <ColumnPicker
            catalog={columnCatalog}
            visible={new Set(shownColumns.map((column) => column.key))}
            onChange={changeColumns}
            onReset={() => changeColumns(null)}
            cellMode={cellMode}
            onCellModeChange={changeCellMode}
            onResetWidths={resetColumnWidths}
          />
          {kindCaps?.create ? (
            <Button type="button" onClick={() => router.push(`${config.path}/new`)}>
              <Plus aria-hidden /> Tạo mới
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
            <div role="group" aria-label="Kỳ xem" className="inline-flex overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                aria-pressed={Boolean(month)}
                onClick={() => changeMonth(month || todayVn().slice(0, 7))}
                className={cn('px-3 py-1.5 text-sm', month ? 'bg-accent-soft font-semibold text-accent-text' : 'font-medium text-slate-600 hover:bg-slate-50')}
              >
                Theo tháng
              </button>
              <button
                type="button"
                aria-pressed={!month}
                onClick={() => changeMonth('')}
                className={cn('border-l border-slate-200 px-3 py-1.5 text-sm', !month ? 'bg-accent-soft font-semibold text-accent-text' : 'font-medium text-slate-600 hover:bg-slate-50')}
              >
                Tất cả
              </button>
            </div>
            {month ? (
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Tháng trước" onClick={() => changeMonth(shiftMonth(month, -1))} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <div className="w-32">
                  <MonthPickerInput aria-label="Chọn tháng" value={month} onChange={(value) => value && changeMonth(value)} />
                </div>
                <button type="button" aria-label="Tháng sau" onClick={() => changeMonth(shiftMonth(month, 1))} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <ChevronRight className="size-4" aria-hidden />
                </button>
                {month !== todayVn().slice(0, 7) ? (
                  <button type="button" onClick={() => changeMonth(todayVn().slice(0, 7))} className="ml-1 text-xs font-medium text-link hover:underline">
                    Về tháng này
                  </button>
                ) : null}
                <span className="ml-2 text-sm font-semibold text-slate-700">{monthLabel(month)}</span>
              </div>
            ) : (
              <span className="text-sm text-slate-500">Toàn bộ thời gian</span>
            )}
          </div>

          {data ? (
            <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-3" aria-label="Tổng kết kỳ">
              {summary.map((item) => (
                <div key={item.id} data-testid={`summary-${item.id}`} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="text-base font-semibold tabular-nums text-slate-900">{item.count} phiếu</div>
                  {item.amount !== null ? <div className="text-xs tabular-nums text-slate-600">{money(item.amount)}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div role="tablist" aria-label="Trạng thái phiếu" className="flex flex-wrap gap-1 border-b border-slate-100 px-3 pt-2">
            {[{ id: '' as const, label: 'Tất cả', count: total }, ...FINANCE_VOUCHER_DISPLAY_STATUSES.map((s) => ({ id: s, label: FINANCE_VOUCHER_STATUS_LABELS[s], count: displayCounts[s] }))].map((tab) => (
              <button
                key={tab.id || 'all'}
                role="tab"
                type="button"
                aria-selected={status === tab.id}
                onClick={() => {
                  setStatus(tab.id);
                  setPage(1);
                }}
                className={cn(
                  'border-b-2 px-3 py-2 text-sm',
                  status === tab.id ? 'border-accent-strong font-semibold text-accent-text' : 'border-transparent font-medium text-slate-600 hover:text-slate-900',
                )}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-400" aria-hidden />
              <input
                aria-label="Tìm phiếu"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Tìm mã phiếu, nội dung, người tạo"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pr-2 pl-8 text-sm outline-none focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent-soft"
              />
            </div>
            <div className="w-52">
              <SearchableSelect options={accountOptions} value={accountId} onChange={filter(setAccountId)} placeholder="Mọi tài khoản" clearable height={32} />
            </div>
            {kind !== 'TRANSFER' && projects.length ? (
              <div className="w-56">
                <SearchableSelect options={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))} value={projectId} onChange={filter(setProjectId)} placeholder="Mọi dự án" clearable height={32} />
              </div>
            ) : null}
            {kind !== 'TRANSFER' ? (
              <div className="w-52">
                <SearchableSelect options={reasonOptions} value={reasonId} onChange={filter(setReasonId)} placeholder={`Mọi ${config.reasonLabel.toLowerCase()}`} clearable height={32} />
              </div>
            ) : null}
            {!month ? (
              <>
                <div className="w-36">
                  <DatePickerInput aria-label="Từ ngày" value={from} onChange={filter(setFrom)} placeholder="Từ ngày" />
                </div>
                <div className="w-36">
                  <DatePickerInput aria-label="Đến ngày" value={to} onChange={filter(setTo)} placeholder="Đến ngày" />
                </div>
              </>
            ) : null}
            <div className="ml-auto flex gap-1">
              {scopes
                .filter((s) => s.visible)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={scope === s.id}
                    onClick={() => {
                      setScope(s.id);
                      setPage(1);
                    }}
                    className={cn('rounded-full border px-3 py-1.5 text-sm', scope === s.id ? 'border-accent-strong bg-accent-soft font-semibold text-accent-text' : 'border-slate-200 font-medium text-slate-600 hover:bg-slate-50')}
                  >
                    {s.label}
                  </button>
                ))}
            </div>
          </div>

          <div className="p-3">
            <ErrorBanner message={error ?? actionError} />
            {bulkReport ? (
              <div role="alert" aria-label="Kết quả duyệt hàng loạt" className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">
                    {bulkReport.approved ? `Đã duyệt và ghi sổ ${bulkReport.approved} phiếu. ` : ''}
                    Bỏ qua {bulkReport.skipped.length} phiếu chưa đủ điều kiện:
                  </p>
                  <button type="button" onClick={() => setBulkReport(null)} className="shrink-0 text-xs font-medium text-link hover:underline">
                    Đóng
                  </button>
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {bulkReport.skipped.map((item) => (
                    <li key={item.id}>
                      <span className="font-medium">{item.code ?? 'Phiếu không xem được'}</span>
                      {item.reason ? ` (${FINANCE_BULK_SKIP_REASON_LABELS[item.reason]})` : ''}: {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canBulkApprove && selectedIds.length ? (
              <div role="region" aria-label="Duyệt hàng loạt" className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-accent-soft px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">Đã chọn {selectedIds.length} phiếu nháp</span>
                <Popconfirm
                  title={`Duyệt và ghi sổ ${selectedIds.length} phiếu?`}
                  description="Tiền được ghi vào sổ tài khoản ngay; phiếu nào không duyệt được sẽ báo lý do, các phiếu khác vẫn được duyệt."
                  okText="Duyệt"
                  okType="primary"
                  onConfirm={() => void bulkApprove()}
                >
                  <Button type="button" size="sm" disabled={bulkBusy}>
                    <CheckCheck aria-hidden /> Duyệt {selectedIds.length} phiếu
                  </Button>
                </Popconfirm>
                <button type="button" onClick={() => setSelectedIds([])} className="text-xs font-medium text-link hover:underline">
                  Bỏ chọn
                </button>
              </div>
            ) : null}
            {/* Bảng gọn: chữ 13px, đệm dòng 8px, tiêu đề chữ thường màu nhạt. */}
            <div className={VOUCHER_TABLE_DENSITY}>
              <Table<FinanceVoucherSummary>
                size="small"
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={data?.items ?? []}
                rowSelection={
                  canBulkApprove
                    ? {
                        columnWidth: 36,
                        selectedRowKeys: selectedIds,
                        onChange: (keys) => setSelectedIds(keys.map(String)),
                        // Phiếu biết chắc không duyệt được (đã duyệt, từ hồ sơ quy trình, đang chạy quy trình, còn thiếu trường) thì
                        // không chọn được, rê chuột thấy lý do; điều kiện còn lại máy chủ kiểm và báo phiếu bị bỏ qua.
                        getCheckboxProps: (row) => ({
                          disabled: Boolean(bulkApproveBlockReason(row)),
                          title: bulkApproveBlockReason(row) ?? undefined,
                          'aria-label': `Chọn phiếu ${row.code}`,
                        }),
                      }
                    : undefined
                }
                // Bề ngang cột theo px (kéo được); tổng vượt khung thì cuộn ngang, cột đầu (mã, số tiền, trạng thái) vẫn thấy ngay.
                tableLayout="fixed"
                scroll={{ x: tableWidth }}
                components={{ header: { cell: ResizableTitle } }}
                onChange={(_pagination, _filters, sorter, extra) => {
                  if (extra.action === 'sort') changeSort(sorter);
                }}
                locale={{ emptyText: loading ? 'Đang tải…' : `Chưa có ${config.singular} nào phù hợp.` }}
                pagination={{
                  current: page,
                  pageSize,
                  total: status ? displayCounts[status] : total,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (count, range) => `Hiển thị ${range[0]}-${range[1]} / ${count} bản ghi`,
                  onChange: (nextPage, nextSize) => {
                    setPage(nextPage);
                    setPageSize(nextSize);
                  },
                }}
                onRow={(row) => ({
                  onDoubleClick: () => router.push(`${config.path}/${row.id}`),
                  onContextMenu: (event) => {
                    event.preventDefault();
                    setActionError(null);
                    void openRowMenu(row, anchorFromMouse(event));
                  },
                  tabIndex: 0,
                  onKeyDown: (event) => {
                    if (!isMenuKey(event)) return;
                    event.preventDefault();
                    setActionError(null);
                    void openRowMenu(row, anchorFromElement(event.currentTarget));
                  },
                })}
              />
            </div>
            {data ? (
              <p className="mt-1 text-right text-xs text-slate-500">
                Tổng tiền các phiếu đã duyệt trong bộ lọc: <span className="font-semibold tabular-nums text-slate-800">{money(data.approvedTotal)}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {menu ? (
        <ContextMenu<FinanceMenuActionId>
          anchor={menu.anchor}
          entries={menu.entries}
          label="Thao tác trên phiếu"
          onClose={() => setMenu(null)}
          onPick={pickMenuAction}
        />
      ) : null}
      {pendingAction ? (
        <Popconfirm
          title={`${APPROVE_MENU_LABEL} phiếu này?`}
          description={
            pendingAction.voucher.approvalMode === 'PROCEDURE' && pendingAction.voucher.status === 'PENDING'
              ? 'Phiếu qua quy trình: tiền được ghi sổ khi bước duyệt cuối hoàn tất.'
              : 'Tiền sẽ được ghi vào sổ tài khoản ngay khi duyệt.'
          }
          okText="Duyệt"
          okType="primary"
          onConfirm={() => void runPendingAction()}
          onCancel={() => setPendingAction(null)}
        >
          <div
            ref={pendingTriggerRef}
            style={{ position: 'fixed', left: pendingAction.anchor.x, top: pendingAction.anchor.y, width: 1, height: 1, pointerEvents: 'none' }}
          />
        </Popconfirm>
      ) : null}
    </div>
  );
}
