import type {
  InventoryReservationEventLine,
  Reservation,
  ReservationItem,
} from '@enterprise-platform/contracts-inventory';
import type { PoolClient, QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  reservationReleasedEvent,
  type ReservationEventHeader,
} from './inventory-reservation-events.js';

type Row = QueryResultRow & Record<string, unknown>;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);
const num = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Giữ hàng ở trạng thái này còn phần chưa xuất để nhả hoặc để xuất theo. */
export const OPEN_RESERVATION_STATUSES = ['RESERVED', 'PARTIALLY_ISSUED'] as const;

export function mapReservationItem(row: Row): ReservationItem {
  return {
    id: str(row.id),
    reservationId: str(row.reservation_id),
    warehouseId: str(row.warehouse_id),
    materialId: str(row.material_id),
    quantityReserved: num(row.quantity_reserved),
    quantityIssued: num(row.quantity_issued),
  };
}

export function mapReservation(row: Row, items: ReservationItem[] = []): Reservation {
  return {
    id: str(row.id),
    reservationCode: str(row.reservation_code),
    referenceType: str(row.reference_type),
    referenceId: opt(row.reference_id),
    status: row.status as Reservation['status'],
    expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    sourceType: opt(row.source_type),
    sourceId: opt(row.source_id),
    idempotencyKey: opt(row.idempotency_key),
    items,
  };
}

export function reservationEventHeader(row: Row): ReservationEventHeader {
  return {
    id: str(row.id),
    reservationCode: str(row.reservation_code),
    referenceType: str(row.reference_type),
    referenceId: opt(row.reference_id),
    sourceType: opt(row.source_type),
    sourceId: opt(row.source_id),
    expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
  };
}

/** Mã giữ hàng. Đuôi lấy từ UUID: hai giữ hàng tạo cùng mili giây không trùng mã. */
export function newReservationCode(): string {
  return `RES-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function loadReservationItems(
  client: Pick<PoolClient, 'query'>,
  reservationId: string,
): Promise<ReservationItem[]> {
  const items = await client.query<Row>(
    `SELECT * FROM inventory_schema.reservation_items WHERE reservation_id = $1 ORDER BY id`,
    [reservationId],
  );
  return items.rows.map(mapReservationItem);
}

/**
 * Nhả phần chưa xuất của một giữ hàng ĐÃ KHOÁ `FOR UPDATE` và đóng nó.
 *
 * Thứ tự khoá như mọi đường khác: giữ hàng, rồi dòng giữ hàng, rồi dòng tồn theo
 * (warehouse_id, material_id). Ghi sự kiện vào outbox trong cùng transaction.
 * Bên gọi phải kiểm trạng thái còn mở trước khi gọi.
 */
export async function releaseLockedReservation(
  client: PoolClient,
  tenantId: string,
  header: Row,
  status: 'CANCELLED' | 'EXPIRED',
  actorUserId: string | null,
  writeOutbox: (
    client: PoolClient,
    tenantId: string,
    event: ReturnType<typeof reservationReleasedEvent>,
  ) => Promise<void>,
): Promise<Reservation> {
  const reservationId = str(header.id);
  const itemRows = await client.query<Row>(
    `SELECT i.*, w.code AS warehouse_code, m.code AS material_code
       FROM inventory_schema.reservation_items i
       JOIN inventory_schema.warehouses w ON w.id = i.warehouse_id
       JOIN inventory_schema.materials m ON m.id = i.material_id
      WHERE i.reservation_id = $1
      ORDER BY i.id
      FOR UPDATE OF i`,
    [reservationId],
  );

  // Gộp phần chưa xuất theo (kho, vật tư): giữ hàng cũ có thể có hai dòng cùng mã.
  const released = new Map<string, InventoryReservationEventLine>();
  for (const item of itemRows.rows) {
    const outstanding = round3(num(item.quantity_reserved) - num(item.quantity_issued));
    if (outstanding <= 0) continue;
    const key = `${str(item.warehouse_id)}|${str(item.material_id)}`;
    const current = released.get(key);
    released.set(key, {
      materialId: str(item.material_id),
      materialCode: str(item.material_code),
      warehouseId: str(item.warehouse_id),
      warehouseCode: str(item.warehouse_code),
      quantity: round3((current?.quantity ?? 0) + outstanding),
    });
  }
  const lines = [...released.values()].sort((left, right) =>
    left.warehouseId === right.warehouseId
      ? left.materialId.localeCompare(right.materialId)
      : left.warehouseId.localeCompare(right.warehouseId),
  );

  if (lines.length > 0) {
    await client.query(
      `SELECT b.id
         FROM inventory_schema.material_inventory b
         JOIN unnest($1::uuid[], $2::uuid[]) AS k(warehouse_id, material_id)
           ON k.warehouse_id = b.warehouse_id AND k.material_id = b.material_id
        WHERE b.location_id IS NULL
        ORDER BY b.warehouse_id, b.material_id
        FOR UPDATE OF b`,
      [lines.map((line) => line.warehouseId), lines.map((line) => line.materialId)],
    );
    for (const line of lines) {
      await client.query(
        `UPDATE inventory_schema.material_inventory
            SET quantity_reserved = GREATEST(0, quantity_reserved - $3), updated_at = now()
          WHERE warehouse_id = $1 AND material_id = $2 AND location_id IS NULL`,
        [line.warehouseId, line.materialId, line.quantity],
      );
    }
  }

  const updated = await client.query<Row>(
    `UPDATE inventory_schema.reservations SET status = $2 WHERE id = $1 RETURNING *`,
    [reservationId, status],
  );
  await writeOutbox(
    client,
    tenantId,
    reservationReleasedEvent(reservationEventHeader(updated.rows[0]), status, lines, actorUserId),
  );
  return mapReservation(updated.rows[0], itemRows.rows.map(mapReservationItem));
}
