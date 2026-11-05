import { QUOTE_DOCUMENT_REFERENCES_MAX, type QuoteDocumentSource } from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type { QuoteDocumentStore, StoredDocumentReference } from '../application/quote-document-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { opportunityScopeSql } from './opportunity-scope-sql.js';
import { ownerScopeSql } from './owner-scope-sql.js';
import { QUOTE_AUDIT_ENTITY } from './postgres-quote.store.js';
import { toIso } from './sql-helpers.js';

/** Tối đa số báo giá anh em được liệt kê làm nguồn. */
const SIBLING_QUOTES_MAX = 50;

export class PostgresQuoteDocumentStore implements QuoteDocumentStore {
  constructor(private readonly database: CrmDatabase) {}

  async quoteVisible(tenantId: string, scope: CrmDataScope, quoteId: string): Promise<boolean> {
    // Cùng điều kiện với `PostgresDocumentStore.entityVisible('quote')`.
    const fragment = opportunityScopeSql(scope, 'q.owner_user_id', 'q.opportunity_id', 2);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(`SELECT 1 FROM crm_schema.quotes q WHERE q.id = $1 AND ${fragment.sql}`, [quoteId, ...fragment.params]);
    return result.rows.length > 0;
  }

  async visibleSources(tenantId: string, scope: CrmDataScope, quoteId: string): Promise<QuoteDocumentSource[]> {
    const pool = await this.database.pool(tenantId);
    const head = await pool.query<{ customer_id: string; opportunity_id: string | null }>(
      `SELECT customer_id, opportunity_id FROM crm_schema.quotes WHERE id = $1`,
      [quoteId],
    );
    const row = head.rows[0];
    if (!row) return [];
    const sources: QuoteDocumentSource[] = [];

    const customerScope = ownerScopeSql(scope, 'c.owner_user_id', 2);
    const customer = await pool.query<{ id: string; label: string }>(
      `SELECT c.id, c.name AS label FROM crm_schema.customers c WHERE c.id = $1 AND ${customerScope.sql}`,
      [row.customer_id, ...customerScope.params],
    );
    if (customer.rows[0]) sources.push({ entityType: 'customer', entityId: customer.rows[0].id, label: customer.rows[0].label });

    if (row.opportunity_id) {
      const opportunityScope = opportunityScopeSql(scope, 'o.owner_user_id', 'o.id', 2);
      const opportunity = await pool.query<{ id: string; label: string }>(
        `SELECT o.id, o.name AS label FROM crm_schema.opportunities o WHERE o.id = $1 AND ${opportunityScope.sql}`,
        [row.opportunity_id, ...opportunityScope.params],
      );
      if (opportunity.rows[0]) sources.push({ entityType: 'opportunity', entityId: opportunity.rows[0].id, label: opportunity.rows[0].label });

      const siblingScope = opportunityScopeSql(scope, 'q.owner_user_id', 'q.opportunity_id', 3);
      const siblings = await pool.query<{ id: string; label: string }>(
        `SELECT q.id, q.code AS label FROM crm_schema.quotes q
          WHERE q.opportunity_id = $1 AND q.id <> $2 AND ${siblingScope.sql}
          ORDER BY q.created_at, q.id LIMIT ${SIBLING_QUOTES_MAX}`,
        [row.opportunity_id, quoteId, ...siblingScope.params],
      );
      for (const sibling of siblings.rows) sources.push({ entityType: 'quote', entityId: sibling.id, label: sibling.label });
    }
    return sources;
  }

  async listReferences(tenantId: string, quoteId: string): Promise<StoredDocumentReference[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string; document_id: string; created_at: Date; created_by: string }>(
      `SELECT id, document_id, created_at, created_by FROM crm_schema.document_references
        WHERE target_entity_type = 'quote' AND target_entity_id = $1 ORDER BY created_at, id`,
      [quoteId],
    );
    return result.rows.map(toStored);
  }

  async findReference(tenantId: string, quoteId: string, referenceId: string): Promise<StoredDocumentReference | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string; document_id: string; created_at: Date; created_by: string }>(
      `SELECT id, document_id, created_at, created_by FROM crm_schema.document_references
        WHERE id = $1 AND target_entity_type = 'quote' AND target_entity_id = $2`,
      [referenceId, quoteId],
    );
    return result.rows[0] ? toStored(result.rows[0]) : undefined;
  }

  async sourceOfDocument(tenantId: string, documentId: string): Promise<QuoteDocumentSource | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ entity_type: 'customer' | 'opportunity' | 'quote'; entity_id: string; label: string | null }>(
      `SELECT d.entity_type, d.entity_id,
              CASE d.entity_type
                WHEN 'customer' THEN (SELECT c.name FROM crm_schema.customers c WHERE c.id = d.entity_id)
                WHEN 'opportunity' THEN (SELECT o.name FROM crm_schema.opportunities o WHERE o.id = d.entity_id)
                WHEN 'quote' THEN (SELECT q.code FROM crm_schema.quotes q WHERE q.id = d.entity_id)
              END AS label
         FROM crm_schema.documents d WHERE d.id = $1 AND d.entity_type IN ('customer', 'opportunity', 'quote')`,
      [documentId],
    );
    const row = result.rows[0];
    return row ? { entityType: row.entity_type, entityId: row.entity_id, label: row.label ?? '(không còn tồn tại)' } : undefined;
  }

  addReference(tenantId: string, quoteId: string, documentId: string, actorId: string): Promise<string | undefined> {
    return this.database.transaction(tenantId, async (client) => {
      // Khoá dòng báo giá để đếm và thêm không chạy đua.
      await client.query(`SELECT 1 FROM crm_schema.quotes WHERE id = $1 FOR UPDATE`, [quoteId]);
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM crm_schema.document_references WHERE target_entity_type = 'quote' AND target_entity_id = $1`,
        [quoteId],
      );
      if (Number(count.rows[0]?.total ?? 0) >= QUOTE_DOCUMENT_REFERENCES_MAX) {
        throw new CrmConflictError('TOO_MANY_DOCUMENT_REFERENCES', `Mỗi báo giá đính kèm tối đa ${QUOTE_DOCUMENT_REFERENCES_MAX} tài liệu có sẵn.`);
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.document_references (document_id, target_entity_type, target_entity_id, created_by)
         VALUES ($1, 'quote', $2, $3) ON CONFLICT (document_id, target_entity_type, target_entity_id) DO NOTHING RETURNING id`,
        [documentId, quoteId, actorId],
      );
      const id = inserted.rows[0]?.id;
      if (!id) return undefined;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'document-ref-add',
        actorId,
        metadata: { documentId },
      });
      return id;
    });
  }

  removeReference(tenantId: string, quoteId: string, referenceId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const removed = await client.query<{ document_id: string }>(
        `DELETE FROM crm_schema.document_references
          WHERE id = $1 AND target_entity_type = 'quote' AND target_entity_id = $2 RETURNING document_id`,
        [referenceId, quoteId],
      );
      if (!removed.rows.length) return false;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'document-ref-remove',
        actorId,
        metadata: { documentId: removed.rows[0].document_id },
      });
      return true;
    });
  }
}

function toStored(row: { id: string; document_id: string; created_at: Date; created_by: string }): StoredDocumentReference {
  return { id: row.id, documentId: row.document_id, createdAt: toIso(row.created_at) as string, createdBy: row.created_by };
}
