'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import type { InventoryLedgerRow, InventoryReservationRow, InventoryWorkspace } from '../inventory-api';
import { LedgerTable } from './ledger-table';
import { MovementForm, type MovementInput } from './movement-form';
import styles from '../inventory.module.scss';

type TransactionMode = 'issue-wo' | 'receipt' | 'transfer' | 'borrow' | 'ledger';

export function TransactionHub({
  workspace,
  ledger,
  reservations,
  materialByCode,
  materialById,
  warehouseById,
  busy,
  onSubmitMovement,
}: {
  workspace: InventoryWorkspace;
  ledger?: readonly InventoryLedgerRow[];
  reservations?: readonly InventoryReservationRow[];
  materialByCode: ReadonlyMap<string, Material>;
  materialById: ReadonlyMap<string, Material>;
  warehouseById: ReadonlyMap<string, string>;
  busy?: boolean;
  onSubmitMovement: (input: MovementInput) => Promise<void>;
}) {
  const [mode, setMode] = useState<TransactionMode>('issue-wo');
  const [selectedWO, setSelectedWO] = useState('WO-2026-0412');
  const [exportType, setExportType] = useState('wo');
  const [selectedWarehouse, setSelectedWarehouse] = useState(workspace.warehouses[0]?.code ?? 'WH-A');

  // Sample mock Work Orders for selection
  const workOrders = [
    { code: 'WO-2026-0412', name: 'Đại tu Bơm tuần hoàn B-01 (Đã duyệt ✅)', priority: 'Gấp', targetDate: '2026-08-30' },
    { code: 'WO-2026-0398', name: 'Thay thế Cụm Vòng đệm Sealing Ring Turbine T1 (Đã duyệt ✅)', priority: 'Bình thường', targetDate: '2026-09-02' },
    { code: 'WO-2026-0405', name: 'Bảo dưỡng Máy nén khí P-04 (Đã duyệt ✅)', priority: 'Tiêu chuẩn', targetDate: '2026-09-05' },
  ];

  // Materials needed for the selected WO
  const woItems = useMemo(() => {
    return workspace.stock.slice(0, 3).map((item, index) => {
      const mat = item.materialCode ? materialByCode.get(item.materialCode) : undefined;
      const reqQty = index === 0 ? 2 : index === 1 ? 4 : 1;
      const isSufficient = item.available >= reqQty;
      return {
        ...item,
        materialName: mat?.name ?? 'Vật tư thay thế',
        requiredQty: reqQty,
        unit: mat?.unit ?? 'Bộ',
        isSufficient,
      };
    });
  }, [workspace.stock, materialByCode]);

  const handleIssueForWO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (woItems.length === 0) return;
    const firstItem = woItems[0];
    await onSubmitMovement({
      kind: 'issue',
      warehouseCode: selectedWarehouse,
      materialCode: firstItem.materialCode ?? '',
      quantity: firstItem.requiredQty,
      note: `Xuất kho tự động theo lệnh ${selectedWO} (${exportType})`,
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Inventory Transaction Hub</span>
          <h1>Trung tâm Giao dịch Kho</h1>
          <p>Tạo phiếu xuất theo Lệnh sửa chữa (Work Order), Nhập kho, Chuyển kho và Mượn - Trả thiết bị.</p>
        </div>
      </div>

      {/* Transaction Sub-tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
        <button
          type="button"
          className={mode === 'issue-wo' ? styles.btnPrimary : styles.btnSecondary}
          onClick={() => setMode('issue-wo')}
        >
          <span>↗</span> Xuất theo Lệnh sửa chữa (WO)
        </button>
        <button
          type="button"
          className={mode === 'receipt' ? styles.btnPrimary : styles.btnSecondary}
          onClick={() => setMode('receipt')}
        >
          <span>+</span> Nhập kho
        </button>
        <button
          type="button"
          className={mode === 'transfer' ? styles.btnPrimary : styles.btnSecondary}
          onClick={() => setMode('transfer')}
        >
          <span>⇄</span> Chuyển kho nội bộ
        </button>
        <button
          type="button"
          className={mode === 'borrow' ? styles.btnPrimary : styles.btnSecondary}
          onClick={() => setMode('borrow')}
        >
          <span>🤝</span> Mượn - Trả vật tư
        </button>
        <button
          type="button"
          className={mode === 'ledger' ? styles.btnPrimary : styles.btnSecondary}
          onClick={() => setMode('ledger')}
        >
          <span>📋</span> Nhật ký chứng từ ({ledger?.length ?? 0})
        </button>
      </div>

      {/* Mode 1: Issue for Work Order */}
      {mode === 'issue-wo' ? (
        <form onSubmit={handleIssueForWO} className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3>Tạo Phiếu Xuất kho theo Lệnh Sửa Chữa (Work Order)</h3>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--pe-text-muted)' }}>
                Mã phiếu tự động: <strong style={{ color: 'var(--pe-primary-600)' }}>XK-2026-08-0042</strong>
              </p>
            </div>
            <span className={`${styles.statusPill} ${styles.statusPillInfo}`}>
              Tích hợp phân hệ Bảo trì
            </span>
          </div>

          {/* Export Type Radios */}
          <div style={{ display: 'flex', gap: '20px', margin: '16px 0', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="radio"
                name="exportType"
                value="wo"
                checked={exportType === 'wo'}
                onChange={(e) => setExportType(e.target.value)}
              />
              Xuất cho Lệnh sửa chữa (WO)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="radio"
                name="exportType"
                value="spare"
                checked={exportType === 'spare'}
                onChange={(e) => setExportType(e.target.value)}
              />
              Xuất dự phòng hiện trường
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="radio"
                name="exportType"
                value="retire"
                checked={exportType === 'retire'}
                onChange={(e) => setExportType(e.target.value)}
              />
              Xuất thanh lý / chuyển giao
            </label>
          </div>

          {/* Form Fields Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--pe-text-secondary)', marginBottom: '6px' }}>
                Lệnh sửa chữa đã duyệt (WO) *
              </label>
              <select
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--pe-border-subtle)', fontSize: '13px' }}
                value={selectedWO}
                onChange={(e) => setSelectedWO(e.target.value)}
              >
                {workOrders.map((wo) => (
                  <option key={wo.code} value={wo.code}>
                    {wo.code}: {wo.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--pe-text-secondary)', marginBottom: '6px' }}>
                Kho xuất hàng *
              </label>
              <select
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--pe-border-subtle)', fontSize: '13px' }}
                value={selectedWarehouse}
                onChange={(e) => setSelectedWarehouse(e.target.value)}
              >
                {workspace.warehouses.map((wh) => (
                  <option key={wh.id} value={wh.code}>
                    {wh.code} — {wh.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--pe-text-secondary)', marginBottom: '6px' }}>
                Người nhận vật tư / Kỹ thuật viên
              </label>
              <input
                type="text"
                placeholder="Ví dụ: KTV. Nguyễn Văn A (Đội Cơ điện 1)"
                defaultValue="KTV. Nguyễn Văn A (Đội Cơ điện 1)"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--pe-border-subtle)', fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Table of BOM items required for WO */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700 }}>
              Danh mục định mức vật tư cần xuất cho {selectedWO}:
            </h4>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Mã vật tư</th>
                    <th>Tên vật tư / Thiết bị</th>
                    <th style={{ textAlign: 'right' }}>Yêu cầu WO</th>
                    <th style={{ textAlign: 'right' }}>Tồn khả dụng</th>
                    <th>Trạng thái tồn</th>
                  </tr>
                </thead>
                <tbody>
                  {woItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600, color: 'var(--pe-primary-600)' }}>
                        {item.materialCode}
                      </td>
                      <td>{item.materialName}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        {item.requiredQty} {item.unit}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {item.available} {item.unit}
                      </td>
                      <td>
                        {item.isSufficient ? (
                          <span className={`${styles.statusPill} ${styles.statusPillSuccess}`}>
                            ✓ Đủ tồn kho ({item.available} {item.unit})
                          </span>
                        ) : (
                          <span className={`${styles.statusPill} ${styles.statusPillDanger}`}>
                            ⚠️ Thiếu hàng (Cần bổ sung)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => window.alert('Đang mở camera quét mã QR để xác nhận serial…')}
            >
              📷 Quét mã QR Serial
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={busy}>
              {busy ? 'Đang xử lý…' : '✓ Phê duyệt &amp; Xuất kho ngay'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Mode 2: Standard Receipt */}
      {mode === 'receipt' ? (
        <MovementForm
          workspace={workspace}
          busy={busy}
          defaultKind="receipt"
          onCancel={() => setMode('issue-wo')}
          onSubmit={onSubmitMovement}
        />
      ) : null}

      {/* Mode 3: Transfer between warehouses */}
      {mode === 'transfer' ? (
        <MovementForm
          workspace={workspace}
          busy={busy}
          defaultKind="transfer"
          onCancel={() => setMode('issue-wo')}
          onSubmit={onSubmitMovement}
        />
      ) : null}

      {/* Mode 4: Borrow / Return items */}
      {mode === 'borrow' ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3>Lập Phiếu Mượn - Trả Vật Tư &amp; Thiết Bị Đi Hiện Trường</h3>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--pe-text-muted)' }}>
                Quản lý theo dõi hạn mượn và bảo toàn thiết bị đo lường / đồ nghề chuyên dụng.
              </p>
            </div>
            <span className={`${styles.statusPill} ${styles.statusPillPurple}`}>
              Quy trình mượn - trả
            </span>
          </div>
          <MovementForm
            workspace={workspace}
            busy={busy}
            defaultKind="issue"
            onCancel={() => setMode('issue-wo')}
            onSubmit={onSubmitMovement}
          />
        </div>
      ) : null}

      {/* Mode 5: Ledger log */}
      {mode === 'ledger' ? (
        <LedgerTable
          rows={ledger}
          materialById={materialById}
          warehouseById={warehouseById}
        />
      ) : null}
    </div>
  );
}
