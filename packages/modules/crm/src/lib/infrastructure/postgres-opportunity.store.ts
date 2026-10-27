import {
  OPPORTUNITY_STAGES,
  type CrmPage,
  type OpportunityBoard,
  type OpportunityDetail,
  type OpportunityStage,
  type OpportunityStageHistoryEntry,
  type OpportunitySummary,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  OpportunityFilter,
  OpportunityRecord,
  OpportunityStore,
  StageChange,
} from '../application/sales-store.port.js';
import { CrmConflictError, CrmStaleVersionError } from '../domain/crm.error.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { SqlConditions, cursorAt, keysetPage, prefixTsQuery, toIso, toNumber } from './sql-helpers.js';

interface OpportunityRow {
  id: string;
  name: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  stage: OpportunityStage;
  probability: number;
  expected_value: string | null;
  expected_close_date: string | null;
  need: string | null;
  budget: string | null;
  lost_reason: string | null;
  lead_id: string | null;
  owner_user_id: string;
  closed_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

interface HistoryRow {
  id: string;
  from_stage: OpportunityStage | null;
  to_stage: OpportunityStage;
  actor_id: string | null;
  reason: string | null;
  at: Date;
}

const OPPORTUNITY_COLUMNS = `
  o.id, o.name, o.customer_id, c.code AS customer_code, c.name AS customer_name, o.stage, o.probability,
  o.expected_value, o.expected_close_date::text AS expected_close_date, o.need, o.budget, o.lost_reason,
  o.lead_id, o.owner_user_id, o.closed_at, o.version, o.created_at, o.updated_at,
  ${cursorAt('o.updated_at')} AS cursor_at`;

const OPPORTUNITY_FROM = `
  FROM crm_schema.opportunities o
  JOIN crm_schema.customers c ON c.id = o.customer_id`;

/** Thực thể ghi vào `audit_log`. */
export const OPPORTUNITY_AUDIT_ENTITY = 'opportunity';

/**
 * Cơ hội, kanban và lịch sử giai đoạn. Lọc phạm vi theo người phụ trách cơ hội
 * (không theo người phụ trách khách: một khách có thể có cơ hội của nhiều người).
 */
export class PostgresOpportunityStore implements OpportunityStore {
  constructor(private readonly database: CrmDatabase) {}

  async listOpportunities(
    tenantId: string,
    scope: CrmDataScope,
    filter: OpportunityFilter,
  ): Promise<CrmPage<OpportunitySummary>> {
    const where = new SqlConditions();
    where.scope(scope, 'o.owner_user_id');
    if (filter.stage) where.add(`o.stage = ${where.param(filter.stage)}`);
    if (filter.ownerUserId) where.add(`o.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.customerId) where.add(`o.customer_id = ${where.param(filter.customerId)}::uuid`);
    addNameSearch(where, filter.q);
    where.after(filter.cursor, 'o.updated_at', 'o.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OpportunityRow>(
      `SELECT ${OPPORTUNITY_COLUMNS} ${OPPORTUNITY_FROM} ${where.where()}
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toSummary);
  }

  async board(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly ownerUserId?: string; readonly q?: string },
    perStageLimit: number,
  ): Promise<OpportunityBoard> {
    const where = new SqlConditions();
    where.scope(scope, 'o.owner_user_id');
    if (filter.ownerUserId) where.add(`o.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    addNameSearch(where, filter.q);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OpportunityRow & { rank: string; total: string; total_value: string | null }>(
      `SELECT * FROM (
         SELECT ${OPPORTUNITY_COLUMNS},
                row_number() OVER (PARTITION BY o.stage ORDER BY o.updated_at DESC, o.id DESC) AS rank,
                count(*) OVER (PARTITION BY o.stage) AS total,
                sum(o.expected_value) OVER (PARTITION BY o.stage) AS total_value
           ${OPPORTUNITY_FROM} ${where.where()}
       ) ranked
       WHERE rank <= ${where.param(perStageLimit)}
       ORDER BY updated_at DESC, id DESC`,
      where.params,
    );
    const columns = OPPORTUNITY_STAGES.map((stage) => {
      const rows = result.rows.filter((row) => row.stage === stage);
      return {
        stage,
        total: rows[0] ? Number(rows[0].total) : 0,
        totalValue: rows[0] ? Number(rows[0].total_value ?? 0) : 0,
        items: rows.map(toSummary),
      };
    });
    return { columns, perStageLimit };
  }

  async getOpportunity(tenantId: string, scope: CrmDataScope, id: string): Promise<OpportunityDetail | undefined> {
    const where = new SqlConditions();
    where.add(`o.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'o.owner_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OpportunityRow>(
      `SELECT ${OPPORTUNITY_COLUMNS} ${OPPORTUNITY_FROM} ${where.where()}`,
      where.params,
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const history = await pool.query<HistoryRow>(
      `SELECT id, from_stage, to_stage, actor_id, reason, at
         FROM crm_schema.opportunity_stage_history
        WHERE opportunity_id = $1
        ORDER BY at DESC, id DESC`,
      [id],
    );
    return {
      ...toSummary(row),
      need: row.need,
      budget: toNumber(row.budget),
      lostReason: row.lost_reason,
      leadId: row.lead_id,
      closedAt: toIso(row.closed_at),
      createdAt: toIso(row.created_at) ?? '',
      history: history.rows.map(toHistory),
    };
  }

  createOpportunity(
    tenantId: string,
    customerId: string,
    record: OpportunityRecord,
    actorId: string,
  ): Promise<string> {
    return this.database.transaction(tenantId, (client) =>
      insertOpportunity(client, customerId, record, actorId, null),
    );
  }

  async updateOpportunity(
    tenantId: string,
    id: string,
    record: OpportunityRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(
      `UPDATE crm_schema.opportunities
          SET name = $3, probability = $4, expected_value = $5, expected_close_date = $6::date, need = $7,
              budget = $8, owner_user_id = $9, version = version + 1, updated_at = now(), updated_by = $10
        WHERE id = $1 AND version = $2 AND stage NOT IN ('WON', 'LOST')`,
      [id, expectedVersion, ...opportunityValues(record), actorId],
    );
    if (!result.rowCount) throw new CrmStaleVersionError();
  }

  changeStage(tenantId: string, id: string, change: StageChange, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE crm_schema.opportunities
            SET stage = $3::varchar,
                lost_reason = CASE WHEN $3::varchar = 'LOST' THEN $4::varchar ELSE lost_reason END,
                probability = CASE $3::varchar WHEN 'WON' THEN 100 WHEN 'LOST' THEN 0 ELSE probability END,
                closed_at = CASE WHEN $3::varchar IN ('WON', 'LOST') THEN now() ELSE NULL END,
                version = version + 1, updated_at = now(), updated_by = $5::uuid
          WHERE id = $1 AND stage = $2::varchar AND ($6::int IS NULL OR version = $6::int)`,
        [id, change.from, change.to, change.reason, actorId, change.expectedVersion ?? null],
      );
      if (!result.rowCount) {
        throw new CrmConflictError(
          'STAGE_CHANGED',
          'Cơ hội vừa được người khác cập nhật. Vui lòng tải lại rồi thử lại.',
        );
      }
      await recordStageChange(client, id, change.from, change.to, change.reason, actorId);
    });
  }
}

/**
 * Tạo cơ hội ở giai đoạn Mới trong transaction của bên gọi, kèm dòng lịch sử
 * đầu tiên và nhật ký. Dùng chung cho tạo trực tiếp và chuyển đổi lead.
 */
export async function insertOpportunity(
  client: CrmSqlClient,
  customerId: string,
  record: OpportunityRecord,
  actorId: string,
  leadId: string | null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.opportunities
       (name, probability, expected_value, expected_close_date, need, budget, owner_user_id, customer_id, lead_id,
        created_by, updated_by)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $10)
     RETURNING id`,
    [...opportunityValues(record), customerId, leadId, actorId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('crm_schema.opportunities insert returned no row.');
  await recordStageChange(client, id, null, 'NEW', null, actorId);
  return id;
}

async function recordStageChange(
  client: CrmSqlClient,
  opportunityId: string,
  from: OpportunityStage | null,
  to: OpportunityStage,
  reason: string | null,
  actorId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO crm_schema.opportunity_stage_history (opportunity_id, from_stage, to_stage, actor_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [opportunityId, from, to, actorId, reason],
  );
  await writeAuditLog(client, {
    entityType: OPPORTUNITY_AUDIT_ENTITY,
    entityId: opportunityId,
    fromStatus: from,
    toStatus: to,
    action: from ? 'change_stage' : 'create',
    actorId,
    reason,
  });
}

function addNameSearch(where: SqlConditions, q: string | undefined): void {
  const tsQuery = q ? prefixTsQuery(q) : undefined;
  if (!tsQuery) return;
  where.add(`to_tsvector('simple'::regconfig, o.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)})`);
}

function opportunityValues(record: OpportunityRecord): unknown[] {
  return [
    record.name,
    record.probability,
    record.expectedValue,
    record.expectedCloseDate,
    record.need,
    record.budget,
    record.ownerUserId,
  ];
}

function toSummary(row: OpportunityRow): OpportunitySummary {
  return {
    id: row.id,
    name: row.name,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    stage: row.stage,
    probability: row.probability,
    expectedValue: toNumber(row.expected_value),
    expectedCloseDate: row.expected_close_date,
    ownerUserId: row.owner_user_id,
    version: row.version,
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toHistory(row: HistoryRow): OpportunityStageHistoryEntry {
  return {
    id: row.id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    actorId: row.actor_id,
    reason: row.reason,
    at: toIso(row.at) ?? '',
  };
}
