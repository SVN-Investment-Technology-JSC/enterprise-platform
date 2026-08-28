'use client';

import type { ReturnItemToStockRequest, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useState } from 'react';
import styles from '../inventory.module.scss';

/**
 * Thanh lý một vật tư khỏi cây lắp đặt.
 *
 * Thanh lý ở đây KHÔNG phải xoá. Hàng đã vào sổ kho thì chỉ có nhập hoặc xuất —
 * mã vật tư và toàn bộ lịch sử của nó luôn ở lại. Tháo một thiết bị xuống là
 * một lệnh NHẬP: hiện vật rời khỏi vị trí lắp đặt và về nằm trong một kho.
 *
 * Vì vậy kho tiếp nhận là bắt buộc, không có kho mặc định. Đoán một kho thay
 * người bấm nghĩa là ghi tăng tồn ở nơi hiện vật không hề có mặt, và sai lệch
 * đó chỉ lộ ra ở kỳ kiểm kê sau.
 */
export function ReturnToStockDialog({
  title,
  description,
  unit,
  maxQuantity,
  warehouses,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  /** Đơn vị tính, để hiện cạnh ô số lượng. */
  unit?: string;
  /** Trần cho ô số lượng: số đang lắp trên thiết bị. Bỏ trống là không chặn. */
  maxQuantity?: number;
  warehouses: readonly Warehouse[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: ReturnItemToStockRequest) => void;
}) {
  // Một kho thì chọn sẵn — vẫn là lựa chọn có ý thức vì nó hiện rõ trên màn
  // hình, chỉ là không bắt bấm thêm một lần cho một phương án duy nhất.
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const amount = Number(quantity);
  const valid = Number.isFinite(amount) && amount > 0;
  const over = maxQuantity !== undefined && valid && amount > maxQuantity;
  const ready = warehouseCode !== '' && valid && !over;

  return (
    <div className={styles.orderDialog} role="dialog" aria-labelledby="return-title">
      <div className={styles.orderDialogBox}>
        <h2 id="return-title">{title}</h2>
        <p>{description}</p>

        <label className={styles.fieldRow}>
          Kho tiếp nhận
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
          Số lượng {unit ? `(${unit})` : ''}
          {/* Thiết bị tháo xuống thường là một cá thể, nhưng vật tư rời thì thủ
              kho đếm được bao nhiêu nhập bấy nhiêu. */}
          <input
            type="number"
            min={0}
            step="0.01"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        <label className={styles.fieldRow}>
          Ghi chú
          <input
            value={note}
            placeholder="Lý do tháo, tình trạng khi về kho…"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {over ? (
          <p className={styles.alert} role="alert">
            Chỉ đang lắp {maxQuantity} {unit ?? ''} — không tháo được {amount}.
          </p>
        ) : null}

        {warehouses.length === 0 ? (
          <p className={styles.alert} role="alert">
            Chưa khai báo kho nào nên chưa nhập hàng về được.
          </p>
        ) : null}

        <div className={styles.editActions}>
          <button
            type="button"
            className={`${styles.action} ${styles.actionPrimary}`}
            disabled={busy || !ready}
            onClick={() =>
              onConfirm({
                warehouseCode,
                quantity: amount,
                note: note.trim() || undefined,
              })
            }
          >
            Nhập về kho
          </button>
          <button type="button" className={styles.action} onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}
