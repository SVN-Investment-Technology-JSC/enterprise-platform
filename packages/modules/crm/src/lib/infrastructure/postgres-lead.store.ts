import type { CrmPage, Lead, LeadStatus } from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  LeadConversionOutcome,
  LeadConversionPlan,
  LeadFilter,
  LeadRecord,
  LeadStore,
} from '../application/sales-store.port.js';
import { CrmConflictError, CrmNotFoundError, CrmStaleVersionError } from '../domain/crm.error.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { insertContact, insertCustomer } from './postgres-customer.store.js';
import { insertOpportunity } from './postgres-opportunity.store.js';
import { SqlConditions, cursorAt, keysetPage, prefixPattern, prefixTsQuery, toIso } from './sql-helpers.js';

interface LeadRow {
  id: string;
  name: string;
  contact_name: string | null;
  tax_code: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  need: string | null;
  note: string | null;
  owner_user_id: string;
  status: LeadStatus;
  converted_customer_id: string | null;
  converted_opportunity_id: string | null;
  converted_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

const LEAD_COLUMNS = `
  l.id, l.name, l.contact_name, l.tax_code, l.phone, l.email, l.source, l.need, l.note, l.owner_user_id,
  l.status, l.converted_customer_id, l.converted_opportunity_id, l.converted_at, l.version, l.created_at,
  l.updated_at, ${cursorAt('l.updated_at')} AS cursor_at`;

export class PostgresLeadStore implements LeadStore {
  constructor(private readonly database: CrmDatabase) {}

  async listLeads(tenantId: string, scope: CrmDataScope, filter: LeadFilter): Promise<CrmPage<Lead>> {
    const where = new SqlConditions();
    where.scope(scope, 'l.owner_user_id');
    if (filter.status) where.add(`l.status = ${where.param(filter.status)}`);
    if (filter.ownerUserId) where.add(`l.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.q) {
      const branches: string[] = [];
      const digits = filter.q.replace(/\s+/g, '');
      if (/^[\d-]+$/.test(digits)) branches.push(`l.tax_code LIKE ${where.param(prefixPattern(digits))}`);
      const tsQuery = prefixTsQuery(filter.q);
      if (tsQuery) {
        branches.push(
          `to_tsvector('simple'::regconfig, l.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)})`,
        );
      }
      where.add(branches.length ? `(${branches.join(' OR ')})` : 'FALSE');
    }
    where.after(filter.cursor, 'l.updated_at', 'l.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<LeadRow>(
      `SELECT ${LEAD_COLUMNS} FROM crm_schema.leads l ${where.where()}
        ORDER BY l.updated_at DESC, l.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toLead);
  }

  async getLead(tenantId: string, scope: CrmDataScope, id: string): Promise<Lead | undefined> {
    const where = new SqlConditions();
    where.add(`l.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'l.owner_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<LeadRow>(`SELECT ${LEAD_COLUMNS} FROM crm_schema.leads l ${where.where()}`, where.params);
    return result.rows[0] ? toLead(result.rows[0]) : undefined;
  }

  async createLead(tenantId: string, record: LeadRecord, actorId: string): Promise<string> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO crm_schema.leads
         (name, contact_name, tax_code, phone, email, source, need, note, owner_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING id`,
      [...leadValues(record), actorId],
    );
    return result.rows[0].id;
  }

  async updateLead(
    tenantId: string,
    id: string,
    record: LeadRecord,
    status: Exclude<LeadStatus, 'CONVERTED'>,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(
      `UPDATE crm_schema.leads
          SET name = $3, contact_name = $4, tax_code = $5, phone = $6, email = $7, source = $8, need = $9,
              note = $10, owner_user_id = $11, status = $12, version = version + 1, updated_at = now(),
              updated_by = $13
        WHERE id = $1 AND version = $2 AND status <> 'CONVERTED'`,
      [id, expectedVersion, ...leadValues(record), status, actorId],
    );
    if (!result.rowCount) throw new CrmStaleVersionError();
  }

  convertLead(tenantId: string, plan: LeadConversionPlan, actorId: string): Promise<LeadConversionOutcome> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await client.query<{ status: LeadStatus; version: number }>(
        `SELECT status, version FROM crm_schema.leads WHERE id = $1 FOR UPDATE`,
        [plan.leadId],
      );
      const lead = locked.rows[0];
      if (!lead) throw new CrmNotFoundError('Không tìm thấy lead.');
      if (lead.status === 'CONVERTED') {
        throw new CrmConflictError('LEAD_CONVERTED', 'Lead đã được chuyển thành khách hàng và cơ hội.');
      }
      if (lead.version !== plan.expectedVersion) throw new CrmStaleVersionError();

      // Lead trùng MST với khách có sẵn: gắn cơ hội vào khách cũ (khách lâu nhất).
      let customerId: string | undefined;
      if (plan.customer.taxCode) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM crm_schema.customers WHERE tax_code = $1 ORDER BY created_at, id LIMIT 1`,
          [plan.customer.taxCode],
        );
        customerId = existing.rows[0]?.id;
      }
      const attachedToExistingCustomer = Boolean(customerId);
      if (!customerId) {
        customerId = await insertCustomer(client, null, plan.customer, actorId);
        if (plan.contact) await insertContact(client, customerId, plan.contact, actorId);
      }

      const opportunityId = await insertOpportunity(client, customerId, plan.opportunity, actorId, plan.leadId);
      await client.query(
        `UPDATE crm_schema.leads
            SET status = 'CONVERTED', converted_customer_id = $2, converted_opportunity_id = $3,
                converted_at = now(), version = version + 1, updated_at = now(), updated_by = $4
          WHERE id = $1`,
        [plan.leadId, customerId, opportunityId, actorId],
      );
      await writeAuditLog(client, {
        entityType: 'lead',
        entityId: plan.leadId,
        fromStatus: lead.status,
        toStatus: 'CONVERTED',
        action: 'convert',
        actorId,
        metadata: { customerId, opportunityId, attachedToExistingCustomer },
      });
      return { customerId, opportunityId, attachedToExistingCustomer };
    });
  }
}

function leadValues(record: LeadRecord): unknown[] {
  return [
    record.name,
    record.contactName,
    record.taxCode,
    record.phone,
    record.email,
    record.source,
    record.need,
    record.note,
    record.ownerUserId,
  ];
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    taxCode: row.tax_code,
    phone: row.phone,
    email: row.email,
    source: row.source,
    need: row.need,
    note: row.note,
    ownerUserId: row.owner_user_id,
    status: row.status,
    convertedCustomerId: row.converted_customer_id,
    convertedOpportunityId: row.converted_opportunity_id,
    convertedAt: toIso(row.converted_at),
    version: row.version,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}
