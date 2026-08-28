'use client';

import type {
  Asset,
  InstallItemRequest,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import styles from '../inventory.module.scss';

/**
 * Lắp vật tư từ kho vào một thiết bị.
 *
 * Đây là một lệnh XUẤT, nên phải biết xuất từ kho nào và bao nhiêu. Mã vật tư
 * không rời khỏi danh mục: lắp 1 mét cáp thì kho còn 2999 mét, vì mét là đơn vị
 * tính chứ không phải một khối cố định.
 *
 * Tồn hiện theo ĐÚNG kho đang chọn, không phải tổng mọi kho. Tổng thì luôn nhìn
 * có vẻ đủ, còn thứ quyết định lệnh xuất có đi được hay không là số nằm trong
 * kho cụ thể đó.
 */
export function InstallMaterialDialog({
  parent,
  materials,
  warehouses,
  stock,
  busy,
  onCancel,
  onConfirm,
}: {
  parent: Asset;
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  stock: readonly MaterialInventory[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (code: string, input: InstallItemRequest) => void;
}) {
  const [materialCode, setMaterial] = useState('');
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  /** Tồn khả dụng theo cặp (mã vật tư, mã kho). */
  const onHand = useMemo(() => {
    const materialById = new Map(materials.map((item) => [item.id, item.code]));
    const warehouseById = new Map(warehouses.map((item) => [item.id, item.code]));
    const map = new Map<string, number>();
    for (const row of stock) {
      const code = materialById.get(row.materialId);
      const warehouse = warehouseById.get(row.warehouseId);
      if (!code || !warehouse) continue;
      const key = `${code}@${warehouse}`;
      map.set(key, (map.get(key) ?? 0) + row.available);
    }
    return map;
  }, [materials, warehouses, stock]);

  const picked = materials.find((item) => item.code === materialCode);
  const available =
    materialCode && warehouseCode ? (onHand.get(`${materialCode}@${warehouseCode}`) ?? 0) : undefined;

  const amount = Number(quantity);
  const valid = Number.isFinite(amount) && amount > 0;
  const short = available !== undefined && valid && amount > available;
  const ready = materialCode !== '' && warehouseCode !== '' && valid && !short;

  return (
    <div className={styles.orderDialog} role="dialog" aria-labelledby="install-title">
      <div className={styles.orderDialogBox}>
        <h2 id="install-title">Lắp vật tư vào {parent.name}</h2>
        <p>
          Xuất vật tư khỏi kho và lắp lên <strong>{parent.code}</strong>. Mã vật tư vẫn ở lại danh
          mục kho với phần tồn còn lại.
        </p>

        <label className={styles.fieldRow}>
          Vật tư
          <select value={materialCode} onChange={(event) => setMaterial(event.target.value)}>
            <option value="">— Chọn vật tư —</option>
            {materials.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name} ({item.code})
              </option>
            ))}
          </select>
        </label>

        <label className={styles.fieldRow}>
          Xuất từ kho
          <select value={warehouseCode} onChange={(event) => setWarehouse(event.target.value)}>
            <option value="">— Chọn kho —</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.code} value={warehouse.code}>
                {warehouse.name} ({warehouse.code})
              </option>
            ))}
          </select>
        </label>

        <label className={styles.fieldRow}>
          Số lượng {picked?.unit ? `(${picked.unit})` : ''}
          <input
            type="number"
            min={0}
            step="0.01"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        {available !== undefined ? (
          <p className={short ? styles.alert : styles.hint} role={short ? 'alert' : undefined}>
            {short
              ? `Kho ${warehouseCode} chỉ còn ${available} ${picked?.unit ?? ''} — không đủ ${amount}.`
              : `Kho ${warehouseCode} còn ${available} ${picked?.unit ?? ''}.`}
          </p>
        ) : null}

        <label className={styles.fieldRow}>
          Ghi chú
          <input
            value={note}
            placeholder="Vị trí lắp, lý do thay thế…"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className={styles.editActions}>
          <button
            type="button"
            className={`${styles.action} ${styles.actionPrimary}`}
            disabled={busy || !ready}
            onClick={() =>
              onConfirm(materialCode, {
                parentCode: parent.code,
                warehouseCode,
                quantity: amount,
                note: note.trim() || undefined,
              })
            }
          >
            Xuất kho và lắp
          </button>
          <button type="button" className={styles.action} onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}
