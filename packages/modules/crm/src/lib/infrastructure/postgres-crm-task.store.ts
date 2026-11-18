import type {
  CrmTaskStore,
  OwnerTaskKind,
  OwnerTaskRecord,
  PendingApprovalRecord,
} from '../application/crm-task-store.port.js';
import type { CrmDataScope } from '../application/data-scope.js';
import type { CrmDatabase } from './crm.database.js';
import { CRM_BUSINESS_PLAN_SOURCE_TYPE } from './postgres-business-plan.store.js';
import { CRM_QUOTE_SOURCE_TYPE } from './postgres-quote.store.js';
import { SqlConditions, toIso, toNumber } from './sql-helpers.js';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface PendingRow {
  subject: 'QUOTE' | 'BUSINESS_PLAN';
  quote_id: string;
  code: string;
  quote_name: string | null;
  version_no: number;
  customer_id: string;
  customer_name: string;
  owner_user_id: string;
  submitted_by: string | null;
  submitted_at: Date | null;
  total_amount: string;
  margin_percent: string | null;
  approval_reasons: { message?: unknown }[] | null;
  link_status: string | null;
  instance_id: string | null;
  instance_code: string | null;
}

interface OwnerRow {
  kind: OwnerTaskKind;
  quote_id: string;
  code: string;
  quote_name: string | null;
  version_no: number;
  customer_id: string;
  customer_name: string;
  owner_user_id: string;
  actor_user_id: string | null;
  at: Date | null;
  total_amount: string;
  margin_percent: string | null;
  reason: string | null;
}

const reasonsOf = (value: PendingRow['approval_reasons']): string[] =>
  (Array.isArray(value) ? value : []).map((reason) => (typeof reason?.message === 'string' ? reason.message : '')).filter(Boolean);

/**
 * Đọc việc cần xử lý (plan mục 17.4). Báo giá chờ duyệt lấy theo phiên bản hiện tại ở Chờ duyệt; PAKD chờ duyệt là
 * PAKD của phiên bản hiện tại có vòng đang mở trình riêng (`via = 'STANDALONE'`). Phạm vi dữ liệu như danh sách báo
 * giá (người phụ trách, người được gán giai đoạn, người theo dõi).
 */
export class PostgresCrmTaskStore implements CrmTaskStore {
  constructor(private readonly database: CrmDatabase) {}

  async pendingApprovals(
    tenantId: string,
    scope: CrmDataScope,
    options: { readonly limit: number; readonly quoteIds?: readonly string[] },
  ): Promise<PendingApprovalRecord[]> {
    const where = new SqlConditions([CRM_QUOTE_SOURCE_TYPE, CRM_BUSINESS_PLAN_SOURCE_TYPE]);
    where.opportunityScope(scope, 't.owner_user_id', 't.opportunity_id', 't.quote_id');
    if (options.quoteIds) where.add(`t.quote_id = ANY(${where.param([...options.quoteIds])}::uuid[])`);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PendingRow>(
      `WITH tasks AS (
         SELECT 'QUOTE' AS subject, q.id AS quote_id, q.code, v.quote_name, v.version_no, q.customer_id, c.name AS customer_name,
                q.owner_user_id, q.opportunity_id, v.submitted_by, v.submitted_at, v.total_amount, v.margin_percent,
                v.approval_reasons, l.status AS link_status, l.instance_id, l.instance_code
           FROM crm_schema.quotes q
           JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
           JOIN crm_schema.customers c ON c.id = q.customer_id
           LEFT JOIN crm_schema.procedure_links l ON l.source_type = $1 AND l.source_id = v.id
          WHERE v.status = 'PENDING'
         UNION ALL
         SELECT 'BUSINESS_PLAN', q.id, q.code, v.quote_name, v.version_no, q.customer_id, c.name,
                q.owner_user_id, q.opportunity_id, p.submitted_by, p.submitted_at, v.total_amount, p.margin_percent,
                NULL::jsonb, l.status, l.instance_id, l.instance_code
           FROM crm_schema.quotes q
           JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
           JOIN crm_schema.business_plans p ON p.quote_version_id = v.id
           JOIN crm_schema.business_plan_rounds r ON r.quote_id = p.quote_id AND r.round_no = p.current_round_no
           JOIN crm_schema.customers c ON c.id = q.customer_id
           LEFT JOIN crm_schema.procedure_links l ON l.source_type = $2 AND l.source_id = r.id
          WHERE p.status = 'PENDING' AND r.via = 'STANDALONE'
       )
       SELECT t.* FROM tasks t ${where.where()}
        ORDER BY t.submitted_at DESC NULLS LAST, t.quote_id DESC
        LIMIT ${where.param(options.limit)}`,
      where.params,
    );
    return result.rows.map(
      (row): PendingApprovalRecord => ({
        subject: row.subject,
        quoteId: row.quote_id,
        quoteCode: row.code,
        quoteName: row.quote_name,
        versionNo: row.version_no,
        customerId: row.customer_id,
        customerName: row.customer_name,
        ownerUserId: row.owner_user_id,
        submittedBy: row.submitted_by,
        submittedAt: toIso(row.submitted_at),
        totalAmount: num(row.total_amount),
        marginPercent: toNumber(row.margin_percent),
        reasons: reasonsOf(row.approval_reasons),
        link: row.link_status ? { status: row.link_status, instanceId: row.instance_id, instanceCode: row.instance_code } : null,
      }),
    );
  }

  async ownerTasks(tenantId: string, ownerUserId: string, limit: number): Promise<OwnerTaskRecord[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OwnerRow>(
      `SELECT * FROM (
         SELECT CASE v.status WHEN 'REJECTED' THEN 'QUOTE_REJECTED' ELSE 'QUOTE_READY_TO_SEND' END AS kind,
                q.id AS quote_id, q.code, v.quote_name, v.version_no, q.customer_id, c.name AS customer_name, q.owner_user_id,
                CASE v.status WHEN 'REJECTED' THEN v.rejected_by ELSE v.approved_by END AS actor_user_id,
                CASE v.status WHEN 'REJECTED' THEN v.rejected_at ELSE COALESCE(v.approved_at, v.submitted_at) END AS at,
                v.total_amount, v.margin_percent,
                CASE v.status WHEN 'REJECTED' THEN v.decision_reason ELSE NULL END AS reason
           FROM crm_schema.quotes q
           JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
           JOIN crm_schema.customers c ON c.id = q.customer_id
          WHERE q.owner_user_id = $1 AND v.status IN ('REJECTED', 'APPROVED')
         UNION ALL
         SELECT 'BUSINESS_PLAN_REJECTED', q.id, q.code, v.quote_name, v.version_no, q.customer_id, c.name, q.owner_user_id,
                p.decided_by, p.decided_at, v.total_amount, p.margin_percent, p.decision_reason
           FROM crm_schema.quotes q
           JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
           JOIN crm_schema.business_plans p ON p.quote_version_id = v.id
           JOIN crm_schema.business_plan_rounds r ON r.quote_id = p.quote_id AND r.round_no = p.current_round_no
           JOIN crm_schema.customers c ON c.id = q.customer_id
          WHERE q.owner_user_id = $1 AND v.status = 'DRAFT' AND p.status = 'REJECTED' AND r.via = 'STANDALONE'
       ) t
       ORDER BY t.at DESC NULLS LAST, t.quote_id DESC
       LIMIT $2`,
      [ownerUserId, limit],
    );
    return result.rows.map(
      (row): OwnerTaskRecord => ({
        kind: row.kind,
        quoteId: row.quote_id,
        quoteCode: row.code,
        quoteName: row.quote_name,
        versionNo: row.version_no,
        customerId: row.customer_id,
        customerName: row.customer_name,
        ownerUserId: row.owner_user_id,
        actorUserId: row.actor_user_id,
        at: toIso(row.at),
        totalAmount: num(row.total_amount),
        marginPercent: toNumber(row.margin_percent),
        reasons: row.reason ? [row.reason] : [],
      }),
    );
  }
}
