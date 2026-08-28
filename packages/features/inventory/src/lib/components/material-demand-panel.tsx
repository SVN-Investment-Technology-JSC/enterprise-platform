'use client';

import type { Material, Reservation, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useMemo } from 'react';
import type { ProcedureWorkOrder } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

/** Phiếu giữ chỗ còn hiệu lực — phần chưa giao vẫn đang chờ hàng. */
const OPEN_STATUSES: ReadonlySet<Reservation['status']> = new Set([
  'PENDING',
  'RESERVED',
  'PARTIALLY_ISSUED',
]);

/**
 * Nhu cầu đang chờ của một mã vật tư: ai cần, bao nhiêu, cho work order nào.
 *
 * Thủ kho đứng trước phiếu nhập/xuất cần biết số mình sắp ghi có ăn vào phần đã
 * hứa cho một work order khác hay không. Con số tồn khả dụng một mình không trả
 * lời được điều đó — nó chỉ nói còn bao nhiêu, không nói bao nhiêu trong đó đã
 * có người chờ.
 *
 * Chỉ tính phần CHƯA giao (`quantityReserved - quantityIssued`): phiếu đã giao
 * xong không còn là nhu cầu, để lại chỉ làm nhiễu.
 */
export function MaterialDemandPanel({
  materialCode,
  materials,
  warehouses,
  reservations,
  workOrders,
}: {
  materialCode: string;
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  reservations: readonly Reservation[];
  /** Hồ sơ bên Quy trình, để đổi id tham chiếu thành mã người đọc hiểu được. */
  workOrders: readonly ProcedureWorkOrder[];
}) {
  const rows = useMemo(() => {
    const material = materials.find((item) => item.code === materialCode);
    if (!material) return [];

    const warehouseById = new Map(warehouses.map((item) => [item.id, item]));
    const orderById = new Map(workOrders.map((item) => [item.id, item]));

    return reservations
      .filter((reservation) => OPEN_STATUSES.has(reservation.status))
      .flatMap((reservation) =>
        (reservation.items ?? [])
          .filter((item) => item.materialId === material.id)
          .map((item) => ({
            key: item.id,
            outstanding: item.quantityReserved - item.quantityIssued,
            warehouse: warehouseById.get(item.warehouseId)?.code ?? '—',
            order: reservation.referenceId ? orderById.get(reservation.referenceId) : undefined,
            reservationCode: reservation.reservationCode,
            unit: material.unit ?? '',
          })),
      )
      .filter((row) => row.outstanding > 0);
  }, [materialCode, materials, warehouses, reservations, workOrders]);

  if (!materialCode) return null;

  if (rows.length === 0) {
    return <p className={styles.hint}>Không có work order nào đang chờ mã này.</p>;
  }

  const total = rows.reduce((sum, row) => sum + row.outstanding, 0);

  return (
    <div className={styles.demandPanel}>
      <header>
        <strong>Đang có người chờ</strong>
        <span>
          {formatNumber(total)} {rows[0].unit}
        </span>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <span className={styles.demandQty}>
              {formatNumber(row.outstanding)} {row.unit}
            </span>
            <span className={styles.demandWhere}>kho {row.warehouse}</span>
            {/* Quy trình không đọc được thì vẫn hiện mã phiếu giữ chỗ: thà một
                mã tra cứu được còn hơn một dòng trống. */}
            <span className={styles.demandOrder}>
              {row.order ? `${row.order.code} · ${row.order.title}` : row.reservationCode}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
