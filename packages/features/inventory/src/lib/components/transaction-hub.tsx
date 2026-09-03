'use client';

import type {
  InventoryLedgerRow,
  InventoryWorkspace,
} from '../inventory-api';
import { useMemo, useState } from 'react';
import { MovementForm, type MovementInput } from './movement-form';
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

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function TransactionHub({
  workspace,
  ledger = [],
  busy = false,
  onSubmitMovement,
}: {
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  busy?: boolean;
  onSubmitMovement: (input: MovementInput) => Promise<void>;
}) {
  const [popupMovement, setPopupMovement] = useState<{ open: boolean; kind?: 'receipt' | 'issue' | 'transfer' }>({
    open: false,
    kind: 'receipt',
  });

  // Filter state for Ledger view
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('all');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerPage, setLedgerPage] = useState(1);
  const ledgerPageSize = 10;

  const materialById = useMemo(
    () => new Map(workspace.materials.map((m) => [m.id, m])),
    [workspace.materials],
  );

  const warehouseById = useMemo(
    () => new Map(workspace.warehouses.map((w) => [w.id, w])),
    [workspace.warehouses],
  );

  // Filtered Ledger
  const filteredLedger = useMemo(() => {
    return ledger.filter((row) => {
      if (ledgerTypeFilter !== 'all' && row.type !== ledgerTypeFilter) return false;
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
  }, [ledger, ledgerTypeFilter, ledgerSearch, materialById]);

  const totalLedgerPages = Math.max(1, Math.ceil(filteredLedger.length / ledgerPageSize));
  const pagedLedger = useMemo(() => {
    const start = (ledgerPage - 1) * ledgerPageSize;
    return filteredLedger.slice(start, start + ledgerPageSize);
  }, [filteredLedger, ledgerPage, ledgerPageSize]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Tác nghiệp kho bãi</span>
          <h1>Trung tâm Giao dịch &amp; Nhập xuất Kho</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
            Tra cứu toàn bộ sổ cái lịch sử giao dịch và thực hiện tác nghiệp xuất/nhập kho vật tư.
          </p>
        </div>
      </div>

      {/* Sổ cái Giao dịch Kho (Stock Ledger) */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Sổ cái Giao dịch Kho (Stock Ledger)</h2>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {filteredLedger.length} giao dịch ghi nhận
            </span>
          </div>

          {/* Filters */}
          <div className={styles.filterRow} style={{ marginTop: '12px', marginBottom: '12px' }}>
            <label>
              Loại giao dịch
              <select
                value={ledgerTypeFilter}
                onChange={(e) => {
                  setLedgerTypeFilter(e.target.value);
                  setLedgerPage(1);
                }}
              >
                <option value="all">Tất cả loại</option>
                <option value="IMPORT">Nhập kho (IMPORT / RECEIPT)</option>
                <option value="EXPORT">Xuất kho (EXPORT / ISSUE)</option>
                <option value="TRANSFER_IN">Chuyển đến</option>
                <option value="TRANSFER_OUT">Chuyển đi</option>
                <option value="BORROW">Mượn</option>
                <option value="RETURN">Trả</option>
                <option value="ADJUST">Điều chỉnh</option>
              </select>
            </label>

            <label>
              Tìm kiếm mã phiếu / vật tư
              <input
                type="text"
                placeholder="Gõ mã hoặc tên…"
                value={ledgerSearch}
                onChange={(e) => {
                  setLedgerSearch(e.target.value);
                  setLedgerPage(1);
                }}
              />
            </label>

            {ledgerTypeFilter !== 'all' || ledgerSearch.trim() ? (
              <button
                type="button"
                className={styles.reset}
                onClick={() => {
                  setLedgerTypeFilter('all');
                  setLedgerSearch('');
                  setLedgerPage(1);
                }}
              >
                Xoá lọc
              </button>
            ) : null}

            {/* Nút Xuất/nhập kho gọi Popup Form trực tiếp */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{
                  padding: '7px 16px',
                  borderRadius: '6px',
                  border: '1px solid #2563eb',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setPopupMovement({ open: true, kind: 'receipt' })}
                title="Mở popup form xuất/nhập kho vật tư"
              >
                + Xuất/nhập kho
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className={styles.table} style={{ width: '100%', fontSize: '12.5px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Mã giao dịch</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Loại</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Vật tư</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Kho hàng</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Số lượng</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Ghi chú / Tham chiếu</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {pagedLedger.map((row) => {
                  const material = materialById.get(row.materialId);
                  const warehouse = warehouseById.get(row.warehouseId);
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
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{material.name}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '8px' }}>{warehouse?.name ?? row.warehouseId}</td>
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
                      <td style={{ fontSize: '11.5px', color: '#64748b', padding: '8px' }}>
                        {row.note ?? '—'}
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
                })}
                {pagedLedger.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}
                    >
                      Không có giao dịch nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {filteredLedger.length > ledgerPageSize ? (
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
                Trang {ledgerPage} / {totalLedgerPages} ({filteredLedger.length} giao dịch)
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={ledgerPage <= 1}
                  onClick={() => setLedgerPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </button>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={ledgerPage >= totalLedgerPages}
                  onClick={() => setLedgerPage((prev) => Math.min(totalLedgerPages, prev + 1))}
                >
                  Sau →
                </button>
              </div>
            </div>
          ) : null}
        </section>

      {/* Popup Form Xuất / Nhập Kho (Dialog) */}
      {popupMovement.open ? (
        <MovementForm
          workspace={workspace}
          initialKind={popupMovement.kind ?? 'receipt'}
          isDialog={true}
          busy={busy}
          onCancel={() => setPopupMovement({ open: false })}
          onSubmit={async (input) => {
            await onSubmitMovement(input);
            setPopupMovement({ open: false });
          }}
        />
      ) : null}
    </div>
  );
}
