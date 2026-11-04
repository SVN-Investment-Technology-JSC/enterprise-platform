'use client';

import type { Material, MaterialInventory, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadMaterialHistory, type InventoryLedgerRow } from '../inventory-api';
import { TRANSACTION_TYPE_LABEL, formatDateTime, formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';
import { useUserLabel } from '../user-names';

/** Dòng tồn của một mặt hàng; `materialCode` có khi dòng tồn đã được ghép mã ở màn Kho. */
export type StockRow = MaterialInventory & { warehouseCode?: string; materialCode?: string };

/** Một trường "nhãn nhỏ phía trên, giá trị bên dưới" của drawer chi tiết. */
export function DrawerField({
  label,
  hint,
  children,
}: {
  label: string;
  /** Lời giải thích hiện khi rê chuột vào nhãn. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }} title={hint}>
        {label}
      </span>
      <span style={{ fontSize: '14px', color: '#0f172a', overflowWrap: 'anywhere' }}>{children || '—'}</span>
    </div>
  );
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.drawerCard}>
      <h3 className={styles.drawerCardTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** Tồn của một mặt hàng theo từng kho, kèm tổng. Dịch vụ không quản lý tồn nên không có. */
export function MaterialStockSection({
  material,
  stock,
  warehouses,
}: {
  material: Pick<Material, 'id' | 'code' | 'unit' | 'kind'>;
  stock: readonly StockRow[];
  warehouses: readonly Warehouse[];
}) {
  const rows = useMemo(
    () => stock.filter((row) => row.materialId === material.id || row.materialCode === material.code),
    [stock, material.id, material.code],
  );
  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? '—';

  if (material.kind === 'SERVICE') {
    return <p className={styles.empty}>Dịch vụ không quản lý tồn kho.</p>;
  }
  if (rows.length === 0) return <p className={styles.empty}>Chưa có tồn ở kho nào.</p>;

  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  const available = rows.reduce((sum, row) => sum + row.available, 0);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.left}>Kho</th>
            <th className={styles.right}>Tồn thực tế</th>
            <th className={styles.right}>Đã giữ</th>
            <th className={styles.right}>Khả dụng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{warehouseName(row.warehouseId)}</td>
              <td className={styles.right}>
                {formatNumber(row.quantity)} {material.unit}
              </td>
              <td className={styles.right}>{formatNumber(row.quantityReserved)}</td>
              <td className={styles.right}>{formatNumber(row.available)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>Tổng</strong>
            </td>
            <td className={styles.right}>
              <strong>
                {formatNumber(total)} {material.unit}
              </strong>
            </td>
            <td className={styles.right} />
            <td className={styles.right}>
              <strong>{formatNumber(available)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Lịch sử nhập, xuất, điều chuyển của một mã (100 dòng gần nhất).
 * Dịch vụ không có tồn nên không có lịch sử và không gọi API.
 */
export function MaterialHistorySection({
  material,
  warehouses,
  warehouseId,
}: {
  material: Pick<Material, 'code' | 'unit' | 'kind'>;
  warehouses: readonly Warehouse[];
  /** Chỉ hiện phát sinh của kho này; bỏ trống là mọi kho. */
  warehouseId?: string;
}) {
  const [history, setHistory] = useState<InventoryLedgerRow[] | 'loading' | 'error'>('loading');
  const userName = useUserLabel();
  const isService = material.kind === 'SERVICE';

  useEffect(() => {
    if (isService) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistory('loading');
    loadMaterialHistory(material.code, 100)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory('error');
      });
    return () => {
      cancelled = true;
    };
  }, [material.code, isService]);

  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? '—';

  if (isService) {
    return <p className={styles.empty}>Dịch vụ không quản lý tồn kho nên không có lịch sử xuất nhập.</p>;
  }
  if (history === 'loading') return <p className={styles.empty}>Đang tải lịch sử…</p>;
  if (history === 'error') {
    return (
      <p className={styles.empty} role="alert">
        Không tải được lịch sử xuất nhập.
      </p>
    );
  }
  const rows = warehouseId ? history.filter((row) => row.warehouseId === warehouseId) : history;
  if (rows.length === 0) return <p className={styles.empty}>Chưa có phát sinh nhập hoặc xuất.</p>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.left}>Thời gian</th>
            <th className={styles.left}>Loại</th>
            <th className={styles.right}>Số lượng</th>
            <th className={styles.left}>Kho</th>
            <th className={styles.left}>Số phiếu</th>
            <th className={styles.left}>Người thực hiện</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDateTime(row.createdAt)}</td>
              <td>{TRANSACTION_TYPE_LABEL[row.type] ?? row.type}</td>
              <td className={styles.right}>
                {row.quantity > 0 ? '+' : ''}
                {formatNumber(row.quantity)} {material.unit}
              </td>
              <td>{warehouseName(row.warehouseId)}</td>
              <td>
                {/* Số phiếu là mã giao dịch hệ thống sinh; số hóa đơn nhập tay (nếu có) nằm dòng dưới. */}
                {row.transactionCode}
                {row.documentNumber ? <span className={styles.sub}>Hóa đơn: {row.documentNumber}</span> : null}
              </td>
              <td title={row.createdBy}>{userName(row.createdBy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
