import type {
  FinanceConfigAuditEntity,
  FinanceConfigAuditEntry,
  FinancePage,
} from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { invalid } from '../domain/finance.error.js';
import { iso, num, optStr, type Db } from './finance.database.js';

type Row = QueryResultRow & Record<string, unknown>;

/** Người sửa, ghi kèm mỗi dòng lịch sử (tên lưu tại thời điểm sửa). */
export interface ConfigAuditActor {
  id: string;
  name: string;
}

/** Một trường đổi giá trị. Giá trị là chữ (`null` = trống). */
export interface ConfigChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Giá trị cấu hình về dạng chữ để lưu lịch sử và so sánh. */
export function auditValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Các trường có giá trị khác nhau giữa trước và sau (so theo dạng chữ). */
export function diffFields(before: object, after: object, fields: readonly string[]): ConfigChange[] {
  const read = (source: object, field: string): unknown => (source as Record<string, unknown>)[field];
  return fields
    .map((field) => ({ field, oldValue: auditValue(read(before, field)), newValue: auditValue(read(after, field)) }))
    .filter((change) => change.oldValue !== change.newValue);
}

/** Ghi lịch sử, mỗi trường một dòng. Gọi trong cùng giao dịch với thay đổi dữ liệu. */
export async function writeConfigAudit(
  db: Db,
  tenantId: string,
  entityType: FinanceConfigAuditEntity,
  entityId: string | null,
  changes: readonly ConfigChange[],
  actor: ConfigAuditActor,
  reason: string | null,
): Promise<void> {
  for (const change of changes) {
    await db.query(
      `INSERT INTO finance_schema.config_audit
         (tenant_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, entityType, entityId, change.field, change.oldValue, change.newValue, reason, actor.id || null, actor.name || null],
    );
  }
}

/** Lý do sửa do người dùng nhập: bỏ khoảng trắng, tối đa 1000 ký tự; rỗng thành `null`. */
export function auditReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > 1000) throw invalid('Lý do tối đa 1000 ký tự.');
  return trimmed;
}

export interface ConfigAuditQuery {
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lịch sử cấu hình, mới nhất trước; lọc theo loại đối tượng và (tuỳ chọn) một tài khoản. */
export async function listConfigAudit(
  db: Db,
  tenantId: string,
  query: ConfigAuditQuery,
): Promise<FinancePage<FinanceConfigAuditEntry>> {
  const entityType = query.entityType ? String(query.entityType).toUpperCase() : null;
  if (entityType !== null && entityType !== 'SETTINGS' && entityType !== 'ACCOUNT') throw invalid('Loại lịch sử không hợp lệ.');
  const entityId = query.entityId ? String(query.entityId) : null;
  if (entityId !== null && !UUID.test(entityId)) throw invalid('Tài khoản không hợp lệ.');
  const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize) || 50), 1), 200);
  const page = Math.max(Math.trunc(Number(query.page) || 1), 1);
  const params: unknown[] = [tenantId, entityType, entityId];
  const where = `WHERE c.tenant_id = $1 AND ($2::text IS NULL OR c.entity_type = $2) AND ($3::uuid IS NULL OR c.entity_id = $3::uuid)`;
  const total = num(
    ((await db.query(`SELECT count(*) AS n FROM finance_schema.config_audit c ${where}`, params)).rows[0] as Row).n,
  );
  const rows = (
    await db.query(
      `SELECT c.*, a.code AS account_code, a.name AS account_name
         FROM finance_schema.config_audit c
         LEFT JOIN finance_schema.accounts a ON c.entity_type = 'ACCOUNT' AND a.id = c.entity_id
         ${where}
        ORDER BY c.created_at DESC, c.id
        LIMIT $4 OFFSET $5`,
      [...params, pageSize, (page - 1) * pageSize],
    )
  ).rows as Row[];
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      entityType: String(row.entity_type) as FinanceConfigAuditEntity,
      entityId: optStr(row.entity_id),
      entityLabel: row.account_code ? `${String(row.account_code)} - ${String(row.account_name ?? '')}` : null,
      field: String(row.field),
      oldValue: optStr(row.old_value),
      newValue: optStr(row.new_value),
      reason: optStr(row.reason),
      actorId: optStr(row.actor_id),
      actorName: optStr(row.actor_name),
      createdAt: iso(row.created_at),
    })),
    total,
    page,
    pageSize,
  };
}
