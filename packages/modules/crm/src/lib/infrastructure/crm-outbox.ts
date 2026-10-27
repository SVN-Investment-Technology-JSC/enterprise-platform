import { randomUUID } from 'node:crypto';
import {
  CRM_CUSTOMER_CREATED,
  CRM_CUSTOMER_UPDATED,
  createIntegrationEvent,
  type CrmCustomerEventPayload,
} from '@enterprise-platform/contracts-integration';
import type { CrmSqlClient } from './audit-log.js';

export interface CrmOutboxInput<TPayload> {
  /** Loại sự kiện, hằng số khai trong contracts (không gõ lại chuỗi). */
  readonly type: string;
  /** `crm-<đối tượng>`, ví dụ `crm-customer`. */
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
}

/**
 * Ghi một sự kiện vào `integration_schema.outbox_events` bằng client của
 * transaction đang mở, để sự kiện và thay đổi dữ liệu cùng commit hoặc cùng
 * rollback. Worker đọc outbox rồi phát lên RabbitMQ (skill `erp-events`).
 */
export async function writeCrmOutbox<TPayload>(
  client: CrmSqlClient,
  tenantId: string,
  input: CrmOutboxInput<TPayload>,
): Promise<void> {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type: input.type,
    version: 1,
    tenantId,
    source: 'crm',
    correlationId: input.aggregateId,
    payload: input.payload,
  });
  await client.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [event.id, input.aggregateType, input.aggregateId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

/**
 * Báo khách hàng vừa được tạo hoặc sửa (mã, tên, MST, phiên bản), đọc lại từ
 * chính dòng vừa ghi trong cùng transaction. Workspace giữ bản sao theo sự kiện
 * này (D1) và bỏ qua sự kiện có `version` không mới hơn bản đang giữ.
 */
export async function writeCustomerEvent(
  client: CrmSqlClient,
  tenantId: string,
  customerId: string,
  kind: 'created' | 'updated',
  actorUserId: string | null,
): Promise<void> {
  const result = await client.query<{ code: string; name: string; tax_code: string | null; version: number }>(
    `SELECT code, name, tax_code, version FROM crm_schema.customers WHERE id = $1`,
    [customerId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`crm_schema.customers ${customerId} not found while writing outbox event.`);
  const payload: CrmCustomerEventPayload = {
    customerId,
    code: row.code,
    name: row.name,
    taxCode: row.tax_code,
    version: Number(row.version),
    actorUserId,
  };
  await writeCrmOutbox(client, tenantId, {
    type: kind === 'created' ? CRM_CUSTOMER_CREATED : CRM_CUSTOMER_UPDATED,
    aggregateType: 'crm-customer',
    aggregateId: customerId,
    payload,
  });
}
