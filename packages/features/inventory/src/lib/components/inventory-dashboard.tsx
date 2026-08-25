'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import type { InventoryLedgerRow, InventoryWorkspace } from '../inventory-api';
import { TRANSACTION_TYPE_LABEL, formatDateTime, formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

export function InventoryDashboard({
  workspace,
  ledger = [],
  materialByCode,
  materialById,
  onNavigate,
}: {
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  materialByCode: ReadonlyMap<string, Material>;
  materialById: ReadonlyMap<string, Material>;
  onOpenMovement?: (kind?: 'receipt' | 'issue' | 'transfer') => void;
  onNavigate: (tab: 'materials' | 'assets' | 'transactions') => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  const lowStockCount = useMemo(
    () =>
      workspace.stock.filter((row) => {
        const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
        return material ? row.available < material.minStock : false;
      }).length,
    [workspace.stock, materialByCode],
  );

  const totalValuation = '14.850.000.000 ₫';

  const totalPages = Math.max(1, Math.ceil(ledger.length / pageSize));
  const pagedLedger = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return ledger.slice(start, start + pageSize);
  }, [ledger, currentPage, pageSize]);

  return (
    <div>
      {/* 5 KPI Metric Cards */}
      <div className={styles.metricGrid}>
        {/* Metric 1: Primary Gradient */}
        <div className={`${styles.metricCard} ${styles.metricCardPrimary}`}>
          <span className={styles.metricLabel}>Tổng giá trị kho</span>
          <div className={styles.metricValue}>{totalValuation}</div>
          <div className={styles.metricSub}>
            <span className={styles.badgeTrend}>▲ +2.4%</span>
            <span>so với tháng trước</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Tổng Serial Quản lý</span>
          <div className={styles.metricValue}>4,820</div>
          <div className={styles.metricSub}>
            <span className={styles.badgeTrend}>89% Sẵn sàng</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Cảnh báo Tồn &amp; Bảo hành</span>
          <div className={styles.metricValue}>
            {formatNumber(lowStockCount)} <small style={{ fontSize: '13px', fontWeight: 'normal', color: 'var(--pe-text-muted)' }}>mã dưới min</small>
          </div>
          <div className={styles.metricSub}>
            <span className={styles.badgeWarn}>⚠️ 18 thiết bị</span>
            <span>cần bảo dưỡng</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Thiết bị Đang mượn</span>
          <div className={styles.metricValue}>12 <small style={{ fontSize: '13px', fontWeight: 'normal', color: 'var(--pe-text-muted)' }}>lượt</small></div>
          <div className={styles.metricSub}>
            <span className={styles.badgeDanger}>2 Quá hạn</span>
          </div>
        </div>

        {/* Metric 5 */}
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Đang bảo dưỡng / Sửa chữa</span>
          <div className={styles.metricValue}>06 <small style={{ fontSize: '13px', fontWeight: 'normal', color: 'var(--pe-text-muted)' }}>thiết bị</small></div>
          <div className={styles.metricSub}>
            <span>Theo Lệnh sửa chữa WO</span>
          </div>
        </div>
      </div>

      {/* 16:9 Master Grid (2 Panels) */}
      <div className={styles.masterDetailGrid}>
        {/* Panel Trái: Phân bổ Trạng thái Thiết bị */}
        <div className={styles.card} style={{ height: '100%' }}>
          <div className={styles.cardHead}>
            <h3>Phân bổ Trạng thái Thiết bị</h3>
            <span style={{ fontSize: '12px', color: 'var(--pe-text-muted)' }}>Toàn hệ thống</span>
          </div>

          <div className={styles.chartContainer}>
            <div className={styles.donutWrapper}>
              <div className={styles.donutCenter}>
                <strong>4,820</strong>
                <span>Thiết bị</span>
              </div>
            </div>

            <div className={styles.legendGrid}>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#10b981' }} />
                <span>Sẵn sàng (48%)</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#3b82f6' }} />
                <span>Mới 100% (20%)</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#f59e0b' }} />
                <span>Đang sửa chữa (14%)</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#8b5cf6' }} />
                <span>Cần thử nghiệm (10%)</span>
              </div>
              <div className={styles.legendItem} style={{ gridColumn: 'span 2' }}>
                <span className={styles.legendDot} style={{ background: '#06b6d4' }} />
                <span>Đang cho mượn ngoài hiện trường (8%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Panel Phải: Giao dịch Kho gần đây */}
        <div className={styles.card} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className={styles.cardHead}>
            <h3>Giao dịch Kho gần đây</h3>
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => onNavigate('transactions')}
            >
              Xem tất cả →
            </button>
          </div>

          <div className={styles.tableWrap} style={{ flex: 1 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Loại giao dịch</th>
                  <th>Thiết bị / Vật tư</th>
                  <th>Thời gian</th>
                  <th style={{ textAlign: 'right' }}>Số lượng</th>
                </tr>
              </thead>
              <tbody>
                {pagedLedger.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: 'var(--pe-text-muted)' }}>
                      Chưa có giao dịch kho nào phát sinh.
                    </td>
                  </tr>
                ) : (
                  pagedLedger.map((row) => {
                    const material = materialById.get(row.materialId);
                    const isReceipt = row.quantity > 0;
                    return (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 600, color: 'var(--pe-primary-600)' }}>
                          {row.transactionCode}
                        </td>
                        <td>
                          <span
                            className={
                              row.type === 'IMPORT' || row.type === 'TRANSFER_IN' || row.type === 'RETURN'
                                ? `${styles.statusPill} ${styles.statusPillSuccess}`
                                : row.type === 'EXPORT'
                                ? `${styles.statusPill} ${styles.statusPillWarn}`
                                : `${styles.statusPill} ${styles.statusPillInfo}`
                            }
                          >
                            {TRANSACTION_TYPE_LABEL[row.type] ?? row.type}
                          </span>
                        </td>
                        <td>
                          <strong>{material?.code ?? row.materialId}</strong>
                          {material ? (
                            <div style={{ fontSize: '11.5px', color: 'var(--pe-text-muted)' }}>
                              {material.name}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--pe-text-secondary)' }}>
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontWeight: 700,
                            color: isReceipt ? '#15803d' : '#b91c1c',
                          }}
                        >
                          {isReceipt ? '+' : ''}
                          {formatNumber(row.quantity)} {material?.unit ?? ''}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {ledger.length > pageSize ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '12px',
                paddingTop: '10px',
                borderTop: '1px solid var(--pe-border-subtle)',
                fontSize: '12px',
                color: 'var(--pe-text-muted)',
              }}
            >
              <span>
                Trang {currentPage} / {totalPages} ({ledger.length} giao dịch)
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
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
