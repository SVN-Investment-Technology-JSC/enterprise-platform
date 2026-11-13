import type { PeopleDirectory } from '../application/sales-store.port.js';
import {
  businessPlanSourceSummary,
  quoteSourceSummary,
  type CrmSourceSummary,
  type SourcePlanFigures,
} from '../domain/procedure-source-summary.js';
import { evaluatePlanApproval } from '../domain/quote-approval-policy.js';
import type { CrmDatabase } from './crm.database.js';
import { CRM_BUSINESS_PLAN_SOURCE_TYPE, PostgresBusinessPlanStore } from './postgres-business-plan.store.js';
import { CRM_QUOTE_SOURCE_TYPE } from './postgres-quote.store.js';
import { toNumber } from './sql-helpers.js';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface PlanFigureRow {
  revenue: string | null;
  goods_cost: string | null;
  total_cost: string | null;
  profit: string | null;
  margin_percent: string | null;
}

const planFigures = (row: PlanFigureRow): SourcePlanFigures => ({
  revenue: num(row.revenue),
  goodsCost: num(row.goods_cost),
  totalCost: num(row.total_cost),
  profit: num(row.profit),
  marginPercent: toNumber(row.margin_percent),
});

/** Tên người phụ trách theo danh bạ; danh bạ lỗi hoặc không có thì bỏ dòng, không chặn việc gửi. */
async function personName(people: PeopleDirectory | undefined, tenantId: string, userId: string): Promise<string | null> {
  if (!people) return null;
  try {
    return (await people.people(tenantId)).find((person) => person.userId === userId)?.displayName ?? null;
  } catch {
    return null;
  }
}

/**
 * Dựng thông tin nguồn cho một liên kết duyệt từ dữ liệu đang lưu (plan mục 17.2): báo giá theo phiên bản
 * (`crm_quote`), PAKD theo vòng duyệt (`crm_business_plan`). Phiên bản Chờ duyệt và PAKD đang chờ đã khoá sửa nên
 * dựng lúc tạo hồ sơ hay lúc bổ sung đều cho cùng nội dung. Nguồn khác hoặc không còn dữ liệu: `null`.
 */
export async function loadSourceSummary(
  database: CrmDatabase,
  tenantId: string,
  sourceType: string,
  sourceId: string,
  people?: PeopleDirectory,
): Promise<CrmSourceSummary | null> {
  const pool = await database.pool(tenantId);
  if (sourceType === CRM_QUOTE_SOURCE_TYPE) {
    const row = (
      await pool.query<
        {
          quote_id: string;
          code: string;
          owner_user_id: string;
          version_no: number;
          customer_name: string;
          opportunity_name: string | null;
          organization_name: string | null;
          total_amount: string;
          discount_amount: string;
          discount_percent: string;
          est_cost: string;
          version_margin: string | null;
          approval_reasons: { message?: unknown }[] | null;
          plan_id: string | null;
        } & PlanFigureRow
      >(
        `SELECT q.id AS quote_id, q.code, q.owner_user_id, v.version_no, c.name AS customer_name, o.name AS opportunity_name,
                COALESCE(so.name, v.seller->>'name') AS organization_name, v.total_amount, v.discount_amount,
                v.discount_percent, v.est_cost, v.margin_percent AS version_margin, v.approval_reasons,
                p.id AS plan_id, p.revenue, p.goods_cost, p.total_cost, p.profit, p.margin_percent
           FROM crm_schema.quote_versions v
           JOIN crm_schema.quotes q ON q.id = v.quote_id
           JOIN crm_schema.customers c ON c.id = q.customer_id
           LEFT JOIN crm_schema.opportunities o ON o.id = q.opportunity_id
           LEFT JOIN crm_schema.sales_organizations so ON so.id = v.organization_id
           LEFT JOIN crm_schema.business_plans p ON p.quote_version_id = v.id
          WHERE v.id = $1`,
        [sourceId],
      )
    ).rows[0];
    if (!row) return null;
    return quoteSourceSummary({
      quoteId: row.quote_id,
      code: row.code,
      versionNo: row.version_no,
      customerName: row.customer_name,
      opportunityName: row.opportunity_name,
      ownerName: await personName(people, tenantId, row.owner_user_id),
      organizationName: row.organization_name,
      totalAmount: num(row.total_amount),
      discountAmount: num(row.discount_amount),
      discountPercent: num(row.discount_percent),
      estCost: num(row.est_cost),
      marginPercent: toNumber(row.version_margin),
      reasons: (Array.isArray(row.approval_reasons) ? row.approval_reasons : [])
        .map((reason) => (typeof reason?.message === 'string' ? reason.message : ''))
        .filter(Boolean),
      plan: row.plan_id ? planFigures(row) : null,
    });
  }
  if (sourceType === CRM_BUSINESS_PLAN_SOURCE_TYPE) {
    const row = (
      await pool.query<
        {
          quote_id: string;
          code: string;
          owner_user_id: string;
          version_no: number;
          customer_name: string;
          discount_percent: string;
        } & PlanFigureRow
      >(
        `SELECT q.id AS quote_id, q.code, q.owner_user_id, r.quote_version_no AS version_no, c.name AS customer_name,
                r.revenue, r.goods_cost, r.total_cost, r.profit, r.margin_percent, r.discount_percent
           FROM crm_schema.business_plan_rounds r
           JOIN crm_schema.quotes q ON q.id = r.quote_id
           JOIN crm_schema.customers c ON c.id = q.customer_id
          WHERE r.id = $1`,
        [sourceId],
      )
    ).rows[0];
    if (!row) return null;
    const figures = planFigures(row);
    const plans = new PostgresBusinessPlanStore(database);
    const [baseline, settings] = await Promise.all([
      plans.latestApproved(tenantId, row.quote_id, row.version_no),
      plans.deviationSettings(tenantId),
    ]);
    const reasons = baseline
      ? evaluatePlanApproval({
          plan: null,
          current: { profit: figures.profit, discountPercent: num(row.discount_percent) },
          baseline: baseline.figures,
          settings,
        }).reasons.map((reason) => reason.message)
      : [];
    return businessPlanSourceSummary({
      quoteId: row.quote_id,
      code: row.code,
      versionNo: row.version_no,
      customerName: row.customer_name,
      ownerName: await personName(people, tenantId, row.owner_user_id),
      figures,
      reasons,
    });
  }
  return null;
}
