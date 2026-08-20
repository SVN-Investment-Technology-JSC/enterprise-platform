'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { Fragment, useMemo, useState } from 'react';
import type { InventoryReservationRow, InventoryWorkspace } from '../inventory-api';
import {
  MATERIAL_CATEGORY_LABEL,
  RESERVATION_STATUS_LABEL,
  WAREHOUSE_TYPE_LABEL,
  formatDateTime,
  formatNumber,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Tab Tồn kho gộp ba tab cũ: Tồn kho, Vật tư và Kho & vị trí. Một dòng tồn vốn đã
 * là một vật tư ở một kho, nên danh mục vật tư mở ra khi bấm vào dòng, còn danh
 * sách kho trở thành hàng chip lọc thay vì một tab riêng.
 */
export function StockTable({
  workspace,
  reservations,
  materialByCode,
  busy,
  onEditMaterial,
  onRetireMaterial,
}: {
  workspace: InventoryWorkspace;
  reservations?: readonly InventoryReservationRow[];
  materialByCode: ReadonlyMap<string, Material>;
  busy?: boolean;
  onEditMaterial?: (material: Material) => void;
  onRetireMaterial?: (material: Material) => void;
}) {
  const [warehouseCode, setWarehouseCode] = useState('all');
  const [query, setQuery] = useState('');
  const [openRowId, setOpenRowId] = useState<string>();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.stock.filter((row) => {
      if (warehouseCode !== 'all' && row.warehouseCode !== warehouseCode) return false;
      if (!needle) return true;
      const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
      return (
        (row.materialCode ?? '').toLowerCase().includes(needle) ||
        (material?.name ?? '').toLowerCase().includes(needle)
      );
    });
  }, [workspace.stock, warehouseCode, query, materialByCode]);

  /** Phiếu giữ chỗ đang chiếm số lượng của một dòng tồn, để giải thích cột "Đã giữ". */
  const holdersOf = (materialId: string, warehouseId: string) =>
    (reservations ?? []).filter((reservation) =>
      (reservation.items ?? []).some(
        (item) => item.materialId === materialId && item.warehouseId === warehouseId,
      ),
    );

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Tồn kho theo vật tư</h2>
        <input
          className={styles.searchInline}
          placeholder="Tìm mã hoặc tên vật tư…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.chipRow}>
        <button
          type="button"
          className={`${styles.chip} ${warehouseCode === 'all' ? styles.chipOn : ''}`}
          onClick={() => setWarehouseCode('all')}
        >
          Tất cả kho
        </button>
        {workspace.warehouses.map((warehouse) => (
          <button
            key={warehouse.id}
            type="button"
            title={`${warehouse.name} · ${WAREHOUSE_TYPE_LABEL[warehouse.type]}`}
            className={`${styles.chip} ${warehouseCode === warehouse.code ? styles.chipOn : ''}`}
            onClick={() => setWarehouseCode(warehouse.code)}
          >
            {warehouse.code}
          </button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vật tư</th>
              <th>Kho</th>
              <th className={styles.right}>Tồn thực</th>
              <th className={styles.right}>Đã giữ</th>
              <th className={styles.right}>Khả dụng</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
              const low = material ? row.available < material.minStock : false;
              const open = openRowId === row.id;
              const holders = open ? holdersOf(row.materialId, row.warehouseId) : [];
              return (
                <Fragment key={row.id}>
                  <tr
                    className={styles.clickable}
                    onClick={() => setOpenRowId(open ? undefined : row.id)}
                  >
                    <td className={styles.code}>
                      {row.materialCode ?? '—'}
                      {material ? <span className={styles.sub}>{material.name}</span> : null}
                    </td>
                    <td>{row.warehouseCode ?? '—'}</td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {formatNumber(row.quantity)} {material?.unit ?? ''}
                    </td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {formatNumber(row.quantityReserved)}
                    </td>
                    <td className={`${styles.numeric} ${styles.right} ${low ? styles.low : ''}`}>
                      {formatNumber(row.available)}
                      {low && material ? (
                        <span className={styles.sub}>dưới mức tối thiểu {formatNumber(material.minStock)}</span>
                      ) : null}
                    </td>
                  </tr>
                  {open ? (
                    <tr className={styles.detailRow}>
                      <td colSpan={5}>
                        <div className={styles.detailGrid}>
                          <div>
                            <span>Nhóm vật tư</span>
                            <strong>
                              {material ? MATERIAL_CATEGORY_LABEL[material.category] : '—'}
                            </strong>
                          </div>
                          <div>
                            <span>Đơn vị tính</span>
                            <strong>{material?.unit ?? '—'}</strong>
                          </div>
                          <div>
                            <span>Tồn tối thiểu / tối đa</span>
                            <strong>
                              {material
                                ? `${formatNumber(material.minStock)} / ${formatNumber(material.maxStock)}`
                                : '—'}
                            </strong>
                          </div>
                          <div>
                            <span>Cập nhật</span>
                            <strong>{formatDateTime(row.updatedAt)}</strong>
                          </div>
                        </div>

                        {material && (onEditMaterial || onRetireMaterial) ? (
                          <div className={styles.rowActions}>
                            {onEditMaterial ? (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => onEditMaterial(material)}
                              >
                                Sửa vật tư
                              </button>
                            ) : null}
                            {onRetireMaterial ? (
                              <button
                                type="button"
                                className={styles.dangerButton}
                                disabled={busy}
                                onClick={() => onRetireMaterial(material)}
                              >
                                Ngừng dùng
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {row.quantityReserved > 0 ? (
                          holders.length > 0 ? (
                            <ul className={styles.holderList}>
                              {holders.map((reservation) => {
                                const held = (reservation.items ?? [])
                                  .filter(
                                    (item) =>
                                      item.materialId === row.materialId &&
                                      item.warehouseId === row.warehouseId,
                                  )
                                  .reduce((sum, item) => sum + item.quantityReserved, 0);
                                return (
                                  <li key={reservation.id}>
                                    <span className={styles.code}>{reservation.reservationCode}</span>
                                    <span className={styles.pill}>
                                      {RESERVATION_STATUS_LABEL[reservation.status]}
                                    </span>
                                    <span>giữ {formatNumber(held)}</span>
                                    <em>
                                      {reservation.expiresAt
                                        ? `hết hạn ${formatDateTime(reservation.expiresAt)}`
                                        : 'không hạn'}
                                    </em>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className={styles.hint}>
                              Số lượng đang giữ không khớp phiếu nào còn hiệu lực.
                            </p>
                          )
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className={styles.empty}>
            {workspace.stock.length === 0 ? 'Chưa có tồn kho.' : 'Không có dòng tồn nào khớp bộ lọc.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
