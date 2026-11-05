import { QUOTE_LINKS_MAX, type QuoteFollower, type QuoteLink, type QuoteLinkTargetType } from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type { QuoteRelationStore } from '../application/quote-relation-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { opportunityScopeSql } from './opportunity-scope-sql.js';
import { ownerScopeSql, type ScopeSqlFragment } from './owner-scope-sql.js';
import { QUOTE_AUDIT_ENTITY } from './postgres-quote.store.js';

const toIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/** Bảng, cột nhãn và cách lọc phạm vi theo loại đối tượng; `table` và cột lấy từ hằng, không từ dữ liệu người dùng. */
const TARGETS: Readonly<
  Record<QuoteLinkTargetType, { table: string; label: string; scope: (scope: CrmDataScope) => ScopeSqlFragment }>
> = {
  CUSTOMER: { table: 'customers', label: 'e.name', scope: (scope) => ownerScopeSql(scope, 'e.owner_user_id', 2) },
  OPPORTUNITY: { table: 'opportunities', label: 'e.name', scope: (scope) => opportunityScopeSql(scope, 'e.owner_user_id', 'e.id', 2) },
  CONTRACT: { table: 'contracts', label: 'e.code', scope: (scope) => ownerScopeSql(scope, 'e.owner_user_id', 2) },
  SALES_ORDER: { table: 'sales_orders', label: 'e.code', scope: (scope) => ownerScopeSql(scope, 'e.owner_user_id', 2) },
  QUOTE: {
    table: 'quotes',
    label: 'e.code',
    scope: (scope) => opportunityScopeSql(scope, 'e.owner_user_id', 'e.opportunity_id', 2, 'e.id'),
  },
};

export class PostgresQuoteRelationStore implements QuoteRelationStore {
  constructor(private readonly database: CrmDatabase) {}

  async quoteAccess(tenantId: string, scope: CrmDataScope, quoteId: string, mode: 'read' | 'write'): Promise<boolean> {
    const fragment =
      mode === 'read'
        ? opportunityScopeSql(scope, 'q.owner_user_id', 'q.opportunity_id', 2, 'q.id')
        : ownerScopeSql(scope, 'q.owner_user_id', 2);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(`SELECT 1 FROM crm_schema.quotes q WHERE q.id = $1 AND ${fragment.sql}`, [quoteId, ...fragment.params]);
    return result.rows.length > 0;
  }

  async listFollowers(tenantId: string, quoteId: string): Promise<QuoteFollower[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ user_id: string; added_at: Date; added_by: string | null }>(
      `SELECT user_id, added_at, added_by FROM crm_schema.quote_followers WHERE quote_id = $1 ORDER BY added_at, user_id`,
      [quoteId],
    );
    return result.rows.map((row) => ({ userId: row.user_id, addedAt: toIso(row.added_at), addedBy: row.added_by }));
  }

  addFollower(tenantId: string, quoteId: string, userId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO crm_schema.quote_followers (quote_id, user_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT (quote_id, user_id) DO NOTHING RETURNING user_id`,
        [quoteId, userId, actorId],
      );
      if (!inserted.rows.length) return false;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'follower-add',
        actorId,
        metadata: { userId },
      });
      return true;
    });
  }

  removeFollower(tenantId: string, quoteId: string, userId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const removed = await client.query(
        `DELETE FROM crm_schema.quote_followers WHERE quote_id = $1 AND user_id = $2 RETURNING user_id`,
        [quoteId, userId],
      );
      if (!removed.rows.length) return false;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'follower-remove',
        actorId,
        metadata: { userId },
      });
      return true;
    });
  }

  async listLinks(tenantId: string, quoteId: string): Promise<QuoteLink[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{
      id: string;
      target_type: QuoteLinkTargetType;
      target_id: string;
      target_label: string | null;
      created_at: Date;
      created_by: string | null;
    }>(
      `SELECT l.id, l.target_type, l.target_id, l.created_at, l.created_by,
              CASE l.target_type
                WHEN 'CUSTOMER' THEN (SELECT c.name FROM crm_schema.customers c WHERE c.id = l.target_id)
                WHEN 'OPPORTUNITY' THEN (SELECT o.name FROM crm_schema.opportunities o WHERE o.id = l.target_id)
                WHEN 'CONTRACT' THEN (SELECT k.code FROM crm_schema.contracts k WHERE k.id = l.target_id)
                WHEN 'SALES_ORDER' THEN (SELECT so.code FROM crm_schema.sales_orders so WHERE so.id = l.target_id)
                WHEN 'QUOTE' THEN (SELECT q.code FROM crm_schema.quotes q WHERE q.id = l.target_id)
              END AS target_label
         FROM crm_schema.quote_links l
        WHERE l.quote_id = $1
        ORDER BY l.created_at, l.id`,
      [quoteId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label ?? '(không còn tồn tại)',
      createdAt: toIso(row.created_at),
      createdBy: row.created_by,
    }));
  }

  async findTarget(tenantId: string, scope: CrmDataScope, type: QuoteLinkTargetType, id: string): Promise<string | undefined> {
    const target = TARGETS[type];
    const fragment = target.scope(scope);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ label: string }>(
      `SELECT ${target.label} AS label FROM crm_schema.${target.table} e WHERE e.id = $1 AND ${fragment.sql}`,
      [id, ...fragment.params],
    );
    return result.rows[0]?.label;
  }

  addLink(
    tenantId: string,
    quoteId: string,
    target: { readonly type: QuoteLinkTargetType; readonly id: string },
    actorId: string,
  ): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      // Khoá dòng báo giá để đếm và thêm không chạy đua.
      await client.query(`SELECT 1 FROM crm_schema.quotes WHERE id = $1 FOR UPDATE`, [quoteId]);
      const count = await client.query<{ total: string }>(`SELECT count(*) AS total FROM crm_schema.quote_links WHERE quote_id = $1`, [quoteId]);
      if (Number(count.rows[0]?.total ?? 0) >= QUOTE_LINKS_MAX) {
        throw new CrmConflictError('TOO_MANY_LINKS', `Mỗi báo giá tối đa ${QUOTE_LINKS_MAX} đối tượng liên quan.`);
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.quote_links (quote_id, target_type, target_id, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (quote_id, target_type, target_id) DO NOTHING RETURNING id`,
        [quoteId, target.type, target.id, actorId],
      );
      if (!inserted.rows.length) return false;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'link-add',
        actorId,
        metadata: { targetType: target.type, targetId: target.id },
      });
      return true;
    });
  }

  removeLink(tenantId: string, quoteId: string, linkId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const removed = await client.query<{ target_type: string; target_id: string }>(
        `DELETE FROM crm_schema.quote_links WHERE quote_id = $1 AND id = $2 RETURNING target_type, target_id`,
        [quoteId, linkId],
      );
      const row = removed.rows[0];
      if (!row) return false;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'link-remove',
        actorId,
        metadata: { targetType: row.target_type, targetId: row.target_id },
      });
      return true;
    });
  }
}
