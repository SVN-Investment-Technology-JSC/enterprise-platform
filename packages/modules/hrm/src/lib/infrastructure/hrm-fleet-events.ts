import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  HRM_FLEET_BOOKING_CONFIRMED,
  HRM_FLEET_BOOKING_CONFLICTED,
  HRM_FLEET_BOOKING_INBOUND,
  MAINTENANCE_FLEET_BOOKING_CANCELLED,
  MAINTENANCE_FLEET_BOOKING_REQUESTED,
  WORKSPACE_FLEET_BOOKING_CANCELLED,
  WORKSPACE_FLEET_BOOKING_REQUESTED,
  createIntegrationEvent,
  type FleetBookingCancelledPayload,
  type FleetBookingRequestedPayload,
  type FleetBookingResultPayload,
  type IntegrationEventEnvelope,
} from '@enterprise-platform/contracts-integration';
import { cancelFleetBookingBySource, upsertFleetBooking } from './hrm-fleet.js';
import { hrmTransaction } from './hrm-transaction.js';

/** Hàng đợi `hrm.integrations.v1` dùng chung; inbox riêng cho luồng đặt xe. */
const INBOX_CONSUMER = 'hrm.fleet-bookings';

export const HRM_FLEET_EVENT_BINDINGS = HRM_FLEET_BOOKING_INBOUND;

export function isFleetBookingInboundEvent(type: string): boolean {
  return (HRM_FLEET_BOOKING_INBOUND as readonly string[]).includes(type);
}

const REQUESTED: readonly string[] = [WORKSPACE_FLEET_BOOKING_REQUESTED, MAINTENANCE_FLEET_BOOKING_REQUESTED];
const CANCELLED: readonly string[] = [WORKSPACE_FLEET_BOOKING_CANCELLED, MAINTENANCE_FLEET_BOOKING_CANCELLED];

/** Mỗi module chỉ được đặt xe cho nguồn của chính nó. */
const SOURCES_OF: Record<string, readonly string[]> = {
  workspace: ['WORK_ITEM', 'CALENDAR_EVENT'],
  maintenance: ['INCIDENT'],
};

async function reply(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  type: string,
  payload: FleetBookingResultPayload,
) {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type,
    tenantId,
    source: 'hrm',
    correlationId: payload.sourceId,
    payload,
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1,'hrm-fleet-booking',$2,$3,$4,$5::jsonb,$6)`,
    [event.id, payload.sourceId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

function businessMessage(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : error.message;
}

/**
 * Nhận yêu cầu đặt hoặc huỷ xe từ Workspace/Maintenance. Trả `false` nếu sự kiện đã xử lý.
 * Trùng lịch hay xe không còn dùng được không làm hỏng giao dịch: HRM ghi nhận và trả lời `conflicted`.
 */
export async function receiveFleetBookingEvent(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
): Promise<boolean> {
  return hrmTransaction(pool, async (db) => {
    const fresh = await db.query(
      `INSERT INTO integration_schema.inbox_messages (consumer, event_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id`,
      [INBOX_CONSUMER, event.id],
    );
    if (!fresh.rowCount) return false;
    const origin = event.type.split('.')[0];
    const payload = event.payload as FleetBookingRequestedPayload & FleetBookingCancelledPayload;
    if (!SOURCES_OF[origin]?.includes(payload?.sourceType)) return true;

    if (CANCELLED.includes(event.type)) {
      await cancelFleetBookingBySource(db, tenantId, payload.sourceType as never, payload.sourceId);
      return true;
    }
    if (!REQUESTED.includes(event.type)) return true;

    const requester = payload.requesterUserId
      ? (
          await db.query(
            `SELECT id FROM core_schema.employees WHERE tenant_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
            [tenantId, payload.requesterUserId],
          )
        ).rows[0]
      : undefined;
    try {
      const booking = await upsertFleetBooking(db, tenantId, {
        sourceType: payload.sourceType as never,
        sourceId: payload.sourceId,
        vehicleId: payload.vehicleId,
        driverId: payload.driverId,
        startAt: payload.startAt,
        endAt: payload.endAt,
        destination: payload.destination ?? null,
        requesterEmployeeId: (requester?.id as string | undefined) ?? null,
        sourceLabel: payload.sourceLabel?.slice(0, 255) ?? null,
        // Công việc, lịch họp và sự cố không có bước duyệt nên lịch xác nhận ngay.
        status: 'CONFIRMED',
      });
      await reply(db, tenantId, HRM_FLEET_BOOKING_CONFIRMED, {
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        bookingId: booking.id,
      });
    } catch (error) {
      const reason = businessMessage(error);
      if (!reason) throw error;
      await reply(db, tenantId, HRM_FLEET_BOOKING_CONFLICTED, {
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        reason,
      });
    }
    return true;
  });
}
