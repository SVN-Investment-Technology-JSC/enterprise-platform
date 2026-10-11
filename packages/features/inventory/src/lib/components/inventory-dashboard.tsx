import type { Material } from '@enterprise-platform/contracts-inventory';
import {
  resolveDashboardCards,
  type DashboardCardSize,
} from '@enterprise-platform/feature-module-shell';
import { useMemo, useState } from 'react';
import type {
  InventoryLedgerRow,
  InventoryWorkspace,
} from '../inventory-api';
import {
  INVENTORY_DASHBOARD_CARDS,
  type InventoryDashboardData,
} from '../inventory-dashboard.cards';
import styles from '../inventory.module.scss';

const SIZE_CLASS: Readonly<Record<DashboardCardSize, string>> = {
  sm: styles.cardSm,
  md: styles.cardMd,
  lg: styles.cardLg,
  xl: styles.cardXl,
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
      </div>

      {/* Dynamic KPI / Chart Cards Section */}
      {activeCards.length > 0 ? (
        <div className={styles.dashboardCardsGrid}>
          {activeCards.map((card) => (
            <section
              key={card.id}
              className={`${styles.card} ${SIZE_CLASS[card.size]}`}
              style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}
            >
              <h2 className={styles.cardTitle} style={{ margin: '0 0 10px', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                {card.title}
              </h2>
              {card.render(dashboardData)}
            </section>
          ))}
        </div>
      ) : (
        <div
          className={styles.empty}
          style={{
            padding: '24px',
            textAlign: 'center',
            background: '#ffffff',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
          }}
        >
          <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: '13.5px' }}>
            Chưa có thẻ tổng quan nào được chọn hiển thị.
          </p>
          <button
            type="button"
            className={styles.reset}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => onNavigate('settings')}
          >
            Đi đến Cài đặt thẻ →
          </button>
        </div>
      )}


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
                  <th style={{ textAlign: 'center', padding: '8px' }}>Số lượng</th>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong>{material?.code ?? row.materialId}</strong>
                            {material && material.isActive === false ? (
                              <span
                                style={{
                                  fontSize: '10px',
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
                          {material ? (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {material.name}
                            </div>
                          ) : null}
                        </td>
                        <td
                          style={{
                            textAlign: 'center',
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
          {ledger.length > 0 ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                marginTop: '12px',
                paddingTop: '8px',
                borderTop: '1px solid #e2e8f0',
                fontSize: '12px',
                color: '#64748b',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span>
                  Trang <strong>{safeCurrentPage}</strong> / <strong>{totalPages}</strong> ({ledger.length} giao dịch)
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#64748b' }}>
                  <span>Hiển thị:</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value) || 5);
                      setCurrentPage(1);
                    }}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: '11.5px',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <option value={5}>5 / trang</option>
                    <option value={10}>10 / trang</option>
                    <option value={15}>15 / trang</option>
                    <option value={30}>30 / trang</option>
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </button>
                <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '11.5px' }}>
                  {safeCurrentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={safeCurrentPage >= totalPages}
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
