import type { Material } from '@enterprise-platform/contracts-inventory';
import {
  resolveDashboardCards,
  type DashboardCardSize,
} from '@enterprise-platform/feature-module-shell';
import { formatDateTime as formatSharedDateTime, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import type {
  InventoryLedgerRow,
  InventoryWorkspace,
} from '../inventory-api';
import {
  INVENTORY_DASHBOARD_CARDS,
  type InventoryDashboardData,
} from '../inventory-dashboard.cards';
import { formatNumber } from '../inventory-labels';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../ui/cn';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

const PAGE_SIZE_OPTIONS = [5, 10, 15, 30].map((value) => ({ value: String(value), label: `${value} / trang` }));

const SIZE_CLASS: Readonly<Record<DashboardCardSize, string>> = {
  sm: 'col-span-1',
  md: 'col-span-1 min-[48.01rem]:col-span-2',
  lg: 'col-span-1 min-[48.01rem]:col-span-2 min-[72.01rem]:col-span-3',
  xl: 'col-span-1 min-[48.01rem]:col-span-2 min-[72.01rem]:col-span-4',
};

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Nhập kho',
  IMPORT: 'Nhập kho',
  ISSUE: 'Xuất kho',
  EXPORT: 'Xuất kho',
  TRANSFER_IN: 'Nhập kho',
  TRANSFER_OUT: 'Xuất kho',
  BORROW: 'Mượn',
  RETURN: 'Trả',
  ADJUST: 'Điều chỉnh',
};

function formatDateTime(value: string): string {
  if (!value) return '—';
  return formatSharedDateTime(value, '—');
}

export function InventoryDashboard({
  workspace,
  ledger = [],
  materialByCode,
  cardSelection,
  onNavigate,
  onOpenMovement: _onOpenMovement,
}: {
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  materialByCode?: ReadonlyMap<string, Material>;
  cardSelection?: readonly string[];
  onNavigate: (tab: 'stock' | 'assets' | 'transactions' | 'settings') => void;
  onOpenMovement?: (kind?: 'receipt' | 'issue' | 'transfer') => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const resolvedMaterialByCode = useMemo(() => {
    if (materialByCode) return materialByCode;
    const map = new Map<string, Material>();
    for (const mat of workspace.materials) map.set(mat.code, mat);
    return map;
  }, [materialByCode, workspace.materials]);

  const dashboardData: InventoryDashboardData = useMemo(
    () => ({
      workspace,
      ledger,
      materialByCode: resolvedMaterialByCode,
    }),
    [workspace, ledger, resolvedMaterialByCode],
  );

  // Phân giải danh sách thẻ hiển thị dựa trên cấu hình cardSelection từ Settings
  const activeCards = useMemo(() => {
    if (cardSelection !== undefined) {
      // Khi người dùng đã có cấu hình rõ ràng (kể cả mảng rỗng [] nếu bỏ tick hết)
      const byId = new Map(INVENTORY_DASHBOARD_CARDS.map((card) => [card.id, card]));
      return cardSelection
        .map((id) => byId.get(id))
        .filter((card): card is (typeof INVENTORY_DASHBOARD_CARDS)[number] => card !== undefined);
    }
    // Mặc định ban đầu nếu chưa tải settings
    return resolveDashboardCards(INVENTORY_DASHBOARD_CARDS, []);
  }, [cardSelection]);

  const materialById = useMemo(
    () => new Map(workspace.materials.map((m) => [m.id, m])),
    [workspace.materials],
  );

  const totalPages = Math.max(1, Math.ceil(ledger.length / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const pagedLedger = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return ledger.slice(start, start + pageSize);
  }, [ledger, safeCurrentPage, pageSize]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner & Quick Actions */}
      <div className="mb-[1.1rem] flex flex-wrap items-center justify-between gap-[0.85rem]">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-[0.65rem] py-[0.2rem] text-[0.8125rem] font-bold text-slate-900">
            Trung tâm Điều hành Kho &amp; Thiết bị
          </span>
          <h1 className="m-0 text-[1.25rem] font-bold tracking-[-0.02em] text-slate-900">Tổng quan Tài sản &amp; Tồn kho</h1>
          <p className="m-0 mt-1 text-[14px] text-slate-500">
            Theo dõi tổng lượng tồn kho, cảnh báo định mức Min/Max và tiến độ luân chuyển thiết bị.
          </p>
        </div>
      </div>

      {/* Dynamic KPI / Chart Cards Section */}
      {activeCards.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 min-[48.01rem]:grid-cols-2 min-[72.01rem]:grid-cols-4">
          {activeCards.map((card) => (
            <Card key={card.id} className={cn('gap-0 p-4', SIZE_CLASS[card.size])}>
              <h2 className="m-0 mb-[10px] text-[14px] font-semibold text-slate-500">
                {card.title}
              </h2>
              {card.render(dashboardData)}
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="m-0 mb-2 text-[14px] text-slate-500">
            Chưa có thẻ tổng quan nào được chọn hiển thị.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => onNavigate('settings')}>
            Đi đến Cài đặt thẻ →
          </Button>
        </div>
      )}

      {/* Master Detail 2 Panels Grid */}
      <div className="grid gap-4 [grid-template-columns:minmax(320px,1fr)_minmax(420px,1.4fr)]">
        {/* Left Panel: Warehouse Distribution */}
        <Card className="gap-0">
          <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">Phân bổ theo Kho lưu trữ</CardTitle>
            <span className="text-[13px] text-slate-500">
              {workspace.warehouses.length} kho
            </span>
          </CardHeader>

          <div className="mt-4 flex flex-col gap-[10px]">
            {workspace.warehouses.map((wh) => {
              const stockInWh = workspace.stock.filter((s) => s.warehouseId === wh.id);
              const totalItems = stockInWh.reduce((sum, s) => sum + s.quantity, 0);
              return (
                <div
                  key={wh.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-[10px]"
                >
                  <div>
                    <strong className="text-[14px] text-slate-900">{wh.name}</strong>
                    <div className="text-[12px] text-slate-500">Mã kho: {wh.code}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-bold text-slate-900">
                      {formatNumber(totalItems)}
                    </div>
                    <small className="text-[12px] text-slate-500">
                      {stockInWh.length} danh mục
                    </small>
                  </div>
                </div>
              );
            })}
            {workspace.warehouses.length === 0 ? (
              <p className="text-[13px] text-slate-500">Chưa có kho nào được thiết lập.</p>
            ) : null}
          </div>
        </Card>

        {/* Right Panel: Recent Transactions */}
        <Card className="gap-0">
          <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">Giao dịch Kho gần đây</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => onNavigate('transactions')}>
              Xem tất cả →
            </Button>
          </CardHeader>

          <TableWrap className="mt-3 flex-1 overflow-x-auto">
            <Table className="text-[13px]">
              <TableHead>
                <tr>
                  <TableHeaderCell className="p-2 text-left">Mã phiếu</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-left">Loại giao dịch</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-left">Vật tư</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-center">Số lượng</TableHeaderCell>
                  <TableHeaderCell className="p-2 text-right">Thời gian</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {pagedLedger.length === 0 ? (
                  <TableEmpty colSpan={5}>Chưa có giao dịch kho nào phát sinh trong sổ cái.</TableEmpty>
                ) : (
                  pagedLedger.map((row) => {
                    const material = materialById.get(row.materialId);
                    const isReceipt = row.quantity > 0;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="p-2 font-semibold text-slate-900">
                          {row.transactionCode}
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
                            <div className="text-[12px] text-slate-500">
                              {material.name}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'p-2 text-center font-bold',
                            isReceipt ? 'text-green-700' : 'text-red-700',
                          )}
                        >
                          {isReceipt ? '+' : ''}
                          {formatNumber(row.quantity)} {material?.unit ?? ''}
                        </TableCell>
                        <TableCell className="p-2 text-right text-[12px] text-slate-500">
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Pagination Footer */}
          {ledger.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-[13px] text-slate-500">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Trang <strong>{safeCurrentPage}</strong> / <strong>{totalPages}</strong> ({ledger.length} giao dịch)
                </span>
                <div className="inline-flex items-center gap-[6px] text-[12px] text-slate-500">
                  <span>Hiển thị:</span>
                  <div className="w-[110px]">
                    <SearchableSelect
                      options={PAGE_SIZE_OPTIONS}
                      value={String(pageSize)}
                      onChange={(value) => {
                        setPageSize(Number(value) || 5);
                        setCurrentPage(1);
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
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </Button>
                <span className="text-[12px] font-semibold text-slate-900">
                  {safeCurrentPage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Sau →
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
