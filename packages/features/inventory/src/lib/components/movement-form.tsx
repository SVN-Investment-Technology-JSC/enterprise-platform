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

/**
 * Nhập / xuất / chuyển kho.
 *
 * Ba lệnh này đã có endpoint từ lâu nhưng chưa nút nào gọi, nên tới giờ mọi phát
 * sinh tồn kho đều phải làm ngoài hệ thống. Ghi chú để bắt buộc: một dòng sổ cái
 * không có lý do thì sáu tháng sau không ai đối chiếu được.
 */
export function MovementForm({
  workspace,
  busy,
  onCancel,
  onSubmit,
}: {
  workspace: InventoryWorkspace;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: MovementInput) => void;
}) {
  const [kind, setKind] = useState<MovementKind>('receipt');
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

  // Xuất quá tồn khả dụng thì server cũng chặn, nhưng báo trước ở đây đỡ mất công
  // gõ lại cả phiếu.
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
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.cardHead}>
        <h2>Phát sinh tồn kho</h2>
      </div>

      <div className={styles.chipRow}>
        {(Object.keys(KIND_LABEL) as MovementKind[]).map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.chip} ${kind === value ? styles.chipOn : ''}`}
            onClick={() => setKind(value)}
          >
            {KIND_LABEL[value]}
          </button>
        ))}
      </div>

      <div className={styles.formGrid}>
        <label>
          {kind === 'transfer' ? 'Kho nguồn *' : 'Kho *'}
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
        </label>

        {kind === 'transfer' ? (
          <label>
            Kho đích *
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
          </label>
        ) : null}

        <label>
          Vật tư *
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
            <small className={overdraw ? styles.overdraw : undefined}>
              Khả dụng tại {warehouseCode}: {formatNumber(available)} {material?.unit ?? ''}
            </small>
          ) : null}
        </label>

        <label>
          Số lượng *
          <input
            required
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          {overdraw ? (
            <small className={styles.overdraw}>
              Vượt tồn khả dụng {formatNumber(available)} {material?.unit ?? ''}.
            </small>
          ) : null}
        </label>

        {kind === 'receipt' ? (
          <label>
            Đơn giá
            <input
              type="number"
              min={0}
              step="any"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <label>
        Lý do / chứng từ *
        <input
          required
          placeholder="VD: Nhập theo hoá đơn HD-2026-118, hoặc xuất cho workorder PR-..."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div className={styles.editActions}>
        <button
          type="submit"
          className={`${styles.action} ${styles.actionPrimary}`}
          disabled={busy || overdraw}
        >
          {busy ? 'Đang ghi sổ…' : KIND_LABEL[kind]}
        </button>
        <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
