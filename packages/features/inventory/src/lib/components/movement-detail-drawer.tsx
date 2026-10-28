'use client';

import type { Material, Warehouse } from '@enterprise-platform/contracts-inventory';
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
import { useEffect, useMemo, useState } from 'react';
import type { InventoryLedgerRow, InventoryWorkspace } from '../inventory-api';
import {
  formatDateTime,
  formatNoteDates,
  formatNumber,
  referenceLabel,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

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

  // Đóng drawer khi nhấn ESC
  useEffect(() => {
    if (!transaction) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transaction, onClose]);

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
        (s.warehouseId === transaction.warehouseId || s.warehouseCode === warehouse?.code) &&
        (s.materialId === transaction.materialId || s.materialCode === material?.code),
    );
  }, [workspace.stock, transaction, warehouse, material]);

  // Tìm 5 giao dịch gần đây của cùng vật tư này trên sổ cái
  const recentMovements = useMemo(() => {
    if (!transaction || !ledger || ledger.length === 0) return [];
    return ledger
      .filter((row) => row.materialId === transaction.materialId && row.id !== transaction.id)
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
    ? workspace.warehouses.find((w) => w.id === transaction.counterpartyWarehouseId)
    : undefined;
  const counterpartyName = counterpartyWarehouse
    ? `${counterpartyWarehouse.name} (${counterpartyWarehouse.code})`
    : transaction.counterpartyName;
  const hasCounterparty = Boolean(
    transaction.counterpartyType || counterpartyName || transaction.documentNumber,
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
    <>
      {/* Backdrop mờ nền khi trượt Drawer */}
      <div
        className={styles.drawerBackdrop}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel Drawer trượt từ bên phải */}
      <aside
        className={styles.drawerPanel}
        aria-label="Chi tiết phiếu xuất nhập kho"
        style={{ width: 'min(640px, 95vw)' }}
      >
        {/* 1. Header cố định của Drawer */}
        <div className={styles.drawerHead}>
          <div className={styles.drawerHeadInfo}>
            <div className={styles.drawerEyebrow}>
              <Receipt size={14} strokeWidth={2.2} />
              <span>Chứng từ kho · Sổ cái xuất nhập</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 className={styles.drawerTitle}>{transaction.transactionCode}</h3>
              <button
                type="button"
                className={styles.reset}
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: copied ? '#dcfce7' : '#f1f5f9',
                  borderColor: copied ? '#86efac' : '#cbd5e1',
                  color: copied ? '#15803d' : '#475569',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
                onClick={handleCopyCode}
                title="Sao chép mã giao dịch"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
              </button>
            </div>

            <div className={styles.drawerSubtitle}>
              {/* Badge Loại giao dịch */}
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background:
                    movementKind === 'in'
                      ? '#dcfce7'
                      : movementKind === 'out'
                        ? '#fee2e2'
                        : '#fef3c7',
                  color:
                    movementKind === 'in'
                      ? '#15803d'
                      : movementKind === 'out'
                        ? '#b91c1c'
                        : '#b45309',
                  border: `1px solid ${
                    movementKind === 'in'
                      ? '#bbf7d0'
                      : movementKind === 'out'
                        ? '#fecaca'
                        : '#fde68a'
                  }`,
                }}
              >
                {typeConfig.label}
              </span>

              <span>·</span>

              {/* Badge Trạng thái dòng công việc */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#15803d',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#16a34a',
                  }}
                />
                {transaction.workflowStatus === 'APPROVED' ? 'Đã ghi nhận' : 'Hoàn tất'}
              </span>

              <span>·</span>

              {/* Thời gian */}
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {formatDateTime(transaction.createdAt)}
              </span>
            </div>
          </div>

          {/* Nút Đóng X */}
          <button
            type="button"
            className={styles.drawerCloseBtn}
            onClick={onClose}
            title="Đóng ngăn kéo (Phím ESC)"
            aria-label="Đóng"
          >
            <X size={16} />
          </button>
        </div>

        {/* 2. Body cuộn nội bộ độc lập */}
        <div className={styles.drawerBody}>
          {/* Hero Banner: Tổng quan biến động số lượng */}
          <div
            className={`${styles.movementHero} ${
              movementKind === 'in'
                ? styles.movementHeroIn
                : movementKind === 'out'
                  ? styles.movementHeroOut
                  : styles.movementHeroAdjust
            }`}
          >
            <div className={styles.movementHeroHead}>
              <div
                className={`${styles.movementHeroKind} ${
                  movementKind === 'in'
                    ? styles.movementHeroKindIn
                    : movementKind === 'out'
                      ? styles.movementHeroKindOut
                      : styles.movementHeroKindAdjust
                }`}
              >
                <span
                  className={`${styles.movementHeroIconCircle} ${
                    movementKind === 'in'
                      ? styles.movementHeroIconCircleIn
                      : movementKind === 'out'
                        ? styles.movementHeroIconCircleOut
                        : styles.movementHeroIconCircleAdjust
                  }`}
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
                className={`${styles.movementHeroAmount} ${
                  movementKind === 'in'
                    ? styles.movementHeroAmountIn
                    : movementKind === 'out'
                      ? styles.movementHeroAmountOut
                      : styles.movementHeroAmountAdjust
                }`}
              >
                {isReceipt ? '+' : ''}
                {formatNumber(quantity)} {material?.unit ?? ''}
              </div>
            </div>

            {/* Chi tiết giá trị và kho */}
            <div className={styles.movementHeroGrid}>
              <div className={styles.movementHeroStat}>
                <span className={styles.movementHeroStatLabel}>Đơn giá ghi sổ</span>
                <span className={styles.movementHeroStatValue}>
                  {unitCost > 0 ? `${formatNumber(unitCost)} ₫` : 'Chưa ghi nhận'}
                </span>
              </div>

              <div className={styles.movementHeroStat}>
                <span className={styles.movementHeroStatLabel}>Tổng giá trị</span>
                <span className={styles.movementHeroStatValue}>
                  {totalValue > 0 ? `${formatNumber(totalValue)} ₫` : '—'}
                </span>
              </div>

              <div className={styles.movementHeroStat}>
                <span className={styles.movementHeroStatLabel}>Kho ghi nhận</span>
                <span className={styles.movementHeroStatValue} title={warehouse?.name}>
                  {warehouse?.code ?? '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 1: Thông tin vật tư chi tiết */}
          <div className={styles.movementCard}>
            <h4 className={styles.movementCardTitle}>
              <Package size={16} color="#2563eb" />
              <span>Vật tư / Thiết bị liên quan</span>
            </h4>

            <div className={styles.movementGrid2}>
              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Tên vật tư</span>
                <span className={styles.movementFieldValue} style={{ color: '#0f172a' }}>
                  {material?.name ?? 'Chưa xác định tên'}
                </span>
              </div>

              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Mã định danh (Code)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <code
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontWeight: 700,
                      color: '#1e40af',
                      background: '#eff6ff',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {material?.code ?? transaction.materialId}
                  </code>
                  {material && material.isActive === false ? (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: '#f1f5f9',
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        fontWeight: 500,
                      }}
                    >
                      Ngừng dùng
                    </span>
                  ) : null}
                </div>
              </div>

              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Đơn vị tính</span>
                <span className={styles.movementFieldValue}>{material?.unit ?? '—'}</span>
              </div>

              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Phân loại</span>
                <span className={styles.movementFieldValue}>
                  {material?.category ?? material?.type ?? 'Vật tư lưu kho'}
                </span>
              </div>

              {transaction.serialNumber ? (
                <div className={styles.movementFieldItem} style={{ gridColumn: 'span 2' }}>
                  <span className={styles.movementFieldLabel}>Số Sê-ri định danh (SN)</span>
                  <code
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontWeight: 700,
                      color: '#7c3aed',
                      background: '#f5f3ff',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {transaction.serialNumber}
                  </code>
                </div>
              ) : null}
            </div>

            {/* Khối thống kê tồn kho tức thời tại kho này */}
            <div style={{ marginTop: '4px' }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#475569',
                  display: 'block',
                  marginBottom: '6px',
                }}
              >
                Tình trạng tồn kho hiện tại tại kho {warehouse?.code ?? ''}:
              </span>
              <div className={styles.movementStockBox}>
                <div className={styles.movementStockItem}>
                  <span className={styles.movementStockItemLabel}>Tồn thực tế</span>
                  <span className={styles.movementStockItemValue}>
                    {formatNumber(currentStock?.quantity ?? 0)} {material?.unit ?? ''}
                  </span>
                </div>
                <div className={styles.movementStockItem}>
                  <span className={styles.movementStockItemLabel}>Đang giữ chỗ</span>
                  <span
                    className={styles.movementStockItemValue}
                    style={{ color: (currentStock?.quantityReserved ?? 0) > 0 ? '#b45309' : '#64748b' }}
                  >
                    {formatNumber(currentStock?.quantityReserved ?? 0)} {material?.unit ?? ''}
                  </span>
                </div>
                <div className={styles.movementStockItem}>
                  <span className={styles.movementStockItemLabel}>Khả dụng xuất</span>
                  <span className={styles.movementStockItemValue} style={{ color: '#15803d' }}>
                    {formatNumber(currentStock?.available ?? 0)} {material?.unit ?? ''}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Kho bãi & Vị trí lưu kho */}
          <div className={styles.movementCard}>
            <h4 className={styles.movementCardTitle}>
              <WarehouseIcon size={16} color="#0284c7" />
              <span>Kho bãi &amp; Vị trí lưu trữ</span>
            </h4>

            <div className={styles.movementGrid2}>
              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Tên kho hàng</span>
                <span className={styles.movementFieldValue}>{warehouse?.name ?? '—'}</span>
              </div>

              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Mã kho</span>
                <code
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 700,
                    color: '#0369a1',
                    background: '#f0f9ff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  {warehouse?.code ?? transaction.warehouseId}
                </code>
              </div>

              <div className={styles.movementFieldItem} style={{ gridColumn: 'span 2' }}>
                <span className={styles.movementFieldLabel}>Vị trí ô kệ / Bin Location</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MapPin size={14} color="#64748b" />
                  <span className={styles.movementFieldValue}>
                    {transaction.locationId || 'Kho chung (Không phân chia ô kệ)'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Card: Nơi nhập đến từ / nơi xuất đi đến */}
          <div className={styles.movementCard}>
            <h4 className={styles.movementCardTitle}>
              <MapPin size={16} color="#059669" />
              <span>{counterpartyHeading}</span>
            </h4>

            {hasCounterparty ? (
              <div className={styles.movementGrid2}>
                <div className={styles.movementFieldItem}>
                  <span className={styles.movementFieldLabel}>Loại đối tượng</span>
                  <span className={styles.movementFieldValue}>
                    {transaction.counterpartyType
                      ? (COUNTERPARTY_TYPE_LABEL[transaction.counterpartyType] ??
                        transaction.counterpartyType)
                      : '—'}
                  </span>
                </div>

                <div className={styles.movementFieldItem}>
                  <span className={styles.movementFieldLabel}>Tên</span>
                  <span className={styles.movementFieldValue}>{counterpartyName ?? '—'}</span>
                </div>

                {transaction.counterpartyAddress ? (
                  <div className={styles.movementFieldItem} style={{ gridColumn: 'span 2' }}>
                    <span className={styles.movementFieldLabel}>Địa chỉ</span>
                    <span className={styles.movementFieldValue}>{transaction.counterpartyAddress}</span>
                  </div>
                ) : null}

                {transaction.documentNumber ? (
                  <div className={styles.movementFieldItem} style={{ gridColumn: 'span 2' }}>
                    <span className={styles.movementFieldLabel}>Số hoá đơn / Chứng từ gốc</span>
                    <code
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontWeight: 700,
                        color: '#1e40af',
                      }}
                    >
                      {transaction.documentNumber}
                    </code>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.movementNoteBox}>
                Chưa ghi nhận. Phiếu tạo trước khi hệ thống lưu nơi nhập/xuất, hoặc người lập phiếu không khai báo.
              </div>
            )}
          </div>

          {/* Card 3: Thông tin chứng từ & Tham chiếu kiểm toán */}
          <div className={styles.movementCard}>
            <h4 className={styles.movementCardTitle}>
              <FileText size={16} color="#475569" />
              <span>Chứng từ &amp; Tham chiếu nghiệp vụ</span>
            </h4>

            <div className={styles.movementGrid2}>
              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Người lập phiếu / Người thao tác</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <User size={14} color="#64748b" />
                  <span className={styles.movementFieldValue}>
                    {transaction.createdBy || 'Hệ thống'}
                  </span>
                </div>
              </div>

              <div className={styles.movementFieldItem}>
                <span className={styles.movementFieldLabel}>Thời điểm ghi nhận</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calendar size={14} color="#64748b" />
                  <span className={styles.movementFieldValue}>
                    {formatDateTime(transaction.createdAt)}
                  </span>
                </div>
              </div>

              {transaction.referenceType || transaction.referenceId ? (
                <div className={styles.movementFieldItem} style={{ gridColumn: 'span 2' }}>
                  <span className={styles.movementFieldLabel}>Tham chiếu nguồn</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: '#f1f5f9',
                        color: '#475569',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      {referenceLabel(transaction.referenceType)}
                    </span>
                    {transaction.referenceId ? (
                      <code
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          color: '#2563eb',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        {transaction.referenceId}
                      </code>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Ghi chú / Diễn giải nghiệp vụ */}
            <div className={styles.movementFieldItem}>
              <span className={styles.movementFieldLabel}>Diễn giải / Ghi chú</span>
              <div className={styles.movementNoteBox}>
                {transaction.note ? formatNoteDates(transaction.note) : 'Không có ghi chú thêm cho giao dịch này.'}
              </div>
            </div>
          </div>

          {/* Card 4: Các lần xuất nhập gần đây của vật tư này */}
          {recentMovements.length > 0 ? (
            <div className={styles.movementCard}>
              <h4 className={styles.movementCardTitle}>
                <Clock size={16} color="#64748b" />
                <span>Lịch sử các lần xuất nhập khác của vật tư này ({recentMovements.length})</span>
              </h4>

              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                <table className={styles.movementMiniTable}>
                  <thead>
                    <tr>
                      <th>Mã chứng từ</th>
                      <th>Loại</th>
                      <th>Kho</th>
                      <th style={{ textAlign: 'center' }}>Số lượng</th>
                      <th style={{ textAlign: 'right' }}>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMovements.map((otherRow) => {
                      const otherIsReceipt = otherRow.quantity > 0;
                      const otherWh = workspace.warehouses.find(
                        (w) => w.id === otherRow.warehouseId || w.code === otherRow.warehouseId,
                      );
                      return (
                        <tr
                          key={otherRow.id}
                          style={{ cursor: onSelectTransaction ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (onSelectTransaction) {
                              onSelectTransaction(otherRow);
                            }
                          }}
                          title={onSelectTransaction ? 'Xem chi tiết giao dịch này' : undefined}
                        >
                          <td style={{ fontWeight: 600, color: '#2563eb' }}>
                            {otherRow.transactionCode}
                          </td>
                          <td>
                            <span
                              style={{
                                fontSize: '11px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                                background: otherIsReceipt ? '#dcfce7' : '#fee2e2',
                                color: otherIsReceipt ? '#15803d' : '#b91c1c',
                              }}
                            >
                              {TRANSACTION_KIND_MAP[otherRow.type]?.label ?? otherRow.type}
                            </span>
                          </td>
                          <td>{otherWh?.code ?? otherRow.warehouseId}</td>
                          <td
                            style={{
                              textAlign: 'center',
                              fontWeight: 700,
                              color: otherIsReceipt ? '#15803d' : '#b91c1c',
                            }}
                          >
                            {otherIsReceipt ? '+' : ''}
                            {formatNumber(otherRow.quantity)}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '11px', color: '#64748b' }}>
                            {formatDateTime(otherRow.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* 3. Footer ghim đáy với các nút thao tác */}
        <div className={styles.drawerFooter}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={styles.drawerActionBtn}
              onClick={handleCopyCode}
            >
              {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
              <span>{copied ? 'Đã sao chép mã' : 'Sao chép mã phiếu'}</span>
            </button>
          </div>

          <div className={styles.drawerFooterActions}>
            <button
              type="button"
              className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
