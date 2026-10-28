import { randomUUID } from 'node:crypto';
import {
  CRM_DELIVERY_LATE,
  CRM_NO_CAPABILITIES,
  CRM_ORDER_RESERVATION_LOST,
  type SalesOrderDetail,
} from '@enterprise-platform/contracts-crm';
import { ContractService } from './application/contract.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { notifyLateDeliveries } from './application/delivery-late.job.js';
import { CustomerTimelineService } from './application/activity.service.js';
import {
  AllowAllCreditLimitCheck,
  UnknownOrderBalanceReader,
  type InventoryClient,
  type IssueRequestInput,
  type ReserveStockRequest,
  type ReservedStock,
} from './application/fulfillment.port.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import type { ProcedureClient } from './application/quote-store.port.js';
import { QuoteConversionService } from './application/quote-conversion.service.js';
import { QuoteService } from './application/quote.service.js';
import { SalesOrderService } from './application/sales-order.service.js';
import { vietnamToday } from './application/pricing.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { CrmError } from './domain/crm.error.js';
import { PostgresIntegrationRequests } from './infrastructure/integration-requests.js';
import { applyReservationExpired, applyReservationReleased, applyStockIssued } from './infrastructure/inventory-events.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresContractStore, PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPriceListStore, PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteConversionStore } from './infrastructure/postgres-quote-conversion.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { PostgresSalesOrderStore } from './infrastructure/postgres-sales-order.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const BT = randomUUID();
const NV = randomUUID();

/** Danh mục Kho giả: `QA-KHO-CAP` hàng tồn kho, `QA-KHO-BT` dịch vụ. */
class FakeCatalog implements CatalogReader {
  readonly known: CatalogMaterial[] = [
    { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị', kind: 'STOCK', avgCost: 800_000, totalAvailable: 100 },
    { id: BT, code: 'QA-KHO-BT', name: 'Gói bảo trì', unit: 'Gói', category: null, kind: 'SERVICE', avgCost: null, totalAvailable: null },
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

/**
 * Kho giả theo đúng hợp đồng API nội bộ: giữ tất cả hoặc không (409 kèm
 * `shortages`), cùng khoá cùng nội dung trả lại phần giữ cũ, nhả trả phần chưa
 * xuất về khả dụng, yêu cầu xuất chống lặp theo khoá.
 */
class FakeInventory implements InventoryClient {
  readonly available = new Map<string, number>();
  readonly reservations = new Map<string, { result: ReservedStock; request: string; lines: ReserveStockRequest['lines'] }>();
  readonly released: string[] = [];
  readonly issues = new Map<string, { input: IssueRequestInput; documentId: string; documentCode: string }>();

  async reserve(_tenantId: string, request: ReserveStockRequest): Promise<ReservedStock> {
    await new Promise((done) => setTimeout(done, 5));
    const fingerprint = JSON.stringify([request.sourceType, request.sourceId, request.expiresAt, request.lines]);
    const existing = this.reservations.get(request.idempotencyKey);
    if (existing) {
      if (existing.request !== fingerprint) throw new CrmError('IDEMPOTENCY_KEY_CONFLICT', 'Khoá đã dùng.', 409);
      return existing.result;
    }
    const shortages = request.lines
      .map((line) => ({ ...line, have: this.available.get(`${line.warehouseCode}|${line.materialCode}`) ?? 0 }))
      .filter((line) => line.have < line.quantity)
      .map((line) => ({ materialCode: line.materialCode, warehouseCode: line.warehouseCode, requested: line.quantity, available: line.have }));
    if (shortages.length) throw new CrmError('RESERVATION_INSUFFICIENT_STOCK', 'Không đủ tồn.', 409, { shortages });
    for (const line of request.lines) {
      const key = `${line.warehouseCode}|${line.materialCode}`;
      this.available.set(key, (this.available.get(key) ?? 0) - line.quantity);
    }
    const result: ReservedStock = {
      reservationId: randomUUID(),
      reservationCode: `GH${this.reservations.size + 1}`,
      status: 'RESERVED',
      expiresAt: request.expiresAt,
    };
    this.reservations.set(request.idempotencyKey, { result, request: fingerprint, lines: request.lines });
    return result;
  }

  async release(_tenantId: string, reservationCode: string): Promise<void> {
    this.released.push(reservationCode);
  }

  async createIssueRequest(_tenantId: string, input: IssueRequestInput) {
    const existing = this.issues.get(input.idempotencyKey);
    if (existing) return { documentId: existing.documentId, documentCode: existing.documentCode, status: 'DRAFT' };
    const created = { input, documentId: randomUUID(), documentCode: `PX${this.issues.size + 1}` };
    this.issues.set(input.idempotencyKey, created);
    return { documentId: created.documentId, documentCode: created.documentCode, status: 'DRAFT' };
  }
}

const noProcedure: ProcedureClient = {
  startInstance: async () => ({ id: randomUUID(), code: null }),
  publishedDefinition: async () => ({ id: '', code: '', name: '' }),
  listPublished: async () => [],
};

integration('Bán hàng GĐ4: hợp đồng, đơn bán, giao hàng (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    canWriteQuote: true,
    canWriteOrder: true,
    canWriteContract: true,
    ...extra,
  });
  const nv = actor(NV);
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true });
  const today = vietnamToday(new Date());
  const addDays = (days: number) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };

  const inventory = new FakeInventory();
  let quotes: QuoteService;
  let conversion: QuoteConversionService;
  let contracts: ContractService;
  let orders: SalesOrderService;
  let orderStore: PostgresSalesOrderStore;
  let timeline: CustomerTimelineService;
  let customerId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(handle.database);
    const catalog = new FakeCatalog();
    const pricing = new PostgresPricingStore(handle.database);
    const quoteStore = new PostgresQuoteStore(handle.database);
    const contractStore = new PostgresContractStore(handle.database);
    const settings = new PostgresSalesSettingsStore(handle.database);
    const dispatcher = new PostgresIntegrationRequests(handle.database, inventory);
    orderStore = new PostgresSalesOrderStore(handle.database, new UnknownOrderBalanceReader());
    quotes = new QuoteService(
      quoteStore,
      new PostgresQuoteSettingsStore(handle.database),
      pricing,
      catalog,
      customerStore,
      new PostgresOpportunityStore(handle.database),
      scopes,
      { start: async () => undefined },
      { snapshot: async () => ({ positions: [], assignments: [] }) },
    );
    conversion = new QuoteConversionService(new PostgresQuoteConversionStore(handle.database), quoteStore, scopes);
    contracts = new ContractService(contractStore, customerStore, catalog, scopes, inventory, settings, dispatcher);
    orders = new SalesOrderService(
      orderStore,
      contractStore,
      customerStore,
      pricing,
      catalog,
      scopes,
      inventory,
      settings,
      new AllowAllCreditLimitCheck(),
      dispatcher,
    );
    timeline = new CustomerTimelineService(new PostgresTimelineStore(handle.database), customerStore, scopes);
    void noProcedure;

    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [
        { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
        { materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Gói bảo trì', unit: 'Gói', price: 500_000, vatRate: 10 },
      ],
    });
    customerId = (await new CustomerService(customerStore, scopes).create(nv, { name: 'Công ty Đơn Hàng', ownerUserId: NV })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const count = async (sql: string, values: unknown[]) => Number((await handle.pool.query<{ n: string }>(sql, values)).rows[0].n);
  const outbox = async (aggregateId: string) =>
    (
      await handle.pool.query<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id = $1 ORDER BY occurred_at, id`,
        [aggregateId],
      )
    ).rows;

  /** Báo giá đã khách chấp nhận: 10 cáp + 2 gói dịch vụ. */
  async function acceptedQuote() {
    const created = await quotes.create(nv, { customerId });
    let detail = await quotes.addLine(nv, created.id, 1, { revision: created.version.revision, materialId: CAP, quantity: 10 });
    detail = await quotes.addLine(nv, created.id, 1, { revision: detail.version.revision, materialId: BT, quantity: 2 });
    detail = await quotes.submit(nv, created.id, 1, { revision: detail.version.revision });
    detail = await quotes.send(nv, created.id, 1, { revision: detail.version.revision });
    return quotes.accept(nv, created.id, 1, { revision: detail.version.revision });
  }

  /** Đơn trực tiếp Nháp ở kho `warehouse`, dòng cáp `quantity` cái (kèm dịch vụ nếu `withService`). */
  async function directOrder(quantity: number, warehouse = 'KHO-1', withService = false) {
    return orders.create(nv, {
      customerId,
      warehouseCode: warehouse,
      lines: [{ materialId: CAP, quantity }, ...(withService ? [{ materialId: BT, quantity: 1 }] : [])],
    });
  }

  it('TC-QUO-11/13, TC-ORD-02: chuyển báo giá đúng một lần kể cả gọi song song; đơn trùng dòng, giá, VAT', async () => {
    const quote = await acceptedQuote();
    expect(quote.status).toBe('ACCEPTED');
    const [first, second] = await Promise.all([conversion.convert(nv, quote.id), conversion.convert(nv, quote.id)]);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(second.contractId).toBe(first.contractId);
    expect(second.orderId).toBe(first.orderId);
    expect(await count(`SELECT count(*) AS n FROM crm_schema.contracts WHERE quote_id = $1`, [quote.id])).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM crm_schema.sales_orders WHERE quote_id = $1`, [quote.id])).toBe(1);
    const again = await conversion.convert(nv, quote.id);
    expect(again).toMatchObject({ created: false, contractId: first.contractId });

    const order = await orders.get(nv, first.orderId);
    expect(order).toMatchObject({ source: 'QUOTE', status: 'DRAFT', contractId: first.contractId, quoteId: quote.id });
    expect(order.lines.map((line) => [line.materialCode, line.quantity, line.unitPrice, line.discountPercent, line.vatRate, line.lineTotal])).toEqual(
      quote.version.lines.map((line) => [line.materialCode, line.quantity, line.unitPrice, line.discountPercent, line.vatRate, line.lineTotal]),
    );
    expect(order.totals.totalAmount).toBe(quote.version.totals.totalAmount);
    expect(order.deliveries).toHaveLength(1);
    expect(order.deliveries[0].lines.map((line) => line.plannedQuantity)).toEqual([10, 2]);
    const contract = await contracts.get(nv, first.contractId);
    expect(contract).toMatchObject({ type: 'SALE', status: 'DRAFT', value: quote.version.totals.totalAmount, quoteCode: quote.code });
    expect((await quotes.get(nv, quote.id)).convertedAt).not.toBeNull();

    // Đơn từ hợp đồng Nháp chưa xác nhận được; xác nhận hợp đồng (giữ hàng) rồi đơn dùng phần giữ của hợp đồng.
    await expect(orders.confirm(nv, order.id, { revision: order.revision })).rejects.toMatchObject({ code: 'CONTRACT_NOT_ACTIVE' });
    inventory.available.set('KHO-Q|QA-KHO-CAP', 10);
    const withWarehouse = await contracts.update(nv, contract.id, { revision: contract.revision, warehouseCode: 'KHO-Q' });
    const active = await contracts.confirm(nv, contract.id, { revision: withWarehouse.revision });
    expect(active).toMatchObject({ status: 'ACTIVE', reservation: { status: 'HELD' } });
    const sameWarehouse = await orders.update(nv, order.id, { revision: order.revision, warehouseCode: 'KHO-Q' });
    const confirmed = await orders.confirm(nv, order.id, { revision: sameWarehouse.revision });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.lines[0]).toMatchObject({ reservationSource: 'CONTRACT', reservationCode: active.reservation?.reservationCode, reservedQuantity: 10 });
    expect(inventory.available.get('KHO-Q|QA-KHO-CAP')).toBe(0);

    // TC-CUS-10 (phần GĐ4): dòng thời gian khách có báo giá, hợp đồng, đơn.
    const kinds = new Set((await timeline.list(nv, customerId, {})).items.map((entry) => entry.kind));
    expect(kinds).toEqual(new Set(['quote', 'contract', 'order']));
  });

  it('TC-QUO-12: báo giá chưa khách chấp nhận không chuyển được', async () => {
    const created = await quotes.create(nv, { customerId });
    await expect(conversion.convert(nv, created.id)).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_NOT_ACCEPTED' });
  });

  it('TC-ORD-03, TC-CONC-01: hai đơn cùng giữ phần tồn cuối cùng, đúng một thành công', async () => {
    inventory.available.set('KHO-C|QA-KHO-CAP', 1);
    const [a, b] = await Promise.all([directOrder(1, 'KHO-C'), directOrder(1, 'KHO-C')]);
    const results = await Promise.allSettled([
      orders.confirm(nv, a.id, { revision: a.revision }),
      orders.confirm(nv, b.id, { revision: b.revision }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ statusCode: 409, code: 'RESERVATION_INSUFFICIENT_STOCK' });
    expect(inventory.available.get('KHO-C|QA-KHO-CAP')).toBe(0);
    const statuses = (await Promise.all([orders.get(nv, a.id), orders.get(nv, b.id)])).map((order) => order.status).sort();
    expect(statuses).toEqual(['CONFIRMED', 'DRAFT']);
  });

  it('TC-ORD-04..07, TC-SM-08, TC-INT-16: giao hai đợt, áp kết quả xuất idempotent, đảo chứng từ', async () => {
    inventory.available.set('KHO-1|QA-KHO-CAP', 100);
    const draft = await directOrder(10, 'KHO-1', true);
    let order = await orders.confirm(nv, draft.id, { revision: draft.revision });
    expect(order.lines[0]).toMatchObject({ reservationStatus: 'HELD', reservedQuantity: 10, reservationSource: 'ORDER' });
    const [stockLine, serviceLine] = order.lines;
    order = await orders.saveDelivery(nv, order.id, null, {
      revision: order.revision,
      plannedDate: addDays(1),
      lines: [{ orderLineId: stockLine.id, quantity: 4 }, { orderLineId: serviceLine.id, quantity: 1 }],
    });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(5), address: 'Chi nhánh B', lines: [{ orderLineId: stockLine.id, quantity: 6 }] });
    await expect(
      orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(6), lines: [{ orderLineId: stockLine.id, quantity: 1 }] }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Tổng số lượng các đợt vượt số lượng đơn.' });
    const [first, second] = order.deliveries;
    order = await orders.requestIssue(nv, order.id, first.id, { revision: order.revision });
    expect(order.status).toBe('DELIVERING');
    const issue = inventory.issues.get(`crm-delivery:${first.id}`);
    // TC-ORD-10: dòng dịch vụ không gửi Kho.
    expect(issue?.input.lines).toEqual([{ materialCode: 'QA-KHO-CAP', quantity: 4, reservationId: stockLine.reservationId }]);

    const issued = {
      documentId: issue?.documentId,
      documentCode: issue?.documentCode,
      sourceType: 'crm_delivery',
      sourceId: first.id,
      reversesDocumentId: null,
      postedAt: new Date().toISOString(),
      lines: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', quantity: 4, unitCost: 800_000, costAmount: 3_200_000, serials: ['S1', 'S2', 'S3', 'S4'], direction: 'OUT' }],
    };
    const balances = new UnknownOrderBalanceReader();
    expect(await applyStockIssued(handle.database, tenantId, issued, balances)).toBe('applied');
    expect(await applyStockIssued(handle.database, tenantId, issued, balances)).toBe('ignored');
    order = await orders.get(nv, order.id);
    expect(order.status).toBe('PARTIAL');
    expect(order.lines[0]).toMatchObject({ deliveredQuantity: 4, actualCost: 3_200_000, reservedQuantity: 6, serials: ['S1', 'S2', 'S3', 'S4'] });
    // T8-12: dòng dùng phần giữ của chính đơn xuất một phần: vẫn Đang giữ.
    expect(order.lines[0]).toMatchObject({ reservationSource: 'ORDER', reservationStatus: 'HELD' });
    expect(order.lines[1]).toMatchObject({ deliveredQuantity: 1 });
    expect(order.deliveries[0]).toMatchObject({ status: 'ISSUED', issueDocumentCode: issue?.documentCode });

    order = await orders.requestIssue(nv, order.id, second.id, { revision: order.revision });
    expect(order.status).toBe('DELIVERING');
    const secondIssue = inventory.issues.get(`crm-delivery:${second.id}`);
    const secondEvent = {
      ...issued,
      documentId: secondIssue?.documentId,
      documentCode: secondIssue?.documentCode,
      sourceId: second.id,
      lines: [{ ...issued.lines[0], quantity: 6, costAmount: 4_860_000, serials: ['S5', 'S6', 'S7', 'S8', 'S9', 'S10'] }],
    };
    await applyStockIssued(handle.database, tenantId, secondEvent, balances);
    order = await orders.get(nv, order.id);
    // Đã giao đủ nhưng chưa có sổ công nợ (GĐ5): không tự Hoàn tất.
    expect(order.status).toBe('DELIVERED');
    expect(order.lines[0]).toMatchObject({ deliveredQuantity: 10, actualCost: 8_060_000, reservedQuantity: 0 });
    // T8-12: xuất đủ thì phần giữ của dòng sang Đã xuất đủ, như dòng dùng phần giữ của hợp đồng.
    expect(order.lines[0]).toMatchObject({ reservationSource: 'ORDER', reservationStatus: 'COMPLETED' });

    // Chứng từ đảo đợt 2: trừ lại, bỏ serial, đơn lùi về Đã giao một phần; nhận trùng thì bỏ qua.
    const reversal = {
      ...secondEvent,
      documentId: randomUUID(),
      documentCode: 'PX-DAO',
      reversesDocumentId: secondIssue?.documentId,
      lines: [{ ...secondEvent.lines[0], direction: 'IN' }],
    };
    expect(await applyStockIssued(handle.database, tenantId, reversal, balances)).toBe('applied');
    expect(await applyStockIssued(handle.database, tenantId, reversal, balances)).toBe('ignored');
    order = await orders.get(nv, order.id);
    expect(order.status).toBe('PARTIAL');
    expect(order.lines[0]).toMatchObject({ deliveredQuantity: 4, actualCost: 3_200_000, serials: ['S1', 'S2', 'S3', 'S4'] });
    // Đảo chứng từ không trả phần giữ (như Kho): vẫn Đã xuất đủ.
    expect(order.lines[0]).toMatchObject({ reservationStatus: 'COMPLETED', reservedQuantity: 0 });
    expect(order.deliveries[1].status).toBe('REVERSED');
    expect(order.history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['create', 'confirm', 'request-issue', 'deliver', 'reverse-delivery']),
    );
  });

  it('TC-SM-09: huỷ đơn đã giao một phần nhả phần giữ còn lại, không đụng phần đã xuất', async () => {
    inventory.available.set('KHO-1|QA-KHO-CAP', 100);
    const draft = await directOrder(10);
    let order = await orders.confirm(nv, draft.id, { revision: draft.revision });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(1), lines: [{ orderLineId: order.lines[0].id, quantity: 4 }] });
    order = await orders.requestIssue(nv, order.id, order.deliveries[0].id, { revision: order.revision });
    const issue = inventory.issues.get(`crm-delivery:${order.deliveries[0].id}`);
    await applyStockIssued(
      handle.database,
      tenantId,
      {
        documentId: issue?.documentId,
        documentCode: issue?.documentCode,
        sourceType: 'crm_delivery',
        sourceId: order.deliveries[0].id,
        lines: [{ materialId: CAP, quantity: 4, costAmount: 3_200_000, serials: [] }],
      },
      new UnknownOrderBalanceReader(),
    );
    order = await orders.get(nv, order.id);
    const code = order.lines[0].reservationCode as string;
    const releasedBefore = inventory.released.length;
    const cancelled = await orders.cancel(nv, order.id, { revision: order.revision, reason: 'Khách dừng phần còn lại' });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Khách dừng phần còn lại' });
    expect(cancelled.lines[0]).toMatchObject({ deliveredQuantity: 4, reservationStatus: 'RELEASED', reservedQuantity: 0 });
    expect(inventory.released.slice(releasedBefore)).toEqual([code]);
    expect(
      (await handle.pool.query(`SELECT status FROM crm_schema.integration_requests WHERE idempotency_key = $1`, [`crm-release:${code}`])).rows,
    ).toEqual([{ status: 'SUCCEEDED' }]);
  });

  it('T4-13: Kho báo giữ hàng hết hạn thì dòng đơn mất phần giữ và báo người phụ trách; trạng thái đơn không đổi', async () => {
    inventory.available.set('KHO-1|QA-KHO-CAP', 100);
    const draft = await directOrder(3);
    const order = await orders.confirm(nv, draft.id, { revision: draft.revision });
    const code = order.lines[0].reservationCode as string;
    expect(await applyReservationExpired(handle.database, tenantId, { reservationCode: code, sourceType: 'crm_order', sourceId: order.id })).toBe('applied');
    expect(await applyReservationExpired(handle.database, tenantId, { reservationCode: code, sourceType: 'crm_order', sourceId: order.id })).toBe('ignored');
    const after = await orders.get(nv, order.id);
    expect(after.status).toBe('CONFIRMED');
    expect(after.lines[0]).toMatchObject({ reservationStatus: 'EXPIRED', reservedQuantity: 0 });
    const lost = (await outbox(order.id)).find((row) => row.event_type === CRM_ORDER_RESERVATION_LOST);
    expect(lost?.payload.payload).toMatchObject({ recipientUserIds: [NV], reservationCode: code });
  });

  it('TC-ORD-08/09: đợt quá ngày dự kiến hiện ở bộ lọc giao trễ, báo một lần; xuất xong thì hết trễ', async () => {
    inventory.available.set('KHO-1|QA-KHO-CAP', 100);
    const draft = await directOrder(2);
    let order: SalesOrderDetail = await orders.confirm(nv, draft.id, { revision: draft.revision });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(1), lines: [{ orderLineId: order.lines[0].id, quantity: 2 }] });
    // Lùi ngày dự kiến về hôm qua như khi đợt đã quá hạn.
    await handle.pool.query(`UPDATE crm_schema.delivery_plans SET planned_date = $2 WHERE id = $1`, [order.deliveries[0].id, addDays(-1)]);
    const late = await orders.list(nv, { late: 'true' });
    expect(late.items.map((item) => item.id)).toContain(order.id);
    expect(late.items.find((item) => item.id === order.id)?.late).toBe(true);
    expect(await notifyLateDeliveries(orderStore, tenantId, today, 50)).toBeGreaterThanOrEqual(1);
    expect(await notifyLateDeliveries(orderStore, tenantId, today, 50)).toBe(0);
    const events = await outbox(order.deliveries[0].id);
    expect(events.map((row) => row.event_type)).toEqual([CRM_DELIVERY_LATE]);
    expect(events[0].payload.payload).toMatchObject({ orderId: order.id, recipientUserIds: [NV] });

    order = await orders.get(nv, order.id);
    order = await orders.requestIssue(nv, order.id, order.deliveries[0].id, { revision: order.revision });
    const issue = inventory.issues.get(`crm-delivery:${order.deliveries[0].id}`);
    await applyStockIssued(
      handle.database,
      tenantId,
      { documentId: issue?.documentId, documentCode: issue?.documentCode, sourceType: 'crm_delivery', sourceId: order.deliveries[0].id, lines: [{ materialId: CAP, quantity: 2, costAmount: 1_600_000 }] },
      new UnknownOrderBalanceReader(),
    );
    expect((await orders.list(nv, { late: 'true' })).items.map((item) => item.id)).not.toContain(order.id);
  });

  it('TC-CON-01..05, TC-CON-07/08: hợp đồng, đợt thanh toán, xác nhận giữ hàng tất cả hoặc không', async () => {
    inventory.available.set('KHO-H|QA-KHO-CAP', 5);
    const draft = await contracts.create(nv, {
      type: 'SALE',
      customerId,
      title: 'Hợp đồng mua bán cáp',
      validFrom: today,
      validTo: addDays(60),
      value: 100_000_000,
      warehouseCode: 'KHO-H',
      lines: [
        { materialId: CAP, quantity: 10, unitPrice: 900_000 },
        { materialId: BT, quantity: 1, unitPrice: 500_000 },
      ],
    });
    await expect(
      contracts.savePaymentTerms(nv, draft.id, {
        revision: draft.revision,
        terms: [
          { name: 'Đợt 1', percent: 30, condition: 'SIGN' },
          { name: 'Đợt 2', percent: 60, condition: 'DELIVERY' },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Tổng các đợt phải bằng 100% giá trị hợp đồng.' });
    const withTerms = await contracts.savePaymentTerms(nv, draft.id, {
      revision: draft.revision,
      terms: [
        { name: 'Ký', percent: 30, condition: 'SIGN' },
        { name: 'Giao hàng', percent: 50, condition: 'DELIVERY', dueDays: 15 },
        { name: 'Nghiệm thu', percent: 20, condition: 'ACCEPTANCE' },
      ],
    });
    expect(withTerms.paymentTerms.map((term) => term.amount)).toEqual([30_000_000, 50_000_000, 20_000_000]);

    // Thiếu 5 cái: không giữ dòng nào, hợp đồng vẫn Nháp.
    await expect(contracts.confirm(nv, draft.id, { revision: withTerms.revision })).rejects.toMatchObject({
      statusCode: 409,
      details: { shortages: [expect.objectContaining({ lineNo: 1, requested: 10, available: 5 })] },
    });
    expect((await contracts.get(nv, draft.id)).status).toBe('DRAFT');
    inventory.available.set('KHO-H|QA-KHO-CAP', 15);
    const active = await contracts.confirm(nv, draft.id, { revision: withTerms.revision });
    expect(active).toMatchObject({ status: 'ACTIVE', reservation: { status: 'HELD' } });
    const reserved = [...inventory.reservations.entries()].find(([key]) => key === `crm-contract:${draft.id}`)?.[1];
    expect(reserved?.lines).toEqual([{ materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-H', quantity: 10 }]);
    // Cùng transaction xác nhận: đợt "khi ký" đến hạn (GĐ5, T5-05) nên nhật ký có thêm một mục cùng thời điểm.
    expect(active.history.map((entry) => [entry.action, entry.toStatus])).toEqual(
      expect.arrayContaining([
        ['confirm', 'ACTIVE'],
        ['payment-term-due', null],
        ['create', 'DRAFT'],
      ]),
    );
    expect(active.history).toHaveLength(3);
    expect(active.paymentTerms.map((term) => term.status)).toEqual(['DUE', 'PENDING', 'PENDING']);

    // Huỷ hợp đồng chưa giao: nhả phần giữ.
    const cancelled = await contracts.cancel(nv, draft.id, { revision: active.revision, reason: 'Khách huỷ' });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', reservation: { status: 'RELEASED' } });
    // Huỷ hợp đồng: khoản phải thu của đợt đã đến hạn được đảo, nợ về 0.
    const balance = await handle.pool.query<{ total: string }>(
      `SELECT COALESCE(sum(amount), 0) AS total FROM crm_schema.receivable_entries WHERE contract_id = $1`,
      [draft.id],
    );
    expect(Number(balance.rows[0].total)).toBe(0);
    expect(inventory.released).toContain(active.reservation?.reservationCode);
  });

  it('TC-CON-02/03: hợp đồng khung sinh nhiều đơn với giá khung; hết hạn thì không tạo đơn', async () => {
    const frame = await contracts.create(nv, {
      type: 'FRAMEWORK',
      customerId,
      title: 'Khung cáp 2026',
      validFrom: today,
      validTo: addDays(10),
      lines: [{ materialId: CAP, unitPrice: 900_000 }],
    });
    const active = await contracts.confirm(nv, frame.id, { revision: frame.revision });
    for (let index = 0; index < 2; index += 1) {
      const order = await orders.create(nv, { contractId: frame.id, lines: [{ materialId: CAP, quantity: 3 }] });
      expect(order).toMatchObject({ source: 'CONTRACT', contractId: frame.id, contractCode: frame.code });
      expect(order.lines[0]).toMatchObject({ priceSource: 'CONTRACT', listPrice: 900_000, unitPrice: 900_000, priceReferenceCode: frame.code });
    }
    // Báo giá của cùng khách cũng lấy giá khung (khung đang hiệu lực).
    const quote = await quotes.create(nv, { customerId });
    const priced = await quotes.addLine(nv, quote.id, 1, { revision: quote.version.revision, materialId: CAP, quantity: 1 });
    expect(priced.version.lines[0]).toMatchObject({ priceSource: 'CONTRACT', listPrice: 900_000 });

    // Job hết hạn: quá ngày kết thúc thì Hết hạn, đơn mới bị chặn.
    await handle.pool.query(`UPDATE crm_schema.contracts SET valid_from = $2, valid_to = $3 WHERE id = $1`, [frame.id, addDays(-30), addDays(-1)]);
    expect(await new PostgresContractStore(handle.database).expireDue(tenantId, today, 50)).toBeGreaterThanOrEqual(1);
    expect((await contracts.get(nv, active.id)).status).toBe('EXPIRED');
    await expect(orders.create(nv, { contractId: frame.id })).rejects.toMatchObject({ statusCode: 409, message: 'Hợp đồng đã hết hiệu lực.' });
  });
  it('phần giữ của hợp đồng: Kho xuất đủ theo phần giữ thì hợp đồng và dòng đơn hiện Đã xuất đủ; Kho nhả thì Đã nhả', async () => {
    inventory.available.set('KHO-R|QA-KHO-CAP', 20);
    const draft = await contracts.create(nv, {
      type: 'SALE',
      customerId,
      title: 'HĐ giữ hàng xuất đủ',
      validFrom: today,
      validTo: addDays(60),
      value: 9_000_000,
      warehouseCode: 'KHO-R',
      lines: [{ materialId: CAP, quantity: 10, unitPrice: 900_000 }],
    });
    const active = await contracts.confirm(nv, draft.id, { revision: draft.revision });
    const reservation = active.reservation;
    expect(reservation).toMatchObject({ status: 'HELD' });
    let order = await orders.create(nv, { contractId: draft.id, lines: [{ materialId: CAP, quantity: 10 }] });
    order = await orders.confirm(nv, order.id, { revision: order.revision });
    expect(order.lines[0]).toMatchObject({ reservationSource: 'CONTRACT', reservationId: reservation?.reservationId });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(1), lines: [{ orderLineId: order.lines[0].id, quantity: 4 }] });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(2), lines: [{ orderLineId: order.lines[0].id, quantity: 6 }] });
    const balances = new UnknownOrderBalanceReader();
    const issue = async (deliveryId: string, quantity: number, reversesDocumentId: string | null = null) => {
      order = await orders.get(nv, order.id);
      if (!reversesDocumentId) order = await orders.requestIssue(nv, order.id, deliveryId, { revision: order.revision });
      const request = inventory.issues.get(`crm-delivery:${deliveryId}`);
      const documentId = reversesDocumentId ? randomUUID() : request?.documentId;
      await applyStockIssued(
        handle.database,
        tenantId,
        {
          documentId,
          documentCode: `PX-${quantity}`,
          sourceType: 'crm_delivery',
          sourceId: deliveryId,
          reversesDocumentId,
          postedAt: new Date().toISOString(),
          lines: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', quantity, costAmount: 0, direction: reversesDocumentId ? 'IN' : 'OUT', reservationId: reservation?.reservationId }],
        },
        balances,
      );
      return documentId as string;
    };
    const [first, second] = order.deliveries;
    // Xuất một phần theo phần giữ: vẫn Đang giữ (Kho: Xuất một phần).
    const firstDocument = await issue(first.id, 4);
    expect((await contracts.get(nv, draft.id)).reservation).toMatchObject({ status: 'HELD' });
    // Dòng đơn xuất một phần: phần giữ của dòng vẫn Đang giữ.
    expect((await orders.get(nv, order.id)).lines[0]).toMatchObject({ reservationStatus: 'HELD', deliveredQuantity: 4 });
    await issue(second.id, 6);
    const completed = await contracts.get(nv, draft.id);
    expect(completed.reservation).toMatchObject({ status: 'COMPLETED', reservationCode: reservation?.reservationCode });
    expect(completed.history.map((entry) => entry.action)).toContain('reservation-completed');
    // T8-09: dòng đơn dùng phần giữ của hợp đồng xuất đủ thì phần giữ của dòng sang Đã xuất đủ.
    expect((await orders.get(nv, order.id)).lines[0]).toMatchObject({ reservationStatus: 'COMPLETED', reservedQuantity: 0, deliveredQuantity: 10 });
    // Đảo chứng từ không trả phần giữ (như Kho): vẫn Đã xuất đủ.
    await issue(first.id, 4, firstDocument);
    expect((await contracts.get(nv, draft.id)).reservation?.status).toBe('COMPLETED');
    expect((await orders.get(nv, order.id)).lines[0]).toMatchObject({ reservationStatus: 'COMPLETED', deliveredQuantity: 6 });
    // Phần giữ không còn Đang giữ: sự kiện nhả về sau bị bỏ qua.
    expect(
      await applyReservationReleased(handle.database, tenantId, { reservationCode: reservation?.reservationCode, sourceType: 'crm_contract', sourceId: draft.id }),
    ).toBe('ignored');

    // Hợp đồng khác: Kho nhả tay phần giữ thì hợp đồng và dòng đơn dùng phần giữ đó sang Đã nhả.
    const other = await contracts.create(nv, {
      type: 'SALE',
      customerId,
      title: 'HĐ bị nhả ở Kho',
      validFrom: today,
      validTo: addDays(60),
      value: 1_800_000,
      warehouseCode: 'KHO-R',
      lines: [{ materialId: CAP, quantity: 2, unitPrice: 900_000 }],
    });
    const otherActive = await contracts.confirm(nv, other.id, { revision: other.revision });
    let otherOrder = await orders.create(nv, { contractId: other.id, lines: [{ materialId: CAP, quantity: 2 }] });
    otherOrder = await orders.confirm(nv, otherOrder.id, { revision: otherOrder.revision });
    const released = { reservationCode: otherActive.reservation?.reservationCode, sourceType: 'crm_contract', sourceId: other.id };
    expect(await applyReservationReleased(handle.database, tenantId, released)).toBe('applied');
    expect(await applyReservationReleased(handle.database, tenantId, released)).toBe('ignored');
    expect((await contracts.get(nv, other.id)).reservation?.status).toBe('RELEASED');
    expect((await orders.get(nv, otherOrder.id)).lines[0]).toMatchObject({ reservationStatus: 'RELEASED', reservedQuantity: 0 });
  });
});
