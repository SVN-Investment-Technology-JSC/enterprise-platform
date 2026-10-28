import {
  OPEN_OPPORTUNITY_STAGES,
  activityDeepLink,
  contractDeepLink,
  quoteDeepLink,
  receivableDeepLink,
  salesOrderDeepLink,
  type DashboardAttentionItem,
  type DashboardAttentionList,
  type DashboardRange,
  type DashboardStageRow,
  type DashboardTopCustomer,
  type DashboardTopProduct,
  type OpportunityStage,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  DashboardAttentionFilter,
  DashboardPeriodFigures,
  DashboardSnapshot,
  DashboardViewer,
  SalesDashboardStore,
} from '../application/sales-dashboard-store.port.js';
import type { DailyFigure } from '../domain/dashboard.js';
import { roundVnd } from '../domain/pricing-engine.js';
import { daysOverdue } from '../domain/receivables.js';
import type { CrmDatabase } from './crm.database.js';
import { ownerScopeSql } from './owner-scope-sql.js';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

/** Đầu ngày `$n` và đầu ngày sau `$n` theo giờ Việt Nam, để lọc cột `timestamptz` theo ngày. */
const dayStart = (param: string) => `(${param}::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
const dayAfter = (param: string) => `(${param}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

/** `dd/mm/yyyy` cho câu mô tả. */
function viDate(date: string | null): string {
  return date ? date.split('-').reverse().join('/') : '';
}

/**
 * Tham số của một câu gọi kèm điều kiện phạm vi trên nhiều cột (các nhánh
 * UNION, các truy vấn con) dùng chung một `$n` danh sách người.
 */
class ScopedParams {
  readonly values: unknown[];
  private readonly scopeIndex: number;

  constructor(
    private readonly scope: CrmDataScope,
    initial: readonly unknown[] = [],
  ) {
    this.values = [...initial];
    this.scopeIndex = this.values.length + 1;
    if (scope.kind !== 'all') this.values.push([...scope.userIds]);
  }

  /** Điều kiện phạm vi trên cột người phụ trách `column`. */
  on(column: string): string {
    return ownerScopeSql(this.scope, column, this.scopeIndex).sql;
  }

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

interface AttentionRow {
  id: string;
  title: string;
  subtitle: string | null;
  date: string | null;
  amount: string | null;
  total: number;
}

function attention<TRow extends AttentionRow>(rows: readonly TRow[], map: (row: TRow) => DashboardAttentionItem): DashboardAttentionList {
  return { total: rows[0]?.total ?? 0, items: rows.map(map) };
}

/**
 * Đọc số liệu dashboard Tổng quan. Doanh thu, lợi nhuận đọc `sales_facts` (chỉ
 * mục ngày, người phụ trách + ngày); đơn mới theo `created_at`; cơ hội theo
 * giai đoạn; công nợ theo người phụ trách khách như báo cáo công nợ. Danh sách
 * "Cần chú ý" trả tối đa `limit` mục kèm tổng số khớp (`count(*) OVER ()`).
 */
export class PostgresSalesDashboardStore implements SalesDashboardStore {
  constructor(private readonly database: CrmDatabase) {}

  async periodFigures(
    tenantId: string,
    scope: CrmDataScope,
    current: DashboardRange,
    previous: DashboardRange,
  ): Promise<{ current: DashboardPeriodFigures; previous: DashboardPeriodFigures }> {
    const pool = await this.database.pool(tenantId);
    // $1..$4: từ, đến của kỳ hiện tại rồi kỳ trước; kỳ trước luôn nằm trước kỳ hiện tại.
    const params = new ScopedParams(scope, [current.from, current.to, previous.from, previous.to]);
    const both = (column: string, cast = '') => ({
      current: `${column} >= ${dayStart('$1')}${cast} AND ${column} < ${dayAfter('$2')}${cast}`,
      previous: `${column} >= ${dayStart('$3')}${cast} AND ${column} < ${dayAfter('$4')}${cast}`,
    });
    const created = both('s.created_at');
    const closed = both('o.closed_at');
    const [facts, orders, opportunities] = await Promise.all([
      pool.query<{ cur_revenue: string; cur_cost: string; prev_revenue: string; prev_cost: string }>(
        `SELECT COALESCE(sum(f.revenue) FILTER (WHERE f.delivered_date >= $1::date), 0) AS cur_revenue,
                COALESCE(sum(f.cost_amount) FILTER (WHERE f.delivered_date >= $1::date), 0) AS cur_cost,
                COALESCE(sum(f.revenue) FILTER (WHERE f.delivered_date <= $4::date), 0) AS prev_revenue,
                COALESCE(sum(f.cost_amount) FILTER (WHERE f.delivered_date <= $4::date), 0) AS prev_cost
           FROM crm_schema.sales_facts f
          WHERE ((f.delivered_date BETWEEN $1::date AND $2::date) OR (f.delivered_date BETWEEN $3::date AND $4::date))
            AND ${params.on('f.owner_user_id')}`,
        params.values,
      ),
      pool.query<{ cur: number; prev: number }>(
        `SELECT count(*) FILTER (WHERE ${created.current})::int AS cur,
                count(*) FILTER (WHERE ${created.previous})::int AS prev
           FROM crm_schema.sales_orders s
          WHERE ((${created.current}) OR (${created.previous}))
            AND s.status NOT IN ('DRAFT', 'CANCELLED')
            AND ${params.on('s.owner_user_id')}`,
        params.values,
      ),
      pool.query<{ cur_won: number; cur_lost: number; prev_won: number; prev_lost: number }>(
        `SELECT count(*) FILTER (WHERE o.stage = 'WON' AND ${closed.current})::int AS cur_won,
                count(*) FILTER (WHERE o.stage = 'LOST' AND ${closed.current})::int AS cur_lost,
                count(*) FILTER (WHERE o.stage = 'WON' AND ${closed.previous})::int AS prev_won,
                count(*) FILTER (WHERE o.stage = 'LOST' AND ${closed.previous})::int AS prev_lost
           FROM crm_schema.opportunities o
          WHERE o.stage IN ('WON', 'LOST')
            AND ((${closed.current}) OR (${closed.previous}))
            AND ${params.on('o.owner_user_id')}`,
        params.values,
      ),
    ]);
    const fact = facts.rows[0];
    const order = orders.rows[0];
    const opportunity = opportunities.rows[0];
    return {
      current: {
        revenue: num(fact?.cur_revenue),
        costAmount: num(fact?.cur_cost),
        newOrders: order?.cur ?? 0,
        won: opportunity?.cur_won ?? 0,
        lost: opportunity?.cur_lost ?? 0,
      },
      previous: {
        revenue: num(fact?.prev_revenue),
        costAmount: num(fact?.prev_cost),
        newOrders: order?.prev ?? 0,
        won: opportunity?.prev_won ?? 0,
        lost: opportunity?.prev_lost ?? 0,
      },
    };
  }

  async dailyFigures(tenantId: string, scope: CrmDataScope, range: DashboardRange): Promise<DailyFigure[]> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [range.from, range.to]);
    const result = await pool.query<{ day: string; revenue: string; orders: number }>(
      `SELECT day::text AS day, COALESCE(sum(revenue), 0) AS revenue, sum(orders)::int AS orders
         FROM (
           SELECT f.delivered_date AS day, f.revenue, 0 AS orders
             FROM crm_schema.sales_facts f
            WHERE f.delivered_date BETWEEN $1::date AND $2::date AND ${params.on('f.owner_user_id')}
           UNION ALL
           SELECT (s.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, 0 AS revenue, 1 AS orders
             FROM crm_schema.sales_orders s
            WHERE s.created_at >= ${dayStart('$1')} AND s.created_at < ${dayAfter('$2')}
              AND s.status NOT IN ('DRAFT', 'CANCELLED') AND ${params.on('s.owner_user_id')}
         ) x
        GROUP BY day
        ORDER BY day`,
      params.values,
    );
    return result.rows.map((row) => ({ date: row.day, revenue: num(row.revenue), orders: row.orders }));
  }

  async pipeline(tenantId: string, scope: CrmDataScope): Promise<DashboardStageRow[]> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [[...OPEN_OPPORTUNITY_STAGES]]);
    const result = await pool.query<{ stage: OpportunityStage; n: number; value: string; weighted: string }>(
      `SELECT o.stage, count(*)::int AS n, COALESCE(sum(o.expected_value), 0) AS value,
              COALESCE(sum(o.expected_value * o.probability / 100.0), 0) AS weighted
         FROM crm_schema.opportunities o
        WHERE o.stage = ANY($1::varchar[]) AND ${params.on('o.owner_user_id')}
        GROUP BY o.stage`,
      params.values,
    );
    return result.rows.map((row) => ({
      stage: row.stage,
      count: row.n,
      value: roundVnd(num(row.value)),
      weightedValue: roundVnd(num(row.weighted)),
    }));
  }

  async topCustomers(tenantId: string, scope: CrmDataScope, range: DashboardRange, limit: number): Promise<DashboardTopCustomer[]> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [range.from, range.to]);
    const result = await pool.query<{ id: string; code: string; name: string; revenue: string; profit: string; orders: number }>(
      `SELECT f.customer_id AS id, c.code, c.name, sum(f.revenue) AS revenue,
              sum(f.revenue - f.cost_amount) AS profit, count(DISTINCT f.order_id)::int AS orders
         FROM crm_schema.sales_facts f
         JOIN crm_schema.customers c ON c.id = f.customer_id
        WHERE f.delivered_date BETWEEN $1::date AND $2::date AND ${params.on('f.owner_user_id')}
        GROUP BY f.customer_id, c.code, c.name
       HAVING sum(f.revenue) > 0
        ORDER BY sum(f.revenue) DESC, c.code
        LIMIT ${params.add(limit)}`,
      params.values,
    );
    return result.rows.map((row) => ({
      customerId: row.id,
      code: row.code,
      name: row.name,
      revenue: roundVnd(num(row.revenue)),
      profit: roundVnd(num(row.profit)),
      orderCount: row.orders,
    }));
  }

  async topProducts(tenantId: string, scope: CrmDataScope, range: DashboardRange, limit: number): Promise<DashboardTopProduct[]> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [range.from, range.to]);
    const result = await pool.query<{ id: string; code: string; name: string; quantity: string; revenue: string; profit: string }>(
      `SELECT f.material_id AS id, max(f.material_code) AS code, max(f.material_name) AS name,
              sum(f.quantity) AS quantity, sum(f.revenue) AS revenue, sum(f.revenue - f.cost_amount) AS profit
         FROM crm_schema.sales_facts f
        WHERE f.delivered_date BETWEEN $1::date AND $2::date AND ${params.on('f.owner_user_id')}
        GROUP BY f.material_id
       HAVING sum(f.revenue) > 0
        ORDER BY sum(f.revenue) DESC, max(f.material_code)
        LIMIT ${params.add(limit)}`,
      params.values,
    );
    return result.rows.map((row) => ({
      materialId: row.id,
      code: row.code,
      name: row.name,
      quantity: Math.round(num(row.quantity) * 1000) / 1000,
      revenue: roundVnd(num(row.revenue)),
      profit: roundVnd(num(row.profit)),
    }));
  }

  async snapshot(tenantId: string, scope: CrmDataScope, today: string): Promise<DashboardSnapshot> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [today]);
    const quoteParams = new ScopedParams(scope);
    const [receivables, quotes] = await Promise.all([
      pool.query<{ balance: string; overdue: string; overdue_customers: number }>(
        `WITH scoped AS (
           SELECT c.id FROM crm_schema.customers c WHERE ${params.on('c.owner_user_id')}
         ), overdue AS (
           SELECT i.customer_id, i.open_amount
             FROM crm_schema.receivable_open_items i
            WHERE i.customer_id IN (SELECT id FROM scoped) AND i.open_amount > 0 AND i.due_date < $1::date
         )
         SELECT (SELECT COALESCE(sum(e.amount), 0) FROM crm_schema.receivable_entries e
                  WHERE e.customer_id IN (SELECT id FROM scoped)) AS balance,
                (SELECT COALESCE(sum(open_amount), 0) FROM overdue) AS overdue,
                (SELECT count(DISTINCT customer_id)::int FROM overdue) AS overdue_customers`,
        params.values,
      ),
      pool.query<{ n: number; value: string }>(
        `SELECT count(*)::int AS n, COALESCE(sum(v.net_amount), 0) AS value
           FROM crm_schema.quotes q
           JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
          WHERE q.status = 'PENDING' AND ${quoteParams.on('q.owner_user_id')}`,
        quoteParams.values,
      ),
    ]);
    const receivable = receivables.rows[0];
    return {
      receivableBalance: num(receivable?.balance),
      receivableOverdue: num(receivable?.overdue),
      overdueCustomers: receivable?.overdue_customers ?? 0,
      pendingQuotes: quotes.rows[0]?.n ?? 0,
      pendingQuoteValue: num(quotes.rows[0]?.value),
    };
  }

  async lateDeliveries(tenantId: string, scope: CrmDataScope, filter: DashboardAttentionFilter): Promise<DashboardAttentionList> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [filter.today]);
    const result = await pool.query<AttentionRow & { late: number }>(
      `SELECT o.id, o.code AS title, c.name AS subtitle, min(d.planned_date)::text AS date, o.total_amount AS amount,
              count(*)::int AS late, (count(*) OVER ())::int AS total
         FROM crm_schema.sales_orders o
         JOIN crm_schema.customers c ON c.id = o.customer_id
         JOIN crm_schema.delivery_plans d ON d.order_id = o.id
        WHERE d.status IN ('PLANNED', 'REQUESTED') AND d.planned_date < $1::date
          AND o.status NOT IN ('CANCELLED', 'DONE') AND ${params.on('o.owner_user_id')}
        GROUP BY o.id, o.code, c.name, o.total_amount
        ORDER BY 4, o.code
        LIMIT ${params.add(filter.limit)}`,
      params.values,
    );
    return attention(result.rows, (row) => {
      const days = daysOverdue(row.date, filter.today) ?? 0;
      return {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? '',
        date: row.date,
        days,
        amount: roundVnd(num(row.amount)),
        note: `${row.late > 1 ? `${row.late} đợt giao trễ, ` : ''}trễ ${days} ngày (dự kiến ${viDate(row.date)})`,
        deepLink: salesOrderDeepLink(row.id),
      };
    });
  }

  async pendingQuotes(
    tenantId: string,
    scope: CrmDataScope,
    viewer: DashboardViewer,
    filter: DashboardAttentionFilter,
  ): Promise<DashboardAttentionList> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [viewer.userId, viewer.canApproveQuote]);
    // Của tôi: tôi gửi hoặc tôi phụ trách. Chờ tôi duyệt: tôi có quyền duyệt và không phải người gửi.
    const result = await pool.query<AttentionRow & { mine: boolean }>(
      `SELECT q.id, q.code AS title, c.name AS subtitle,
              (COALESCE(v.submitted_at, q.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date,
              v.net_amount AS amount, (v.submitted_by = $1::uuid OR q.owner_user_id = $1::uuid) AS mine,
              (count(*) OVER ())::int AS total
         FROM crm_schema.quotes q
         JOIN crm_schema.customers c ON c.id = q.customer_id
         JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
        WHERE q.status = 'PENDING' AND ${params.on('q.owner_user_id')}
          AND (v.submitted_by = $1::uuid OR q.owner_user_id = $1::uuid
               OR ($2::boolean AND v.submitted_by IS DISTINCT FROM $1::uuid))
        ORDER BY 4, q.code
        LIMIT ${params.add(filter.limit)}`,
      params.values,
    );
    return attention(result.rows, (row) => {
      const days = Math.max(daysOverdue(row.date, filter.today) ?? 0, 0);
      const waiting = days ? `${days} ngày` : 'từ hôm nay';
      return {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? '',
        date: row.date,
        days,
        amount: roundVnd(num(row.amount)),
        note: row.mine ? `Bạn gửi, chờ duyệt ${waiting}` : `Chờ bạn duyệt ${waiting}`,
        deepLink: quoteDeepLink(row.id),
      };
    });
  }

  async expiringContracts(tenantId: string, scope: CrmDataScope, filter: DashboardAttentionFilter): Promise<DashboardAttentionList> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [filter.today, filter.expiringUntil]);
    const result = await pool.query<AttentionRow>(
      `SELECT k.id, k.code AS title, c.name AS subtitle, k.valid_to::text AS date, k.value AS amount,
              (count(*) OVER ())::int AS total
         FROM crm_schema.contracts k
         JOIN crm_schema.customers c ON c.id = k.customer_id
        WHERE k.status = 'ACTIVE' AND k.valid_to BETWEEN $1::date AND $2::date AND ${params.on('k.owner_user_id')}
        ORDER BY k.valid_to, k.code
        LIMIT ${params.add(filter.limit)}`,
      params.values,
    );
    return attention(result.rows, (row) => {
      const days = -(daysOverdue(row.date, filter.today) ?? 0);
      return {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? '',
        date: row.date,
        days,
        amount: roundVnd(num(row.amount)),
        note: days ? `Hết hạn ${viDate(row.date)}, còn ${days} ngày` : 'Hết hạn hôm nay',
        deepLink: contractDeepLink(row.id),
      };
    });
  }

  async dueActivities(tenantId: string, assigneeUserId: string, filter: DashboardAttentionFilter): Promise<DashboardAttentionList> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<AttentionRow & { overdue: boolean }>(
      `SELECT a.id, a.subject AS title, COALESCE(c.name, o.name) AS subtitle,
              (a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date, NULL::numeric AS amount,
              a.due_at < now() AS overdue, (count(*) OVER ())::int AS total
         FROM crm_schema.activities a
         LEFT JOIN crm_schema.customers c ON c.id = a.customer_id
         LEFT JOIN crm_schema.opportunities o ON o.id = a.opportunity_id
        WHERE a.assignee_user_id = $1::uuid AND a.status = 'OPEN' AND a.due_at < ${dayAfter('$2')}
        ORDER BY a.due_at, a.id
        LIMIT $3`,
      [assigneeUserId, filter.today, filter.limit],
    );
    return attention(result.rows, (row) => {
      const days = Math.max(daysOverdue(row.date, filter.today) ?? 0, 0);
      return {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? '',
        date: row.date,
        days,
        amount: null,
        note: !row.overdue ? 'Đến hạn hôm nay' : days ? `Quá hạn ${days} ngày` : 'Quá hạn hôm nay',
        deepLink: activityDeepLink(row.id),
      };
    });
  }

  async overdueReceivables(tenantId: string, scope: CrmDataScope, filter: DashboardAttentionFilter): Promise<DashboardAttentionList> {
    const pool = await this.database.pool(tenantId);
    const params = new ScopedParams(scope, [filter.today]);
    const result = await pool.query<AttentionRow & { orders: number }>(
      `SELECT c.id, c.code AS title, c.name AS subtitle, min(i.due_date)::text AS date, sum(i.open_amount) AS amount,
              count(DISTINCT i.order_id)::int AS orders, (count(*) OVER ())::int AS total
         FROM crm_schema.receivable_open_items i
         JOIN crm_schema.customers c ON c.id = i.customer_id
        WHERE i.open_amount > 0 AND i.due_date < $1::date AND ${params.on('c.owner_user_id')}
        GROUP BY c.id, c.code, c.name
        ORDER BY sum(i.open_amount) DESC, c.code
        LIMIT ${params.add(filter.limit)}`,
      params.values,
    );
    return attention(result.rows, (row) => {
      const days = daysOverdue(row.date, filter.today) ?? 0;
      return {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? '',
        date: row.date,
        days,
        amount: roundVnd(num(row.amount)),
        note: `Quá hạn ${days} ngày${row.orders > 1 ? `, ${row.orders} đơn` : ''}`,
        deepLink: receivableDeepLink(row.id),
      };
    });
  }
}
