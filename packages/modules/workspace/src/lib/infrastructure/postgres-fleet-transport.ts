import { randomUUID } from 'node:crypto';
import { inTransaction } from '@enterprise-platform/adapter-database';
import {
  WORKSPACE_FLEET_BOOKING_CANCELLED,
  WORKSPACE_FLEET_BOOKING_REQUESTED,
  createIntegrationEvent,
  type FleetBookingCancelledPayload,
  type FleetBookingRequestedPayload,
} from '@enterprise-platform/contracts-integration';
import type {
  SourceTransport,
  TransportMode,
  TransportSourceType,
  TransportStatus,
} from '@enterprise-platform/contracts-workspace';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { SaveSourceTransport, WorkspaceStore } from '../application/workspace-store.port.js';

type Row = QueryResultRow & Record<string, unknown>;
type Db = Pick<PoolClient, 'query'>;

const iso = (value: unknown) => (value == null ? null : new Date(value as string).toISOString());
const optText = (value: unknown) => (value == null ? null : String(value));

export function mapSourceTransport(row: Row): SourceTransport {
  return {
    sourceType: row.source_type as TransportSourceType,
    sourceId: String(row.source_id),
    mode: row.mode as TransportMode,
    detail: optText(row.detail),
    vehicleId: optText(row.vehicle_id),
    driverId: optText(row.driver_id),
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    destination: optText(row.destination),
    status: row.status as TransportStatus,
    statusReason: optText(row.status_reason),
  };
}

async function emit(
  db: Db,
  tenantId: string,
  type: string,
  sourceId: string,
  payload: FleetBookingRequestedPayload | FleetBookingCancelledPayload,
) {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type,
    tenantId,
    source: 'workspace',
    correlationId: sourceId,
    payload,
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'workspace-fleet-transport', $2, $3, $4, $5::jsonb, $6)`,
    [event.id, sourceId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

const SELECT_ONE = `SELECT * FROM workspace_schema.fleet_transports WHERE source_type = $1 AND source_id = $2`;

/** Phương tiện của công việc và lịch họp; mọi thay đổi xe công ty đi cùng sự kiện outbox trong một transaction. */
export function createFleetTransportStore(
  poolFor: (tenantId: string) => Promise<Pool>,
): WorkspaceStore['fleetTransport'] {
  return {
    find: async (tenantId, sourceType, sourceId) => {
      const pool = await poolFor(tenantId);
      const row = (await pool.query<Row>(SELECT_ONE, [sourceType, sourceId])).rows[0];
      return row ? mapSourceTransport(row) : undefined;
    },

    save: async (tenantId, input: SaveSourceTransport) => {
      const pool = await poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const before = (await client.query<Row>(`${SELECT_ONE} FOR UPDATE`, [input.sourceType, input.sourceId])).rows[0];
        const company = input.mode === 'COMPANY_VEHICLE';
        const unchanged =
          before &&
          before.mode === input.mode &&
          before.status !== 'CONFLICT' &&
          optText(before.detail) === (input.detail ?? null) &&
          optText(before.vehicle_id) === (input.vehicleId ?? null) &&
          optText(before.driver_id) === (input.driverId ?? null) &&
          iso(before.start_at) === (input.startAt ? new Date(input.startAt).toISOString() : null) &&
          iso(before.end_at) === (input.endAt ? new Date(input.endAt).toISOString() : null) &&
          optText(before.destination) === (input.destination ?? null) &&
          optText(before.source_label) === input.sourceLabel;
        if (unchanged) return mapSourceTransport(before);

        const saved = (
          await client.query<Row>(
            `INSERT INTO workspace_schema.fleet_transports
               (source_type, source_id, mode, detail, vehicle_id, driver_id, start_at, end_at, destination,
                source_label, requester_user_id, status, status_reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL)
             ON CONFLICT (source_type, source_id) DO UPDATE SET
               mode = EXCLUDED.mode, detail = EXCLUDED.detail, vehicle_id = EXCLUDED.vehicle_id,
               driver_id = EXCLUDED.driver_id, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
               destination = EXCLUDED.destination, source_label = EXCLUDED.source_label,
               requester_user_id = EXCLUDED.requester_user_id, status = EXCLUDED.status,
               status_reason = NULL, updated_at = now()
             RETURNING *`,
            [
              input.sourceType,
              input.sourceId,
              input.mode,
              company ? null : (input.detail ?? null),
              company ? input.vehicleId : null,
              company ? input.driverId : null,
              company ? input.startAt : null,
              company ? input.endAt : null,
              company ? (input.destination ?? null) : null,
              input.sourceLabel,
              input.requesterUserId,
              company ? 'REQUESTED' : 'NONE',
            ],
          )
        ).rows[0];

        if (company) {
          await emit(client, tenantId, WORKSPACE_FLEET_BOOKING_REQUESTED, input.sourceId, {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceLabel: input.sourceLabel,
            vehicleId: input.vehicleId as string,
            driverId: input.driverId as string,
            startAt: new Date(input.startAt as string).toISOString(),
            endAt: new Date(input.endAt as string).toISOString(),
            destination: input.destination ?? null,
            requesterUserId: input.requesterUserId,
          });
        } else if (before?.mode === 'COMPANY_VEHICLE') {
          // Chuyển từ xe công ty sang phương tiện ngoài: trả xe.
          await emit(client, tenantId, WORKSPACE_FLEET_BOOKING_CANCELLED, input.sourceId, {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          });
        }
        return mapSourceTransport(saved);
      });
    },

    clear: async (tenantId, sourceType, sourceId) => {
      const pool = await poolFor(tenantId);
      await inTransaction(pool, async (client) => {
        const removed = (
          await client.query<Row>(
            `DELETE FROM workspace_schema.fleet_transports WHERE source_type = $1 AND source_id = $2 RETURNING mode`,
            [sourceType, sourceId],
          )
        ).rows[0];
        if (removed?.mode === 'COMPANY_VEHICLE') {
          await emit(client, tenantId, WORKSPACE_FLEET_BOOKING_CANCELLED, sourceId, { sourceType, sourceId });
        }
      });
    },
  };
}
