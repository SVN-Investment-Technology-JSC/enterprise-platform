import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { vietnamToday } from './application/pricing.service.js';
import { SalesDashboardService } from './application/sales-dashboard.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { addDays } from './domain/receivables.js';
import { PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresSalesDashboardStore } from './infrastructure/postgres-sales-dashboard.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

/** NV1: phạm vi "của tôi". NVB: nhân viên khác, không là cấp dưới của NV1. QL: toàn bộ, có quyền duyệt báo giá. */
const NV1 = randomUUID();
const NVB = randomUUID();
const QL = randomUUID();
const M1 = randomUUID();
const M2 = randomUUID();
/** Kỳ cố định cho số liệu theo kỳ; số liệu "tại hôm nay" dựng quanh ngày chạy test. */
const MARCH = { period: 'custom' as const, from: '2025-03-01', to: '2025-03-31' };

integration('Bán hàng: dashboard Tổng quan (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let service: SalesDashboardService;
  const tenantId = randomUUID();
  const today = vietnamToday(new Date());
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    ...extra,
  });
  const nv1 = actor(NV1);
  const ql = actor(QL, { canManage: true, canReadAll: true, canApproveQuote: true });
  const sql = (text: string, values: unknown[] = []) => handle.pool.query(text, values);
  const ids = new Map<string, string>();
  /** Thời điểm `hh:00` giờ Việt Nam của ngày `date`. */
  const vnAt = (date: string, hour = 10) => `${date}T${String(hour).padStart(2, '0')}:00:00+07:00`;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    service = new SalesDashboardService(
      new PostgresSalesDashboardStore(handle.database),
      scopes,
      new PostgresSalesSettingsStore(handle.database),
    );

    for (const [key, owner] of [
      ['C1', NV1],
      ['C2', NVB],
    ] as const) {
      const row = await sql(
        `INSERT INTO crm_schema.customers (code, name, owner_user_id, kind) VALUES ($1, $2, $3, 'CUSTOMER') RETURNING id`,
        [`DB-${key}`, `Khách ${key}`, owner],
      );
      ids.set(key, row.rows[0].id);
    }

    // Doanh thu: NV1 tháng 3 1,5 triệu (lãi 600 nghìn), tháng 2 400 nghìn; NVB tháng 3 2 triệu (lãi 500 nghìn).
    for (const [owner, customer, material, code, quantity, revenue, cost, date] of [
      [NV1, 'C1', M1, 'DB-M1', 2, 1_000_000, 600_000, '2025-03-05'],
      [NV1, 'C1', M2, 'DB-M2', 1, 500_000, 300_000, '2025-03-20'],
      [NV1, 'C1', M1, 'DB-M1', 1, 400_000, 200_000, '2025-02-10'],
      [NVB, 'C2', M1, 'DB-M1', 4, 2_000_000, 1_500_000, '2025-03-10'],
    ] as const) {
      await sql(
        `INSERT INTO crm_schema.sales_facts
           (source_type, document_id, order_id, order_line_id, customer_id, owner_user_id, material_id, material_code,
            material_name, delivered_at, delivered_date, quantity, revenue, cost_amount)
         VALUES ('stock_issue', $1, $2, $3, $4, $5, $6, $7, $7, $8::date, $8::date, $9, $10, $11)`,
        [randomUUID(), randomUUID(), randomUUID(), ids.get(customer), owner, material, code, date, quantity, revenue, cost],
      );
    }

    // Đơn: NV1 một đơn tháng 3 (thêm một đơn Nháp không tính), một đơn tháng 2; NVB một đơn tháng 3.
    // Hai đơn tạo hôm nay có đợt giao trễ (không rơi vào kỳ tháng 3/2025).
    const order = async (code: string, owner: string, customer: string, status: string, createdAt?: string) =>
      (
        await sql(
          `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, order_date, status, total_amount, created_at)
           VALUES ($1, 'DIRECT', $2, $3, $4::date, $5, 1000000, COALESCE($6::timestamptz, now())) RETURNING id`,
          [code, ids.get(customer), owner, today, status, createdAt ?? null],
        )
      ).rows[0].id as string;
    await order('DB-O1', NV1, 'C1', 'CONFIRMED', vnAt('2025-03-05'));
    await order('DB-O2', NV1, 'C1', 'DRAFT', vnAt('2025-03-06'));
    await order('DB-O3', NVB, 'C2', 'CONFIRMED', vnAt('2025-03-10'));
    await order('DB-O4', NV1, 'C1', 'CONFIRMED', vnAt('2025-02-15'));
    // 31/3 23:30 giờ Việt Nam (16:30 UTC) vẫn là tháng 3.
    await order('DB-O7', NVB, 'C2', 'DELIVERED', '2025-03-31T16:30:00Z');
    for (const [code, owner, customer] of [
      ['DB-O5', NV1, 'C1'],
      ['DB-O6', NVB, 'C2'],
    ] as const) {
      const id = await order(code, owner, customer, 'CONFIRMED');
      ids.set(code, id);
      await sql(
        `INSERT INTO crm_schema.delivery_plans (order_id, code, seq, planned_date, status) VALUES ($1, $2, 1, $3::date, 'PLANNED')`,
        [id, `${code}-1`, addDays(today, -3)],
      );
    }

    // Cơ hội: NV1 thắng 1, thua 1 trong tháng 3, đang mở 1 (10 triệu, 50%); NVB thắng 1, đang mở 1 (4 triệu, 10%).
    for (const [owner, customer, stage, value, probability, closedAt] of [
      [NV1, 'C1', 'WON', 1_000_000, 100, vnAt('2025-03-10')],
      [NV1, 'C1', 'LOST', 1_000_000, 0, vnAt('2025-03-12')],
      [NV1, 'C1', 'QUOTING', 10_000_000, 50, null],
      [NVB, 'C2', 'WON', 1_000_000, 100, vnAt('2025-03-15')],
      [NVB, 'C2', 'NEW', 4_000_000, 10, null],
    ] as const) {
      await sql(
        `INSERT INTO crm_schema.opportunities (customer_id, name, stage, probability, expected_value, owner_user_id, closed_at, lost_reason)
         VALUES ($1, 'Cơ hội', $2::varchar, $3, $4, $5, $6::timestamptz, CASE WHEN $2::varchar = 'LOST' THEN 'Giá cao' END)`,
        [ids.get(customer), stage, probability, value, owner, closedAt],
      );
    }

    // Báo giá chờ duyệt: NV1 gửi 3 triệu; NVB gửi 1 triệu.
    for (const [code, owner, customer, net] of [
      ['DB-Q1', NV1, 'C1', 3_000_000],
      ['DB-Q2', NVB, 'C2', 1_000_000],
    ] as const) {
      const quote = await sql(
        `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id, status) VALUES ($1, $2, $3, 'PENDING') RETURNING id`,
        [code, ids.get(customer), owner],
      );
      await sql(
        `INSERT INTO crm_schema.quote_versions (quote_id, version_no, status, net_amount, submitted_by, submitted_at)
         VALUES ($1, 1, 'PENDING', $2, $3, now() - interval '2 days')`,
        [quote.rows[0].id, net, owner],
      );
    }

    // Hợp đồng: NV1 hết hạn sau 10 ngày, NV1 sau 200 ngày (ngoài cửa sổ); NVB sau 5 ngày.
    for (const [code, owner, customer, days] of [
      ['DB-K1', NV1, 'C1', 10],
      ['DB-K2', NV1, 'C1', 200],
      ['DB-K3', NVB, 'C2', 5],
    ] as const) {
      await sql(
        `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, valid_to, value, status, owner_user_id)
         VALUES ($1, 'SALE', $2, 'Hợp đồng', $3::date, $4::date, 5000000, 'ACTIVE', $5)`,
        [code, ids.get(customer), addDays(today, -100), addDays(today, days), owner],
      );
    }

    // Hoạt động: NV1 quá hạn hôm qua, đến hạn đầu hôm nay, hạn ngày mai (không tính), đã xong (không tính); QL quá hạn.
    for (const [subject, assignee, dueAt, status] of [
      ['Gọi lại', NV1, vnAt(addDays(today, -1)), 'OPEN'],
      ['Gửi tài liệu', NV1, vnAt(today, 0), 'OPEN'],
      ['Họp', NV1, vnAt(addDays(today, 1)), 'OPEN'],
      ['Đã xong', NV1, vnAt(addDays(today, -1)), 'DONE'],
      ['Duyệt', QL, vnAt(addDays(today, -2)), 'OPEN'],
    ] as const) {
      await sql(
        `INSERT INTO crm_schema.activities (type, subject, customer_id, assignee_user_id, due_at, status)
         VALUES ('TASK', $1, $2, $3, $4::timestamptz, $5)`,
        [subject, ids.get('C1'), assignee, dueAt, status],
      );
    }

    // Công nợ: C1 (NV1) 2 triệu quá hạn 10 ngày, 1 triệu chưa đến hạn; C2 (NVB) 5 triệu quá hạn 1 ngày.
    for (const [customer, amount, due] of [
      ['C1', 2_000_000, addDays(today, -10)],
      ['C1', 1_000_000, addDays(today, 10)],
      ['C2', 5_000_000, addDays(today, -1)],
    ] as const) {
      await sql(
        `INSERT INTO crm_schema.receivable_entries (kind, customer_id, amount, entry_date, due_date, source_type, source_id)
         VALUES ('DEBIT', $1, $2, $3::date, $4::date, 'test', $5)`,
        [ids.get(customer), amount, addDays(today, -30), due, randomUUID()],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await handle?.drop();
  });

  it('NV1 chỉ thấy số của mình', async () => {
    const dashboard = await service.dashboard(nv1, MARCH);
    expect(dashboard.scope).toBe('mine');
    expect(dashboard.previous).toEqual({ from: '2025-01-29', to: '2025-02-28' });
    const { kpis } = dashboard;
    expect(kpis.revenue).toEqual({ value: 1_500_000, previous: 400_000, changePercent: 275 });
    expect(kpis.profit).toEqual({ value: 600_000, previous: 200_000, changePercent: 200 });
    expect(kpis.marginPercent.value).toBe(40);
    expect(kpis.newOrders).toEqual({ value: 1, previous: 1, changePercent: 0 });
    expect(kpis.winRate).toMatchObject({ value: 50, won: 1, lost: 1 });
    expect(kpis.pipeline).toEqual({ count: 1, value: 10_000_000, weightedValue: 5_000_000 });
    expect(kpis.receivables).toEqual({ balance: 3_000_000, overdue: 2_000_000, overdueCustomers: 1 });
    expect(kpis.pendingQuotes).toEqual({ count: 1, value: 3_000_000 });

    expect(dashboard.topCustomers.map((row) => [row.code, row.revenue, row.orderCount])).toEqual([['DB-C1', 1_500_000, 2]]);
    expect(dashboard.topProducts.map((row) => [row.code, row.revenue, row.quantity])).toEqual([
      ['DB-M1', 1_000_000, 2],
      ['DB-M2', 500_000, 1],
    ]);
    expect(dashboard.trend.granularity).toBe('day');
    expect(dashboard.trend.buckets).toHaveLength(31);
    expect(dashboard.trend.buckets[4]).toEqual({ start: '2025-03-05', end: '2025-03-05', revenue: 1_000_000, orders: 1 });

    const { attention } = dashboard;
    expect(attention.lateDeliveries.items.map((item) => item.title)).toEqual(['DB-O5']);
    expect(attention.lateDeliveries.items[0]).toMatchObject({ days: 3, deepLink: `/modules/crm#orders/${ids.get('DB-O5')}` });
    expect(attention.pendingQuotes).toMatchObject({ total: 1, items: [{ title: 'DB-Q1', note: 'Bạn gửi, chờ duyệt 2 ngày' }] });
    expect(attention.expiringContracts.items.map((item) => [item.title, item.days])).toEqual([['DB-K1', 10]]);
    expect(attention.activities.total).toBe(2);
    expect(attention.activities.items.map((item) => item.title)).toEqual(['Gọi lại', 'Gửi tài liệu']);
    expect(attention.activities.items[0].note).toBe('Quá hạn 1 ngày');
    expect(attention.overdueReceivables.items.map((item) => [item.title, item.amount, item.days])).toEqual([
      ['DB-C1', 2_000_000, 10],
    ]);
  });

  it('QL thấy toàn bộ, gồm báo giá chờ mình duyệt', async () => {
    const dashboard = await service.dashboard(ql, MARCH);
    expect(dashboard.scope).toBe('all');
    const { kpis } = dashboard;
    expect(kpis.revenue.value).toBe(3_500_000);
    expect(kpis.profit.value).toBe(1_100_000);
    // Đơn tạo 23:30 ngày 31/3 giờ Việt Nam vẫn tính vào tháng 3.
    expect(kpis.newOrders.value).toBe(3);
    expect(kpis.winRate).toMatchObject({ value: 66.67, won: 2, lost: 1 });
    expect(kpis.pipeline).toEqual({ count: 2, value: 14_000_000, weightedValue: 5_400_000 });
    expect(kpis.receivables).toEqual({ balance: 8_000_000, overdue: 7_000_000, overdueCustomers: 2 });
    expect(kpis.pendingQuotes).toEqual({ count: 2, value: 4_000_000 });
    expect(dashboard.pipeline.find((row) => row.stage === 'NEW')).toEqual({ stage: 'NEW', count: 1, value: 4_000_000, weightedValue: 400_000 });
    expect(dashboard.topCustomers.map((row) => row.code)).toEqual(['DB-C2', 'DB-C1']);
    expect(dashboard.topProducts[0]).toMatchObject({ code: 'DB-M1', revenue: 3_000_000, quantity: 6 });

    const { attention } = dashboard;
    expect(attention.lateDeliveries.total).toBe(2);
    expect(attention.pendingQuotes.items.map((item) => item.note)).toEqual(['Chờ bạn duyệt 2 ngày', 'Chờ bạn duyệt 2 ngày']);
    expect(attention.expiringContracts.items.map((item) => item.title)).toEqual(['DB-K3', 'DB-K1']);
    // Hoạt động chỉ của chính người xem, kể cả khi thấy toàn bộ dữ liệu.
    expect(attention.activities.items.map((item) => item.title)).toEqual(['Duyệt']);
    expect(attention.overdueReceivables.items.map((item) => item.title)).toEqual(['DB-C2', 'DB-C1']);
  });

  it('số của NV1 không vượt số của QL', async () => {
    const [mine, all] = await Promise.all([service.dashboard(nv1, { period: 'year' }), service.dashboard(ql, { period: 'year' })]);
    expect(mine.kpis.revenue.value).toBeLessThanOrEqual(all.kpis.revenue.value);
    expect(mine.kpis.pipeline.value).toBeLessThanOrEqual(all.kpis.pipeline.value);
    expect(mine.kpis.receivables.balance).toBeLessThanOrEqual(all.kpis.receivables.balance);
    expect(mine.kpis.pendingQuotes.count).toBeLessThanOrEqual(all.kpis.pendingQuotes.count);
  });
});
