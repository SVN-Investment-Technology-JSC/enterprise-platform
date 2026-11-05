import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CRM_NO_CAPABILITIES, type SalesReportRow } from '@enterprise-platform/contracts-crm';
import { CreditLimitService } from './application/credit-limit.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import type { InventoryClient, IssueRequestInput, ReserveStockRequest, ReservedStock } from './application/fulfillment.port.js';
import { PriceListService } from './application/price-list.service.js';
import { vietnamToday } from './application/pricing.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import type { FinanceClient } from './application/receivable-store.port.js';
import { SalesOrderService } from './application/sales-order.service.js';
import { SalesReportService } from './application/sales-report.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { addDays } from './domain/receivables.js';
import { PostgresIntegrationRequests } from './infrastructure/integration-requests.js';
import { applyStockIssued } from './infrastructure/inventory-events.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresContractStore, PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresCreditStore } from './infrastructure/postgres-credit.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresPriceListStore, PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresReceivableStore } from './infrastructure/postgres-receivable.store.js';
import { PostgresSalesOrderStore } from './infrastructure/postgres-sales-order.store.js';
import { PostgresSalesReportStore } from './infrastructure/postgres-sales-report.store.js';
import { insertReceivableEntry } from './infrastructure/receivable-recognition.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const BT = randomUUID();
/** NV1 (phạm vi "của tôi"), NVB (nhân viên khác, không là cấp dưới của NV1), QL (toàn bộ). */
const NV1 = randomUUID();
const NVB = randomUUID();
const NV2 = randomUUID();
const NV3 = randomUUID();
const NV4 = randomUUID();
const QL = randomUUID();

class FakeCatalog implements CatalogReader {
  readonly known: CatalogMaterial[] = [
    { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị', kind: 'STOCK', avgCost: 800_000, totalAvailable: 100 },
    { id: BT, code: 'QA-KHO-BT', name: 'Gói bảo trì', unit: 'Gói', category: 'Dịch vụ', kind: 'SERVICE', avgCost: null, totalAvailable: null },
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

class FakeInventory implements InventoryClient {
  readonly issues = new Map<string, { documentId: string; documentCode: string }>();
  async reserve(_tenantId: string, request: ReserveStockRequest): Promise<ReservedStock> {
    return { reservationId: randomUUID(), reservationCode: `GH-${request.idempotencyKey.slice(-6)}`, status: 'RESERVED', expiresAt: request.expiresAt };
  }
  async release(): Promise<void> {
    return undefined;
  }
  async createIssueRequest(_tenantId: string, input: IssueRequestInput) {
    const existing = this.issues.get(input.idempotencyKey) ?? { documentId: randomUUID(), documentCode: `PX${this.issues.size + 1}` };
    this.issues.set(input.idempotencyKey, existing);
    return { ...existing, status: 'DRAFT' };
  }
}

const NO_FINANCE: FinanceClient = {
  createReceiptVoucher: async () => {
    throw new Error('not used');
  },
  voucherState: async () => null,
  cancelReceiptVoucher: async () => {
    throw new Error('not used');
  },
};

/**
 * 20 dòng giao cố định (TC-RPT-01): 18 dòng trong tháng 3/2025, 1 dòng cuối
 * tháng 2 và 1 dòng đầu tháng 4 (ngoài kỳ). Dòng 8 là dòng âm của chứng từ đảo.
 * Cột: người phụ trách, khách, mặt hàng, số lượng, doanh thu, giá vốn, đơn, ngày.
 */
const FIXTURE: readonly [string, string, string, number, number, number, string, string][] = [
  ['A', 'C1', 'M1', 2, 2_000_000, 1_600_000, 'O1', '2025-03-01'],
  ['A', 'C1', 'M2', 1, 500_000, 300_000, 'O1', '2025-03-01'],
  ['A', 'C1', 'M3', 10, 1_000_000, 700_000, 'O1', '2025-03-02'],
  ['A', 'C2', 'M1', 1, 1_000_000, 830_000, 'O2', '2025-03-05'],
  ['A', 'C2', 'M4', 1, 300_000, 0, 'O2', '2025-03-05'],
  ['A', 'C3', 'M2', 3, 1_500_000, 900_000, 'O3', '2025-03-10'],
  ['A', 'C3', 'M3', 5, 500_000, 350_000, 'O3', '2025-03-10'],
  ['A', 'C1', 'M1', -1, -1_000_000, -800_000, 'O1', '2025-03-15'],
  ['B', 'C2', 'M1', 4, 4_000_000, 3_200_000, 'O4', '2025-03-03'],
  ['B', 'C2', 'M2', 2, 1_000_000, 600_000, 'O4', '2025-03-03'],
  ['B', 'C2', 'M3', 20, 2_000_000, 1_400_000, 'O4', '2025-03-04'],
  ['B', 'C3', 'M4', 2, 600_000, 0, 'O5', '2025-03-12'],
  ['B', 'C3', 'M1', 1, 1_000_000, 810_000, 'O5', '2025-03-12'],
  ['B', 'C1', 'M2', 1, 500_000, 310_000, 'O6', '2025-03-20'],
  ['B', 'C1', 'M3', 8, 800_000, 560_000, 'O6', '2025-03-20'],
  ['A', 'C2', 'M2', 2, 1_000_000, 640_000, 'O2', '2025-03-25'],
  ['A', 'C3', 'M1', 1, 1_000_000, 820_000, 'O3', '2025-03-28'],
  ['B', 'C2', 'M4', 1, 300_000, 0, 'O4', '2025-03-31'],
  ['A', 'C1', 'M1', 1, 1_000_000, 800_000, 'O1', '2025-02-28'],
  ['B', 'C1', 'M1', 1, 1_000_000, 800_000, 'O6', '2025-04-01'],
];
const MARCH = { from: '2025-03-01', to: '2025-03-31' };

integration('Bán hàng GĐ7: báo cáo (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const today = vietnamToday(new Date());
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    canWriteOrder: true,
    canReadReport: true,
    ...extra,
  });
  const ql = actor(QL, { canManage: true, canReadAll: true });
  const nv1 = actor(NV1);
  const nv2 = actor(NV2);

  const inventory = new FakeInventory();
  let reports: SalesReportService;
  let orders: SalesOrderService;
  let customers: CustomerService;
  let receivableStore: PostgresReceivableStore;
  /** Id thật của khách, nhóm khách, mặt hàng, đơn trong bộ 20 dòng. */
  const ids = new Map<string, string>();

  const sql = (text: string, values: unknown[] = []) => handle.pool.query(text, values);

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(handle.database);
    const contractStore = new PostgresContractStore(handle.database);
    const settings = new PostgresSalesSettingsStore(handle.database);
    receivableStore = new PostgresReceivableStore(handle.database);
    const dispatcher = new PostgresIntegrationRequests(handle.database, inventory, NO_FINANCE);
    const catalog = new FakeCatalog();
    orders = new SalesOrderService(
      new PostgresSalesOrderStore(handle.database, receivableStore),
      contractStore,
      customerStore,
      new PostgresPricingStore(handle.database),
      catalog,
      scopes,
      inventory,
      settings,
      new CreditLimitService(new PostgresCreditStore(handle.database), { start: async () => undefined }),
      dispatcher,
    );
    customers = new CustomerService(customerStore, scopes);
    reports = new SalesReportService(new PostgresSalesReportStore(handle.database), scopes, settings);

    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(ql, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2024-01-01' });
    await lists.upsertItems(ql, list.id, {
      items: [
        { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
        { materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Gói bảo trì', unit: 'Gói', price: 500_000, vatRate: 10 },
      ],
    });

    // Bộ 20 dòng: nhóm khách G1; C1 Miền Bắc, C2 Miền Nam (đều G1); C3 không nhóm, không khu vực.
    const group = (await sql(`INSERT INTO crm_schema.customer_groups (code, name) VALUES ('RPT-G1', 'Đại lý cấp 1') RETURNING id`)).rows[0].id;
    ids.set('G1', group);
    for (const [key, groupId, region] of [
      ['C1', group, 'Miền Bắc'],
      ['C2', group, 'Miền Nam'],
      ['C3', null, null],
    ] as const) {
      const row = await sql(
        `INSERT INTO crm_schema.customers (code, name, owner_user_id, group_id, region, kind)
         VALUES ($1, $2, $3, $4, $5, 'CUSTOMER') RETURNING id`,
        [`RPT-${key}`, `Khách ${key}`, NV1, groupId, region],
      );
      ids.set(key, row.rows[0].id);
    }
    for (const key of ['M1', 'M2', 'M3', 'M4', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6']) ids.set(key, randomUUID());
    const category: Record<string, string | null> = { M1: 'Thiết bị', M2: 'Thiết bị', M3: 'Vật tư', M4: null };
    const region: Record<string, string | null> = { C1: 'Miền Bắc', C2: 'Miền Nam', C3: null };
    for (const [owner, customer, material, quantity, revenue, cost, order, date] of FIXTURE) {
      await sql(
        `INSERT INTO crm_schema.sales_facts
           (source_type, document_id, order_id, order_line_id, customer_id, customer_group_id, region, owner_user_id,
            material_id, material_code, material_name, category, delivered_at, delivered_date, quantity, revenue, vat_amount, cost_amount)
         VALUES ('stock_issue', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $12::date, $13, $14, $15, $16)`,
        [
          randomUUID(),
          ids.get(order),
          randomUUID(),
          ids.get(customer),
          customer === 'C3' ? null : group,
          region[customer],
          owner === 'A' ? NV1 : NVB,
          ids.get(material),
          `RPT-${material}`,
          `Mặt hàng ${material}`,
          category[material],
          date,
          quantity,
          revenue,
          revenue / 10,
          cost,
        ],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const pick = (row: SalesReportRow) => [row.quantity, row.revenue, row.costAmount, row.profit, row.orderCount];
  const byKey = (rows: readonly SalesReportRow[]) => Object.fromEntries(rows.map((row) => [row.code ?? row.key ?? '', pick(row)]));

  it('TC-RPT-01: doanh thu, sản lượng, lợi nhuận theo năm chiều khớp bảng tính tay', async () => {
    const owner = await reports.sales(ql, { ...MARCH, groupBy: 'owner' });
    expect(owner.totals).toEqual({
      quantity: 64,
      revenue: 18_000_000,
      vatAmount: 1_800_000,
      costAmount: 12_220_000,
      profit: 5_780_000,
      marginPercent: 32.11,
      orderCount: 6,
    });
    expect(Object.fromEntries(owner.rows.map((row) => [row.key, pick(row)]))).toEqual({
      [NV1]: [25, 7_800_000, 5_340_000, 2_460_000, 3],
      [NVB]: [39, 10_200_000, 6_880_000, 3_320_000, 3],
    });
    // Xếp theo doanh thu giảm dần.
    expect(owner.rows[0].key).toBe(NVB);

    const customer = await reports.sales(ql, { ...MARCH, groupBy: 'customer' });
    expect(byKey(customer.rows)).toEqual({
      'RPT-C1': [21, 3_800_000, 2_670_000, 1_130_000, 2],
      'RPT-C2': [31, 9_600_000, 6_670_000, 2_930_000, 2],
      'RPT-C3': [12, 4_600_000, 2_880_000, 1_720_000, 2],
    });
    expect(customer.rows.find((row) => row.code === 'RPT-C1')?.label).toBe('Khách C1');

    const material = await reports.sales(ql, { ...MARCH, groupBy: 'material' });
    expect(byKey(material.rows)).toEqual({
      'RPT-M1': [8, 8_000_000, 6_460_000, 1_540_000, 5],
      'RPT-M2': [9, 4_500_000, 2_750_000, 1_750_000, 5],
      'RPT-M3': [43, 4_300_000, 3_010_000, 1_290_000, 4],
      'RPT-M4': [4, 1_200_000, 0, 1_200_000, 3],
    });
    expect(material.rows.find((row) => row.code === 'RPT-M4')?.marginPercent).toBe(100);

    const category = await reports.sales(ql, { ...MARCH, groupBy: 'category' });
    expect(Object.fromEntries(category.rows.map((row) => [row.key ?? '(trống)', pick(row)]))).toEqual({
      'Thiết bị': [17, 12_500_000, 9_210_000, 3_290_000, 6],
      'Vật tư': [43, 4_300_000, 3_010_000, 1_290_000, 4],
      '(trống)': [4, 1_200_000, 0, 1_200_000, 3],
    });

    const region = await reports.sales(ql, { ...MARCH, groupBy: 'region' });
    expect(Object.fromEntries(region.rows.map((row) => [row.key ?? '(trống)', pick(row)]))).toEqual({
      'Miền Bắc': [21, 3_800_000, 2_670_000, 1_130_000, 2],
      'Miền Nam': [31, 9_600_000, 6_670_000, 2_930_000, 2],
      '(trống)': [12, 4_600_000, 2_880_000, 1_720_000, 2],
    });

    const groups = await reports.sales(ql, { ...MARCH, groupBy: 'customerGroup' });
    expect(Object.fromEntries(groups.rows.map((row) => [row.code ?? '(trống)', pick(row)]))).toEqual({
      'RPT-G1': [52, 13_400_000, 9_340_000, 4_060_000, 4],
      '(trống)': [12, 4_600_000, 2_880_000, 1_720_000, 2],
    });

    // Lọc nhóm khách, khu vực.
    expect((await reports.sales(ql, { ...MARCH, customerGroupId: ids.get('G1') })).totals.revenue).toBe(13_400_000);
    expect((await reports.sales(ql, { ...MARCH, region: 'Miền Nam' })).totals.revenue).toBe(9_600_000);
  });

  it('TC-RPT-08: NV1 có crm.report.read, không có crm.read.all: chỉ thấy dữ liệu của mình; lọc người ngoài phạm vi trả rỗng', async () => {
    const own = await reports.sales(nv1, { ...MARCH, groupBy: 'material' });
    expect(own.totals).toMatchObject({ quantity: 25, revenue: 7_800_000, costAmount: 5_340_000, profit: 2_460_000, orderCount: 3 });
    expect(byKey(own.rows)).toEqual({
      'RPT-M1': [3, 3_000_000, 2_450_000, 550_000, 3],
      'RPT-M2': [6, 3_000_000, 1_840_000, 1_160_000, 3],
      'RPT-M3': [15, 1_500_000, 1_050_000, 450_000, 2],
      'RPT-M4': [1, 300_000, 0, 300_000, 1],
    });
    const other = await reports.sales(nv1, { ...MARCH, ownerUserId: NVB });
    expect(other.rows).toEqual([]);
    expect(other.totals.revenue).toBe(0);
    await expect(reports.sales(actor(NV1, { canReadReport: false }), MARCH)).rejects.toMatchObject({ statusCode: 403 });
  });

  /** Đơn trực tiếp đã xác nhận, một đợt giao gồm mọi dòng, đã yêu cầu xuất kho. */
  async function requestedOrder(owner: CrmActor, lines: { materialId: string; quantity: number }[]) {
    const customerId = (await customers.create(owner, { name: `Công ty Báo Cáo ${randomUUID().slice(0, 6)}`, ownerUserId: owner.userId })).id;
    const draft = await orders.create(owner, { customerId, warehouseCode: 'KHO-1', lines });
    let order = await orders.confirm(owner, draft.id, { revision: draft.revision });
    order = await orders.saveDelivery(owner, order.id, null, {
      revision: order.revision,
      plannedDate: addDays(today, 1),
      lines: order.lines.map((line) => ({ orderLineId: line.id, quantity: line.quantity })),
    });
    order = await orders.requestIssue(owner, order.id, order.deliveries[0].id, { revision: order.revision });
    return order;
  }

  it('TC-RPT-02, T7-01: chứng từ xuất ghi dòng giao với giá vốn thực tế 830.000 (không dùng 800.000 ước tính); nhận trùng không ghi lại; chứng từ đảo ghi dòng âm', async () => {
    const order = await requestedOrder(nv2, [
      { materialId: CAP, quantity: 1 },
      { materialId: BT, quantity: 1 },
    ]);
    expect(order.lines[0]).toMatchObject({ estUnitCost: 800_000 });
    const issue = inventory.issues.get(`crm-delivery:${order.deliveries[0].id}`);
    const event = {
      documentId: issue?.documentId,
      documentCode: issue?.documentCode,
      sourceType: 'crm_delivery',
      sourceId: order.deliveries[0].id,
      postedAt: new Date().toISOString(),
      lines: [{ materialId: CAP, quantity: 1, costAmount: 830_000 }],
    };
    expect(await applyStockIssued(handle.database, tenantId, event, receivableStore)).toBe('applied');
    expect(await applyStockIssued(handle.database, tenantId, event, receivableStore)).toBe('ignored');

    const facts = await sql(
      `SELECT material_code, category, quantity::float AS quantity, revenue::float AS revenue, vat_amount::float AS vat, cost_amount::float AS cost,
              owner_user_id, delivered_date::text AS day, source_type
         FROM crm_schema.sales_facts WHERE order_id = $1 ORDER BY material_code`,
      [order.id],
    );
    expect(facts.rows).toEqual([
      { material_code: 'QA-KHO-BT', category: 'Dịch vụ', quantity: 1, revenue: 500_000, vat: 50_000, cost: 0, owner_user_id: NV2, day: today, source_type: 'stock_issue' },
      { material_code: 'QA-KHO-CAP', category: 'Thiết bị', quantity: 1, revenue: 1_000_000, vat: 100_000, cost: 830_000, owner_user_id: NV2, day: today, source_type: 'stock_issue' },
    ]);
    const report = await reports.sales(ql, { from: today, to: today, groupBy: 'material', ownerUserId: NV2 });
    expect(report.rows.find((row) => row.code === 'QA-KHO-CAP')).toMatchObject({ revenue: 1_000_000, costAmount: 830_000, profit: 170_000, marginPercent: 17 });
    expect(report.totals).toMatchObject({ revenue: 1_500_000, costAmount: 830_000, profit: 670_000 });

    await applyStockIssued(
      handle.database,
      tenantId,
      { ...event, documentId: randomUUID(), documentCode: 'PX-DAO', reversesDocumentId: issue?.documentId, lines: [{ ...event.lines[0], direction: 'IN' }] },
      receivableStore,
    );
    const reversed = await sql(
      `SELECT quantity::float AS quantity, revenue::float AS revenue, cost_amount::float AS cost, reverses_document_id
         FROM crm_schema.sales_facts WHERE order_id = $1 AND reverses_document_id IS NOT NULL ORDER BY material_code`,
      [order.id],
    );
    expect(reversed.rows).toEqual([
      { quantity: -1, revenue: -500_000, cost: 0, reverses_document_id: issue?.documentId },
      { quantity: -1, revenue: -1_000_000, cost: -830_000, reverses_document_id: issue?.documentId },
    ]);
    const after = await reports.sales(ql, { from: today, to: today, ownerUserId: NV2 });
    expect(after.totals).toMatchObject({ quantity: 0, revenue: 0, costAmount: 0, profit: 0 });
  });

  it('T7-01: đợt chỉ có dịch vụ ghi dòng giao ngay khi ghi nhận đã giao', async () => {
    const order = await requestedOrder(nv2, [{ materialId: BT, quantity: 2 }]);
    const facts = await sql(
      `SELECT document_id, source_type, quantity::float AS quantity, revenue::float AS revenue FROM crm_schema.sales_facts WHERE order_id = $1`,
      [order.id],
    );
    expect(facts.rows).toEqual([{ document_id: order.deliveries[0].id, source_type: 'service_delivery', quantity: 2, revenue: 1_000_000 }]);
  });

  it('T7-01: migration 0011 chạy lại được và chép đợt giao đã xuất trước đó (dữ liệu cũ)', async () => {
    const order = await requestedOrder(nv2, [{ materialId: CAP, quantity: 3 }]);
    const issue = inventory.issues.get(`crm-delivery:${order.deliveries[0].id}`);
    await applyStockIssued(
      handle.database,
      tenantId,
      { documentId: issue?.documentId, documentCode: issue?.documentCode, sourceType: 'crm_delivery', sourceId: order.deliveries[0].id, lines: [{ materialId: CAP, quantity: 3, costAmount: 2_460_000 }] },
      receivableStore,
    );
    // Giả lập tenant có đợt giao trước khi có bảng: xoá dòng giao rồi chạy lại migration.
    await sql(`DELETE FROM crm_schema.sales_facts WHERE order_id = $1`, [order.id]);
    const migration = await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm/0011-sales-facts.sql'), 'utf8');
    await handle.database.transaction(tenantId, (client) => client.query(migration));
    await handle.database.transaction(tenantId, (client) => client.query(migration));
    const facts = await sql(
      `SELECT source_type, document_id, quantity::float AS quantity, revenue::float AS revenue, vat_amount::float AS vat, cost_amount::float AS cost
         FROM crm_schema.sales_facts WHERE order_id = $1`,
      [order.id],
    );
    expect(facts.rows).toEqual([
      { source_type: 'backfill', document_id: issue?.documentId, quantity: 3, revenue: 3_000_000, vat: 300_000, cost: 2_460_000 },
    ]);
  });

  it('TC-RPT-03: 10 cơ hội, 6 báo giá, 4 hợp đồng, 3 đơn: 60%, 66,67%, 75%; tổng 30%', async () => {
    const customerId = ids.get('C1');
    const insert = async (table: 'opportunities' | 'quotes' | 'contracts' | 'sales_orders', count: number, status?: string) => {
      for (let index = 0; index < count; index += 1) {
        const code = `CV-${table.slice(0, 3)}-${randomUUID().slice(0, 8)}`;
        if (table === 'opportunities') {
          await sql(`INSERT INTO crm_schema.opportunities (customer_id, name, owner_user_id) VALUES ($1, $2, $3)`, [customerId, code, NV3]);
        } else if (table === 'quotes') {
          await sql(`INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id) VALUES ($1, $2, $3)`, [code, customerId, NV3]);
        } else if (table === 'contracts') {
          await sql(
            `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, owner_user_id, status)
             VALUES ($1, 'SALE', $2, 'Hợp đồng', $3, $4, $5)`,
            [code, customerId, today, NV3, status ?? 'ACTIVE'],
          );
        } else {
          await sql(
            `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, order_date, status)
             VALUES ($1, 'DIRECT', $2, $3, $4, $5)`,
            [code, customerId, NV3, today, status ?? 'CONFIRMED'],
          );
        }
      }
    };
    await insert('opportunities', 10);
    await insert('quotes', 6);
    await insert('contracts', 4);
    await insert('contracts', 1, 'CANCELLED');
    await insert('sales_orders', 3);
    await insert('sales_orders', 1, 'CANCELLED');
    // Cơ hội tạo ngoài kỳ không tính.
    await sql(`INSERT INTO crm_schema.opportunities (customer_id, name, owner_user_id, created_at) VALUES ($1, 'Cũ', $2, '2024-01-01')`, [customerId, NV3]);

    const report = await reports.conversion(ql, { from: today, to: today, ownerUserId: NV3 });
    expect(report.steps.map((step) => [step.stage, step.count, step.stepPercent, step.overallPercent])).toEqual([
      ['OPPORTUNITY', 10, null, 100],
      ['QUOTE', 6, 60, 60],
      ['CONTRACT', 4, 66.67, 40],
      ['ORDER', 3, 75, 30],
    ]);
    expect(report.byOwner).toHaveLength(1);
    expect(report.byOwner[0].ownerUserId).toBe(NV3);
    // NV1 không thấy số của NV3.
    expect((await reports.conversion(nv1, { from: today, to: today, ownerUserId: NV3 })).steps[0].count).toBe(0);
  });

  it('TC-RPT-04: 2 báo giá chờ duyệt, 1 hợp đồng sắp hết hạn, 1 đơn giao trễ: đúng 4 mục, đúng loại', async () => {
    const customerId = ids.get('C2');
    for (const code of ['CB-BG1', 'CB-BG2']) {
      await sql(`INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id, status) VALUES ($1, $2, $3, 'PENDING')`, [code, customerId, NV4]);
    }
    await sql(`INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id, status) VALUES ('CB-BG3', $1, $2, 'APPROVED')`, [customerId, NV4]);
    const contract = async (code: string, validTo: string, status = 'ACTIVE') =>
      sql(
        `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, valid_to, owner_user_id, status)
         VALUES ($1, 'SALE', $2, 'Hợp đồng', $3, $4, $5, $6)`,
        [code, customerId, addDays(today, -100), validTo, NV4, status],
      );
    await contract('CB-HD1', addDays(today, 10));
    await contract('CB-HD2', addDays(today, 60));
    await contract('CB-HD3', addDays(today, 5), 'COMPLETED');
    const order = async (code: string, status: string, planned: string, deliveryStatus: string) => {
      const id = (
        await sql(
          `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, order_date, status)
           VALUES ($1, 'DIRECT', $2, $3, $4, $5) RETURNING id`,
          [code, customerId, NV4, addDays(today, -20), status],
        )
      ).rows[0].id;
      for (const [seq, date] of [planned, addDays(planned, 1)].entries()) {
        await sql(
          `INSERT INTO crm_schema.delivery_plans (order_id, code, seq, planned_date, status) VALUES ($1, $2, $3, $4, $5)`,
          [id, `${code}-${seq + 1}`, seq + 1, date, deliveryStatus],
        );
      }
    };
    await order('CB-DH1', 'CONFIRMED', addDays(today, -5), 'PLANNED');
    await order('CB-DH2', 'CANCELLED', addDays(today, -5), 'PLANNED');
    await order('CB-DH3', 'DELIVERING', addDays(today, -5), 'ISSUED');

    const list = await reports.alerts(ql, { ownerUserId: NV4 });
    expect(list.contractExpiringDays).toBe(30);
    expect(list.items.map((item) => [item.kind, item.code, item.days])).toEqual([
      ['QUOTE_PENDING', 'CB-BG1', 0],
      ['QUOTE_PENDING', 'CB-BG2', 0],
      ['CONTRACT_EXPIRING', 'CB-HD1', 10],
      ['DELIVERY_LATE', 'CB-DH1', 5],
    ]);
    expect(list.items[3].summary).toContain('2 đợt giao trễ');
    expect(list.items[3].deepLink).toContain('#orders/');
    expect((await reports.alerts(ql, { ownerUserId: NV4, kind: 'DELIVERY_LATE' })).items).toHaveLength(1);
    expect((await reports.alerts(nv1, { ownerUserId: NV4 })).items).toEqual([]);
  });

  it('TC-RPT-07: công nợ theo khách khớp sổ; doanh thu chưa thu = doanh thu − đã thu phân bổ; đơn quá hạn', async () => {
    const customerId = (
      await sql(`INSERT INTO crm_schema.customers (code, name, owner_user_id, kind) VALUES ('RPT-AR', 'Khách Công Nợ', $1, 'CUSTOMER') RETURNING id`, [NV4])
    ).rows[0].id as string;
    const orderId = (
      await sql(
        `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, order_date, status)
         VALUES ('AR-DH1', 'DIRECT', $1, $2, $3, 'DELIVERED') RETURNING id`,
        [customerId, NV4, addDays(today, -40)],
      )
    ).rows[0].id as string;
    const entry = (input: Parameters<typeof insertReceivableEntry>[1]) =>
      handle.database.transaction(tenantId, (client) => insertReceivableEntry(client, input)) as Promise<string>;
    const base = { customerId, entryDate: addDays(today, -40), sourceId: randomUUID() };
    const past = await entry({ ...base, kind: 'DEBIT', orderId, amount: 3_000_000, dueDate: addDays(today, -10), sourceType: 'test_debit' });
    const future = await entry({ ...base, sourceId: randomUUID(), kind: 'DEBIT', amount: 2_000_000, dueDate: addDays(today, 20), sourceType: 'test_debit' });
    await entry({ ...base, sourceId: randomUUID(), kind: 'CREDIT', amount: -1_000_000, refEntryId: past, sourceType: 'receipt_allocation' });
    await entry({ ...base, sourceId: randomUUID(), kind: 'CREDIT', amount: -500_000, sourceType: 'receipt_unapplied' });
    await entry({ ...base, sourceId: randomUUID(), kind: 'ADJUSTMENT', amount: -200_000, refEntryId: future, sourceType: 'adjustment' });

    const report = await reports.receivables(ql, { ownerUserId: NV4 });
    expect(report.customers).toEqual([
      {
        customerId,
        customerCode: 'RPT-AR',
        customerName: 'Khách Công Nợ',
        ownerUserId: NV4,
        customerGroupName: null,
        region: null,
        revenue: 5_000_000,
        collected: 1_500_000,
        adjusted: -200_000,
        balance: 3_300_000,
        uncollectedRevenue: 4_000_000,
        overdueAmount: 2_000_000,
        nextDueDate: addDays(today, 20),
        oldestOverdueDate: addDays(today, -10),
        overdueOrderCount: 1,
      },
    ]);
    // Khớp sổ công nợ (view số dư theo khách).
    const balance = await sql(`SELECT balance::float AS balance FROM crm_schema.receivable_customer_balances WHERE customer_id = $1`, [customerId]);
    expect(balance.rows[0].balance).toBe(report.customers[0].balance);
    expect(report.overdueOrders).toEqual([
      expect.objectContaining({ orderId, orderCode: 'AR-DH1', dueDate: addDays(today, -10), daysOverdue: 10, overdueAmount: 2_000_000 }),
    ]);
    expect(report.totals).toMatchObject({ revenue: 5_000_000, balance: 3_300_000, uncollectedRevenue: 4_000_000 });
    expect((await reports.receivables(nv1, { ownerUserId: NV4 })).customers).toEqual([]);
  });
});
