import {
  CONVERSION_STAGES,
  contractDeepLink,
  quoteDeepLink,
  salesOrderDeepLink,
  type ConversionStage,
  type OverdueOrderRow,
  type ReceivableReportCustomerRow,
  type SalesAlert,
  type SalesAlertKind,
  type SalesReportDimension,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  ConversionCounts,
  ReceivableReportFilter,
  SalesFactFilter,
  SalesGroupResult,
  SalesGroupRow,
  SalesReportStore,
} from '../application/sales-report-store.port.js';
import { roundVnd } from '../domain/pricing-engine.js';
import { daysOverdue } from '../domain/receivables.js';
import type { RawFigures } from '../domain/sales-report.js';
import type { CrmDatabase } from './crm.database.js';
import { ownerScopeSql } from './owner-scope-sql.js';
import { SqlConditions } from './sql-helpers.js';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

/** Mỗi loại cảnh báo trả tối đa chừng này mục (cũ nhất trước). */
const ALERT_LIMIT = 500;
const RECEIVABLE_CUSTOMER_LIMIT = 2_000;
const OVERDUE_ORDER_LIMIT = 1_000;

/**
 * Biểu thức nhóm theo chiều. `group` là danh sách cột của GROUP BY; `first` là
 * cột đầu để đánh dấu dòng tổng bằng `GROUPING(...)`.
 */
const DIMENSIONS: Readonly<
  Record<SalesReportDimension, { key: string; code: string; label: string; group: string; first: string; join: string }>
> = {
  owner: { key: 'f.owner_user_id::text', code: 'NULL::text', label: 'NULL::text', group: 'f.owner_user_id', first: 'f.owner_user_id', join: '' },
  customer: {
    key: 'f.customer_id::text',
    code: 'c.code',
    label: 'c.name',
    group: 'f.customer_id, c.code, c.name',
    first: 'f.customer_id',
    join: 'JOIN crm_schema.customers c ON c.id = f.customer_id',
  },
  material: {
    key: 'f.material_id::text',
    code: 'max(f.material_code)',
    label: 'max(f.material_name)',
    group: 'f.material_id',
    first: 'f.material_id',
    join: '',
  },
  category: { key: 'f.category', code: 'NULL::text', label: 'f.category', group: 'f.category', first: 'f.category', join: '' },
  region: { key: 'f.region', code: 'NULL::text', label: 'f.region', group: 'f.region', first: 'f.region', join: '' },
  customerGroup: {
    key: 'f.customer_group_id::text',
    code: 'g.code',
    label: 'g.name',
    group: 'f.customer_group_id, g.code, g.name',
    first: 'f.customer_group_id',
    join: 'LEFT JOIN crm_schema.customer_groups g ON g.id = f.customer_group_id',
  },
};

interface FigureRow {
  quantity: string;
  revenue: string;
  vat_amount: string;
  cost_amount: string;
  order_count: number;
}

function figures(row: FigureRow | undefined): RawFigures {
  return {
    quantity: num(row?.quantity),
    revenue: num(row?.revenue),
    vatAmount: num(row?.vat_amount),
    costAmount: num(row?.cost_amount),
    orderCount: row?.order_count ?? 0,
  };
}

/** `dd/mm/yyyy` cho câu cảnh báo. */
function viDate(date: string): string {
  return date.split('-').reverse().join('/');
}

/**
 * Đọc số liệu báo cáo Bán hàng (GĐ7). Doanh thu chỉ đọc `sales_facts`; chuyển
 * đổi, cảnh báo, công nợ đọc bảng nghiệp vụ. Phạm vi dữ liệu lọc trên người phụ
 * trách: dòng giao theo người phụ trách đơn lúc giao, công nợ theo người phụ
 * trách khách (như tuổi nợ), còn lại theo người phụ trách của chính bản ghi.
 */
export class PostgresSalesReportStore implements SalesReportStore {
  constructor(private readonly database: CrmDatabase) {}

  async salesByDimension(
    tenantId: string,
    scope: CrmDataScope,
    groupBy: SalesReportDimension,
    filter: SalesFactFilter,
    maxRows: number,
  ): Promise<SalesGroupResult> {
    const dimension = DIMENSIONS[groupBy];
    const where = new SqlConditions();
    where.add(`f.delivered_date BETWEEN ${where.param(filter.from)}::date AND ${where.param(filter.to)}::date`);
    where.scope(scope, 'f.owner_user_id');
    if (filter.ownerUserId) where.add(`f.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.customerGroupId) where.add(`f.customer_group_id = ${where.param(filter.customerGroupId)}::uuid`);
    if (filter.region) where.add(`f.region = ${where.param(filter.region)}`);
    const pool = await this.database.pool(tenantId);
    // Một lượt quét cho cả các nhóm và dòng tổng (số đơn đếm riêng, không cộng từ các nhóm).
    const result = await pool.query<FigureRow & { key: string | null; code: string | null; label: string | null; total: number }>(
      `SELECT ${dimension.key} AS key, ${dimension.code} AS code, ${dimension.label} AS label,
              GROUPING(${dimension.first}) AS total,
              COALESCE(sum(f.quantity), 0) AS quantity, COALESCE(sum(f.revenue), 0) AS revenue,
              COALESCE(sum(f.vat_amount), 0) AS vat_amount, COALESCE(sum(f.cost_amount), 0) AS cost_amount,
              count(DISTINCT f.order_id)::int AS order_count
         FROM crm_schema.sales_facts f
         ${dimension.join}
         ${where.where()}
        GROUP BY GROUPING SETS ((${dimension.group}), ())`,
      where.params,
    );
    const groups = result.rows
      .filter((row) => !row.total)
      .map((row): SalesGroupRow => ({ key: row.key, code: row.code, label: row.label, figures: figures(row) }))
      .sort((a, b) => b.figures.revenue - a.figures.revenue || (a.code ?? a.label ?? '').localeCompare(b.code ?? b.label ?? ''));
    return {
      rows: groups.slice(0, maxRows),
      truncated: groups.length > maxRows,
      totals: figures(result.rows.find((row) => row.total)),
    };
  }

  async conversionCounts(
    tenantId: string,
    scope: CrmDataScope,
    filter: Pick<SalesFactFilter, 'from' | 'to' | 'ownerUserId'>,
  ): Promise<readonly { readonly ownerUserId: string; readonly counts: ConversionCounts }[]> {
    const params: unknown[] = [filter.from, filter.to];
    const scopeIndex = params.length + 1;
    const scoped = (column: string) => ownerScopeSql(scope, column, scopeIndex);
    params.push(...scoped('x.owner_user_id').params);
    let ownerCondition: (column: string) => string = () => 'TRUE';
    if (filter.ownerUserId) {
      params.push(filter.ownerUserId);
      const index = params.length;
      ownerCondition = (column) => `${column} = $${index}::uuid`;
    }
    // Kỳ theo giờ Việt Nam: [00:00 ngày đầu, 00:00 ngày sau ngày cuối).
    const branch = (table: string, alias: string, stage: ConversionStage, extra = '') =>
      `SELECT ${alias}.owner_user_id, '${stage}' AS stage
         FROM crm_schema.${table} ${alias}
        WHERE ${alias}.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
          AND ${alias}.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
          AND ${scoped(`${alias}.owner_user_id`).sql} AND ${ownerCondition(`${alias}.owner_user_id`)}${extra}`;
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ owner_user_id: string; stage: ConversionStage; n: number }>(
      `SELECT owner_user_id, stage, count(*)::int AS n
         FROM (
           ${branch('opportunities', 'o', 'OPPORTUNITY')}
           UNION ALL
           ${branch('quotes', 'q', 'QUOTE')}
           UNION ALL
           ${branch('contracts', 'k', 'CONTRACT', ` AND k.status <> 'CANCELLED'`)}
           UNION ALL
           ${branch('sales_orders', 's', 'ORDER', ` AND s.status <> 'CANCELLED'`)}
         ) x
        GROUP BY owner_user_id, stage`,
      params,
    );
    const byOwner = new Map<string, Record<ConversionStage, number>>();
    for (const row of result.rows) {
      const counts = byOwner.get(row.owner_user_id) ?? (Object.fromEntries(CONVERSION_STAGES.map((stage) => [stage, 0])) as Record<ConversionStage, number>);
      counts[row.stage] = row.n;
      byOwner.set(row.owner_user_id, counts);
    }
    return [...byOwner].map(([ownerUserId, counts]) => ({ ownerUserId, counts }));
  }

  async alerts(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly today: string; readonly expiringUntil: string; readonly ownerUserId?: string; readonly kind?: SalesAlertKind },
  ): Promise<SalesAlert[]> {
    const pool = await this.database.pool(tenantId);
    const wanted = (kind: SalesAlertKind) => !filter.kind || filter.kind === kind;
    const conditions = (ownerColumn: string, withToday = true) => {
      const where = new SqlConditions();
      const today = withToday ? where.param(filter.today) : '';
      where.scope(scope, ownerColumn);
      if (filter.ownerUserId) where.add(`${ownerColumn} = ${where.param(filter.ownerUserId)}::uuid`);
      return { where, today };
    };
    interface AlertRow {
      id: string;
      code: string;
      customer_id: string;
      customer_name: string;
      owner_user_id: string;
      date: string;
      extra: number;
    }
    const items: SalesAlert[] = [];
    const base = (kind: SalesAlertKind, row: AlertRow) => ({
      kind,
      id: row.id,
      code: row.code,
      customerId: row.customer_id,
      customerName: row.customer_name,
      ownerUserId: row.owner_user_id,
      date: row.date,
    });

    if (wanted('QUOTE_PENDING')) {
      const { where } = conditions('q.owner_user_id', false);
      where.add(`q.status = 'PENDING'`);
      const rows = await pool.query<AlertRow>(
        `SELECT q.id, q.code, q.customer_id, c.name AS customer_name, q.owner_user_id,
                (COALESCE(v.submitted_at, q.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date, 0 AS extra
           FROM crm_schema.quotes q
           JOIN crm_schema.customers c ON c.id = q.customer_id
           LEFT JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
           ${where.where()}
          ORDER BY 6, q.code
          LIMIT ${ALERT_LIMIT}`,
        where.params,
      );
      for (const row of rows.rows) {
        const days = Math.max(daysOverdue(row.date, filter.today) ?? 0, 0);
        items.push({
          ...base('QUOTE_PENDING', row),
          days,
          summary: `Báo giá ${row.code} của ${row.customer_name} chờ duyệt ${days ? `${days} ngày` : 'từ hôm nay'}.`,
          deepLink: quoteDeepLink(row.id),
        });
      }
    }

    if (wanted('CONTRACT_EXPIRING')) {
      const { where, today } = conditions('k.owner_user_id');
      where.add(`k.status = 'ACTIVE' AND k.valid_to BETWEEN ${today}::date AND ${where.param(filter.expiringUntil)}::date`);
      const rows = await pool.query<AlertRow>(
        `SELECT k.id, k.code, k.customer_id, c.name AS customer_name, k.owner_user_id, k.valid_to::text AS date, 0 AS extra
           FROM crm_schema.contracts k
           JOIN crm_schema.customers c ON c.id = k.customer_id
           ${where.where()}
          ORDER BY k.valid_to, k.code
          LIMIT ${ALERT_LIMIT}`,
        where.params,
      );
      for (const row of rows.rows) {
        const days = -(daysOverdue(row.date, filter.today) ?? 0);
        items.push({
          ...base('CONTRACT_EXPIRING', row),
          days,
          summary: `Hợp đồng ${row.code} của ${row.customer_name} hết hạn ngày ${viDate(row.date)} (${days ? `còn ${days} ngày` : 'hết hạn hôm nay'}).`,
          deepLink: contractDeepLink(row.id),
        });
      }
    }

    if (wanted('DELIVERY_LATE')) {
      const { where, today } = conditions('o.owner_user_id');
      where.add(`d.status IN ('PLANNED', 'REQUESTED') AND d.planned_date < ${today}::date AND o.status NOT IN ('CANCELLED', 'DONE')`);
      const rows = await pool.query<AlertRow>(
        `SELECT o.id, o.code, o.customer_id, c.name AS customer_name, o.owner_user_id,
                min(d.planned_date)::text AS date, count(*)::int AS extra
           FROM crm_schema.sales_orders o
           JOIN crm_schema.customers c ON c.id = o.customer_id
           JOIN crm_schema.delivery_plans d ON d.order_id = o.id
           ${where.where()}
          GROUP BY o.id, o.code, o.customer_id, c.name, o.owner_user_id
          ORDER BY 6, o.code
          LIMIT ${ALERT_LIMIT}`,
        where.params,
      );
      for (const row of rows.rows) {
        const days = daysOverdue(row.date, filter.today) ?? 0;
        items.push({
          ...base('DELIVERY_LATE', row),
          days,
          summary: `Đơn ${row.code} của ${row.customer_name} có ${row.extra} đợt giao trễ, sớm nhất dự kiến ngày ${viDate(row.date)} (trễ ${days} ngày).`,
          deepLink: salesOrderDeepLink(row.id),
        });
      }
    }
    return items;
  }

  async receivables(
    tenantId: string,
    scope: CrmDataScope,
    filter: ReceivableReportFilter,
  ): Promise<{ customers: ReceivableReportCustomerRow[]; overdueOrders: OverdueOrderRow[] }> {
    const customerConditions = () => {
      const where = new SqlConditions();
      const today = where.param(filter.today);
      where.scope(scope, 'c.owner_user_id');
      if (filter.ownerUserId) where.add(`c.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
      if (filter.customerGroupId) where.add(`c.group_id = ${where.param(filter.customerGroupId)}::uuid`);
      if (filter.region) where.add(`c.region = ${where.param(filter.region)}`);
      return { where, today };
    };
    const pool = await this.database.pool(tenantId);

    const customers = customerConditions();
    customers.where.add(`EXISTS (SELECT 1 FROM crm_schema.receivable_entries x WHERE x.customer_id = c.id)`);
    const today = customers.today;
    // Tiền thu: dòng CREDIT và bút đảo của chúng (phiếu thu bị đảo); có `ref_entry_id` là đã phân bổ vào khoản nợ.
    const receipt = `(e.kind = 'CREDIT' OR e.source_type = 'receipt_reversal')`;
    const customerRows = await pool.query<{
      id: string;
      code: string;
      name: string;
      owner_user_id: string;
      region: string | null;
      group_name: string | null;
      revenue: string;
      collected: string;
      allocated: string;
      balance: string;
      overdue: string | null;
      oldest: string | null;
      next_due: string | null;
      overdue_orders: number | null;
    }>(
      `WITH scoped AS (
         SELECT c.id, c.code, c.name, c.owner_user_id, c.region, g.name AS group_name
           FROM crm_schema.customers c
           LEFT JOIN crm_schema.customer_groups g ON g.id = c.group_id
           ${customers.where.where()}
       ), ledger AS (
         SELECT e.customer_id,
                COALESCE(sum(e.amount) FILTER (WHERE e.kind = 'DEBIT'), 0) AS revenue,
                COALESCE(-sum(e.amount) FILTER (WHERE ${receipt}), 0) AS collected,
                COALESCE(-sum(e.amount) FILTER (WHERE ${receipt} AND e.ref_entry_id IS NOT NULL), 0) AS allocated,
                sum(e.amount) AS balance
           FROM crm_schema.receivable_entries e
          WHERE e.customer_id IN (SELECT id FROM scoped)
          GROUP BY e.customer_id
       ), due AS (
         SELECT i.customer_id,
                sum(i.open_amount) FILTER (WHERE i.due_date <= ${today}::date) AS overdue,
                min(i.due_date) FILTER (WHERE i.due_date <= ${today}::date)::text AS oldest,
                min(i.due_date) FILTER (WHERE i.due_date > ${today}::date)::text AS next_due,
                count(DISTINCT i.order_id) FILTER (WHERE i.due_date <= ${today}::date)::int AS overdue_orders
           FROM crm_schema.receivable_open_items i
          WHERE i.customer_id IN (SELECT id FROM scoped) AND i.open_amount > 0
          GROUP BY i.customer_id
       )
       SELECT s.id, s.code, s.name, s.owner_user_id, s.region, s.group_name,
              l.revenue, l.collected, l.allocated, l.balance, d.overdue, d.oldest, d.next_due, d.overdue_orders
         FROM scoped s
         JOIN ledger l ON l.customer_id = s.id
         LEFT JOIN due d ON d.customer_id = s.id
        ORDER BY COALESCE(d.overdue, 0) DESC, l.balance DESC, s.code
        LIMIT ${RECEIVABLE_CUSTOMER_LIMIT}`,
      customers.where.params,
    );

    const orders = customerConditions();
    orders.where.add(`i.open_amount > 0 AND i.due_date <= ${orders.today}::date`);
    const orderRows = await pool.query<{
      order_id: string;
      order_code: string;
      customer_id: string;
      customer_code: string;
      customer_name: string;
      owner_user_id: string;
      due_date: string;
      amount: string;
    }>(
      `SELECT o.id AS order_id, o.code AS order_code, c.id AS customer_id, c.code AS customer_code, c.name AS customer_name,
              o.owner_user_id, min(i.due_date)::text AS due_date, sum(i.open_amount) AS amount
         FROM crm_schema.receivable_open_items i
         JOIN crm_schema.sales_orders o ON o.id = i.order_id
         JOIN crm_schema.customers c ON c.id = i.customer_id
         ${orders.where.where()}
        GROUP BY o.id, o.code, c.id, c.code, c.name, o.owner_user_id
        ORDER BY 7, o.code
        LIMIT ${OVERDUE_ORDER_LIMIT}`,
      orders.where.params,
    );

    return {
      customers: customerRows.rows.map((row): ReceivableReportCustomerRow => {
        const revenue = roundVnd(num(row.revenue));
        const collected = roundVnd(num(row.collected));
        const balance = roundVnd(num(row.balance));
        return {
          customerId: row.id,
          customerCode: row.code,
          customerName: row.name,
          ownerUserId: row.owner_user_id,
          customerGroupName: row.group_name,
          region: row.region,
          revenue,
          collected,
          // Phần còn lại của sổ: điều chỉnh, đảo giao hàng, huỷ đợt (dư nợ = doanh thu − đã thu + điều chỉnh).
          adjusted: roundVnd(balance - revenue + collected),
          balance,
          uncollectedRevenue: roundVnd(revenue - num(row.allocated)),
          overdueAmount: roundVnd(num(row.overdue)),
          nextDueDate: row.next_due,
          oldestOverdueDate: row.oldest,
          overdueOrderCount: row.overdue_orders ?? 0,
        };
      }),
      overdueOrders: orderRows.rows.map((row) => ({
        orderId: row.order_id,
        orderCode: row.order_code,
        customerId: row.customer_id,
        customerCode: row.customer_code,
        customerName: row.customer_name,
        ownerUserId: row.owner_user_id,
        dueDate: row.due_date,
        daysOverdue: daysOverdue(row.due_date, filter.today) ?? 0,
        overdueAmount: roundVnd(num(row.amount)),
      })),
    };
  }
}
