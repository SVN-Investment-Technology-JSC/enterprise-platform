import { randomUUID } from 'node:crypto';
import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { Pool, PoolClient } from 'pg';
import { SocialNotProvisionedError } from '../domain/social.error.js';

/** Thời điểm UTC dạng ISO giữ nguyên micro giây, để con trỏ phân trang không bỏ sót dòng cùng mili giây. */
export function isoColumn(expression: string): string {
  return `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Chọn pool của tenant và đổi lỗi "bảng/schema chưa có" (`42P01`, `3F000`) thành
 * `SocialNotProvisionedError`: migration chưa chạy xong cho tenant này.
 */
export class DiscoveryQueryRunner {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async run<TValue>(tenantId: string, operation: (pool: Pool) => Promise<TValue>): Promise<TValue> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    try {
      return await operation(pool);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '42P01' || code === '3F000') throw new SocialNotProvisionedError();
      throw error;
    }
  }
}

export interface DiscoveryOutboxEvent {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Ghi sự kiện vào outbox bằng chính `client` của transaction đang mở (skill erp-events). */
export async function writeOutboxEvent(
  client: PoolClient,
  tenantId: string,
  event: DiscoveryOutboxEvent,
): Promise<void> {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const envelope = {
    id,
    type: event.type,
    version: 1,
    occurredAt,
    tenantId,
    source: 'social',
    correlationId: event.aggregateId,
    payload: event.payload,
  };
  await client.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [id, event.aggregateType, event.aggregateId, event.type, 1, JSON.stringify(envelope), occurredAt],
  );
}
