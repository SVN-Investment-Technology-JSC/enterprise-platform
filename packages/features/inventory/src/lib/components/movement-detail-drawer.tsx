'use client';

import type {
  Material,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import {
  X,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowUpDown,
  Copy,
  Check,
  Package,
  Warehouse as WarehouseIcon,
  FileText,
  Clock,
  MapPin,
  Calendar,
  User,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InventoryLedgerRow, InventoryWorkspace } from '../inventory-api';
import {
  formatDateTime,
  formatNoteDates,
  formatNumber,
  referenceLabel,
} from '../inventory-labels';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/table';
import { useUserLabel } from '../user-names';

/** Màu theo chiều biến động: nhập (xanh lá), xuất (đỏ), điều chỉnh (hổ phách). */
const MOVEMENT_TONE = {
  in: {
    hero: 'border-green-200 bg-[linear-gradient(135deg,#f0fdf4_0%,#ffffff_100%)]',
    kind: 'text-green-700',
    circle: 'bg-green-100 text-green-700',
    amount: 'text-green-700',
    badge: 'border-green-200 bg-green-100 text-green-700',
  },
  out: {
    hero: 'border-red-200 bg-[linear-gradient(135deg,#fef2f2_0%,#ffffff_100%)]',
    kind: 'text-red-700',
    circle: 'bg-red-100 text-red-700',
    amount: 'text-red-700',
    badge: 'border-red-200 bg-red-100 text-red-700',
  },
  adjust: {
    hero: 'border-amber-200 bg-[linear-gradient(135deg,#fffbeb_0%,#ffffff_100%)]',
    kind: 'text-amber-700',
    circle: 'bg-amber-100 text-amber-700',
    amount: 'text-amber-700',
    badge: 'border-amber-200 bg-amber-100 text-amber-700',
  },
} as const;

const TRANSACTION_KIND_MAP: Readonly<
  Record<string, { label: string; kind: 'in' | 'out' | 'adjust' }>
> = {
  RECEIPT: { label: 'Nhập kho', kind: 'in' },
  IMPORT: { label: 'Nhập kho', kind: 'in' },
  ISSUE: { label: 'Xuất kho', kind: 'out' },
  EXPORT: { label: 'Xuất kho', kind: 'out' },
  TRANSFER_IN: { label: 'Nhập chuyển kho', kind: 'in' },
  TRANSFER_OUT: { label: 'Xuất chuyển kho', kind: 'out' },
  BORROW: { label: 'Xuất mượn', kind: 'out' },
  RETURN: { label: 'Nhập hoàn kho / Trả lại', kind: 'in' },
  ADJUST: { label: 'Điều chỉnh kiểm kê', kind: 'adjust' },
};

const COUNTERPARTY_TYPE_LABEL: Readonly<Record<string, string>> = {
  SUPPLIER: 'Nhà cung cấp',
  DEPARTMENT: 'Phòng ban',
  CUSTOMER: 'Khách hàng',
  PROJECT: 'Dự án / Công trình',
  ASSET: 'Thiết bị / Tài sản',
  WAREHOUSE: 'Kho',
};

export interface MovementDetailDrawerProps {
  transaction: InventoryLedgerRow | null;
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  onClose: () => void;
  onSelectTransaction?: (transaction: InventoryLedgerRow) => void;
}

export function MovementDetailDrawer({
  transaction,
  workspace,
  ledger = [],
  onClose,
  onSelectTransaction,
}: MovementDetailDrawerProps) {
  const [copied, setCopied] = useState(false);
  const userName = useUserLabel();

  // Tìm thông tin vật tư và kho liên quan
  const material = useMemo<Material | undefined>(() => {
    if (!transaction) return undefined;
    return (
      workspace.materials.find((m) => m.id === transaction.materialId) ??
      workspace.materials.find((m) => m.code === transaction.materialId)
    );
  }, [transaction, workspace.materials]);

  const warehouse = useMemo<Warehouse | undefined>(() => {
    if (!transaction) return undefined;
    return (
      workspace.warehouses.find((w) => w.id === transaction.warehouseId) ??
      workspace.warehouses.find((w) => w.code === transaction.warehouseId)
    );
  }, [transaction, workspace.warehouses]);

  // Tìm tồn kho hiện tại của vật tư tại kho này
  const currentStock = useMemo(() => {
    if (!transaction) return undefined;
    return workspace.stock.find(
      (s) =>
        (s.warehouseId === transaction.warehouseId ||
          s.warehouseCode === warehouse?.code) &&
        (s.materialId === transaction.materialId ||
          s.materialCode === material?.code),
    );
  }, [workspace.stock, transaction, warehouse, material]);

  // Tìm 5 giao dịch gần đây của cùng vật tư này trên sổ cái
  const recentMovements = useMemo(() => {
    if (!transaction || !ledger || ledger.length === 0) return [];
    return ledger
      .filter(
        (row) =>
          row.materialId === transaction.materialId &&
          row.id !== transaction.id,
      )
      .slice(0, 5);
  }, [transaction, ledger]);

  if (!transaction) return null;

  const isReceipt =
    transaction.quantity > 0 ||
    ['IMPORT', 'RECEIPT', 'TRANSFER_IN', 'RETURN'].includes(transaction.type);
  const isAdjust = transaction.type === 'ADJUST';
  const movementKind = isAdjust ? 'adjust' : isReceipt ? 'in' : 'out';

  const typeConfig = TRANSACTION_KIND_MAP[transaction.type] ?? {
    label: isAdjust ? 'Điều chỉnh' : isReceipt ? 'Nhập kho' : 'Xuất kho',
    kind: movementKind,
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(transaction.transactionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Bỏ qua nếu clipboard không truy cập được
    }
  };

  // Kho đối ứng của chuyển kho: tra theo id, không có thì dùng tên đã lưu cùng dòng sổ.
  const counterpartyWarehouse = transaction.counterpartyWarehouseId
    ? workspace.warehouses.find(
        (w) => w.id === transaction.counterpartyWarehouseId,
      )
    : undefined;
  const counterpartyName = counterpartyWarehouse
    ? `${counterpartyWarehouse.name} (${counterpartyWarehouse.code})`
    : transaction.counterpartyName;
  const hasCounterparty = Boolean(
    transaction.counterpartyType ||
      counterpartyName ||
      transaction.documentNumber,
  );
  const counterpartyHeading = isAdjust
    ? 'Nơi phát sinh'
    : isReceipt
      ? 'Nơi nhập — nhận hàng từ'
      : 'Nơi xuất — hàng đi đến';

  const unitCost = Number(transaction.unitCost) || 0;
  const quantity = transaction.quantity;
  const totalValue = unitCost > 0 ? Math.abs(quantity) * unitCost : 0;

  return (
    <Sheet onEscape={onClose} onBackdropClick={onClose}>
      <SheetContent
        className="max-w-[640px]"
        aria-label="Chi tiết phiếu xuất nhập kho"
      >
        <SheetHeader>
          <div className="flex flex-col gap-[0.3rem] flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[0.75rem] font-bold uppercase tracking-[0.04em] text-blue-600">
              <Receipt size={14} strokeWidth={2.2} />
              <span>Chứng từ kho · Sổ cái xuất nhập</span>
            </div>

            <div
              className="flex items-center gap-2 flex-wrap"
            >
              <SheetTitle className="m-0 text-[1.25rem] font-bold text-slate-900 leading-[1.3]">
                {transaction.transactionCode}
              </SheetTitle>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className={
                  copied
                    ? 'border-green-300 bg-green-100 text-green-700 hover:bg-green-100'
                    : 'bg-slate-100 text-slate-600'
                }
                onClick={handleCopyCode}
                title="Sao chép mã giao dịch"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
              </Button>
            </div>

            <div className="m-0 flex flex-wrap items-center gap-2 text-sm text-slate-500 [&_code]:rounded-sm [&_code]:bg-blue-50 [&_code]:px-[0.35rem] [&_code]:py-[0.1rem] [&_code]:font-mono [&_code]:font-bold [&_code]:text-blue-800">
              {/* Badge Loại giao dịch */}
              <Badge
                variant="outline"
                className={cn('h-auto px-2 py-0.5 text-[12px] font-semibold', MOVEMENT_TONE[movementKind].badge)}
              >
                {typeConfig.label}
              </Badge>

              <span>·</span>

              {/* Badge Trạng thái dòng công việc */}
              <span
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-green-700"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full bg-green-600"
                />
                {transaction.workflowStatus === 'APPROVED'
                  ? 'Đã ghi nhận'
                  : 'Hoàn tất'}
              </span>

              <span>·</span>

              {/* Thời gian */}
              <span className="text-[12px] text-slate-500">
                {formatDateTime(transaction.createdAt)}
              </span>
            </div>
          </div>

          {/* Nút Đóng X */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-slate-400 hover:text-slate-700"
            onClick={onClose}
            title="Đóng ngăn kéo (Phím ESC)"
            aria-label="Đóng"
          >
            <X size={16} />
          </Button>
        </SheetHeader>

        {/* 2. Body cuộn nội bộ độc lập */}
        <SheetBody className="bg-white p-0">
          <div className="flex-1 overflow-y-auto py-5 px-[1.6rem] flex flex-col gap-5">
            {/* Hero Banner: Tổng quan biến động số lượng */}
            <div
              className={cn(
                'flex flex-col gap-[0.85rem] rounded-[10px] border px-5 py-[1.1rem] transition-all duration-200',
                MOVEMENT_TONE[movementKind].hero,
              )}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div
                  className={cn(
                    'inline-flex items-center gap-2 text-[0.875rem] font-bold',
                    MOVEMENT_TONE[movementKind].kind,
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      MOVEMENT_TONE[movementKind].circle,
                    )}
                  >
                    {movementKind === 'in' ? (
                      <ArrowDownLeft size={18} strokeWidth={2.4} />
                    ) : movementKind === 'out' ? (
                      <ArrowUpRight size={18} strokeWidth={2.4} />
                    ) : (
                      <ArrowUpDown size={18} strokeWidth={2.4} />
                    )}
                  </span>
                  <span>
                    {movementKind === 'in'
                      ? 'Nhập hàng vào kho'
                      : movementKind === 'out'
                        ? 'Xuất hàng khỏi kho'
                        : 'Điều chỉnh lượng tồn'}
                  </span>
                </div>

                {/* Con số biến động lớn */}
                <div
                  className={cn(
                    'text-[1.6rem] font-extrabold leading-[1.2] tracking-[-0.02em]',
                    MOVEMENT_TONE[movementKind].amount,
                  )}
                >
                  {isReceipt ? '+' : ''}
                  {formatNumber(quantity)} {material?.unit ?? ''}
                </div>
              </div>

              {/* Chi tiết giá trị và kho */}
              <div className="grid grid-cols-[repeat(3,_minmax(0,_1fr))] gap-3 pt-3 border-t border-dashed border-t-slate-200">
                <div className="flex flex-col gap-[0.2rem]">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Đơn giá ghi sổ
                  </span>
                  <span className="text-[0.95rem] font-bold text-slate-800">
                    {unitCost > 0
                      ? `${formatNumber(unitCost)} ₫`
                      : 'Chưa ghi nhận'}
                  </span>
                </div>

                <div className="flex flex-col gap-[0.2rem]">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Tổng giá trị
                  </span>
                  <span className="text-[0.95rem] font-bold text-slate-800">
                    {totalValue > 0 ? `${formatNumber(totalValue)} ₫` : '—'}
                  </span>
                </div>

                <div className="flex flex-col gap-[0.2rem]">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Kho ghi nhận
                  </span>
                  <span
                    className="text-[0.95rem] font-bold text-slate-800"
                    title={warehouse?.name}
                  >
                    {warehouse?.code ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 1: Thông tin vật tư chi tiết */}
            <div className="bg-white border border-slate-200 rounded-lg py-4 px-5 flex flex-col gap-[0.85rem]">
              <h4 className="m-0 text-[0.875rem] font-bold text-slate-700 flex items-center gap-2">
                <Package size={16} color="#2563eb" />
                <span>Vật tư / Thiết bị liên quan</span>
              </h4>

              <div className="grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-[0.85rem]">
                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">Tên vật tư</span>
                  <span
                    className="text-[0.875rem] font-semibold text-slate-900 break-words text-slate-900"
                    
                  >
                    {material?.name ?? 'Chưa xác định tên'}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Mã định danh (Code)
                  </span>
                  <div
                    className="flex items-center gap-1.5"
                  >
                    <code
                      className="font-mono font-bold text-blue-800 bg-blue-50 py-0.5 px-1.5 rounded-sm"
                    >
                      {material?.code ?? transaction.materialId}
                    </code>
                    {material && material.isActive === false ? (
                      <span
                        className="text-[11px] py-[1px] px-[5px] rounded-sm bg-slate-100 text-slate-500 border border-slate-300 font-medium"
                      >
                        Ngừng dùng
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">Đơn vị tính</span>
                  <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                    {material?.unit ?? '—'}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">Phân loại</span>
                  <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                    {material?.tradeCategory || 'Chưa phân loại'}
                  </span>
                </div>

                {transaction.serialNumber ? (
                  <div
                    className="flex flex-col gap-1 col-[span_2]"
                    
                  >
                    <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                      Số Sê-ri định danh (SN)
                    </span>
                    <code
                      className="font-mono font-bold text-violet-600 bg-violet-50 py-0.5 px-1.5 rounded-sm"
                    >
                      {transaction.serialNumber}
                    </code>
                  </div>
                ) : null}
              </div>

              {/* Khối thống kê tồn kho tức thời tại kho này */}
              <div className="mt-1">
                <span
                  className="text-[12px] font-semibold text-slate-600 block mb-1.5"
                >
                  Tình trạng tồn kho hiện tại tại kho {warehouse?.code ?? ''}:
                </span>
                <div className="grid grid-cols-[repeat(3,_minmax(0,_1fr))] gap-[0.65rem] py-3 px-[0.85rem] bg-slate-50 border border-slate-200 rounded-md">
                  <div className="flex flex-col gap-[0.2rem]">
                    <span className="text-[0.75rem] text-slate-500 font-medium">
                      Tồn thực tế
                    </span>
                    <span className="text-[1rem] font-bold text-slate-900">
                      {formatNumber(currentStock?.quantity ?? 0)}{' '}
                      {material?.unit ?? ''}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[0.2rem]">
                    <span className="text-[0.75rem] text-slate-500 font-medium">
                      Đang giữ chỗ
                    </span>
                    <span
                      className={cn(
                        'text-[1rem] font-bold',
                        (currentStock?.quantityReserved ?? 0) > 0 ? 'text-amber-700' : 'text-slate-500',
                      )}
                    >
                      {formatNumber(currentStock?.quantityReserved ?? 0)}{' '}
                      {material?.unit ?? ''}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[0.2rem]">
                    <span className="text-[0.75rem] text-slate-500 font-medium">
                      Khả dụng xuất
                    </span>
                    <span
                      className="text-[1rem] font-bold text-slate-900 text-green-700"
                      
                    >
                      {formatNumber(currentStock?.available ?? 0)}{' '}
                      {material?.unit ?? ''}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Kho bãi & Vị trí lưu kho */}
            <div className="bg-white border border-slate-200 rounded-lg py-4 px-5 flex flex-col gap-[0.85rem]">
              <h4 className="m-0 text-[0.875rem] font-bold text-slate-700 flex items-center gap-2">
                <WarehouseIcon size={16} color="#0284c7" />
                <span>Kho bãi &amp; Vị trí lưu trữ</span>
              </h4>

              <div className="grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-[0.85rem]">
                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Tên kho hàng
                  </span>
                  <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                    {warehouse?.name ?? '—'}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">Mã kho</span>
                  <code
                    className="font-mono font-bold text-sky-700 bg-sky-50 py-0.5 px-1.5 rounded-sm"
                  >
                    {warehouse?.code ?? transaction.warehouseId}
                  </code>
                </div>

                <div
                  className="flex flex-col gap-1 col-[span_2]"
                  
                >
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Vị trí ô kệ / Bin Location
                  </span>
                  <div
                    className="flex items-center gap-1.5"
                  >
                    <MapPin size={14} color="#64748b" />
                    <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                      {transaction.locationId ||
                        'Kho chung (Không phân chia ô kệ)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Nơi nhập đến từ / nơi xuất đi đến */}
            <div className="bg-white border border-slate-200 rounded-lg py-4 px-5 flex flex-col gap-[0.85rem]">
              <h4 className="m-0 text-[0.875rem] font-bold text-slate-700 flex items-center gap-2">
                <MapPin size={16} color="#059669" />
                <span>{counterpartyHeading}</span>
              </h4>

              {hasCounterparty ? (
                <div className="grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-[0.85rem]">
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                      Loại đối tượng
                    </span>
                    <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                      {transaction.counterpartyType
                        ? (COUNTERPARTY_TYPE_LABEL[
                            transaction.counterpartyType
                          ] ?? transaction.counterpartyType)
                        : '—'}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">Tên</span>
                    <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                      {counterpartyName ?? '—'}
                    </span>
                  </div>

                  {transaction.counterpartyAddress ? (
                    <div
                      className="flex flex-col gap-1 col-[span_2]"
                      
                    >
                      <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">Địa chỉ</span>
                      <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                        {transaction.counterpartyAddress}
                      </span>
                    </div>
                  ) : null}

                  {transaction.documentNumber ? (
                    <div
                      className="flex flex-col gap-1 col-[span_2]"
                      
                    >
                      <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                        Số hoá đơn / Chứng từ gốc
                      </span>
                      <code
                        className="font-mono font-bold text-blue-800"
                      >
                        {transaction.documentNumber}
                      </code>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="py-3 px-4 bg-slate-50 border-l-3 border-l-blue-600 rounded-[0_6px_6px_0] text-[0.875rem] text-slate-700 leading-[1.5]">
                  Chưa ghi nhận. Phiếu tạo trước khi hệ thống lưu nơi nhập/xuất,
                  hoặc người lập phiếu không khai báo.
                </div>
              )}
            </div>

            {/* Card 3: Thông tin chứng từ & Tham chiếu kiểm toán */}
            <div className="bg-white border border-slate-200 rounded-lg py-4 px-5 flex flex-col gap-[0.85rem]">
              <h4 className="m-0 text-[0.875rem] font-bold text-slate-700 flex items-center gap-2">
                <FileText size={16} color="#475569" />
                <span>Chứng từ &amp; Tham chiếu nghiệp vụ</span>
              </h4>

              <div className="grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-[0.85rem]">
                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Người lập phiếu / Người thao tác
                  </span>
                  <div
                    className="flex items-center gap-1.5"
                  >
                    <User size={14} color="#64748b" />
                    <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                      {userName(transaction.createdBy, 'Hệ thống')}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                    Thời điểm ghi nhận
                  </span>
                  <div
                    className="flex items-center gap-1.5"
                  >
                    <Calendar size={14} color="#64748b" />
                    <span className="text-[0.875rem] font-semibold text-slate-900 break-words">
                      {formatDateTime(transaction.createdAt)}
                    </span>
                  </div>
                </div>

                {transaction.referenceType || transaction.referenceId ? (
                  <div
                    className="flex flex-col gap-1 col-[span_2]"
                    
                  >
                    <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                      Tham chiếu nguồn
                    </span>
                    <div
                      className="flex items-center gap-2 flex-wrap"
                    >
                      <span
                        className="py-0.5 px-1.5 rounded-sm bg-slate-100 text-slate-600 text-[12px] font-semibold"
                      >
                        {referenceLabel(transaction.referenceType)}
                      </span>
                      {transaction.referenceId ? (
                        <code
                          className="font-mono text-blue-600 text-[12px] font-semibold"
                        >
                          {transaction.referenceId}
                        </code>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Ghi chú / Diễn giải nghiệp vụ */}
              <div className="flex flex-col gap-1">
                <span className="text-[0.75rem] font-semibold text-slate-500 uppercase tracking-[0.03em]">
                  Diễn giải / Ghi chú
                </span>
                <div className="py-3 px-4 bg-slate-50 border-l-3 border-l-blue-600 rounded-[0_6px_6px_0] text-[0.875rem] text-slate-700 leading-[1.5]">
                  {transaction.note
                    ? formatNoteDates(transaction.note)
                    : 'Không có ghi chú thêm cho giao dịch này.'}
                </div>
              </div>
            </div>

            {/* Card 4: Các lần xuất nhập gần đây của vật tư này */}
            {recentMovements.length > 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg py-4 px-5 flex flex-col gap-[0.85rem]">
                <h4 className="m-0 text-[0.875rem] font-bold text-slate-700 flex items-center gap-2">
                  <Clock size={16} color="#64748b" />
                  <span>
                    Lịch sử các lần xuất nhập khác của vật tư này (
                    {recentMovements.length})
                  </span>
                </h4>

                <div
                  className="overflow-x-auto border border-slate-200 rounded-md"
                >
                  <Table className="text-[0.8125rem]">
                    <TableHead className="text-slate-600">
                      <TableRow className="border-slate-200 hover:bg-transparent">
                        <TableHeaderCell className="px-2 py-1.5 font-bold">Mã chứng từ</TableHeaderCell>
                        <TableHeaderCell className="px-2 py-1.5 font-bold">Loại</TableHeaderCell>
                        <TableHeaderCell className="px-2 py-1.5 font-bold">Kho</TableHeaderCell>
                        <TableHeaderCell className="px-2 py-1.5 font-bold text-center">Số lượng</TableHeaderCell>
                        <TableHeaderCell className="px-2 py-1.5 font-bold text-right">Thời gian</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recentMovements.map((otherRow) => {
                        const otherIsReceipt = otherRow.quantity > 0;
                        const otherWh = workspace.warehouses.find(
                          (w) =>
                            w.id === otherRow.warehouseId ||
                            w.code === otherRow.warehouseId,
                        );
                        return (
                          <TableRow
                            key={otherRow.id}
                            className={cn('hover:bg-slate-100', onSelectTransaction ? 'cursor-pointer' : 'cursor-default')}
                            onClick={() => {
                              if (onSelectTransaction) {
                                onSelectTransaction(otherRow);
                              }
                            }}
                            title={
                              onSelectTransaction
                                ? 'Xem chi tiết giao dịch này'
                                : undefined
                            }
                          >
                            <TableCell className="px-2 py-1.5 font-semibold text-blue-600">
                              {otherRow.transactionCode}
                            </TableCell>
                            <TableCell className="px-2 py-1.5 text-slate-800">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  'h-auto rounded-sm px-1.5 py-[1px] text-[11px] font-semibold',
                                  otherIsReceipt ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                                )}
                              >
                                {TRANSACTION_KIND_MAP[otherRow.type]?.label ??
                                  otherRow.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-2 py-1.5 text-slate-800">{otherWh?.code ?? otherRow.warehouseId}</TableCell>
                            <TableCell
                              className={cn('px-2 py-1.5 text-center font-bold', otherIsReceipt ? 'text-green-700' : 'text-red-700')}
                            >
                              {otherIsReceipt ? '+' : ''}
                              {formatNumber(otherRow.quantity)}
                            </TableCell>
                            <TableCell className="px-2 py-1.5 text-right text-[11px] text-slate-500">
                              {formatDateTime(otherRow.createdAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </div>
        </SheetBody>

        {/* 3. Footer ghim đáy với các nút thao tác */}
        <SheetFooter className="justify-between">
          <Button type="button" variant="outline" onClick={handleCopyCode}>
            {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
            <span>{copied ? 'Đã sao chép mã' : 'Sao chép mã phiếu'}</span>
          </Button>
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
