'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCheck, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, Search } from 'lucide-react';
import { Table } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput, MonthPickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { ContextMenu, anchorFromElement, anchorFromMouse, isMenuKey, type MenuAnchor, type MenuEntry } from '@enterprise-platform/feature-shared';
import {
  FINANCE_VOUCHER_STATUSES,
  FINANCE_VOUCHER_STATUS_LABELS,
  financeAllocationLabel,
  type FinanceAccount,
  type FinanceApprovalMode,
  type FinanceBulkApproveResult,
  type FinanceListColumns,
  type FinanceCatalogs,
  type FinanceVoucher,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceVoucherStatus,
  type FinanceVoucherSummary,
} from '@enterprise-platform/contracts-finance';
import { financeDelete, financeErrorMessage, financeFetch, financePost, financePut, toQuery } from '../finance-api';
import { buildCsv, downloadCsv } from '../finance-csv';
import { dateVn, isMonth, money, monthLabel, monthRange, newFinanceIdempotencyKey, shiftMonth, todayVn, voucherCsvRows } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { useFinancePermissions } from '../finance-permissions';
import { buildVoucherMenu, type FinanceMenuActionId } from '../voucher-context-menu';
import { visibleVoucherColumns, voucherColumnCatalog, voucherColumnWidths, type VoucherColumnKey } from '../voucher-list-columns';
import { loadWorkspaceProjects, projectLabel, type WorkspaceProjectOption } from '../workspace-links';
import { Button } from '../ui/button';
import { ColumnPicker } from '../ui/column-picker';
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

export default function VoucherListScreen({ kind }: { kind: FinanceVoucherKind }) {
  const config = FINANCE_KIND_CONFIG[kind];
  const router = useRouter();
  const params = useSearchParams();
  const { capabilities } = useFinancePermissions();
  const kindCaps = capabilities?.[kind === 'RECEIPT' ? 'receipt' : kind === 'PAYMENT' ? 'payment' : 'transfer'];

  const [status, setStatus] = useState<FinanceVoucherStatus | ''>('');
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

  // Menu chuột phải: Sửa, Duyệt, Huỷ, Xoá, Nhân bản — thao tác nhanh không cần mở từng phiếu.
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; voucherId: string; entries: MenuEntry<FinanceMenuActionId>[]; approvalMode?: FinanceApprovalMode } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: 'approve' | 'cancel' | 'delete'; voucherId: string; anchor: MenuAnchor; approvalMode?: FinanceApprovalMode } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingTriggerRef = useRef<HTMLDivElement>(null);

  // Duyệt hàng loạt: chỉ phiếu đang chờ duyệt trực tiếp mới chọn được (phiếu qua quy trình duyệt trong quy trình).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

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
      setMenu((current) => (current?.voucherId === row.id ? { anchor, voucherId: row.id, entries: buildVoucherMenu(voucher, Boolean(kindCaps?.create)), approvalMode: voucher.approvalMode } : current));
    } catch (e) {
      setMenu(null);
      setActionError(financeErrorMessage(e, 'Không mở được menu thao tác.'));
    }
  }

  function pickMenuAction(action: FinanceMenuActionId) {
    if (!menu) return;
    const { voucherId, anchor, approvalMode } = menu;
    setMenu(null);
    if (action === 'edit') router.push(`${config.path}/${voucherId}/edit`);
    else if (action === 'duplicate') router.push(`${config.path}/new?from=${voucherId}`);
    else setPendingAction({ action, voucherId, anchor, approvalMode });
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
        `/vouchers${toQuery({ kind, status, scope: scope === 'all' || scope === 'procedure' ? undefined : scope, source: scope === 'procedure' ? 'procedure' : undefined, search: debouncedSearch, accountId, reasonId, projectId, from: range.from, to: range.to, page, pageSize })}`,
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
  }, [kind, status, scope, debouncedSearch, accountId, reasonId, projectId, range.from, range.to, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runPendingAction(reason?: string) {
    if (!pendingAction) return;
    const { action, voucherId, approvalMode } = pendingAction;
    try {
      if (action === 'delete') await financeDelete(`/vouchers/${voucherId}`);
      else if (action === 'approve')
        await (approvalMode === 'PROCEDURE'
          ? financePost(`/vouchers/${voucherId}/procedure-action`, { action: 'approve', idempotencyKey: newFinanceIdempotencyKey() })
          : financePost(`/vouchers/${voucherId}/approve`, { note: undefined }));
      else await financePost(`/vouchers/${voucherId}/cancel`, { note: reason });
      toast.success(action === 'delete' ? 'Đã xoá phiếu' : action === 'approve' ? 'Đã duyệt và ghi sổ' : 'Đã huỷ phiếu');
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
    try {
      const result = await financePost<FinanceBulkApproveResult>('/vouchers/bulk-approve', { ids: selectedIds });
      if (result.approved.length) toast.success(`Đã duyệt và ghi sổ ${result.approved.length} phiếu`);
      if (result.failed.length)
        setActionError(
          `${result.failed.length} phiếu chưa duyệt được:\n${result.failed.map((item) => `${item.code ?? item.id}: ${item.message}`).join('\n')}`,
        );
      setSelectedIds(result.failed.map((item) => item.id));
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
  const changeMonth = (next: string) => {
    setMonth(next);
    setPage(1);
  };
  const summary = data
    ? [
        { id: 'total', label: 'Tổng số phiếu', count: total, amount: null as number | null },
        { id: 'approved', label: 'Đã duyệt', count: data.statusCounts.APPROVED, amount: data.statusAmounts.APPROVED },
        { id: 'pending', label: 'Chờ duyệt', count: data.statusCounts.PENDING, amount: data.statusAmounts.PENDING },
        { id: 'open', label: 'Nháp / Bị từ chối', count: data.statusCounts.DRAFT + data.statusCounts.REJECTED, amount: data.statusAmounts.DRAFT + data.statusAmounts.REJECTED },
      ]
    : [];

  const columnCatalog = voucherColumnCatalog(kind, config);
  const shownColumns = visibleVoucherColumns(columnCatalog, savedColumns);
  const widths = voucherColumnWidths(shownColumns);
  const renderers: Record<VoucherColumnKey, ColumnType<FinanceVoucherSummary>> = {
    creator: { dataIndex: 'createdByName', align: 'center', render: (name: string | null) => <Avatar name={name} /> },
    code: {
      dataIndex: 'code',
      render: (code: string, row) => (
        <a
          href={`${config.path}/${row.id}`}
          // Phiếu chưa ghi sổ chỉ có mã nháp: hiện nhạt hơn để phân biệt với mã chính thức.
          className={row.officialCode ? 'font-medium text-link hover:underline' : 'font-medium text-slate-500 hover:text-link hover:underline'}
          onClick={(event) => {
            event.preventDefault();
            router.push(`${config.path}/${row.id}`);
          }}
        >
          {code}
          {row.sourceCode ? <span className="block text-xs font-normal text-slate-500">Từ hồ sơ {row.sourceCode}</span> : null}
        </a>
      ),
    },
    date: { dataIndex: 'voucherDate', render: (value: string) => dateVn(value) },
    content: { dataIndex: 'content', ellipsis: true },
    accounts: { ellipsis: true, render: (_: unknown, row) => `${row.accountName ?? ''} → ${row.destAccountName ?? ''}` },
    reason: { dataIndex: 'reasonName', ellipsis: true },
    account: { dataIndex: 'accountName', ellipsis: true },
    counterparty: { dataIndex: 'counterpartyGroupName', ellipsis: true },
    person: { dataIndex: 'counterpartyName', ellipsis: true },
    allocation: { ellipsis: true, render: (_: unknown, row) => (row.allocation ? financeAllocationLabel(row.allocation) : '') },
    project: { ellipsis: true, render: (_: unknown, row) => (row.allocation ? `${row.allocation.projectCode} - ${row.allocation.projectName}` : '') },
    amount: { dataIndex: 'totalAmount', align: 'right', render: (value: number) => <span className="tabular-nums font-medium">{money(value)}</span> },
    status: { dataIndex: 'status', render: (value: FinanceVoucherStatus) => <StatusBadge status={value} /> },
  };
  const columns: ColumnType<FinanceVoucherSummary>[] = shownColumns.map((column) => ({
    ...renderers[column.key],
    key: column.key,
    title: column.label,
    width: widths[column.key],
  }));
  const canBulkApprove = Boolean(kindCaps?.approve);
  const selectable = (row: FinanceVoucherSummary) => row.status === 'PENDING' && row.approvalMode === 'DIRECT';

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
                className={cn('px-3 py-1 text-sm', month ? 'bg-accent-soft font-semibold text-accent-text' : 'text-slate-600 hover:bg-slate-50')}
              >
                Theo tháng
              </button>
              <button
                type="button"
                aria-pressed={!month}
                onClick={() => changeMonth('')}
                className={cn('border-l border-slate-200 px-3 py-1 text-sm', !month ? 'bg-accent-soft font-semibold text-accent-text' : 'text-slate-600 hover:bg-slate-50')}
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
              <span className="text-sm text-slate-500">Toàn bộ thời gian; lọc theo ngày ở bên dưới.</span>
            )}
          </div>

          {data ? (
            <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Tổng kết kỳ">
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
            {[{ id: '' as const, label: 'Tất cả', count: total }, ...FINANCE_VOUCHER_STATUSES.map((s) => ({ id: s, label: FINANCE_VOUCHER_STATUS_LABELS[s], count: data?.statusCounts[s] ?? 0 }))].map((tab) => (
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
                  status === tab.id ? 'border-accent-strong font-semibold text-accent-text' : 'border-transparent text-slate-600 hover:text-slate-900',
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
                    className={cn('rounded-full border px-3 py-1 text-xs', scope === s.id ? 'border-accent-strong bg-accent-soft text-accent-text' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                  >
                    {s.label}
                  </button>
                ))}
            </div>
          </div>

          <div className="p-3">
            <ErrorBanner message={error ?? actionError} />
            {canBulkApprove && selectedIds.length ? (
              <div role="region" aria-label="Duyệt hàng loạt" className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-accent-soft px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">Đã chọn {selectedIds.length} phiếu chờ duyệt</span>
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
                      getCheckboxProps: (row) => ({
                        disabled: !selectable(row),
                        title: selectable(row) ? undefined : 'Chỉ chọn được phiếu đang chờ duyệt trực tiếp',
                        'aria-label': `Chọn phiếu ${row.code}`,
                      }),
                    }
                  : undefined
              }
              // Bố cục cố định theo phần trăm: dữ liệu ít nên vừa một bề ngang bảng, không cuộn ngang.
              tableLayout="fixed"
              locale={{ emptyText: loading ? 'Đang tải…' : `Chưa có ${config.singular} nào phù hợp.` }}
              pagination={{
                current: page,
                pageSize,
                total: status ? (data?.statusCounts[status] ?? 0) : total,
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
          title={pendingAction.action === 'delete' ? 'Xoá phiếu?' : pendingAction.action === 'approve' ? 'Duyệt và ghi sổ phiếu này?' : 'Huỷ phiếu'}
          description={
            pendingAction.action === 'delete'
              ? 'Phiếu chưa ghi sổ nên xoá được; bị xoá hẳn và không khôi phục được.'
              : pendingAction.action === 'approve'
                ? pendingAction.approvalMode === 'PROCEDURE'
                  ? 'Phiếu qua quy trình: tiền được ghi sổ khi bước duyệt cuối hoàn tất.'
                  : 'Tiền sẽ được ghi vào sổ tài khoản ngay khi duyệt.'
                : undefined
          }
          reasonRequired={pendingAction.action === 'cancel' || undefined}
          reasonLabel={pendingAction.action === 'cancel' ? 'Lý do huỷ' : undefined}
          reasonPlaceholder={pendingAction.action === 'cancel' ? 'Nhập lý do huỷ phiếu' : undefined}
          okText={pendingAction.action === 'delete' ? 'Xoá' : pendingAction.action === 'approve' ? 'Duyệt' : 'Huỷ phiếu'}
          okType={pendingAction.action === 'approve' ? 'primary' : undefined}
          onConfirm={(reason) => void runPendingAction(reason)}
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
