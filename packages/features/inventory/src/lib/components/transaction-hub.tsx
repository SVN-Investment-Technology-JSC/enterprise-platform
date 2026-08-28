'use client';

import type {
  InventoryLedgerRow,
  InventoryWorkspace,
} from '../inventory-api';
import { useMemo, useState, type FormEvent } from 'react';
import { MovementForm, type MovementInput } from './movement-form';
import styles from '../inventory.module.scss';

type TransactionMode = 'issue-wo' | 'receipt' | 'transfer' | 'borrow' | 'ledger';

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
  const [mode, setMode] = useState<TransactionMode>('issue-wo');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(workspace.warehouses[0]?.id ?? '');
  const [woCode, setWoCode] = useState('WO-2026-0801');
  const [recipient, setRecipient] = useState('KTV. Nguyễn Văn A (Đội Kỹ thuật)');

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

  // Sample BOM requirements for demonstration
  const sampleBom = useMemo(() => {
    return workspace.materials.slice(0, 3).map((mat) => {
      const stockItem = workspace.stock.find(
        (s) => s.materialId === mat.id && s.warehouseId === selectedWarehouseId,
      );
      const available = stockItem?.quantity ?? 0;
      const requiredQty = 2;
      return {
        id: mat.id,
        code: mat.code,
        name: mat.name,
        unit: mat.unit ?? 'cái',
        requiredQty,
        available,
        isSufficient: available >= requiredQty,
      };
    });
  }, [workspace.materials, workspace.stock, selectedWarehouseId]);

  const handleIssueWo = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouseId || sampleBom.length === 0) return;
    const firstItem = sampleBom[0];
    if (!firstItem) return;
    const selectedWh = workspace.warehouses.find((w) => w.id === selectedWarehouseId);
    await onSubmitMovement({
      kind: 'issue',
      warehouseCode: selectedWh?.code ?? workspace.warehouses[0]?.code ?? '',
      materialCode: firstItem.code,
      quantity: firstItem.requiredQty,
      note: `Xuất kho theo Lệnh công tác ${woCode} cho ${recipient}`,
    });
  };

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
      {/* Header & Modes Selector */}
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Tác nghiệp kho bãi</span>
          <h1>Trung tâm Giao dịch &amp; Nhập xuất Kho</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
            Thực hiện nhập, xuất theo lệnh WO, chuyển kho nội bộ và tra cứu toàn bộ sổ cái giao
            dịch.
          </p>
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className={styles.chipRow}>
        <button
          type="button"
          className={`${styles.chip} ${mode === 'issue-wo' ? styles.chipOn : ''}`}
          onClick={() => setMode('issue-wo')}
        >
          📋 Xuất kho theo Lệnh (WO)
        </button>
        <button
          type="button"
          className={`${styles.chip} ${mode === 'receipt' ? styles.chipOn : ''}`}
          onClick={() => setMode('receipt')}
        >
          📥 Nhập kho vật tư
        </button>
        <button
          type="button"
          className={`${styles.chip} ${mode === 'transfer' ? styles.chipOn : ''}`}
          onClick={() => setMode('transfer')}
        >
          🔁 Chuyển kho nội bộ
        </button>
        <button
          type="button"
          className={`${styles.chip} ${mode === 'borrow' ? styles.chipOn : ''}`}
          onClick={() => setMode('borrow')}
        >
          ⏱️ Phiếu Mượn / Trả hiện trường
        </button>
        <button
          type="button"
          className={`${styles.chip} ${mode === 'ledger' ? styles.chipOn : ''}`}
          onClick={() => setMode('ledger')}
        >
          📜 Sổ cái Giao dịch ({ledger.length})
        </button>
      </div>

      {/* Mode 1: Issue for Work Order */}
      {mode === 'issue-wo' ? (
        <form className={styles.card} onSubmit={handleIssueWo}>
          <div className={styles.cardHead}>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px' }}>Lập Phiếu Xuất Kho theo Lệnh Công tác (WO)</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                Hệ thống tự động đối chiếu danh mục vật tư cần thiết với lượng tồn kho khả dụng hiện
                tại.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
              margin: '16px 0',
            }}
          >
            <div>
              <label
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}
              >
                Mã Lệnh công tác (WO) *
              </label>
              <input
                type="text"
                value={woCode}
                onChange={(e) => setWoCode(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
                required
              />
            </div>

            <div>
              <label
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}
              >
                Kho xuất hàng *
              </label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
                required
              >
                {workspace.warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.code} — {wh.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}
              >
                Người nhận vật tư / Kỹ thuật viên
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          {/* BOM Items Checklist */}
          <div style={{ marginTop: '16px', marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '13.5px' }}>
              Danh mục định mức vật tư cần xuất cho {woCode}:
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.table} style={{ width: '100%', fontSize: '12.5px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Mã vật tư</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Tên vật tư</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>Yêu cầu</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>Tồn khả dụng</th>
                    <th style={{ textAlign: 'center', padding: '8px' }}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleBom.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600, color: '#2563eb', padding: '8px' }}>
                        {item.code}
                      </td>
                      <td style={{ padding: '8px' }}>{item.name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, padding: '8px' }}>
                        {item.requiredQty} {item.unit}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        {item.available} {item.unit}
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px' }}>
                        {item.isSufficient ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: '#dcfce7',
                              color: '#15803d',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            ✓ Đủ tồn kho
                          </span>
                        ) : (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: '#fee2e2',
                              color: '#b91c1c',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            ⚠️ Thiếu hàng
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sampleBom.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ textAlign: 'center', padding: '16px', color: '#64748b' }}
                      >
                        Chưa có danh mục vật tư nào trong kho được chọn.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button
              type="submit"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy || sampleBom.length === 0}
            >
              {busy ? 'Đang xử lý…' : '✓ Phê duyệt & Xuất kho'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Mode 2: Standard Receipt */}
      {mode === 'receipt' ? (
        <MovementForm
          workspace={workspace}
          busy={busy}
          onCancel={() => setMode('issue-wo')}
          onSubmit={onSubmitMovement}
        />
      ) : null}

      {/* Mode 3: Transfer between warehouses */}
      {mode === 'transfer' ? (
        <MovementForm
          workspace={workspace}
          busy={busy}
          onCancel={() => setMode('issue-wo')}
          onSubmit={onSubmitMovement}
        />
      ) : null}

      {/* Mode 4: Borrow / Return items */}
      {mode === 'borrow' ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px' }}>Phiếu Mượn - Trả Thiết bị Hiện trường</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                Quản lý thiết bị đo, đồ nghề chuyên dụng mượn đi công tác tại hiện trường.
              </p>
            </div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <MovementForm
              workspace={workspace}
              busy={busy}
              onCancel={() => setMode('issue-wo')}
              onSubmit={onSubmitMovement}
            />
          </div>
        </div>
      ) : null}

      {/* Mode 5: Full Stock Ledger Table */}
      {mode === 'ledger' ? (
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
      ) : null}
    </div>
  );
}
