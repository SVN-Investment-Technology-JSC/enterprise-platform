'use client';

import type { Material, TransactionType } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import type { InventoryLedgerRow } from '../inventory-api';
import {
  TRANSACTION_TYPE_LABEL,
  formatDateTime,
  formatNumber,
  referenceLabel,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

export function LedgerTable({
  rows,
  materialById,
  warehouseById,
}: {
  rows?: readonly InventoryLedgerRow[];
  materialById: ReadonlyMap<string, Material>;
  warehouseById: ReadonlyMap<string, string>;
}) {
  const [type, setType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const all = rows ?? [];

  const visible = useMemo(
    () =>
      all.filter((entry) => {
        if (type && entry.type !== type) return false;
        if (warehouseId && entry.warehouseId !== warehouseId) return false;
        // Ngày "đến" tính hết cả ngày, nếu không người dùng chọn cùng một ngày
        // cho cả hai ô sẽ không thấy giao dịch nào.
        if (from && entry.createdAt < from) return false;
        if (to && entry.createdAt > `${to}T23:59:59.999Z`) return false;
        return true;
      }),
    [all, type, warehouseId, from, to],
  );

  const filtered = Boolean(type || warehouseId || from || to);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Nhật ký giao dịch</h2>
        <span className={styles.countHint}>
          {formatNumber(visible.length)}
          {filtered ? ` / ${formatNumber(all.length)}` : ''} giao dịch
        </span>
      </div>

      <div className={styles.filterRow}>
        <label>
          Loại giao dịch
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(TRANSACTION_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kho
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Tất cả</option>
            {[...warehouseById].map(([id, code]) => (
              <option key={id} value={id}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Từ ngày
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        {filtered ? (
          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              setType('');
              setWarehouseId('');
              setFrom('');
              setTo('');
            }}
          >
            Xoá lọc
          </button>
        ) : null}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Chứng từ</th>
              <th>Thời gian</th>
              <th>Loại</th>
              <th>Vật tư</th>
              <th>Kho</th>
              <th className={styles.right}>Biến động</th>
              <th>Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.id}>
                <td className={styles.code}>{entry.transactionCode}</td>
                <td>{formatDateTime(entry.createdAt)}</td>
                <td>{TRANSACTION_TYPE_LABEL[entry.type as TransactionType] ?? entry.type}</td>
                <td className={styles.code}>
                  {materialById.get(entry.materialId)?.code ?? '—'}
                  <span className={styles.sub}>{materialById.get(entry.materialId)?.name}</span>
                </td>
                <td>{warehouseById.get(entry.warehouseId) ?? '—'}</td>
                <td
                  className={`${styles.numeric} ${styles.right} ${
                    entry.quantity < 0 ? styles.negative : styles.positive
                  }`}
                >
                  {entry.quantity > 0 ? '+' : ''}
                  {formatNumber(entry.quantity)}
                </td>
                <td>
                  {referenceLabel(entry.referenceType)}
                  {entry.note ? <span className={styles.sub}>{entry.note}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className={styles.empty}>
            {all.length === 0 ? 'Chưa có giao dịch.' : 'Không có giao dịch nào khớp bộ lọc.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
