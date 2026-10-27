import {
  INVENTORY_RESERVATION_CREATED_EVENT,
  INVENTORY_RESERVATION_EXPIRED_EVENT,
  INVENTORY_RESERVATION_RELEASED_EVENT,
  type InventoryReservationEventLine,
  type InventoryReservationReleasedPayload,
  type InventoryStockReservationCreatedPayload,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryNotificationEvent } from './inventory-notification-events.js';

/** Phần đầu giữ hàng mà sự kiện cần, đọc từ dòng `reservations`. */
export interface ReservationEventHeader {
  readonly id: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  readonly referenceId?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly expiresAt?: string;
}

const AGGREGATE_TYPE = 'inventory-reservation';
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function reservationCreatedEvent(
  header: ReservationEventHeader,
  lines: readonly InventoryReservationEventLine[],
  actorUserId: string | null,
): InventoryNotificationEvent {
  const payload: InventoryStockReservationCreatedPayload = {
    reservationId: header.id,
    reservationCode: header.reservationCode,
    referenceType: header.referenceType,
    referenceId: header.referenceId ?? null,
    materialCode: lines[0]?.materialCode ?? '',
    quantityReserved: lines[0]?.quantity ?? 0,
    sourceType: header.sourceType ?? null,
    sourceId: header.sourceId ?? null,
    expiresAt: header.expiresAt ?? null,
    lines,
    actorUserId,
  };
  return {
    type: INVENTORY_RESERVATION_CREATED_EVENT,
    aggregateType: AGGREGATE_TYPE,
    aggregateId: header.id,
    payload: { ...payload },
  };
}

/** Nhả tay (`CANCELLED`) hoặc job hết hạn (`EXPIRED`): cùng payload, khác loại sự kiện. */
export function reservationReleasedEvent(
  header: ReservationEventHeader,
  status: 'CANCELLED' | 'EXPIRED',
  releasedLines: readonly InventoryReservationEventLine[],
  actorUserId: string | null,
): InventoryNotificationEvent {
  const payload: InventoryReservationReleasedPayload = {
    reservationId: header.id,
    reservationCode: header.reservationCode,
    referenceType: header.referenceType,
    referenceId: header.referenceId ?? null,
    sourceType: header.sourceType ?? null,
    sourceId: header.sourceId ?? null,
    status,
    releasedLines,
    releasedQuantity: round3(releasedLines.reduce((sum, line) => sum + line.quantity, 0)),
    actorUserId,
  };
  return {
    type:
      status === 'EXPIRED'
        ? INVENTORY_RESERVATION_EXPIRED_EVENT
        : INVENTORY_RESERVATION_RELEASED_EVENT,
    aggregateType: AGGREGATE_TYPE,
    aggregateId: header.id,
    payload: { ...payload },
  };
}
