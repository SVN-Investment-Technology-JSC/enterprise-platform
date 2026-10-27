import { normalizeAuditEntry, type CrmAuditEntry } from '../domain/audit-log.js';

/**
 * Kết nối đang mở transaction của bên gọi. Chỉ cần `query`, nên `PoolClient`
 * của pg dùng thẳng được và test dùng client giả.
 */
export interface CrmSqlClient {
  query<TRow = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: TRow[] }>;
}

/**
 * Ghi một dòng nhật ký chuyển trạng thái vào `crm_schema.audit_log`.
 *
 * Gọi bằng client của transaction đang đổi dữ liệu, không bao giờ bằng pool:
 * transaction rollback thì nhật ký cũng mất theo, commit thì có cả hai. Hàm
 * không tự mở hay đóng transaction. Trả về id dòng vừa ghi.
 */
export async function writeAuditLog(client: CrmSqlClient, entry: CrmAuditEntry): Promise<string> {
  const row = normalizeAuditEntry(entry);
  const result = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.audit_log
       (entity_type, entity_id, from_status, to_status, action, actor_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      row.entityType,
      row.entityId,
      row.fromStatus,
      row.toStatus,
      row.action,
      row.actorId,
      row.reason,
      JSON.stringify(row.metadata ?? {}),
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('crm_schema.audit_log insert returned no row.');
  return id;
}
