'use client';

import type { Material, TransactionType } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InventoryLedgerRow } from '../inventory-api';
import { exportLedgerToExcel } from '../inventory-export';
import {
  TRANSACTION_TYPE_LABEL,
  formatDateTime,
  formatNoteDates,
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

  const typeOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả loại giao dịch' },
      ...Object.entries(TRANSACTION_TYPE_LABEL).map(([val, lbl]) => ({ value: val, label: lbl })),
    ],
    [],
  );

  const warehouseOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả kho' },
      ...[...warehouseById].map(([id, code]) => ({ value: id, label: code })),
    ],
    [warehouseById],
  );

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

  const handleExport = () => {
    exportLedgerToExcel({
      rows: visible,
      materialById,
      warehouseById,
    });
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Nhật ký giao dịch</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={styles.countHint}>
            {formatNumber(visible.length)}
            {filtered ? ` / ${formatNumber(all.length)}` : ''} giao dịch
          </span>
          <button
            type="button"
            className={`${styles.action} ${styles.actionGhost}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '36px' }}
            onClick={handleExport}
            title="Xuất nhật ký giao dịch ra tệp Excel"
          >
            <Download size={15} />
            <span>Xuất Excel</span>
          </button>
        </div>
      </div>

      <div className={styles.filterRow}>
        <label style={{ minWidth: '13rem' }}>
          Loại giao dịch
          <SearchableSelect
            options={typeOptions}
            value={type}
            placeholder="Tất cả"
            onChange={(val) => setType(val)}
            clearable
          />
        </label>
        <label style={{ minWidth: '11rem' }}>
          Kho
          <SearchableSelect
            options={warehouseOptions}
            value={warehouseId}
            placeholder="Tất cả"
            onChange={(val) => setWarehouseId(val)}
            clearable
          />
        </label>
        <label>
          Từ ngày
          <div style={{ minWidth: '9.5rem' }}>
            <DatePickerInput value={from} onChange={setFrom} height={34} />
          </div>
        </label>
        <label>
          Đến ngày
          <div style={{ minWidth: '9.5rem' }}>
            <DatePickerInput value={to} onChange={setTo} height={34} />
          </div>
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
              <th className={styles.center}>Biến động</th>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{materialById.get(entry.materialId)?.code ?? '—'}</span>
                    {materialById.get(entry.materialId)?.isActive === false ? (
                      <span
                        style={{
                          fontSize: '12px',
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
                  <span className={styles.sub}>{materialById.get(entry.materialId)?.name}</span>
                </td>
                <td>{warehouseById.get(entry.warehouseId) ?? '—'}</td>
                <td
                  className={`${styles.numeric} ${styles.center} ${
                    entry.quantity < 0 ? styles.negative : styles.positive
                  }`}
                >
                  {entry.quantity > 0 ? '+' : ''}
                  {formatNumber(entry.quantity)}
                </td>
                <td>
                  {referenceLabel(entry.referenceType)}
                  {entry.note ? <span className={styles.sub}>{formatNoteDates(entry.note)}</span> : null}
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
