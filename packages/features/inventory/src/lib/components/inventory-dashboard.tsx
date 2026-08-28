'use client';

import type {
  InventoryLedgerRow,
  InventoryWorkspace,
} from '../inventory-api';
import { useMemo, useState } from 'react';
import styles from '../inventory.module.scss';

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Nhập kho',
  IMPORT: 'Nhập kho',
  ISSUE: 'Xuất kho',
  EXPORT: 'Xuất kho',
  TRANSFER: 'Chuyển kho',
  TRANSFER_IN: 'Chuyển đến',
  TRANSFER_OUT: 'Chuyển đi',
  BORROW: 'Mượn',
  RETURN: 'Trả',
  ADJUST: 'Điều chỉnh',
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

function formatDateTime(value: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function InventoryDashboard({
  workspace,
  ledger = [],
  onNavigate,
  onOpenMovement,
}: {
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  onNavigate: (tab: 'stock' | 'assets' | 'transactions' | 'settings') => void;
  onOpenMovement?: (kind?: 'receipt' | 'issue' | 'transfer') => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  const totalMaterials = workspace.materials.length;
  const totalStockItems = workspace.stock.length;
  const totalAssets = workspace.assets.length;

  const lowStockCount = useMemo(() => {
    let count = 0;
    for (const mat of workspace.materials) {
      if (mat.minStock && mat.minStock > 0) {
        const currentQty = workspace.stock
          .filter((s) => s.materialId === mat.id)
          .reduce((sum, s) => sum + s.quantity, 0);
        if (currentQty <= mat.minStock) {
          count++;
        }
      }
    }
    return count;
  }, [workspace.materials, workspace.stock]);

  const materialById = useMemo(
    () => new Map(workspace.materials.map((m) => [m.id, m])),
    [workspace.materials],
  );

  const totalPages = Math.max(1, Math.ceil(ledger.length / pageSize));
  const pagedLedger = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return ledger.slice(start, start + pageSize);
  }, [ledger, currentPage, pageSize]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner & Quick Actions */}
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Trung tâm Điều hành Kho &amp; Thiết bị</span>
          <h1>Tổng quan Tài sản &amp; Tồn kho</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
            Theo dõi tổng lượng tồn kho, cảnh báo định mức Min/Max và tiến độ luân chuyển thiết bị.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`${styles.action} ${styles.actionGhost}`}
            onClick={() => onNavigate('transactions')}
          >
            📋 Lập phiếu xuất WO
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.actionPrimary}`}
            onClick={() => onOpenMovement?.('receipt')}
          >
            + Nhập kho mới
          </button>
        </div>
      </div>

      {/* KPI 5 Cards Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
        }}
      >
        <div className={styles.card} style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            Tổng mã vật tư
          </span>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
            {formatNumber(totalMaterials)}
          </div>
          <div style={{ fontSize: '11.5px', color: '#16a34a' }}>
            {totalStockItems} vị trí tồn kho
          </div>
        </div>

        <div className={styles.card} style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            Tài sản &amp; Cụm máy
          </span>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb', margin: '4px 0' }}>
            {formatNumber(totalAssets)}
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Cây cấu trúc phân cấp</div>
        </div>

        <div className={styles.card} style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            Cảnh báo thiếu tồn kho
          </span>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: lowStockCount > 0 ? '#dc2626' : '#16a34a',
              margin: '4px 0',
            }}
          >
            {lowStockCount}
          </div>
          <div style={{ fontSize: '11.5px', color: lowStockCount > 0 ? '#dc2626' : '#64748b' }}>
            {lowStockCount > 0 ? 'Dưới định mức tối thiểu' : 'Tồn kho an toàn'}
          </div>
        </div>

        <div className={styles.card} style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Kho lưu trữ</span>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
            {workspace.warehouses.length}
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Kho vật tư &amp; thiết bị</div>
        </div>

        <div className={styles.card} style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            Tổng giao dịch phát sinh
          </span>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#7c3aed', margin: '4px 0' }}>
            {ledger.length}
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Giao dịch trong sổ cái</div>
        </div>
      </div>

      {/* Master Detail 2 Panels Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 1fr) minmax(420px, 1.4fr)',
          gap: '16px',
        }}
      >
        {/* Left Panel: Warehouse Distribution */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h3 style={{ margin: 0, fontSize: '15px' }}>Phân bổ theo Kho lưu trữ</h3>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {workspace.warehouses.length} kho
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            {workspace.warehouses.map((wh) => {
              const stockInWh = workspace.stock.filter((s) => s.warehouseId === wh.id);
              const totalItems = stockInWh.reduce((sum, s) => sum + s.quantity, 0);
              return (
                <div
                  key={wh.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{wh.name}</strong>
                    <div style={{ fontSize: '11.5px', color: '#64748b' }}>Mã kho: {wh.code}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#2563eb' }}>
                      {formatNumber(totalItems)}
                    </div>
                    <small style={{ fontSize: '11px', color: '#64748b' }}>
                      {stockInWh.length} danh mục
                    </small>
                  </div>
                </div>
              );
            })}
            {workspace.warehouses.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '12px' }}>Chưa có kho nào được thiết lập.</p>
            ) : null}
          </div>
        </div>

        {/* Right Panel: Recent Transactions */}
        <div className={styles.card} style={{ display: 'flex', flexDirection: 'column' }}>
          <div className={styles.cardHead}>
            <h3 style={{ margin: 0, fontSize: '15px' }}>Giao dịch Kho gần đây</h3>
            <button
              type="button"
              className={styles.reset}
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={() => onNavigate('transactions')}
            >
              Xem tất cả →
            </button>
          </div>

          <div style={{ overflowX: 'auto', marginTop: '12px', flex: 1 }}>
            <table className={styles.table} style={{ width: '100%', fontSize: '12.5px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Mã phiếu</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Loại giao dịch</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Vật tư</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Số lượng</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {pagedLedger.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}
                    >
                      Chưa có giao dịch kho nào phát sinh trong sổ cái.
                    </td>
                  </tr>
                ) : (
                  pagedLedger.map((row) => {
                    const material = materialById.get(row.materialId);
                    const isReceipt = row.quantity > 0;
                    return (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 600, color: '#2563eb', padding: '8px' }}>
                          {row.transactionCode}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: isReceipt ? '#dcfce7' : '#fee2e2',
                              color: isReceipt ? '#15803d' : '#b91c1c',
                            }}
                          >
                            {TRANSACTION_TYPE_LABEL[row.type] ?? row.type}
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>
                          <strong>{material?.code ?? row.materialId}</strong>
                          {material ? (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {material.name}
                            </div>
                          ) : null}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontWeight: 700,
                            color: isReceipt ? '#15803d' : '#b91c1c',
                            padding: '8px',
                          }}
                        >
                          {isReceipt ? '+' : ''}
                          {formatNumber(row.quantity)} {material?.unit ?? ''}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontSize: '11.5px',
                            color: '#64748b',
                            padding: '8px',
                          }}
                        >
                          {formatDateTime(row.createdAt)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {ledger.length > pageSize ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '12px',
                paddingTop: '8px',
                borderTop: '1px solid #e2e8f0',
                fontSize: '12px',
                color: '#64748b',
              }}
            >
              <span>
                Trang {currentPage} / {totalPages} ({ledger.length} giao dịch)
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </button>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Sau →
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
