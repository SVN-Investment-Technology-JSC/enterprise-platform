import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { RealtimeEventEnvelope, RealtimeServerEvent } from '@enterprise-platform/contracts-realtime';
import type { Pool, QueryResultRow } from 'pg';

export interface NotificationDeliveryPublisher {
  publish(event: IntegrationEventEnvelope): Promise<void>;
}

interface DeliveryRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  user_id: string;
  sequence: string | number;
  event_name: RealtimeServerEvent;
  event_version: 1;
  payload: unknown;
  occurred_at: Date | string;
}

export class NotificationDeliveryRelay {
  constructor(
    private readonly pool: Pool,
    private readonly publisher: NotificationDeliveryPublisher,
    private readonly batchSize = 100,
  ) {}

  async flush(): Promise<number> {
    const client = await this.pool.connect();
    let currentId: string | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<DeliveryRow>(
        `SELECT id, tenant_id, user_id, sequence, event_name, event_version,
                payload, occurred_at
           FROM notification_schema.notification_events
          WHERE published_at IS NULL
          ORDER BY occurred_at, sequence
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [this.batchSize],
      );
      for (const row of result.rows) {
        currentId = row.id;
        const realtimeEvent: RealtimeEventEnvelope = {
          id: row.id,
          event: row.event_name,
          version: row.event_version,
          tenantId: row.tenant_id,
          userId: row.user_id,
          sequence: Number(row.sequence),
          occurredAt: toIso(row.occurred_at),
          data: row.payload,
        };
        await this.publisher.publish({
          id: row.id,
          type: 'notification.delivery.v1',
          version: 1,
          occurredAt: realtimeEvent.occurredAt,
          tenantId: row.tenant_id,
          source: 'notification-worker',
          correlationId: `${row.user_id}:${row.sequence}`,
          payload: realtimeEvent,
        });
        await client.query(
          `UPDATE notification_schema.notification_events
              SET published_at = now(), publish_attempts = publish_attempts + 1,
                  last_error = NULL
            WHERE id = $1`,
          [row.id],
        );
      }
      await client.query('COMMIT');
      return result.rowCount ?? result.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      if (currentId) {
        await this.pool.query(
          `UPDATE notification_schema.notification_events
              SET publish_attempts = publish_attempts + 1,
                  last_error = left($2, 2000)
            WHERE id = $1 AND published_at IS NULL`,
          [currentId, error instanceof Error ? error.message : String(error)],
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
