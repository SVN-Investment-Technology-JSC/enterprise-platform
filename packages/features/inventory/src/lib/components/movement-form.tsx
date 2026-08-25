'use client';

import { useState, type FormEvent } from 'react';
import type { InventoryWorkspace } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

export type MovementKind = 'receipt' | 'issue' | 'transfer';

const KIND_LABEL: Record<MovementKind, string> = {
  receipt: 'Nhập kho',
  issue: 'Xuất kho',
  transfer: 'Chuyển kho',
};

export interface MovementInput {
  readonly kind: MovementKind;
  readonly warehouseCode: string;
  readonly toWarehouseCode?: string;
  readonly materialCode: string;
  readonly quantity: number;
  readonly unitCost?: number;
  readonly note: string;
}

export function MovementForm({
  workspace,
  busy,
  defaultKind = 'receipt',
  onCancel,
  onSubmit,
}: {
  workspace: InventoryWorkspace;
  busy?: boolean;
  defaultKind?: MovementKind;
  onCancel: () => void;
  onSubmit: (input: MovementInput) => void;
}) {
  const [kind, setKind] = useState<MovementKind>(defaultKind);
  const [warehouseCode, setWarehouseCode] = useState(workspace.warehouses[0]?.code ?? '');
  const [toWarehouseCode, setToWarehouseCode] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');

  const material = workspace.materials.find((item) => item.code === materialCode);
  const row = workspace.stock.find(
    (item) => item.materialCode === materialCode && item.warehouseCode === warehouseCode,
  );
  const available = row?.available ?? 0;
  const amount = Number(quantity) || 0;
  const overdraw = (kind === 'issue' || kind === 'transfer') && amount > available;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (overdraw) return;
    onSubmit({
      kind,
      warehouseCode,
      toWarehouseCode: kind === 'transfer' ? toWarehouseCode : undefined,
      materialCode,
      quantity: amount,
      unitCost: kind === 'receipt' && unitCost ? Number(unitCost) : undefined,
      note: note.trim(),
    });
  };

  return (
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={styles.modalDialog} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <h2>
            <span>⇄</span>
            {kind === 'receipt' ? 'Lập Phiếu Nhập Kho' : kind === 'issue' ? 'Lập Phiếu Xuất Kho' : 'Lập Phiếu Chuyển Kho'}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            {/* Kind Selector Pills */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {(Object.keys(KIND_LABEL) as MovementKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={kind === value ? styles.btnPrimary : styles.btnSecondary}
                  style={{ padding: '6px 14px', fontSize: '12.5px' }}
                  onClick={() => setKind(value)}
                >
                  {KIND_LABEL[value]}
                </button>
              ))}
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>{kind === 'transfer' ? 'Kho xuất (Nguồn) *' : 'Kho lưu trữ *'}</label>
                <select
                  required
                  value={warehouseCode}
                  onChange={(event) => setWarehouseCode(event.target.value)}
                >
                  {workspace.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.code}>
                      {warehouse.code} — {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>

              {kind === 'transfer' ? (
                <div className={styles.formGroup}>
                  <label>Kho nhập (Đích) *</label>
                  <select
                    required
                    value={toWarehouseCode}
                    onChange={(event) => setToWarehouseCode(event.target.value)}
                  >
                    <option value="">— Chọn kho đích —</option>
                    {workspace.warehouses
                      .filter((warehouse) => warehouse.code !== warehouseCode)
                      .map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.code}>
                          {warehouse.code} — {warehouse.name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}

              <div className={styles.formGroup}>
                <label>Vật tư / Phụ tùng *</label>
                <select
                  required
                  value={materialCode}
                  onChange={(event) => setMaterialCode(event.target.value)}
                >
                  <option value="">— Chọn vật tư —</option>
                  {workspace.materials.map((item) => (
                    <option key={item.id} value={item.code}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
                {materialCode ? (
                  <small style={{ color: overdraw ? '#dc2626' : 'var(--pe-text-muted)' }}>
                    Tồn khả dụng tại {warehouseCode}: <strong>{formatNumber(available)} {material?.unit ?? ''}</strong>
                  </small>
                ) : null}
              </div>

              <div className={styles.formGroup}>
                <label>Số lượng ({material?.unit ?? 'Đơn vị'}) *</label>
                <input
                  required
                  type="number"
                  min={0.01}
                  step="any"
                  placeholder="VD: 5"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
                {overdraw ? (
                  <small style={{ color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ Số lượng xuất vượt quá tồn khả dụng ({available}).
                  </small>
                ) : null}
              </div>

              {kind === 'receipt' ? (
                <div className={styles.formGroup}>
                  <label>Đơn giá nhập (VNĐ)</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="VD: 1500000"
                    value={unitCost}
                    onChange={(event) => setUnitCost(event.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div className={styles.formGroup}>
              <label>Lý do / Số chứng từ tham chiếu *</label>
              <textarea
                required
                rows={2}
                placeholder="VD: Nhập theo PO-2026-081 hoặc Xuất sửa chữa WO-2026-0412"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.modalFoot}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ bỏ
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={busy || overdraw || !materialCode || amount <= 0}
            >
              {busy ? 'Đang ghi sổ…' : `✓ Hoàn tất ${KIND_LABEL[kind]}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
