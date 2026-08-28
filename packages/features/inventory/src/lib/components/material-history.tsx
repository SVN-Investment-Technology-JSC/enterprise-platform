'use client';

import type { TransactionType } from '@enterprise-platform/contracts-inventory';
import { formatDateTime, formatNumber } from '../inventory-labels';
import type { InventoryLedgerRow } from '../inventory-api';
import styles from '../inventory.module.scss';

/** Nhãn loại bút toán, nói theo việc thủ kho làm chứ không theo tên enum. */
const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  IMPORT: 'Nhập kho',
  EXPORT: 'Xuất kho',
  TRANSFER_IN: 'Chuyển đến',
  TRANSFER_OUT: 'Chuyển đi',
  BORROW: 'Mượn',
  RETURN: 'Trả',
  ADJUST: 'Điều chỉnh',
};

/**
 * Lịch sử nhập/xuất của một mã vật tư.
 *
 * Tách ra khỏi bảng tồn kho cũ khi hai bảng gộp làm một: nội dung không đổi, chỉ
 * đổi chỗ đứng — giờ nó nằm trong khối chi tiết bung ra dưới chính mã đó.
 */
export function MaterialHistory(props: {
  state: InventoryLedgerRow[] | 'loading' | 'error' | undefined;
  unit?: string;
  warehouseCodeById: ReadonlyMap<string, string>;
}) {
  if (props.state === undefined || props.state === 'loading') {
    return <p className={styles.historyNote}>Đang tải lịch sử…</p>;
  }
  if (props.state === 'error') {
    return <p className={styles.historyNote}>Không đọc được lịch sử nhập/xuất.</p>;
  }
  if (props.state.length === 0) {
    return <p className={styles.historyNote}>Vật tư này chưa có giao dịch nào.</p>;
  }

  return (
    <div className={styles.historyWrap}>
      <h4>Lịch sử nhập/xuất</h4>
      <ul className={styles.historyList}>
        {props.state.map((entry) => (
          <li key={entry.id}>
            <span className={styles.historyWhen}>{formatDateTime(entry.createdAt)}</span>
            <span className={styles.historyType}>
              {TYPE_LABEL[entry.type] ?? entry.type}
              {props.warehouseCodeById.get(entry.warehouseId)
                ? ` · ${props.warehouseCodeById.get(entry.warehouseId)}`
                : ''}
            </span>
            <span
              className={`${styles.historyQty} ${
                entry.quantity < 0 ? styles.historyOut : styles.historyIn
              }`}
            >
              {entry.quantity > 0 ? '+' : ''}
              {formatNumber(entry.quantity)} {props.unit ?? ''}
            </span>
            {entry.note ? <small className={styles.historyNoteLine}>{entry.note}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
