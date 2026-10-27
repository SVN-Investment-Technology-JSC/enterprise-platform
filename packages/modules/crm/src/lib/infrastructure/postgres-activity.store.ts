import type {
  Activity,
  ActivityStatus,
  ActivityType,
  CrmPage,
  CustomerTimelineEntry,
  OpportunityStage,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  ActivityFilter,
  ActivityRecord,
  ActivityStore,
  TimelineStore,
} from '../application/sales-store.port.js';
import type { KeysetCursor } from '../domain/pagination.js';
import { CrmStaleVersionError } from '../domain/crm.error.js';
import type { CrmDatabase } from './crm.database.js';
import { SqlConditions, cursorAt, keysetPage, toIso } from './sql-helpers.js';

interface ActivityRow {
  id: string;
  type: ActivityType;
  subject: string;
  description: string | null;
  customer_id: string | null;
  customer_name: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  assignee_user_id: string;
  due_at: Date | null;
  status: ActivityStatus;
  result: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  version: number;
  created_at: Date;
  created_by: string | null;
  cursor_at: string;
}

const ACTIVITY_COLUMNS = `
  a.id, a.type, a.subject, a.description, a.customer_id, c.name AS customer_name, a.opportunity_id,
  o.name AS opportunity_name, a.assignee_user_id, a.due_at, a.status, a.result, a.completed_at, a.completed_by,
  a.version, a.created_at, a.created_by, ${cursorAt('a.created_at')} AS cursor_at`;

const ACTIVITY_FROM = `
  FROM crm_schema.activities a
  LEFT JOIN crm_schema.customers c ON c.id = a.customer_id
  LEFT JOIN crm_schema.opportunities o ON o.id = a.opportunity_id`;

/**
 * Phạm vi của một hoạt động: người được giao trong phạm vi; hoặc hoạt động
 * gắn cơ hội mà người phụ trách cơ hội trong phạm vi; hoặc hoạt động chỉ gắn
 * khách mà người phụ trách khách trong phạm vi. Hoạt động trên cơ hội của
 * người ngoài phạm vi không lộ ra chỉ vì khách là của mình (TC-CUS-11).
 */
function activityScope(where: SqlConditions, scope: CrmDataScope): void {
  if (scope.kind === 'all') return;
  const users = where.param([...scope.userIds]);
  where.add(
    `(a.assignee_user_id = ANY(${users}::uuid[])
      OR (a.opportunity_id IS NOT NULL AND o.owner_user_id = ANY(${users}::uuid[]))
      OR (a.opportunity_id IS NULL AND c.owner_user_id = ANY(${users}::uuid[])))`,
  );
}

export class PostgresActivityStore implements ActivityStore {
  constructor(private readonly database: CrmDatabase) {}

  async listActivities(tenantId: string, scope: CrmDataScope, filter: ActivityFilter): Promise<CrmPage<Activity>> {
    const where = new SqlConditions();
    activityScope(where, scope);
    if (filter.customerId) where.add(`a.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.opportunityId) where.add(`a.opportunity_id = ${where.param(filter.opportunityId)}::uuid`);
    if (filter.assigneeUserId) where.add(`a.assignee_user_id = ${where.param(filter.assigneeUserId)}::uuid`);
    if (filter.status) where.add(`a.status = ${where.param(filter.status)}`);
    where.after(filter.cursor, 'a.created_at', 'a.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<ActivityRow>(
      `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_FROM} ${where.where()}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toActivity);
  }

  async getActivity(tenantId: string, scope: CrmDataScope, id: string): Promise<Activity | undefined> {
    const where = new SqlConditions();
    where.add(`a.id = ${where.param(id)}::uuid`);
    activityScope(where, scope);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<ActivityRow>(`SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_FROM} ${where.where()}`, where.params);
    return result.rows[0] ? toActivity(result.rows[0]) : undefined;
  }

  async createActivity(
    tenantId: string,
    target: { readonly customerId: string | null; readonly opportunityId: string | null },
    record: ActivityRecord,
    actorId: string,
  ): Promise<string> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO crm_schema.activities
         (type, subject, description, customer_id, opportunity_id, assignee_user_id, due_at, status, result,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING id`,
      [
        record.type,
        record.subject,
        record.description,
        target.customerId,
        target.opportunityId,
        record.assigneeUserId,
        record.dueAt,
        record.status,
        record.result,
        actorId,
      ],
    );
    return result.rows[0].id;
  }

  async updateActivity(
    tenantId: string,
    id: string,
    record: ActivityRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    const pool = await this.database.pool(tenantId);
    // Hoàn tất lần đầu ghi thời điểm và người hoàn tất; sửa lại một hoạt động đã
    // hoàn tất giữ nguyên hai trường đó; mở lại hay huỷ thì xoá.
    const result = await pool.query(
      `UPDATE crm_schema.activities
          SET type = $3, subject = $4, description = $5, assignee_user_id = $6, due_at = $7, status = $8::varchar,
              result = $9,
              completed_at = CASE WHEN $8::varchar = 'DONE' THEN COALESCE(CASE WHEN status = 'DONE' THEN completed_at END, now()) END,
              completed_by = CASE WHEN $8::varchar = 'DONE' THEN COALESCE(CASE WHEN status = 'DONE' THEN completed_by END, $10::uuid) END,
              version = version + 1, updated_at = now(), updated_by = $10
        WHERE id = $1 AND version = $2`,
      [
        id,
        expectedVersion,
        record.type,
        record.subject,
        record.description,
        record.assigneeUserId,
        record.dueAt,
        record.status,
        record.result,
        actorId,
      ],
    );
    if (!result.rowCount) throw new CrmStaleVersionError();
  }
}

interface TimelineRow {
  kind: 'opportunity-stage' | 'activity' | 'quote' | 'contract' | 'order';
  id: string;
  at: Date;
  actor_id: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  from_stage: OpportunityStage | null;
  to_stage: OpportunityStage | null;
  reason: string | null;
  activity_type: ActivityType | null;
  subject: string | null;
  status: ActivityStatus | null;
  due_at: Date | null;
  quote_id: string | null;
  version_no: string | null;
  cursor_at: string;
}

/**
 * Dòng thời gian khách hàng: hợp các nguồn bằng `UNION ALL`, mỗi nhánh tự lọc
 * phạm vi, rồi phân trang keyset trên `(at, id)`. Thêm loại mục mới (báo giá,
 * đơn, công nợ...) là thêm một nhánh và một nhánh trong `toEntry`.
 */
export class PostgresTimelineStore implements TimelineStore {
  constructor(private readonly database: CrmDatabase) {}

  async customerTimeline(
    tenantId: string,
    scope: CrmDataScope,
    customerId: string,
    cursor: KeysetCursor | undefined,
    limit: number,
  ): Promise<CrmPage<CustomerTimelineEntry>> {
    const stages = new SqlConditions();
    const customer = stages.param(customerId);
    stages.add(`o.customer_id = ${customer}::uuid`);
    stages.scope(scope, 'o.owner_user_id');

    // Nhánh hoạt động, báo giá dùng chung bộ tham số với nhánh cơ hội.
    const activities = new SqlConditions(stages.params);
    activities.add(`a.customer_id = ${customer}::uuid`);
    activityScope(activities, scope);

    const quotes = new SqlConditions(stages.params);
    quotes.add(`q.customer_id = ${customer}::uuid`);
    quotes.scope(scope, 'q.owner_user_id');

    const contracts = new SqlConditions(stages.params);
    contracts.add(`k.customer_id = ${customer}::uuid`);
    contracts.scope(scope, 'k.owner_user_id');

    const orders = new SqlConditions(stages.params);
    orders.add(`so.customer_id = ${customer}::uuid`);
    orders.scope(scope, 'so.owner_user_id');

    const outer = new SqlConditions(stages.params);
    outer.after(cursor, 't.at', 't.id');

    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TimelineRow>(
      `SELECT t.*, ${cursorAt('t.at')} AS cursor_at FROM (
         SELECT 'opportunity-stage' AS kind, h.id, h.at, h.actor_id, o.id AS opportunity_id,
                o.name AS opportunity_name, h.from_stage, h.to_stage, h.reason,
                NULL::varchar AS activity_type, NULL::varchar AS subject, NULL::varchar AS status,
                NULL::timestamptz AS due_at, NULL::uuid AS quote_id, NULL::text AS version_no
           FROM crm_schema.opportunity_stage_history h
           JOIN crm_schema.opportunities o ON o.id = h.opportunity_id
           ${stages.where()}
         UNION ALL
         SELECT 'activity', a.id, a.created_at, a.created_by, a.opportunity_id, o.name, NULL, NULL, NULL,
                a.type, a.subject, a.status, a.due_at, NULL, NULL
           ${ACTIVITY_FROM}
           ${activities.where()}
         UNION ALL
         SELECT 'quote', l.id, l.at, l.actor_id, q.opportunity_id, NULL, l.from_status, l.to_status, l.reason,
                l.action, q.code, NULL, NULL, q.id, l.metadata->>'versionNo'
           FROM crm_schema.audit_log l
           JOIN crm_schema.quotes q ON q.id = l.entity_id AND l.entity_type = 'quote'
           ${quotes.where()}
         UNION ALL
         SELECT 'contract', l.id, l.at, l.actor_id, NULL, NULL, l.from_status, l.to_status, l.reason,
                l.action, k.code, NULL, NULL, k.id, NULL
           FROM crm_schema.audit_log l
           JOIN crm_schema.contracts k ON k.id = l.entity_id AND l.entity_type = 'contract'
           ${contracts.where()}
         UNION ALL
         SELECT 'order', l.id, l.at, l.actor_id, NULL, NULL, l.from_status, l.to_status, l.reason,
                l.action, so.code, NULL, NULL, so.id, NULL
           FROM crm_schema.audit_log l
           JOIN crm_schema.sales_orders so ON so.id = l.entity_id AND l.entity_type = 'sales_order'
           ${orders.where()}
       ) t
       ${outer.where()}
       ORDER BY t.at DESC, t.id DESC
       LIMIT ${outer.param(limit + 1)}`,
      outer.params,
    );
    return keysetPage(result.rows, limit, toEntry);
  }
}

function toEntry(row: TimelineRow): CustomerTimelineEntry {
  const at = toIso(row.at) ?? '';
  if (row.kind === 'quote') {
    return {
      kind: 'quote',
      id: row.id,
      at,
      actorId: row.actor_id,
      quoteId: row.quote_id ?? '',
      quoteCode: row.subject ?? '',
      action: row.activity_type ?? '',
      fromStatus: row.from_stage,
      toStatus: row.to_stage,
      versionNo: row.version_no === null ? null : Number(row.version_no),
      reason: row.reason,
      opportunityId: row.opportunity_id,
    };
  }
  if (row.kind === 'contract' || row.kind === 'order') {
    const common = {
      id: row.id,
      at,
      actorId: row.actor_id,
      action: row.activity_type ?? '',
      fromStatus: row.from_stage,
      toStatus: row.to_stage,
      reason: row.reason,
    };
    return row.kind === 'contract'
      ? { kind: 'contract', ...common, contractId: row.quote_id ?? '', contractCode: row.subject ?? '' }
      : { kind: 'order', ...common, orderId: row.quote_id ?? '', orderCode: row.subject ?? '' };
  }
  if (row.kind === 'activity') {
    return {
      kind: 'activity',
      id: row.id,
      at,
      actorId: row.actor_id,
      activityId: row.id,
      activityType: row.activity_type as ActivityType,
      subject: row.subject ?? '',
      status: row.status as ActivityStatus,
      dueAt: toIso(row.due_at),
      opportunityId: row.opportunity_id,
    };
  }
  if (!row.from_stage) {
    return {
      kind: 'opportunity-created',
      id: row.id,
      at,
      actorId: row.actor_id,
      opportunityId: row.opportunity_id ?? '',
      opportunityName: row.opportunity_name ?? '',
      stage: row.to_stage as OpportunityStage,
    };
  }
  return {
    kind: 'opportunity-stage-changed',
    id: row.id,
    at,
    actorId: row.actor_id,
    opportunityId: row.opportunity_id ?? '',
    opportunityName: row.opportunity_name ?? '',
    fromStage: row.from_stage,
    toStage: row.to_stage as OpportunityStage,
    reason: row.reason,
  };
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    description: row.description,
    customerId: row.customer_id,
    customerName: row.customer_name,
    opportunityId: row.opportunity_id,
    opportunityName: row.opportunity_name,
    assigneeUserId: row.assignee_user_id,
    dueAt: toIso(row.due_at),
    status: row.status,
    result: row.result,
    completedAt: toIso(row.completed_at),
    completedBy: row.completed_by,
    version: row.version,
    createdAt: toIso(row.created_at) ?? '',
    createdBy: row.created_by,
  };
}
