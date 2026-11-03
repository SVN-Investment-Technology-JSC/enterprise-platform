import {
  OPPORTUNITY_PROMOTIONS_MAX,
  type PromotionDiscountType,
  type PromotionKind,
  type QuotePromotionSnapshot,
} from '@enterprise-platform/contracts-crm';
import type { OpportunityPromotionRow, PromotionStore } from '../application/promotion-store.port.js';
import type { QuoteVersionRef } from '../application/quote-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import type { PromotionCatalogRow, PromotionRecord } from '../domain/promotion.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { lockVersion, QUOTE_AUDIT_ENTITY } from './postgres-quote.store.js';
import { constraintViolation, toDateOnly, toIso } from './sql-helpers.js';

/** Khoá thực thể ghi `audit_log` cho danh mục khuyến mãi. */
export const PROMOTION_CATALOG_AUDIT_ENTITY = 'promotion_catalog';

interface CatalogDbRow {
  id: string;
  kind: PromotionKind;
  code: string;
  name: string;
  description: string | null;
  discount_type: PromotionDiscountType;
  value: string;
  valid_from: Date | string | null;
  valid_to: Date | string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

const CATALOG_COLUMNS = 'id, kind, code, name, description, discount_type, value, valid_from, valid_to, active, created_at, updated_at';
const CODE_EXISTS = () => new CrmConflictError('PROMOTION_CODE_EXISTS', 'Mã khuyến mãi đã tồn tại.');

function toCatalog(row: CatalogDbRow): PromotionCatalogRow {
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    description: row.description,
    discountType: row.discount_type,
    value: Number(row.value),
    validFrom: toDateOnly(row.valid_from),
    validTo: toDateOnly(row.valid_to),
    active: row.active,
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  };
}

export class PostgresPromotionStore implements PromotionStore {
  constructor(private readonly database: CrmDatabase) {}

  async listCatalog(tenantId: string, query: { readonly kind?: string; readonly includeInactive: boolean }): Promise<PromotionCatalogRow[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CatalogDbRow>(
      `SELECT ${CATALOG_COLUMNS} FROM crm_schema.promotion_catalog
        WHERE ($1::boolean OR active) AND ($2::varchar IS NULL OR kind = $2::varchar)
        ORDER BY kind, name, id`,
      [query.includeInactive, query.kind ?? null],
    );
    return result.rows.map(toCatalog);
  }

  async getCatalog(tenantId: string, id: string): Promise<PromotionCatalogRow | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CatalogDbRow>(`SELECT ${CATALOG_COLUMNS} FROM crm_schema.promotion_catalog WHERE id = $1`, [id]);
    return result.rows[0] ? toCatalog(result.rows[0]) : undefined;
  }

  createCatalog(tenantId: string, record: PromotionRecord, actorId: string): Promise<PromotionCatalogRow> {
    return this.database.transaction(tenantId, async (client) => {
      let result;
      try {
        result = await client.query<CatalogDbRow>(
          `INSERT INTO crm_schema.promotion_catalog
             (kind, code, name, description, discount_type, value, valid_from, valid_to, active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           RETURNING ${CATALOG_COLUMNS}`,
          [record.kind, record.code, record.name, record.description, record.discountType, record.value, record.validFrom, record.validTo, record.active, actorId],
        );
      } catch (error) {
        if (constraintViolation(error, '23505', 'uq_crm_promotion_catalog_code')) throw CODE_EXISTS();
        throw error;
      }
      const row = toCatalog(result.rows[0]);
      await writeAuditLog(client, {
        entityType: PROMOTION_CATALOG_AUDIT_ENTITY,
        entityId: row.id,
        action: 'create',
        actorId,
        metadata: { kind: row.kind, code: row.code },
      });
      return row;
    });
  }

  updateCatalog(tenantId: string, id: string, record: PromotionRecord, actorId: string): Promise<PromotionCatalogRow | undefined> {
    return this.database.transaction(tenantId, async (client) => {
      let result;
      try {
        result = await client.query<CatalogDbRow>(
          `UPDATE crm_schema.promotion_catalog
              SET code = $2, name = $3, description = $4, discount_type = $5, value = $6, valid_from = $7, valid_to = $8,
                  active = $9, updated_at = now(), updated_by = $10
            WHERE id = $1
            RETURNING ${CATALOG_COLUMNS}`,
          [id, record.code, record.name, record.description, record.discountType, record.value, record.validFrom, record.validTo, record.active, actorId],
        );
      } catch (error) {
        if (constraintViolation(error, '23505', 'uq_crm_promotion_catalog_code')) throw CODE_EXISTS();
        throw error;
      }
      if (!result.rows[0]) return undefined;
      const row = toCatalog(result.rows[0]);
      await writeAuditLog(client, {
        entityType: PROMOTION_CATALOG_AUDIT_ENTITY,
        entityId: id,
        action: row.active ? 'update' : 'deactivate',
        actorId,
        metadata: { code: row.code },
      });
      return row;
    });
  }

  async listOpportunityPromotions(tenantId: string, opportunityId: string): Promise<OpportunityPromotionRow[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<
      CatalogDbRow & { link_id: string; link_note: string | null; link_created_at: Date; link_created_by: string | null }
    >(
      `SELECT op.id AS link_id, op.note AS link_note, op.created_at AS link_created_at, op.created_by AS link_created_by,
              c.id, c.kind, c.code, c.name, c.description, c.discount_type, c.value, c.valid_from, c.valid_to, c.active,
              c.created_at, c.updated_at
         FROM crm_schema.opportunity_promotions op
         JOIN crm_schema.promotion_catalog c ON c.id = op.catalog_id
        WHERE op.opportunity_id = $1
        ORDER BY op.created_at, op.id`,
      [opportunityId],
    );
    return result.rows.map((row) => ({
      id: row.link_id,
      opportunityId,
      catalog: toCatalog(row),
      note: row.link_note,
      createdAt: toIso(row.link_created_at) as string,
      createdBy: row.link_created_by,
    }));
  }

  addOpportunityPromotion(tenantId: string, opportunityId: string, catalogId: string, note: string | null, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      // Khoá dòng cơ hội để đếm và thêm không chạy đua.
      await client.query(`SELECT 1 FROM crm_schema.opportunities WHERE id = $1 FOR UPDATE`, [opportunityId]);
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM crm_schema.opportunity_promotions WHERE opportunity_id = $1`,
        [opportunityId],
      );
      if (Number(count.rows[0]?.total ?? 0) >= OPPORTUNITY_PROMOTIONS_MAX) {
        throw new CrmConflictError('TOO_MANY_PROMOTIONS', `Mỗi dự án chọn tối đa ${OPPORTUNITY_PROMOTIONS_MAX} khuyến mãi.`);
      }
      const inserted = await client.query(
        `INSERT INTO crm_schema.opportunity_promotions (opportunity_id, catalog_id, note, created_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (opportunity_id, catalog_id) DO NOTHING RETURNING id`,
        [opportunityId, catalogId, note, actorId],
      );
      if (!inserted.rows.length) return false;
      await writeAuditLog(client, {
        entityType: 'opportunity',
        entityId: opportunityId,
        action: 'promotion-add',
        actorId,
        metadata: { catalogId },
      });
      return true;
    });
  }

  removeOpportunityPromotion(tenantId: string, opportunityId: string, linkId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const removed = await client.query<{ catalog_id: string }>(
        `DELETE FROM crm_schema.opportunity_promotions WHERE id = $1 AND opportunity_id = $2 RETURNING catalog_id`,
        [linkId, opportunityId],
      );
      if (!removed.rows.length) return false;
      await writeAuditLog(client, {
        entityType: 'opportunity',
        entityId: opportunityId,
        action: 'promotion-remove',
        actorId,
        metadata: { catalogId: removed.rows[0].catalog_id },
      });
      return true;
    });
  }

  saveQuotePromotions(
    tenantId: string,
    quoteId: string,
    base: QuoteVersionRef,
    promotions: readonly QuotePromotionSnapshot[],
    actorId: string,
  ): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      await lockVersion(client, quoteId, base, 'DRAFT');
      const updated = await client.query<{ revision: number }>(
        `UPDATE crm_schema.quote_versions
            SET promotions = $2::jsonb, revision = revision + 1, updated_at = now(), updated_by = $3
          WHERE id = $1
          RETURNING revision`,
        [base.versionId, JSON.stringify(promotions), actorId],
      );
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'promotions-set',
        actorId,
        metadata: { versionNo: base.versionNo, catalogIds: promotions.map((promotion) => promotion.catalogId) },
      });
      return updated.rows[0].revision;
    });
  }
}
