import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { Pool } from 'pg';
import type { CrmActor } from './application/crm-actor.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { AllowAllCreditLimitCheck, UnknownOrderBalanceReader } from './application/fulfillment.port.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteService } from './application/quote.service.js';
import { SalesOrderService } from './application/sales-order.service.js';
import { CRM_TEST_ADMIN_URL_ENV, TestCrmDatabase, crmIntegrationEnabled, dropTestDatabase } from './crm-test-support.js';
import { seedPriceList } from './crm-test-price-lists.js';
import { PostgresContractStore, PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { PostgresSalesOrderStore } from './infrastructure/postgres-sales-order.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

jest.setTimeout(60_000);

/**
 * Migration 0039 gán sẵn bảng giá cho báo giá, đơn bán cũ (`docs/crm_price_list_logic/test.md` B1.4-B1.10, B2): dựng
 * DB đến 0038, nạp dữ liệu như bản app cũ để lại (bảng chuẩn, bảng riêng gán ở hồ sơ khách, tổng tiền đã tính), chạy
 * 0039, rồi tính lại bằng code mới và so tổng tiền.
 */
const root = resolve(process.cwd(), '../../../migrations');
const MIGRATION = '0039-price-list-default-sync.sql';

const CAP = randomUUID();
const BT = randomUUID();
const OWNER = randomUUID();

class FakeCatalog implements CatalogReader {
  readonly known: CatalogMaterial[] = [
    { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: null, kind: 'STOCK', avgCost: null, totalAvailable: null },
    { id: BT, code: 'QA-KHO-BT', name: 'Gói bảo trì', unit: 'Gói', category: null, kind: 'SERVICE', avgCost: null, totalAvailable: null },
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

async function crmFiles(): Promise<string[]> {
  return (await readdir(resolve(root, 'tenant/crm'))).filter((name) => name.endsWith('.sql')).sort();
}

/** Chạy một file như migrator: trong một transaction. */
async function applyFile(pool: Pool, file: string): Promise<void> {
  const sql = await readFile(resolve(root, 'tenant/crm', file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface SeedLine {
  readonly materialId: string;
  readonly code: string;
  readonly unit: string;
  readonly kind: 'STOCK' | 'SERVICE';
  readonly quantity: number;
  readonly price: number;
}

const cap = (quantity: number, price: number): SeedLine => ({ materialId: CAP, code: 'QA-KHO-CAP', unit: 'Cái', kind: 'STOCK', quantity, price });
const bt = (quantity: number, price: number): SeedLine => ({ materialId: BT, code: 'QA-KHO-BT', unit: 'Gói', kind: 'SERVICE', quantity, price });

/** Dòng và tổng như engine cũ tính (không chiết khấu, VAT 10%). */
function amounts(lines: readonly SeedLine[]) {
  const net = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  return { net, vat: net / 10, total: net + net / 10 };
}

integration('Migration 0039: gán sẵn bảng giá cho báo giá, đơn bán cũ (PostgreSQL)', () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let quotes: QuoteService;
  let orders: SalesOrderService;
  const tenantId = randomUUID();
  const actor: CrmActor = {
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId: OWNER,
    displayName: 'Nhân viên',
    canWriteQuote: true,
    canWriteOrder: true,
    canReadAll: true,
  };
  const ids: Record<string, string> = {};
  const lists: Record<string, string> = {};
  let sequence = 0;

  async function customer(code: string, priceListId: string | null): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO crm_schema.customers (code, name, owner_user_id, kind, price_list_id) VALUES ($1, $1, $2, 'CUSTOMER', $3) RETURNING id`,
      [code, OWNER, priceListId],
    );
    return result.rows[0].id;
  }

  async function quote(customerId: string, priceDate: string | null, createdAt: string, lines: readonly SeedLine[]): Promise<string> {
    sequence += 1;
    const totals = amounts(lines);
    const quoteId = (
      await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id, valid_until) VALUES ($1, $2, $3, '2099-12-31') RETURNING id`,
        [`BG-MIG-${sequence}`, customerId, OWNER],
      )
    ).rows[0].id;
    const versionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.quote_versions
           (quote_id, version_no, price_date, priced_on, valid_until, gross_amount, net_amount, vat_amount, total_amount, created_at)
         VALUES ($1, 1, $2, COALESCE($2, $3::date), '2099-12-31', $4, $4, $5, $6, $3::timestamptz) RETURNING id`,
        [quoteId, priceDate, createdAt, totals.net, totals.vat, totals.total],
      )
    ).rows[0].id;
    for (const [index, line] of lines.entries()) {
      const net = line.quantity * line.price;
      await pool.query(
        `INSERT INTO crm_schema.quote_lines
           (version_id, line_no, material_id, material_code, material_name, unit, material_kind, quantity, list_price,
            price_source, unit_price, gross_amount, discount_amount, vat_rate, line_amount, vat_amount, line_total)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'STANDARD_LIST', $8, $9, 0, 10, $9, $10, $11)`,
        [versionId, index + 1, line.materialId, line.code, line.unit, line.kind, line.quantity, line.price, net, net / 10, net + net / 10],
      );
    }
    return quoteId;
  }

  async function order(
    customerId: string,
    source: 'DIRECT' | 'QUOTE',
    orderDate: string,
    priceDate: string | null,
    lines: readonly SeedLine[],
    quoteId: string | null = null,
  ): Promise<string> {
    sequence += 1;
    const totals = amounts(lines);
    const orderId = (
      await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.sales_orders
           (code, source, customer_id, quote_id, owner_user_id, order_date, price_date, gross_amount, net_amount, vat_amount,
            total_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10) RETURNING id`,
        [`DH-MIG-${sequence}`, source, customerId, quoteId, OWNER, orderDate, priceDate, totals.net, totals.vat, totals.total],
      )
    ).rows[0].id;
    for (const [index, line] of lines.entries()) {
      const net = line.quantity * line.price;
      await pool.query(
        `INSERT INTO crm_schema.sales_order_lines
           (order_id, line_no, material_id, material_code, material_name, unit, material_kind, quantity, list_price,
            price_source, unit_price, gross_amount, discount_amount, vat_rate, line_amount, vat_amount, line_total)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'STANDARD_LIST', $8, $9, 0, 10, $9, $10, $11)`,
        [orderId, index + 1, line.materialId, line.code, line.unit, line.kind, line.quantity, line.price, net, net / 10, net + net / 10],
      );
    }
    return orderId;
  }

  const quoteListOf = async (quoteId: string) =>
    (await pool.query<{ price_list_id: string | null }>(`SELECT price_list_id FROM crm_schema.quote_versions WHERE quote_id = $1`, [quoteId]))
      .rows[0].price_list_id;
  const orderListOf = async (orderId: string) =>
    (await pool.query<{ price_list_id: string | null }>(`SELECT price_list_id FROM crm_schema.sales_orders WHERE id = $1`, [orderId])).rows[0]
      .price_list_id;

  beforeAll(async () => {
    const url = new URL(process.env[CRM_TEST_ADMIN_URL_ENV] as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    const name = 'crm_test_' + randomUUID().replace(/-/g, '');
    const admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = '/' + name;
    pool = createPostgresPool(url.toString());
    drop = async () => {
      try {
        await dropTestDatabase(admin, pool, name);
      } finally {
        await admin.end();
      }
    };
    await pool.query(await readFile(resolve(root, 'tenant/0001-integration.sql'), 'utf8'));
    const files = await crmFiles();
    for (const file of files.filter((entry) => entry < MIGRATION)) await applyFile(pool, file);

    // Dữ liệu bản app cũ: bảng chuẩn 2025 và 2026, bảng riêng (chỉ có cáp) gán cho K1, bảng riêng đã tắt gán cho K3.
    lists['std2025'] = await seedPriceList(pool, {
      code: 'BG-CHUAN-2025',
      isStandard: true,
      validFrom: '2025-01-01',
      validTo: '2025-12-31',
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 800_000 }],
    });
    lists['std'] = await seedPriceList(pool, {
      code: 'BG-CHUAN',
      isStandard: true,
      validFrom: '2026-01-01',
      items: [
        { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000 },
        { materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Gói bảo trì', unit: 'Gói', price: 500_000 },
      ],
    });
    lists['own'] = await seedPriceList(pool, {
      code: 'BG-CU-RIENG',
      validFrom: '2026-01-01',
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 900_000 }],
    });
    lists['off'] = await seedPriceList(pool, {
      code: 'BG-RIENG-TAT',
      status: 'INACTIVE',
      validFrom: '2026-01-01',
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 700_000 }],
    });
    const k1 = await customer('K1', lists['own']);
    const k2 = await customer('K2', null);
    const k3 = await customer('K3', lists['off']);

    ids['ownList'] = await quote(k1, '2026-05-01', '2026-05-01T09:00:00+07:00', [cap(2, 900_000)]);
    ids['noPriceDate'] = await quote(k2, null, '2026-03-01T09:00:00+07:00', [cap(1, 1_000_000), bt(2, 500_000)]);
    ids['ownListOff'] = await quote(k3, '2026-05-01', '2026-05-01T09:00:00+07:00', [cap(1, 1_000_000)]);
    ids['period2025'] = await quote(k2, '2025-06-01', '2025-06-01T09:00:00+07:00', [cap(1, 800_000)]);
    ids['noList'] = await quote(k2, '2024-06-01', '2024-06-01T09:00:00+07:00', [cap(1, 750_000)]);
    // Engine cũ lấy gói bảo trì từ bảng chuẩn khi bảng riêng thiếu; bảng gán sẵn là một bảng nên dòng đó không còn giá.
    ids['ownListMissingItem'] = await quote(k1, '2026-05-01', '2026-05-01T09:00:00+07:00', [cap(1, 900_000), bt(1, 500_000)]);

    ids['orderDirect'] = await order(k1, 'DIRECT', '2026-05-02', null, [cap(2, 900_000)]);
    ids['orderDirectOff'] = await order(k3, 'DIRECT', '2026-05-02', '2026-05-01', [cap(1, 1_000_000)]);
    ids['orderFromQuote'] = await order(k2, 'QUOTE', '2026-05-02', '2026-03-01', [cap(1, 1_000_000), bt(2, 500_000)], ids['noPriceDate']);

    for (const file of files.filter((entry) => entry >= MIGRATION)) await applyFile(pool, file);

    const database = new TestCrmDatabase(pool);
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(database);
    const pricing = new PostgresPricingStore(database);
    const catalog = new FakeCatalog();
    // Hôm nay của test: các báo giá chưa có ngày tính giá được tính lại ở ngày này (bảng chuẩn 2026 còn hiệu lực).
    const now = () => new Date('2026-11-18T03:00:00Z');
    quotes = new QuoteService(
      new PostgresQuoteStore(database),
      new PostgresQuoteSettingsStore(database),
      pricing,
      catalog,
      customerStore,
      new PostgresOpportunityStore(database),
      scopes,
      { start: async () => undefined },
      { snapshot: async () => ({ positions: [], assignments: [] }) },
      now,
    );
    const settings = new PostgresSalesSettingsStore(database);
    orders = new SalesOrderService(
      new PostgresSalesOrderStore(database, new UnknownOrderBalanceReader()),
      new PostgresContractStore(database),
      customerStore,
      pricing,
      catalog,
      scopes,
      {
        reserve: async () => {
          throw new Error('not used');
        },
        release: async () => undefined,
        createIssueRequest: async () => {
          throw new Error('not used');
        },
      },
      settings,
      new AllowAllCreditLimitCheck(),
      { dispatch: async () => 0 },
      now,
    );
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  }, 60_000);

  it('B1.4-B1.9: phiên bản báo giá cũ được gán đúng bảng engine cũ chọn tại ngày tính giá', async () => {
    // Bảng riêng của khách đang bật, còn hiệu lực.
    expect(await quoteListOf(ids['ownList'])).toBe(lists['own']);
    // Ngày tính giá rỗng: theo ngày tạo phiên bản; khách không có bảng riêng thì bảng chuẩn.
    expect(await quoteListOf(ids['noPriceDate'])).toBe(lists['std']);
    // Bảng riêng đã tắt: bảng chuẩn.
    expect(await quoteListOf(ids['ownListOff'])).toBe(lists['std']);
    // Hai bảng chuẩn ở hai giai đoạn: đúng bảng của giai đoạn chứa ngày tính giá.
    expect(await quoteListOf(ids['period2025'])).toBe(lists['std2025']);
    // Không có bảng nào hiệu lực: để rỗng.
    expect(await quoteListOf(ids['noList'])).toBeNull();
  });

  it('B1.10: đơn bán cũ gán theo cùng quy tắc; đơn từ báo giá theo phiên bản báo giá', async () => {
    expect(await orderListOf(ids['orderDirect'])).toBe(lists['own']);
    expect(await orderListOf(ids['orderDirectOff'])).toBe(lists['std']);
    expect(await orderListOf(ids['orderFromQuote'])).toBe(await quoteListOf(ids['noPriceDate']));
  });

  it('B1.2: chạy lại 0039 không lỗi, không gán lại dữ liệu đã có', async () => {
    await pool.query(`UPDATE crm_schema.quote_versions SET price_list_id = $2 WHERE quote_id = $1`, [ids['period2025'], lists['own']]);
    await applyFile(pool, MIGRATION);
    expect(await quoteListOf(ids['period2025'])).toBe(lists['own']);
    expect(await quoteListOf(ids['noList'])).toBeNull();
    await pool.query(`UPDATE crm_schema.quote_versions SET price_list_id = $2 WHERE quote_id = $1`, [ids['period2025'], lists['std2025']]);
  });

  it('B2.1: báo giá nháp tính lại sau migration giữ nguyên tổng tiền', async () => {
    for (const key of ['ownList', 'noPriceDate', 'ownListOff', 'period2025']) {
      const before = await quotes.get(actor, ids[key]);
      const after = await quotes.recalculate(actor, ids[key], 1, { revision: before.version.revision });
      expect({ key, total: after.version.totals.totalAmount, net: after.version.totals.netAmount }).toEqual({
        key,
        total: before.version.totals.totalAmount,
        net: before.version.totals.netAmount,
      });
      expect(after.version.priceListId).toBe(before.version.priceListId);
    }
  });

  it('B2.1 (giới hạn đã biết): báo giá không gán được bảng, hoặc bảng riêng thiếu mặt hàng engine cũ lấy từ bảng chuẩn', async () => {
    const noList = await quotes.get(actor, ids['noList']);
    await expect(quotes.recalculate(actor, ids['noList'], 1, { revision: noList.version.revision })).rejects.toMatchObject({
      code: 'PRICE_LIST_REQUIRED',
    });
    const missing = await quotes.get(actor, ids['ownListMissingItem']);
    await expect(quotes.recalculate(actor, ids['ownListMissingItem'], 1, { revision: missing.version.revision })).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
      details: { line: 2 },
    });
  });

  it('B2.2: đơn bán nháp tính lại sau migration giữ nguyên tổng tiền', async () => {
    for (const key of ['orderDirect', 'orderDirectOff']) {
      const before = await orders.get(actor, ids[key]);
      // Gửi lại phí vận chuyển như cũ để đơn được tính lại theo bảng giá đã gán.
      const after = await orders.update(actor, ids[key], { revision: before.revision, shipping: before.shipping });
      expect({ key, total: after.totals.totalAmount }).toEqual({ key, total: before.totals.totalAmount });
      expect(after.priceListId).toBe(before.priceListId);
    }
  });
});
