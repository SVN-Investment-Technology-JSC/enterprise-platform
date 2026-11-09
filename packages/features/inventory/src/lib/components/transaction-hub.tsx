'use client';
import { formatDateTime as formatSharedDateTime, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useInventoryPermissions } from '../inventory-permissions';
import { formatNoteDates, formatNumber } from '../inventory-labels';

import type {
  InventoryLedgerRow,
  InventoryWorkspace,
  ProcedureRequisition,
  ProcedureOption,
} from '../inventory-api';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Eye } from 'lucide-react';
import { MovementForm, type MovementInput } from './movement-form';
import { BatchRequisitionModal } from './batch-requisition-modal';
import { StocktakeHub } from './stocktake-hub';
import { MovementDetailDrawer } from './movement-detail-drawer';
import {
  loadProcedureRequisitions,
  loadProcedureOptions,
  getFulfilledRequisitionCodes,
  markRequisitionFulfilled,
} from '../inventory-api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

const LEDGER_PAGE_SIZE_OPTIONS = [15, 30, 45, 60].map((value) => ({ value: String(value), label: `${value} / trang` }));

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Nhập kho',
  IMPORT: 'Nhập kho',
  ISSUE: 'Xuất kho',
  EXPORT: 'Xuất kho',
  TRANSFER_IN: 'Nhập kho',
  TRANSFER_OUT: 'Xuất kho',
  BORROW: 'Xuất kho',
  RETURN: 'Nhập kho',
  ADJUST: 'Điều chỉnh',
};

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return formatSharedDateTime(value, '—');
}

export function TransactionHub({
  workspace,
  ledger = [],
  busy = false,
  onSubmitMovement,
  onSubmitMovementInDialog,
  onReload,
  onNotice,
  hideSubTabs = false,
  onOpenProfile,
}: {
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  busy?: boolean;
  onSubmitMovement: (input: MovementInput) => Promise<void>;
  /** Như `onSubmitMovement` nhưng từ chối (reject) khi lỗi, để phiếu đang mở hiện lý do. */
  onSubmitMovementInDialog?: (input: MovementInput) => Promise<void>;
  onReload?: () => Promise<void>;
  onNotice?: (message: string) => void;
  hideSubTabs?: boolean;
  onOpenProfile?: (materialCode: string) => void;
}) {
  const [selectedTx, setSelectedTx] = useState<InventoryLedgerRow | null>(null);
  const [popupMovement, setPopupMovement] = useState<{
    open: boolean;
    kind?: 'receipt' | 'issue' | 'transfer';
    initialMaterialCode?: string;
    initialQuantity?: number;
    initialNote?: string;
    title?: string;
    description?: string;
    reqCode?: string;
  }>({
    open: false,
    kind: 'receipt',
  });

  // Batch Requisition Modal state (khi xuất theo bảng kê có nhiều vật tư)
  const [batchReq, setBatchReq] = useState<ProcedureRequisition | null>(null);
  const { canWriteTransactions } = useInventoryPermissions();

  // Procedure Requisitions state
  const [requisitions, setRequisitions] = useState<ProcedureRequisition[]>([]);
  const [_loadingRequisitions, setLoadingRequisitions] = useState(false);
  const [procedures, setProcedures] = useState<ProcedureOption[]>([]);

  const reloadRequisitions = useCallback(async () => {
    setLoadingRequisitions(true);
    try {
      const data = await loadProcedureRequisitions();
      setRequisitions(data);
    } finally {
      setLoadingRequisitions(false);
    }
  }, []);

  useEffect(() => {
    void reloadRequisitions();
    void loadProcedureOptions().then(setProcedures);
  }, [reloadRequisitions]);

  // Lọc các yêu cầu còn hiệu lực: loại trừ yêu cầu đã xuất trong phiên, trong storage, hoặc đã có giao dịch trên sổ cái
  const _visibleRequisitions = useMemo(() => {
    const fulfilledCodes = new Set(getFulfilledRequisitionCodes());
    return requisitions.filter((req) => {
      if (fulfilledCodes.has(req.code)) return false;
      if (req.status === 'completed' || req.status === 'cancelled' || req.status === 'rejected') {
        return false;
      }
      if (ledger && ledger.length > 0) {
        const hasTx = ledger.some(
          (tx) =>
            tx.note &&
            (tx.note.includes(req.code) || (req.csvFileName && tx.note.includes(req.csvFileName))),
        );
        if (hasTx) {
          markRequisitionFulfilled(req.code);
          return false;
        }
      }
      return true;
    });
  }, [requisitions, ledger]);

  const _handleOpenIssueFromRequisition = (req: ProcedureRequisition, lineIndex?: number) => {
    // Nếu bấm nút ở header bảng kê (lineIndex === undefined) và có từ 1 vật tư trở lên:
    // Mở BatchRequisitionModal để xuất toàn bộ các vật tư trong bảng kê!
    if (lineIndex === undefined) {
      if (req.lines.length > 1) {
        setBatchReq(req);
        return;
      }
      // Nếu chỉ có đúng 1 dòng hoặc chưa phân tách lines
      if (req.lines.length === 1) {
        const selectedLine = req.lines[0];
        const initialMaterialCode = selectedLine?.materialCode;
        const initialQuantity = selectedLine?.quantity;
        const matchingStocks = workspace.stock.filter((s) => s.materialCode === initialMaterialCode);
        const totalAvail = matchingStocks.reduce((sum, s) => sum + s.available, 0);
        const hasStock = totalAvail >= (initialQuantity || 0);

        const initialNote = `${hasStock ? 'Xuất' : 'Nhập mua'} vật tư theo bảng kê ${req.csvFileName} cho hồ sơ ${req.code}${req.assetCode ? ` (Thiết bị: ${req.assetCode})` : ''}`;

        setPopupMovement({
          open: true,
          kind: hasStock ? 'issue' : 'receipt',
          initialMaterialCode,
          initialQuantity,
          initialNote,
          reqCode: req.code,
          title: hasStock
            ? `Lập phiếu xuất kho theo yêu cầu ${req.code}`
            : `Lập phiếu mua sắm / nhập bổ sung theo yêu cầu ${req.code}`,
          description: `Khởi tạo từ hồ sơ ${req.code} kèm tệp ${req.csvFileName}.`,
        });
        return;
      }
      // Trường hợp chưa có lines cụ thể
      setBatchReq(req);
      return;
    }

    // Nếu bấm "Xuất món này →" trên từng dòng cụ thể:
    const selectedLine = req.lines[lineIndex];
    const initialMaterialCode = selectedLine?.materialCode;
    const initialQuantity = selectedLine?.quantity;
    const matchingStocks = workspace.stock.filter((s) => s.materialCode === initialMaterialCode);
    const totalAvail = matchingStocks.reduce((sum, s) => sum + s.available, 0);
    const hasStock = totalAvail >= (initialQuantity || 0);

    const initialNote = `${hasStock ? 'Xuất' : 'Nhập mua'} vật tư theo bảng kê ${req.csvFileName} cho hồ sơ ${req.code}${req.assetCode ? ` (Thiết bị: ${req.assetCode})` : ''}`;

    setPopupMovement({
      open: true,
      kind: hasStock ? 'issue' : 'receipt',
      initialMaterialCode,
      initialQuantity,
      initialNote,
      reqCode: req.lines.length === 1 ? req.code : undefined,
      title: hasStock
        ? `Lập phiếu xuất kho cho ${initialMaterialCode}`
        : `Lập phiếu mua sắm / nhập bổ sung cho ${initialMaterialCode}`,
      description: `Khởi tạo từ hồ sơ ${req.code} kèm tệp ${req.csvFileName}.`,
    });
  };

  void _loadingRequisitions;
  void _visibleRequisitions;
  void _handleOpenIssueFromRequisition;
  void procedures;
  void batchReq;

  // Filter state for Ledger view
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('all');
  const [ledgerWarehouseFilter, setLedgerWarehouseFilter] = useState('all');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(15);

  const materialById = useMemo(
    () => new Map(workspace.materials.map((m) => [m.id, m])),
    [workspace.materials],
  );

  const [activeSubTab, setActiveSubTab] = useState<'ledger' | 'stocktake'>('ledger');

  const warehouseById = useMemo(
    () => new Map(workspace.warehouses.map((w) => [w.id, w])),
    [workspace.warehouses],
  );

  // Filtered Ledger
  const filteredLedger = useMemo(() => {
    return ledger.filter((row) => {
      if (ledgerTypeFilter !== 'all') {
        const isReceiptRow =
          row.quantity > 0 ||
          ['IMPORT', 'RECEIPT', 'TRANSFER_IN', 'RETURN'].includes(row.type);
        if (ledgerTypeFilter === 'IMPORT' && !isReceiptRow) {
          return false;
        }
        if (ledgerTypeFilter === 'EXPORT' && isReceiptRow) {
          return false;
        }
      }
      if (ledgerWarehouseFilter !== 'all') {
        if (row.warehouseId !== ledgerWarehouseFilter) {
          return false;
        }
      }
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const mat = materialById.get(row.materialId);
        const matchCode = row.transactionCode?.toLowerCase().includes(q);
        const matchMat =
          mat?.code.toLowerCase().includes(q) || mat?.name.toLowerCase().includes(q);
        if (!matchCode && !matchMat) return false;
      }
      return true;
    });
  }, [ledger, ledgerTypeFilter, ledgerWarehouseFilter, ledgerSearch, materialById]);

  const totalLedgerPages = Math.max(1, Math.ceil(filteredLedger.length / ledgerPageSize));
  const safeLedgerPage = Math.min(Math.max(1, ledgerPage), totalLedgerPages);
  const pagedLedger = useMemo(() => {
    const start = (safeLedgerPage - 1) * ledgerPageSize;
    return filteredLedger.slice(start, start + ledgerPageSize);
  }, [filteredLedger, safeLedgerPage, ledgerPageSize]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header & Sub-Tab Switcher (ẩn khi nhúng vào Sub-tab của Kho) */}
      {!hideSubTabs ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-[0.85rem]">
            <div>
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-[0.65rem] py-[0.2rem] text-[0.8125rem] font-bold text-slate-900">
                Tác nghiệp kho bãi
              </span>
              <h1 className="m-0 text-[1.25rem] font-bold tracking-[-0.02em] text-slate-900">Trung tâm Giao dịch &amp; Nhập xuất Kho</h1>
              <p className="m-0 mt-1 text-[14px] text-slate-500">
                Tra cứu toàn bộ sổ cái lịch sử giao dịch, lập phiếu xuất/nhập và thực hiện kiểm kê kho đối soát số sách.
              </p>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap gap-[0.35rem]">
            <button
              type="button"
              className={cn(
                'cursor-pointer rounded-[0.65rem] border-0 px-[0.95rem] py-2 text-sm font-semibold',
                activeSubTab === 'ledger'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
              onClick={() => setActiveSubTab('ledger')}
            >
              Sổ giao dịch &amp; Xuất nhập
            </button>
            <button
              type="button"
              className={cn(
                'cursor-pointer rounded-[0.65rem] border-0 px-[0.95rem] py-2 text-sm font-semibold',
                activeSubTab === 'stocktake'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
              onClick={() => setActiveSubTab('stocktake')}
            >
              Kiểm kê kho &amp; Đối soát
            </button>
          </div>
        </>
      ) : null}

      {activeSubTab === 'stocktake' ? (
        <StocktakeHub
          workspace={workspace}
          busy={busy}
          onSubmitMovement={onSubmitMovement}
          onNotice={onNotice}
        />
      ) : (
        /* Sổ cái Giao dịch Kho (Stock Ledger) */
        <Card className="gap-0">
          <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">Sổ cái Giao dịch Kho (Stock Ledger)</CardTitle>
            <span className="text-[13px] text-slate-500">
              {filteredLedger.length} giao dịch ghi nhận
            </span>
          </CardHeader>

          {/* Filters */}
          <div className="my-3 flex flex-wrap items-end gap-[0.7rem]">
            <div className="flex min-w-[9rem] flex-col gap-1">
              <Label className="text-xs font-bold text-slate-500">Loại giao dịch</Label>
              <SearchableSelect
                options={[
                  { value: 'all', label: 'Tất cả loại' },
                  { value: 'IMPORT', label: 'Nhập kho' },
                  { value: 'EXPORT', label: 'Xuất kho' },
                ]}
                value={ledgerTypeFilter}
                onChange={(value) => {
                  setLedgerTypeFilter(value || 'all');
                  setLedgerPage(1);
                }}
                clearable={false}
                height={36}
              />
            </div>

            <div className="flex min-w-[9rem] flex-col gap-1">
              <Label className="text-xs font-bold text-slate-500">Kho hàng</Label>
              <SearchableSelect
                options={[
                  { value: 'all', label: 'Tất cả kho' },
                  ...workspace.warehouses.map((w) => ({
                    value: w.id,
                    label: `${w.code} ${w.name ? `— ${w.name}` : ''}`,
                  })),
                ]}
                value={ledgerWarehouseFilter}
                onChange={(value) => {
                  setLedgerWarehouseFilter(value || 'all');
                  setLedgerPage(1);
                }}
                clearable={false}
                height={36}
              />
            </div>

            <div className="flex min-w-[9rem] flex-col gap-1">
              <Label className="text-xs font-bold text-slate-500">Tìm kiếm mã phiếu / vật tư</Label>
              <Input
                type="text"
                placeholder="Gõ mã hoặc tên…"
                value={ledgerSearch}
                onChange={(e) => {
                  setLedgerSearch(e.target.value);
                  setLedgerPage(1);
                }}
              />
            </div>

            {ledgerTypeFilter !== 'all' || ledgerWarehouseFilter !== 'all' || ledgerSearch.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  setLedgerTypeFilter('all');
                  setLedgerWarehouseFilter('all');
                  setLedgerSearch('');
                  setLedgerPage(1);
                }}
              >
                Xoá lọc
              </Button>
            ) : null}
          </div>

          <TableWrap className="overflow-x-auto">
            <Table className="text-[13px]">
              <TableHead>
                <tr>
                  <TableHeaderCell className="p-2 text-left">Mã giao dịch</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-left">Loại</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-left">Vật tư</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-left">Kho hàng</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-center">Số lượng</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-left">Ghi chú / Tham chiếu</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-right">Thời gian</TableHeaderCell>
                  <TableHeaderCell className="w-[90px] p-2 text-center">Thao tác</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {pagedLedger.map((row) => {
                  const material = materialById.get(row.materialId);
                  const warehouse = warehouseById.get(row.warehouseId);
                  const isReceipt = row.quantity > 0;
                  const isSelected = selectedTx?.id === row.id;
                  return (
                    <TableRow
                      key={row.id}
                      className={cn('cursor-pointer', isSelected && 'bg-primary/10 hover:bg-primary/10')}
                      onClick={() => setSelectedTx(row)}
                    >
                      <TableCell className="p-2 font-semibold text-slate-900">
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] font-semibold text-slate-900 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTx(row);
                          }}
                          title="Mở ngăn kéo xem chi tiết phiếu xuất nhập kho"
                        >
                          {row.transactionCode}
                        </button>
                      </TableCell>
                      <TableCell className="p-2">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[12px] font-semibold',
                            isReceipt ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                          )}
                        >
                          {TRANSACTION_TYPE_LABEL[row.type] ?? row.type}
                        </span>
                      </TableCell>
                      <TableCell className="p-2">
                        <div className="flex items-center gap-[6px]">
                          <strong>{material?.code ?? row.materialId}</strong>
                          {material && material.isActive === false ? (
                            <Badge variant="outline" className="h-auto rounded px-[5px] py-px text-[12px] font-medium text-slate-500">
                              Ngừng dùng
                            </Badge>
                          ) : null}
                        </div>
                        {material ? (
                          <div className="text-[12px] text-slate-500">{material.name}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="p-2">{warehouse?.name ?? row.warehouseId}</TableCell>
                      <TableCell
                        className={cn(
                          'p-2 text-center font-bold',
                          isReceipt ? 'text-green-700' : 'text-red-700',
                        )}
                      >
                        {isReceipt ? '+' : ''}
                        {formatNumber(row.quantity)} {material?.unit ?? ''}
                      </TableCell>
                      <TableCell className="p-2 text-[12px] text-slate-500">
                        {row.note ? formatNoteDates(row.note) : '—'}
                      </TableCell>
                      <TableCell className="p-2 text-right text-[12px] text-slate-500">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1 border-primary/30 bg-primary/10 text-slate-900"
                          onClick={() => setSelectedTx(row)}
                          title="Mở ngăn kéo xem chi tiết phiếu xuất nhập"
                        >
                          <Eye size={12} />
                          <span>Chi tiết</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {pagedLedger.length === 0 ? (
                  <TableEmpty colSpan={8}>Không có giao dịch nào khớp bộ lọc.</TableEmpty>
                ) : null}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Pagination Footer */}
          {filteredLedger.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-[13px] text-slate-500">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Trang <strong>{safeLedgerPage}</strong> / <strong>{totalLedgerPages}</strong> ({filteredLedger.length} giao dịch)
                </span>
                <div className="inline-flex items-center gap-[6px] text-[12px] text-slate-500">
                  <span>Hiển thị:</span>
                  <div className="w-[110px]">
                    <SearchableSelect
                      options={LEDGER_PAGE_SIZE_OPTIONS}
                      value={String(ledgerPageSize)}
                      onChange={(value) => {
                        setLedgerPageSize(Number(value) || 15);
                        setLedgerPage(1);
                      }}
                      clearable={false}
                      height={28}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-[6px]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeLedgerPage <= 1}
                  onClick={() => setLedgerPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </Button>
                <span className="text-[12px] font-semibold text-slate-900">
                  {safeLedgerPage} / {totalLedgerPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeLedgerPage >= totalLedgerPages}
                  onClick={() => setLedgerPage((prev) => Math.min(totalLedgerPages, prev + 1))}
                >
                  Sau →
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* Popup Form Xuất / Nhập Kho (Dialog đơn lẻ) */}
      {popupMovement.open && canWriteTransactions ? (
        <MovementForm
          workspace={workspace}
          initialKind={popupMovement.kind ?? 'receipt'}
          initialMaterialCode={popupMovement.initialMaterialCode}
          initialQuantity={popupMovement.initialQuantity}
          initialNote={popupMovement.initialNote}
          procedures={procedures}
          title={popupMovement.title}
          description={popupMovement.description}
          isDialog={true}
          busy={busy}
          onCancel={() => setPopupMovement({ open: false })}
          onSubmit={async (input) => {
            await (onSubmitMovementInDialog ?? onSubmitMovement)(input);
            if (popupMovement.reqCode) {
              const code = popupMovement.reqCode;
              markRequisitionFulfilled(code);
              setRequisitions((prev) => prev.filter((r) => r.code !== code));
            }
            setPopupMovement({ open: false });
          }}
        />
      ) : null}

      {/* Modal Xuất kho hàng loạt theo Bảng kê (Batch Requisition) */}
      {batchReq && canWriteTransactions ? (
        <BatchRequisitionModal
          req={batchReq}
          workspace={workspace}
          busy={busy}
          onClose={() => setBatchReq(null)}
          onSuccess={async (message, fulfilledCode) => {
            const code = fulfilledCode || batchReq.code;
            markRequisitionFulfilled(code);
            setBatchReq(null);
            setRequisitions((prev) => prev.filter((r) => r.code !== code && r.id !== batchReq.id));
            if (onNotice) onNotice(message);
            if (onReload) await onReload();
          }}
        />
      ) : null}

      {/* Drawer Xem Chi Tiết Giao Dịch Xuất Nhập Kho */}
      <MovementDetailDrawer
        transaction={selectedTx}
        workspace={workspace}
        ledger={ledger}
        onClose={() => setSelectedTx(null)}
        onSelectTransaction={(tx) => setSelectedTx(tx)}
      />
    </div>
  );
}
