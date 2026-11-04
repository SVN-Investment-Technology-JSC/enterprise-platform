import {
  CRM_OPPORTUNITY_STAGE_ASSIGNED,
  CRM_OPPORTUNITY_STAGE_CHANGED,
  type CrmOpportunityStageAssignedPayload,
  type CrmPage,
  type MyStageTask,
  type OpportunityBoard,
  type OpportunityByCustomerPage,
  type OpportunityCustomerTotal,
  type OpportunityDetail,
  type OpportunityStageHistoryEntry,
  type OpportunityStagePlanItem,
  type StagePlanStatus,
  type OpportunitySummary,
  type Pipeline,
  type StageSemantic,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  OpportunityByCustomerFilter,
  OpportunityFilter,
  OpportunityPlacement,
  OpportunityRecord,
  OpportunityStore,
  StageAssigneeChange,
  StageChange,
  StageSkip,
} from '../application/sales-store.port.js';
import { CrmConflictError, CrmNotFoundError, CrmStaleVersionError } from '../domain/crm.error.js';
import { buildOpportunityStageChangedPayload } from '../domain/opportunity-event.js';
import type { PlannedStage } from '../domain/stage-plan.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import { writeCrmOutbox } from './crm-outbox.js';
import { declineQuotesForLostOpportunity, ensureDraftQuoteForOpportunity } from './postgres-quote.store.js';
import type { CrmDatabase } from './crm.database.js';
import { SqlConditions, cursorAt, keysetPage, nameSearchCondition, toIso, toNumber } from './sql-helpers.js';

interface OpportunityRow {
  id: string;
  name: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  stage: string;
  pipeline_id: string;
  pipeline_code: string;
  pipeline_name: string;
  stage_id: string;
  stage_name: string;
  stage_semantic: StageSemantic;
  probability: number;
  expected_value: string | null;
  expected_close_date: string | null;
  need: string | null;
  budget: string | null;
  estimate_total_value: string | null;
  estimate_cost_value: string | null;
  competitor_name: string | null;
  competitor_price: string | null;
  lost_reason: string | null;
  lead_id: string | null;
  owner_user_id: string;
  closed_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

interface SkipRow {
  stage_id: string;
  code: string;
  name: string;
  skipped_by: string | null;
  skipped_reason: string | null;
  skipped_at: Date | null;
}

interface PlanRow {
  stage_id: string;
  code: string;
  name: string;
  semantic: StageSemantic;
  sort_order: number;
  skippable: boolean;
  status: StagePlanStatus;
  assignee_user_id: string | null;
  assignee_warning: string | null;
  assigned_by: string | null;
  assigned_at: Date | null;
  due_date: string | null;
  skipped_reason: string | null;
  skipped_by: string | null;
  skipped_at: Date | null;
}

interface HistoryRow {
  id: string;
  from_stage: string | null;
  to_stage: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  from_stage_name: string | null;
  to_stage_name: string | null;
  actor_id: string | null;
  reason: string | null;
  at: Date;
}

const OPPORTUNITY_COLUMNS = `
  o.id, o.name, o.customer_id, c.code AS customer_code, c.name AS customer_name, o.stage,
  o.pipeline_id, p.code AS pipeline_code, p.name AS pipeline_name,
  o.stage_id, s.name AS stage_name, s.semantic AS stage_semantic, o.probability,
  o.expected_value, o.expected_close_date::text AS expected_close_date, o.need, o.budget, o.estimate_total_value, o.estimate_cost_value, o.competitor_name, o.competitor_price, o.lost_reason,
  o.lead_id, o.owner_user_id, o.closed_at, o.version, o.created_at, o.updated_at,
  ${cursorAt('o.updated_at')} AS cursor_at`;

const OPPORTUNITY_FROM = `
  FROM crm_schema.opportunities o
  JOIN crm_schema.customers c ON c.id = o.customer_id
  JOIN crm_schema.pipelines p ON p.id = o.pipeline_id
  JOIN crm_schema.pipeline_stages s ON s.id = o.stage_id`;

/** Bộ lọc chung của danh sách dự án và danh sách theo khách. Mỗi lần gọi trả một bộ điều kiện mới (mảng tham số riêng). */
function listConditions(
  scope: CrmDataScope,
  filter: Pick<OpportunityFilter, 'q' | 'stage' | 'pipelineId' | 'ownerUserId' | 'customerId'>,
): SqlConditions {
  const where = new SqlConditions();
  // Cơ hội của người trong phạm vi, hoặc cơ hội có giai đoạn giao cho người gọi (ASG-02).
  where.opportunityScope(scope, 'o.owner_user_id', 'o.id');
  if (filter.stage) where.add(`o.stage = ${where.param(filter.stage)}`);
  if (filter.pipelineId) where.add(`o.pipeline_id = ${where.param(filter.pipelineId)}::uuid`);
  if (filter.ownerUserId) where.add(`o.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
  if (filter.customerId) where.add(`o.customer_id = ${where.param(filter.customerId)}::uuid`);
  addNameSearch(where, filter.q);
  return where;
}

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
    const where = listConditions(scope, filter);
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

  async listByCustomer(
    tenantId: string,
    scope: CrmDataScope,
    filter: OpportunityByCustomerFilter,
  ): Promise<OpportunityByCustomerPage> {
    const pool = await this.database.pool(tenantId);
    const where = listConditions(scope, filter);
    const offset = (filter.page - 1) * filter.pageSize;
    // Cập nhật gần nhất lên trước: khách có dự án vừa cập nhật lên đầu, trong khách thì dự án mới cập nhật trước. Dự
    // án của một khách vẫn liền nhau (sắp theo mốc mới nhất của khách rồi id khách); id dự án làm thứ tự ổn định.
    const [rows, total] = await Promise.all([
      pool.query<OpportunityRow>(
        `SELECT * FROM (
           SELECT ${OPPORTUNITY_COLUMNS}, max(o.updated_at) OVER (PARTITION BY o.customer_id) AS customer_updated_at
             ${OPPORTUNITY_FROM} ${where.where()}
         ) ranked
          ORDER BY customer_updated_at DESC, customer_id, updated_at DESC, id DESC
          LIMIT ${where.param(filter.pageSize)} OFFSET ${where.param(offset)}`,
        where.params,
      ),
      pool.query<{ total: number }>(
        `SELECT count(*)::int AS total ${OPPORTUNITY_FROM} ${listConditions(scope, filter).where()}`,
        listConditions(scope, filter).params,
      ),
    ]);
    const customerIds = [...new Set(rows.rows.map((row) => row.customer_id))];
    let customers: OpportunityCustomerTotal[] = [];
    if (customerIds.length) {
      const totals = listConditions(scope, filter);
      totals.add(`o.customer_id = ANY(${totals.param(customerIds)}::uuid[])`);
      const result = await pool.query<{
        customer_id: string;
        customer_code: string;
        customer_name: string;
        count: number;
        total_value: string | null;
      }>(
        `SELECT o.customer_id, c.code AS customer_code, c.name AS customer_name, count(*)::int AS count,
                coalesce(sum(o.expected_value), 0) AS total_value
           ${OPPORTUNITY_FROM} ${totals.where()}
          GROUP BY o.customer_id, c.code, c.name
          ORDER BY max(o.updated_at) DESC, o.customer_id`,
        totals.params,
      );
      customers = result.rows.map((row) => ({
        customerId: row.customer_id,
        customerCode: row.customer_code,
        customerName: row.customer_name,
        count: Number(row.count),
        totalValue: toNumber(row.total_value) ?? 0,
      }));
    }
    return {
      items: rows.rows.map(toSummary),
      customers,
      page: filter.page,
      pageSize: filter.pageSize,
      total: Number(total.rows[0]?.total ?? 0),
    };
  }

  async board(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly ownerUserId?: string; readonly q?: string },
    perStageLimit: number,
    pipeline: Pipeline,
  ): Promise<OpportunityBoard> {
    const where = new SqlConditions();
    where.add(`o.pipeline_id = ${where.param(pipeline.id)}::uuid`);
    // Cơ hội của người trong phạm vi, hoặc cơ hội có giai đoạn giao cho người gọi (ASG-02).
    where.opportunityScope(scope, 'o.owner_user_id', 'o.id');
    if (filter.ownerUserId) where.add(`o.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    addNameSearch(where, filter.q);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OpportunityRow & { rank: string; total: string; total_value: string | null }>(
      `SELECT * FROM (
         SELECT ${OPPORTUNITY_COLUMNS},
                row_number() OVER (PARTITION BY o.stage_id ORDER BY o.updated_at DESC, o.id DESC) AS rank,
                count(*) OVER (PARTITION BY o.stage_id) AS total,
                sum(o.expected_value) OVER (PARTITION BY o.stage_id) AS total_value
           ${OPPORTUNITY_FROM} ${where.where()}
       ) ranked
       WHERE rank <= ${where.param(perStageLimit)}
       ORDER BY updated_at DESC, id DESC`,
      where.params,
    );
    // Giai đoạn đã tắt chỉ có cột khi còn cơ hội (cơ hội vẫn hiện, chuyển đi được).
    const columns = [...pipeline.stages]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((stage) => ({
        stage,
        rows: result.rows.filter((row) => row.stage_id === stage.id),
      }))
      .filter(({ stage, rows }) => stage.active || rows.length > 0)
      .map(({ stage, rows }) => ({
        stage: stage.code,
        stageInfo: { id: stage.id, code: stage.code, name: stage.name, semantic: stage.semantic },
        total: rows[0] ? Number(rows[0].total) : 0,
        totalValue: rows[0] ? Number(rows[0].total_value ?? 0) : 0,
        items: rows.map(toSummary),
      }));
    return { pipeline: { id: pipeline.id, code: pipeline.code, name: pipeline.name }, columns, perStageLimit };
  }

  async getOpportunity(tenantId: string, scope: CrmDataScope, id: string): Promise<OpportunityDetail | undefined> {
    const where = new SqlConditions();
    where.add(`o.id = ${where.param(id)}::uuid`);
    // Cơ hội của người trong phạm vi, hoặc cơ hội có giai đoạn giao cho người gọi (ASG-02).
    where.opportunityScope(scope, 'o.owner_user_id', 'o.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OpportunityRow>(
      `SELECT ${OPPORTUNITY_COLUMNS} ${OPPORTUNITY_FROM} ${where.where()}`,
      where.params,
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const history = await pool.query<HistoryRow>(
      `SELECT h.id, h.from_stage, h.to_stage, h.from_stage_id, h.to_stage_id,
              fs.name AS from_stage_name, ts.name AS to_stage_name, h.actor_id, h.reason, h.at
         FROM crm_schema.opportunity_stage_history h
         LEFT JOIN crm_schema.pipeline_stages fs ON fs.id = h.from_stage_id
         LEFT JOIN crm_schema.pipeline_stages ts ON ts.id = h.to_stage_id
        WHERE h.opportunity_id = $1
        ORDER BY h.at DESC, h.id DESC`,
      [id],
    );
    // Giai đoạn bỏ qua hiện trong lịch sử như một dòng riêng (kind SKIP).
    const skips = await pool.query<SkipRow>(
      `SELECT sp.stage_id, s.code, s.name, sp.skipped_by, sp.skipped_reason, sp.skipped_at
         FROM crm_schema.opportunity_stage_plan sp
         JOIN crm_schema.pipeline_stages s ON s.id = sp.stage_id
        WHERE sp.opportunity_id = $1 AND sp.status = 'SKIPPED'`,
      [id],
    );
    return {
      ...toSummary(row),
      need: row.need,
      budget: toNumber(row.budget),
      estimateTotalValue: toNumber(row.estimate_total_value),
      estimateCostValue: toNumber(row.estimate_cost_value),
      competitorName: row.competitor_name,
      competitorPrice: toNumber(row.competitor_price),
      lostReason: row.lost_reason,
      leadId: row.lead_id,
      closedAt: toIso(row.closed_at),
      createdAt: toIso(row.created_at) ?? '',
      history: [...history.rows.map(toHistory), ...skips.rows.map(toSkipHistory)].sort(
        (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
      ),
      // Service điền theo cấu hình luồng (store không biết bảng bước chuyển).
      nextStages: [],
    };
  }

  createOpportunity(
    tenantId: string,
    customerId: string,
    record: OpportunityRecord,
    actorId: string,
    placement: OpportunityPlacement,
  ): Promise<string> {
    return this.database.transaction(tenantId, async (client) => {
      const id = await insertOpportunity(client, customerId, record, actorId, null, placement);
      if (placement.plan) {
        await insertStagePlan(client, tenantId, id, record, placement.plan, placement.stageNames ?? {}, actorId);
      }
      return id;
    });
  }

  async hasAcceptedQuote(tenantId: string, opportunityId: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(
      `SELECT 1 FROM crm_schema.quotes WHERE opportunity_id = $1 AND status = 'ACCEPTED' LIMIT 1`,
      [opportunityId],
    );
    return result.rows.length > 0;
  }

  async updateOpportunity(
    tenantId: string,
    id: string,
    record: OpportunityRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    // Một transaction: sửa cơ hội và ghi audit khi dự toán đổi (giá trị cũ đọc cùng lúc, khoá dòng).
    await this.database.transaction(tenantId, async (client) => {
      const before = await client.query<{
        estimate_total_value: string | null;
        estimate_cost_value: string | null;
        competitor_name: string | null;
        competitor_price: string | null;
      }>(
        `SELECT estimate_total_value, estimate_cost_value, competitor_name, competitor_price FROM crm_schema.opportunities WHERE id = $1 FOR UPDATE`,
        [id],
      );
      // Chỉ sửa được khi giai đoạn còn mở (nghĩa OPEN), không theo mã.
      const result = await client.query(
        `UPDATE crm_schema.opportunities o
            SET name = $3, probability = $4, expected_value = $5, expected_close_date = $6::date, need = $7,
                budget = $8, owner_user_id = $9, estimate_total_value = $10, estimate_cost_value = $11,
                competitor_name = $13, competitor_price = $14,
                version = o.version + 1, updated_at = now(), updated_by = $12
          WHERE o.id = $1 AND o.version = $2
            AND EXISTS (SELECT 1 FROM crm_schema.pipeline_stages s WHERE s.id = o.stage_id AND s.semantic = 'OPEN')
        RETURNING o.id`,
        [id, expectedVersion, ...opportunityValues(record), actorId, record.competitorName ?? null, record.competitorPrice ?? null],
      );
      if (!result.rows.length) throw new CrmStaleVersionError();
      const old = before.rows[0];
      const fromTotal = toNumber(old?.estimate_total_value ?? null);
      const fromCost = toNumber(old?.estimate_cost_value ?? null);
      const toTotal = record.estimateTotalValue ?? null;
      const toCost = record.estimateCostValue ?? null;
      const fromCompetitorName = old?.competitor_name ?? null;
      const fromCompetitorPrice = toNumber(old?.competitor_price ?? null);
      const toCompetitorName = record.competitorName ?? null;
      const toCompetitorPrice = record.competitorPrice ?? null;
      if (fromCompetitorName !== toCompetitorName || fromCompetitorPrice !== toCompetitorPrice) {
        await writeAuditLog(client, {
          entityType: OPPORTUNITY_AUDIT_ENTITY,
          entityId: id,
          action: 'update_competitor',
          actorId,
          metadata: { fromCompetitorName, toCompetitorName, fromCompetitorPrice, toCompetitorPrice },
        });
      }
      if (fromTotal === toTotal && fromCost === toCost) return;
      await writeAuditLog(client, {
        entityType: OPPORTUNITY_AUDIT_ENTITY,
        entityId: id,
        action: 'update_estimate',
        actorId,
        metadata: {
          fromEstimateTotalValue: fromTotal,
          toEstimateTotalValue: toTotal,
          fromEstimateCostValue: fromCost,
          toEstimateCostValue: toCost,
        },
      });
    });
  }

  changeStage(tenantId: string, id: string, change: StageChange, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      if (change.requireAcceptedQuote) {
        const accepted = await client.query(
          `SELECT 1 FROM crm_schema.quotes WHERE opportunity_id = $1 AND status = 'ACCEPTED' LIMIT 1`,
          [id],
        );
        if (!accepted.rows.length) {
          throw new CrmConflictError('ACCEPTED_QUOTE_REQUIRED', change.requireAcceptedQuote.message);
        }
      }
      const result = await client.query<{ name: string; customer_id: string; owner_user_id: string }>(
        `UPDATE crm_schema.opportunities
            SET stage = $3::varchar, stage_id = $7::uuid,
                lost_reason = CASE WHEN $8::varchar = 'LOST' THEN $4::varchar ELSE lost_reason END,
                probability = CASE $8::varchar WHEN 'WON' THEN 100 WHEN 'LOST' THEN 0 ELSE probability END,
                closed_at = CASE WHEN $8::varchar IN ('WON', 'LOST') THEN now() ELSE NULL END,
                version = version + 1, updated_at = now(), updated_by = $5::uuid
          WHERE id = $1 AND stage_id = $2::uuid AND ($6::int IS NULL OR version = $6::int)
          RETURNING name, customer_id, owner_user_id`,
        [
          id,
          change.fromStageId,
          change.to,
          change.reason,
          actorId,
          change.expectedVersion ?? null,
          change.toStageId,
          change.toSemantic,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new CrmConflictError(
          'STAGE_CHANGED',
          'Cơ hội vừa được người khác cập nhật. Vui lòng tải lại rồi thử lại.',
        );
      }
      await recordStageChange(client, id, {
        from: change.from,
        fromStageId: change.fromStageId,
        to: change.to,
        toStageId: change.toStageId,
        reason: change.reason,
        actorId,
        metadata: { pipelineId: change.pipelineId, semantic: change.toSemantic },
      });
      await writeCrmOutbox(client, tenantId, {
        type: CRM_OPPORTUNITY_STAGE_CHANGED,
        aggregateType: 'crm-opportunity',
        aggregateId: id,
        payload: buildOpportunityStageChangedPayload({
          opportunityId: id,
          customerId: row.customer_id,
          name: row.name,
          ownerUserId: row.owner_user_id,
          from: change.from,
          fromStageId: change.fromStageId,
          fromSemantic: change.fromSemantic,
          to: change.to,
          toStageId: change.toStageId,
          toSemantic: change.toSemantic,
          pipelineId: change.pipelineId,
          reason: change.reason,
          actorUserId: actorId,
        }),
      });
      await applyPlanStageChange(client, id, change);
      // Dòng cơ hội đã bị UPDATE khoá: hai lần chuyển sang Báo giá cùng lúc không tạo hai nháp.
      if (change.draftQuoteValidUntil) {
        await ensureDraftQuoteForOpportunity(client, id, change.draftQuoteValidUntil, actorId);
      }
      if (change.declineOpenQuotes) await declineQuotesForLostOpportunity(client, tenantId, id, actorId);
      if (change.markTenderSubmitted) {
        await client.query(
          `UPDATE crm_schema.tender_profiles SET submitted_at = COALESCE(submitted_at, now()), updated_at = now(), updated_by = $2::uuid
            WHERE opportunity_id = $1::uuid`,
          [id, actorId],
        );
      }
      if (change.syncTenderResult && (change.toSemantic === 'WON' || change.toSemantic === 'LOST')) {
        await client.query(
          `UPDATE crm_schema.tender_profiles
              SET result = $2::varchar,
                  lost_reason = CASE WHEN $2::varchar = 'LOST' THEN COALESCE(lost_reason, $3::varchar) ELSE lost_reason END,
                  result_recorded_at = now(), result_recorded_by = $4::uuid, updated_at = now(), updated_by = $4::uuid
            WHERE opportunity_id = $1::uuid AND result IS NULL`,
          [id, change.toSemantic, change.reason, actorId],
        );
      }
      if (change.inTransaction) await change.inTransaction(client);
    });
  }

  async latestBusinessPlan(tenantId: string, opportunityId: string) {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{
      quote_id: string;
      quote_code: string;
      version_no: number;
      status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
      revenue: string;
      total_cost: string;
      profit: string;
    }>(
      `SELECT q.id AS quote_id, q.code AS quote_code, v.version_no, p.status, p.revenue, p.total_cost, p.profit
         FROM (SELECT id, code FROM crm_schema.quotes
                WHERE opportunity_id = $1::uuid
                ORDER BY created_at DESC, id DESC LIMIT 1) q
         JOIN crm_schema.business_plans p ON p.quote_id = q.id
         JOIN crm_schema.quote_versions v ON v.id = p.quote_version_id
        ORDER BY (p.status = 'APPROVED') DESC,
                 CASE WHEN p.status = 'APPROVED' THEN p.decided_at END DESC NULLS LAST,
                 v.version_no DESC
        LIMIT 1`,
      [opportunityId],
    );
    const row = result.rows[0];
    return row
      ? {
          quoteId: row.quote_id,
          quoteCode: row.quote_code,
          versionNo: row.version_no,
          status: row.status,
          revenue: Number(row.revenue),
          totalCost: Number(row.total_cost),
          profit: Number(row.profit),
        }
      : undefined;
  }

  async getStagePlan(tenantId: string, opportunityId: string): Promise<OpportunityStagePlanItem[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PlanRow>(
      `SELECT sp.stage_id, s.code, s.name, s.semantic, s.sort_order, s.skippable, sp.status, sp.assignee_user_id,
              sp.assignee_warning, sp.assigned_by, sp.assigned_at, sp.due_date::text AS due_date,
              sp.skipped_reason, sp.skipped_by, sp.skipped_at
         FROM crm_schema.opportunity_stage_plan sp
         JOIN crm_schema.pipeline_stages s ON s.id = sp.stage_id
        WHERE sp.opportunity_id = $1::uuid
        ORDER BY s.sort_order, s.code`,
      [opportunityId],
    );
    return result.rows.map(toPlanItem);
  }

  setStageAssignee(
    tenantId: string,
    opportunityId: string,
    change: StageAssigneeChange,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const head = await client.query<{ name: string }>(
        `SELECT name FROM crm_schema.opportunities WHERE id = $1::uuid FOR UPDATE`,
        [opportunityId],
      );
      if (!head.rows[0]) throw new CrmNotFoundError('Không tìm thấy cơ hội.');
      const current = await client.query<{
        assignee_user_id: string | null;
        status: StagePlanStatus;
        due_date: string | null;
        code: string;
        name: string;
      }>(
        `SELECT sp.assignee_user_id, sp.status, sp.due_date::text AS due_date, s.code, s.name
           FROM crm_schema.opportunity_stage_plan sp
           JOIN crm_schema.pipeline_stages s ON s.id = sp.stage_id
          WHERE sp.opportunity_id = $1::uuid AND sp.stage_id = $2::uuid
          FOR UPDATE OF sp`,
        [opportunityId, change.stageId],
      );
      const row = current.rows[0];
      if (!row) throw new CrmNotFoundError('Giai đoạn không có trong kế hoạch của cơ hội.');
      if (row.status === 'DONE' || row.status === 'SKIPPED') {
        throw new CrmConflictError(
          'STAGE_NOT_EDITABLE',
          `Giai đoạn "${row.name}" đã ${row.status === 'DONE' ? 'xong' : 'bỏ qua'}, không đổi được người đảm nhận.`,
        );
      }
      const dueDate = change.dueDate === undefined ? row.due_date : change.dueDate;
      const sameAssignee = (row.assignee_user_id ?? null) === change.assigneeUserId;
      if (sameAssignee && dueDate === row.due_date) return;
      await client.query(
        `UPDATE crm_schema.opportunity_stage_plan
            SET assignee_user_id = $3::uuid, due_date = $4::date, assignee_warning = NULL,
                assigned_by = CASE WHEN $5::boolean THEN assigned_by ELSE $6::uuid END,
                assigned_at = CASE WHEN $5::boolean THEN assigned_at ELSE now() END, updated_at = now()
          WHERE opportunity_id = $1::uuid AND stage_id = $2::uuid`,
        [opportunityId, change.stageId, change.assigneeUserId, dueDate, sameAssignee, actorId],
      );
      if (sameAssignee) return;
      await writeAuditLog(client, {
        entityType: OPPORTUNITY_AUDIT_ENTITY,
        entityId: opportunityId,
        action: 'assign_stage',
        actorId,
        metadata: {
          stageId: change.stageId,
          stageCode: row.code,
          fromAssigneeUserId: row.assignee_user_id,
          toAssigneeUserId: change.assigneeUserId,
        },
      });
      await writeStageAssigned(client, tenantId, {
        opportunityId,
        opportunityName: head.rows[0].name,
        stageId: change.stageId,
        stageCode: row.code,
        stageName: row.name,
        assigneeUserId: change.assigneeUserId,
        previousAssigneeUserId: row.assignee_user_id,
        actorUserId: actorId,
        cause: 'OVERRIDE',
      });
    });
  }

  skipStage(tenantId: string, opportunityId: string, skip: StageSkip, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      // Khoá dòng cơ hội: không đua với chuyển giai đoạn; cơ hội đã đóng thì không bỏ qua nữa.
      const head = await client.query<{ semantic: StageSemantic }>(
        `SELECT s.semantic FROM crm_schema.opportunities o JOIN crm_schema.pipeline_stages s ON s.id = o.stage_id
          WHERE o.id = $1::uuid FOR UPDATE OF o`,
        [opportunityId],
      );
      if (!head.rows[0]) throw new CrmNotFoundError('Không tìm thấy cơ hội.');
      if (head.rows[0].semantic !== 'OPEN') {
        throw new CrmConflictError('OPPORTUNITY_CLOSED', 'Cơ hội đã đóng (Thắng hoặc Thua), không bỏ qua giai đoạn được.');
      }
      const updated = await client.query<{ code: string }>(
        `UPDATE crm_schema.opportunity_stage_plan sp
            SET status = 'SKIPPED', skipped_reason = $3, skipped_by = $4::uuid, skipped_at = now(), updated_at = now()
           FROM crm_schema.pipeline_stages s
          WHERE sp.opportunity_id = $1::uuid AND sp.stage_id = $2::uuid AND sp.status = 'PENDING'
            AND s.id = sp.stage_id AND s.skippable AND s.semantic = 'OPEN'
          RETURNING s.code`,
        [opportunityId, skip.stageId, skip.reason, actorId],
      );
      if (!updated.rows[0]) {
        throw new CrmConflictError('STAGE_CHANGED', 'Giai đoạn vừa thay đổi, không bỏ qua được. Vui lòng tải lại.');
      }
      await writeAuditLog(client, {
        entityType: OPPORTUNITY_AUDIT_ENTITY,
        entityId: opportunityId,
        action: 'skip_stage',
        actorId,
        reason: skip.reason,
        metadata: { stageId: skip.stageId, stageCode: updated.rows[0].code, atCreation: false },
      });
    });
  }

  setPipelineCareSuggestion(tenantId: string, pipelineId: string, enabled: boolean, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const before = await client.query<{ care_suggestion: boolean }>(
        `SELECT care_suggestion FROM crm_schema.pipelines WHERE id = $1::uuid FOR UPDATE`,
        [pipelineId],
      );
      if (!before.rows[0]) return false;
      await client.query(
        `UPDATE crm_schema.pipelines SET care_suggestion = $2, updated_at = now(), updated_by = $3::uuid WHERE id = $1::uuid`,
        [pipelineId, enabled, actorId],
      );
      await writeAuditLog(client, {
        entityType: 'pipeline',
        entityId: pipelineId,
        action: 'set_care_suggestion',
        actorId,
        metadata: { from: before.rows[0].care_suggestion, to: enabled },
      });
      return true;
    });
  }

  async listMyStageTasks(tenantId: string, userId: string, limit: number): Promise<MyStageTask[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{
      id: string;
      name: string;
      customer_id: string;
      customer_name: string;
      owner_user_id: string;
      updated_at: Date;
      plan_status: 'PENDING' | 'ACTIVE';
      plan_stage_id: string;
      plan_code: string;
      plan_name: string;
      plan_semantic: StageSemantic;
      due_date: string | null;
    }>(
      `SELECT o.id, o.name, o.customer_id, c.name AS customer_name, o.owner_user_id, o.updated_at,
              sp.status AS plan_status, sp.stage_id AS plan_stage_id, ps.code AS plan_code, ps.name AS plan_name,
              ps.semantic AS plan_semantic, sp.due_date::text AS due_date
         FROM crm_schema.opportunity_stage_plan sp
         JOIN crm_schema.opportunities o ON o.id = sp.opportunity_id
         JOIN crm_schema.customers c ON c.id = o.customer_id
         JOIN crm_schema.pipeline_stages ps ON ps.id = sp.stage_id
         JOIN crm_schema.pipeline_stages cur ON cur.id = o.stage_id
        WHERE sp.assignee_user_id = $1::uuid AND sp.status IN ('ACTIVE', 'PENDING') AND cur.semantic = 'OPEN'
        ORDER BY (sp.status = 'ACTIVE') DESC, sp.due_date NULLS LAST, o.updated_at DESC, o.id
        LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      opportunityId: row.id,
      opportunityName: row.name,
      customerId: row.customer_id,
      customerName: row.customer_name,
      stage: { id: row.plan_stage_id, code: row.plan_code, name: row.plan_name, semantic: row.plan_semantic },
      status: row.plan_status,
      dueDate: row.due_date,
      ownerUserId: row.owner_user_id,
      updatedAt: toIso(row.updated_at) ?? '',
    }));
  }
}

/** Cập nhật kế hoạch khi cơ hội đổi giai đoạn (trong transaction của `changeStage`). */
async function applyPlanStageChange(client: CrmSqlClient, opportunityId: string, change: StageChange): Promise<void> {
  const forward = change.toSortOrder > change.fromSortOrder;
  const terminal = change.toSemantic !== 'OPEN';
  // Giai đoạn rời đi: tiến hoặc kết thúc là xong, lùi là quay về chờ.
  await client.query(
    `UPDATE crm_schema.opportunity_stage_plan SET status = $3, updated_at = now()
      WHERE opportunity_id = $1::uuid AND stage_id = $2::uuid AND status <> 'SKIPPED'`,
    [opportunityId, change.fromStageId, forward || terminal ? 'DONE' : 'PENDING'],
  );
  // Giai đoạn đích (có thể chưa có dòng nếu luồng đổi sau khi tạo cơ hội).
  await client.query(
    `INSERT INTO crm_schema.opportunity_stage_plan (opportunity_id, stage_id, status)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (opportunity_id, stage_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [opportunityId, change.toStageId, terminal ? 'DONE' : 'ACTIVE'],
  );
  if (terminal) return;
  // Giai đoạn nằm giữa khi nhảy tiến thành xong; khi lùi, giai đoạn đã xong phía sau đích quay về chờ.
  await client.query(
    forward
      ? `UPDATE crm_schema.opportunity_stage_plan sp SET status = 'DONE', updated_at = now()
           FROM crm_schema.pipeline_stages s
          WHERE sp.opportunity_id = $1::uuid AND s.id = sp.stage_id AND sp.status = 'PENDING'
            AND s.semantic = 'OPEN' AND s.sort_order < $2::int AND s.sort_order > $3::int`
      : `UPDATE crm_schema.opportunity_stage_plan sp SET status = 'PENDING', updated_at = now()
           FROM crm_schema.pipeline_stages s
          WHERE sp.opportunity_id = $1::uuid AND s.id = sp.stage_id AND sp.status = 'DONE'
            AND s.semantic = 'OPEN' AND s.sort_order > $2::int AND s.sort_order < $3::int`,
    [opportunityId, change.toSortOrder, change.fromSortOrder],
  );
}

interface StageAssignedInput {
  readonly opportunityId: string;
  readonly opportunityName: string;
  readonly stageId: string;
  readonly stageCode: string;
  readonly stageName: string;
  readonly assigneeUserId: string | null;
  readonly previousAssigneeUserId: string | null;
  readonly actorUserId: string | null;
  readonly cause: 'CREATED' | 'OVERRIDE';
}

/** Ghi sự kiện `crm.opportunity.stage-assigned`; người nhận thông báo là người cũ và mới, trừ người thực hiện. */
async function writeStageAssigned(client: CrmSqlClient, tenantId: string, input: StageAssignedInput): Promise<void> {
  const recipients = [input.previousAssigneeUserId, input.assigneeUserId].filter(
    (userId, index, all): userId is string => !!userId && userId !== input.actorUserId && all.indexOf(userId) === index,
  );
  const payload: CrmOpportunityStageAssignedPayload = {
    opportunityId: input.opportunityId,
    name: input.opportunityName,
    stageId: input.stageId,
    stageCode: input.stageCode,
    stageName: input.stageName,
    assigneeUserId: input.assigneeUserId,
    previousAssigneeUserId: input.previousAssigneeUserId,
    actorUserId: input.actorUserId,
    cause: input.cause,
    recipientUserIds: recipients,
    summary: `Người đảm nhận giai đoạn "${input.stageName}" của dự án "${input.opportunityName}" đã thay đổi.`,
    deepLink: `/modules/crm#opportunities/${input.opportunityId}`,
  };
  await writeCrmOutbox(client, tenantId, {
    type: CRM_OPPORTUNITY_STAGE_ASSIGNED,
    aggregateType: 'crm-opportunity',
    aggregateId: input.opportunityId,
    payload,
  });
}

function toPlanItem(row: PlanRow): OpportunityStagePlanItem {
  return {
    stage: { id: row.stage_id, code: row.code, name: row.name, semantic: row.semantic },
    sortOrder: row.sort_order,
    status: row.status,
    skippable: row.skippable,
    assigneeUserId: row.assignee_user_id,
    assigneeWarning: row.assignee_user_id ? null : row.assignee_warning,
    assignedBy: row.assigned_by,
    assignedAt: toIso(row.assigned_at),
    dueDate: row.due_date,
    skippedReason: row.skipped_reason,
    skippedBy: row.skipped_by,
    skippedAt: toIso(row.skipped_at),
  };
}

/**
 * Tạo cơ hội trong transaction của bên gọi, kèm dòng lịch sử đầu tiên và nhật
 * ký. Ghi tường minh `pipeline_id`, `stage_id` và `stage` (không nhờ trigger
 * tương thích). Không truyền `placement` (chuyển đổi lead) thì vào giai đoạn
 * đầu của luồng mặc định.
 */
export async function insertOpportunity(
  client: CrmSqlClient,
  customerId: string,
  record: OpportunityRecord,
  actorId: string,
  leadId: string | null,
  placement?: OpportunityPlacement,
): Promise<string> {
  const target = placement ?? (await defaultPlacement(client));
  const result = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.opportunities
       (name, probability, expected_value, expected_close_date, need, budget, owner_user_id, estimate_total_value,
        estimate_cost_value, customer_id, lead_id, created_by, updated_by, pipeline_id, stage_id, stage,
        competitor_name, competitor_price)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13::uuid, $14::uuid, $15, $16, $17)
     RETURNING id`,
    [
      ...opportunityValues(record),
      customerId,
      leadId,
      actorId,
      target.pipelineId,
      target.stageId,
      target.stageCode,
      record.competitorName ?? null,
      record.competitorPrice ?? null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('crm_schema.opportunities insert returned no row.');
  await recordStageChange(client, id, {
    from: null,
    fromStageId: null,
    to: target.stageCode,
    toStageId: target.stageId,
    reason: null,
    actorId,
    metadata: { pipelineId: target.pipelineId },
  });
  if (!target.plan) await insertDefaultStagePlan(client, id, target);
  return id;
}

/** Cơ hội tạo không qua service (chuyển đổi lead): kế hoạch cho mọi giai đoạn đang bật, chưa gán người. */
async function insertDefaultStagePlan(
  client: CrmSqlClient,
  opportunityId: string,
  target: OpportunityPlacement,
): Promise<void> {
  await client.query(
    `INSERT INTO crm_schema.opportunity_stage_plan (opportunity_id, stage_id, status)
     SELECT $1::uuid, s.id, CASE WHEN s.id = $2::uuid THEN 'ACTIVE' ELSE 'PENDING' END
       FROM crm_schema.pipeline_stages s
      WHERE s.pipeline_id = $3::uuid AND (s.active OR s.id = $2::uuid)
     ON CONFLICT (opportunity_id, stage_id) DO NOTHING`,
    [opportunityId, target.stageId, target.pipelineId],
  );
}

/**
 * Ghi kế hoạch giai đoạn đã dựng ở service (người đảm nhận theo quy tắc, giai đoạn bỏ qua), kèm `audit_log`
 * bỏ qua giai đoạn và sự kiện `stage-assigned` cho từng người được gán.
 */
async function insertStagePlan(
  client: CrmSqlClient,
  tenantId: string,
  opportunityId: string,
  record: OpportunityRecord,
  plan: readonly PlannedStage[],
  stageNames: NonNullable<OpportunityPlacement['stageNames']>,
  actorId: string,
): Promise<void> {
  for (const item of plan) {
    await client.query(
      `INSERT INTO crm_schema.opportunity_stage_plan
         (opportunity_id, stage_id, assignee_user_id, status, skipped_reason, skipped_by, skipped_at,
          assigned_by, assigned_at, assignee_warning)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7::timestamptz, $8::uuid, $9::timestamptz, $10)`,
      [
        opportunityId,
        item.stageId,
        item.assigneeUserId,
        item.status,
        item.skippedReason,
        item.status === 'SKIPPED' ? actorId : null,
        item.status === 'SKIPPED' ? new Date() : null,
        item.assigneeUserId ? actorId : null,
        item.assigneeUserId ? new Date() : null,
        item.assigneeWarning,
      ],
    );
    const stage = stageNames[item.stageId];
    if (item.status === 'SKIPPED') {
      await writeAuditLog(client, {
        entityType: OPPORTUNITY_AUDIT_ENTITY,
        entityId: opportunityId,
        action: 'skip_stage',
        actorId,
        reason: item.skippedReason,
        metadata: { stageId: item.stageId, stageCode: stage?.code ?? null, atCreation: true },
      });
    }
    if (item.assigneeUserId && item.status !== 'SKIPPED') {
      await writeStageAssigned(client, tenantId, {
        opportunityId,
        opportunityName: record.name,
        stageId: item.stageId,
        stageCode: stage?.code ?? '',
        stageName: stage?.name ?? '',
        assigneeUserId: item.assigneeUserId,
        previousAssigneeUserId: null,
        actorUserId: actorId,
        cause: 'CREATED',
      });
    }
  }
}


async function defaultPlacement(client: CrmSqlClient): Promise<OpportunityPlacement> {
  const result = await client.query<{ pipeline_id: string; stage_id: string; code: string }>(
    `SELECT p.id AS pipeline_id, s.id AS stage_id, s.code
       FROM crm_schema.pipelines p
       JOIN crm_schema.pipeline_stages s ON s.pipeline_id = p.id
      WHERE p.is_default AND s.active AND s.semantic = 'OPEN'
      ORDER BY s.sort_order, s.code
      LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new CrmConflictError('PIPELINE_NOT_CONFIGURED', 'Chưa cấu hình luồng bán hàng mặc định cho cơ hội.');
  }
  return { pipelineId: row.pipeline_id, stageId: row.stage_id, stageCode: row.code };
}

interface StageChangeRecord {
  readonly from: string | null;
  readonly fromStageId: string | null;
  readonly to: string;
  readonly toStageId: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

async function recordStageChange(client: CrmSqlClient, opportunityId: string, change: StageChangeRecord): Promise<void> {
  await client.query(
    `INSERT INTO crm_schema.opportunity_stage_history
       (opportunity_id, from_stage, to_stage, actor_id, reason, from_stage_id, to_stage_id)
     VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid)`,
    [opportunityId, change.from, change.to, change.actorId, change.reason, change.fromStageId, change.toStageId],
  );
  await writeAuditLog(client, {
    entityType: OPPORTUNITY_AUDIT_ENTITY,
    entityId: opportunityId,
    fromStatus: change.from,
    toStatus: change.to,
    action: change.from ? 'change_stage' : 'create',
    actorId: change.actorId,
    reason: change.reason,
    metadata: { ...change.metadata, fromStageId: change.fromStageId, toStageId: change.toStageId },
  });
}

/** Chuỗi chỉ có ký tự đặc biệt (`%`, `_`) vẫn là điều kiện tìm, không bị bỏ qua. */
function addNameSearch(where: SqlConditions, q: string | undefined): void {
  if (q) where.add(nameSearchCondition(where, 'o.name', q));
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
    record.estimateTotalValue ?? null,
    record.estimateCostValue ?? null,
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
    pipeline: { id: row.pipeline_id, code: row.pipeline_code, name: row.pipeline_name },
    stageInfo: { id: row.stage_id, code: row.stage, name: row.stage_name, semantic: row.stage_semantic },
    probability: row.probability,
    expectedValue: toNumber(row.expected_value),
    expectedCloseDate: row.expected_close_date,
    ownerUserId: row.owner_user_id,
    version: row.version,
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toSkipHistory(row: SkipRow): OpportunityStageHistoryEntry {
  return {
    id: `skip:${row.stage_id}`,
    fromStage: null,
    toStage: row.code,
    fromStageId: null,
    toStageId: row.stage_id,
    fromStageName: null,
    toStageName: row.name,
    actorId: row.skipped_by,
    reason: row.skipped_reason,
    at: toIso(row.skipped_at) ?? '',
    kind: 'SKIP',
  };
}

function toHistory(row: HistoryRow): OpportunityStageHistoryEntry {
  return {
    id: row.id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    fromStageId: row.from_stage_id,
    toStageId: row.to_stage_id,
    fromStageName: row.from_stage_name,
    toStageName: row.to_stage_name,
    actorId: row.actor_id,
    reason: row.reason,
    at: toIso(row.at) ?? '',
    kind: 'CHANGE',
  };
}
