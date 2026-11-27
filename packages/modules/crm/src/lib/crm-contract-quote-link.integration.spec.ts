import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES, type ContractLine } from '@enterprise-platform/contracts-crm';
import { ContractService } from './application/contract.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteConversionService } from './application/quote-conversion.service.js';
import { QuoteFormService } from './application/quote-form.service.js';
import type { ApprovalLinks } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { seedPriceList } from './crm-test-price-lists.js';
import { PostgresContractStore } from './infrastructure/postgres-contract.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteConversionStore } from './infrastructure/postgres-quote-conversion.store.js';
import { PostgresQuoteFormStore } from './infrastructure/postgres-quote-form.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const BT = randomUUID();
const TN = randomUUID();
const NV1 = randomUUID();
const NV3 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-tn', reportsToPositionId: null },
    { id: 'p-nv1', reportsToPositionId: 'p-tn' },
    { id: 'p-nv3', reportsToPositionId: null },
  ],
  assignments: [
    { userId: TN, positionId: 'p-tn' },
    { userId: NV1, positionId: 'p-nv1' },
    { userId: NV3, positionId: 'p-nv3' },
  ],
};

class FakeCatalog implements CatalogReader {
  readonly known: CatalogMaterial[] = [
    { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị', kind: 'STOCK', avgCost: 800_000, totalAvailable: 70 },
    { id: BT, code: 'QA-KHO-BT', name: 'Gói bảo trì', unit: 'Gói', category: null, kind: 'SERVICE', avgCost: null, totalAvailable: null },
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

const noLinks: ApprovalLinks = { start: async () => undefined };

/** Dòng hợp đồng bỏ id (id sinh mới mỗi lần) để so hai đường lập. */
const comparable = (lines: readonly ContractLine[]) =>
  lines.map((line) => [
    line.lineNo,
    line.materialId,
    line.materialCode,
    line.unit,
    line.materialKind,
    line.quantity,
    line.unitPrice,
    line.vatRate,
    line.discountPercent,
    line.lineAmount,
    line.note,
    line.warehouseCode ?? null,
  ]);

integration('Bán hàng: lập hợp đồng gắn báo giá khách chấp nhận (PostgreSQL)', () => {
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
  const nv1 = actor(NV1);
  const nv3 = actor(NV3);
  const today = '2026-11-27';

  let quotes: QuoteService;
  let conversion: QuoteConversionService;
  let contracts: ContractService;
  let customerId: string;
  let otherCustomerId: string;
  let priceListId: string;
  let orderTemplateId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const formStore = new PostgresQuoteFormStore(handle.database);
    const quoteStore = new PostgresQuoteStore(handle.database);
    const catalog = new FakeCatalog();
    quotes = new QuoteService(
      quoteStore,
      new PostgresQuoteSettingsStore(handle.database),
      new PostgresPricingStore(handle.database),
      catalog,
      customerStore,
      new PostgresOpportunityStore(handle.database),
      scopes,
      noLinks,
      { snapshot: async () => ORGANIZATION },
      undefined,
      undefined,
      formStore,
    );
    conversion = new QuoteConversionService(new PostgresQuoteConversionStore(handle.database), quoteStore, scopes);
    contracts = new ContractService(
      new PostgresContractStore(handle.database),
      customerStore,
      catalog,
      scopes,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      quoteStore,
    );
    priceListId = await seedPriceList(handle.pool, {
      code: 'BG-CHUAN',
      name: 'Bảng giá chuẩn',
      items: [
        { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
        { materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Gói bảo trì', unit: 'Gói', price: 500_000, vatRate: 8 },
      ],
    });
    const customers = new CustomerService(customerStore, scopes);
    customerId = (await customers.create(nv1, { name: 'Công ty Gắn Báo Giá', ownerUserId: NV1 })).id;
    otherCustomerId = (await customers.create(nv1, { name: 'Công ty Khác', ownerUserId: NV1 })).id;
    const templates = await new QuoteFormService(formStore).listTemplates(nv1, false);
    orderTemplateId = templates.find((template) => template.discountMode === 'ORDER')?.id as string;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  /** Báo giá mẫu ORDER: hai dòng cùng cáp (gộp khi sang hợp đồng) và một dòng dịch vụ, chiết khấu, thuế, phí tổng đơn. */
  async function orderQuote() {
    const created = await quotes.create(nv1, { customerId, priceListId, templateId: orderTemplateId });
    let current = await quotes.addLine(nv1, created.id, 1, { revision: created.version.revision, materialId: CAP, quantity: 3 });
    current = await quotes.addLine(nv1, created.id, 1, { revision: current.version.revision, materialId: CAP, quantity: 7 });
    current = await quotes.addLine(nv1, created.id, 1, { revision: current.version.revision, materialId: BT, quantity: 2 });
    return quotes.updateVersion(nv1, created.id, 1, {
      revision: current.version.revision,
      orderDiscount: { percent: 3.3333 },
      orderTax: { percent: 8 },
      fees: [{ feeType: 'Lắp đặt', amount: 150_000 }],
      shipping: { amount: 200_000 },
    });
  }

  async function accept(id: string) {
    let current = await quotes.get(nv1, id);
    current = await quotes.submit(nv1, id, current.currentVersion, { revision: current.version.revision });
    current = await quotes.send(nv1, id, current.currentVersion, { revision: current.version.revision });
    return quotes.accept(nv1, id, current.currentVersion, { revision: current.version.revision });
  }

  const request = (quoteId: string | null, extra: Record<string, unknown> = {}) => ({
    type: 'SALE' as const,
    customerId,
    title: 'Hợp đồng lập tay có báo giá',
    validFrom: today,
    quoteId,
    ...extra,
  });

  const count = async (sql: string, values: unknown[]) => Number((await handle.pool.query<{ n: string }>(sql, values)).rows[0].n);
  const quoteAudit = async (quoteId: string) =>
    (
      await handle.pool.query<{ action: string; reason: string | null; metadata: Record<string, unknown> }>(
        `SELECT action, reason, metadata FROM crm_schema.audit_log WHERE entity_type = 'quote' AND entity_id = $1 ORDER BY at, id`,
        [quoteId],
      )
    ).rows;

  it('dòng, giá trị hợp đồng gắn báo giá bằng đúng kết quả chuyển báo giá cùng nội dung; báo giá thành đã chuyển, không sinh đơn', async () => {
    const converted = await accept((await orderQuote()).id);
    const linked = await accept((await orderQuote()).id);
    expect(linked.version.totals.totalAmount).toBe(converted.version.totals.totalAmount);

    // Trước khi gắn: báo giá có trong danh sách gắn được, xem trước khớp kết quả lập.
    const linkable = await quotes.list(nv1, { contractLinkable: true, customerId, limit: 50 });
    expect(linkable.items.map((item) => item.id)).toEqual(expect.arrayContaining([linked.id, converted.id]));
    const preview = await contracts.quotePreview(nv1, linked.id);
    expect(preview).toMatchObject({ quoteId: linked.id, quoteCode: linked.code, customerId, versionNo: 1, totalAmount: linked.version.totals.totalAmount });

    const result = await conversion.convert(nv1, converted.id);
    const fromConversion = await contracts.get(nv1, result.contractId);
    // Gửi kèm dòng và để trống giá trị: dòng vẫn lấy từ báo giá, giá trị bằng tổng báo giá như khi chuyển.
    const contract = await contracts.create(
      nv1,
      request(linked.id, { lines: [{ materialId: CAP, quantity: 1, unitPrice: 1 }], value: null }),
    );

    expect(contract).toMatchObject({ status: 'DRAFT', type: 'SALE', customerId, quoteId: linked.id, quoteCode: linked.code });
    expect(contract.value).toBe(fromConversion.value);
    expect(contract.value).toBe(linked.version.totals.totalAmount);
    expect(comparable(contract.lines)).toEqual(comparable(fromConversion.lines));
    expect(comparable(preview.lines)).toEqual(comparable(contract.lines));
    // Hai dòng cáp gộp một, cộng dòng dịch vụ.
    expect(contract.lines.map((line) => [line.materialCode, line.quantity])).toEqual([
      ['QA-KHO-CAP', 10],
      ['QA-KHO-BT', 2],
    ]);

    // Báo giá: đã chuyển, hiện hợp đồng (không đơn), nhật ký "link-contract"; không còn trong danh sách gắn được.
    const detail = await quotes.get(nv1, linked.id);
    expect(detail.convertedAt).not.toBeNull();
    expect(detail.conversion).toEqual({ contractId: contract.id, contractCode: contract.code, orderId: null, orderCode: null });
    expect((await quotes.get(nv1, converted.id)).conversion).toEqual({
      contractId: result.contractId,
      contractCode: result.contractCode,
      orderId: result.orderId,
      orderCode: result.orderCode,
    });
    expect((await quoteAudit(linked.id)).at(-1)).toMatchObject({
      action: 'link-contract',
      reason: `Gắn vào hợp đồng ${contract.code}`,
      metadata: { versionNo: 1, contractId: contract.id, contractCode: contract.code },
    });
    expect(detail.history[0]).toMatchObject({ action: 'link-contract', versionNo: 1 });
    expect(contract.history.map((entry) => entry.action)).toEqual(['create']);
    expect(await count(`SELECT count(*) AS n FROM crm_schema.sales_orders WHERE quote_id = $1`, [linked.id])).toBe(0);
    const after = await quotes.list(nv1, { contractLinkable: true, customerId, limit: 50 });
    expect(after.items.map((item) => item.id)).not.toContain(linked.id);
    expect(after.items.map((item) => item.id)).not.toContain(converted.id);

    // Gắn lại, chuyển đổi báo giá đã gắn, gắn báo giá đã chuyển: đều 409, không sinh thêm hợp đồng.
    await expect(contracts.create(nv1, request(linked.id))).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_CONVERTED' });
    await expect(conversion.convert(nv1, linked.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUOTE_LINKED_TO_CONTRACT',
      message: `Báo giá đã gắn vào hợp đồng ${contract.code}; lập đơn bán từ hợp đồng đó.`,
    });
    await expect(contracts.create(nv1, request(converted.id))).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_CONVERTED' });
    await expect(contracts.quotePreview(nv1, linked.id)).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_CONVERTED' });
    expect(await count(`SELECT count(*) AS n FROM crm_schema.contracts WHERE quote_id = $1`, [linked.id])).toBe(1);
    // Chuyển đổi lặp lại báo giá đã chuyển vẫn trả kết quả lần đầu.
    expect(await conversion.convert(nv1, converted.id)).toMatchObject({ created: false, contractId: result.contractId, orderId: result.orderId });
  });

  it('giá trị nhập tay được giữ; chưa chọn khách thì lấy khách của báo giá', async () => {
    const quote = await accept((await orderQuote()).id);
    const contract = await contracts.create(nv1, request(quote.id, { customerId: '', value: 12_000_000 }));
    expect(contract).toMatchObject({ customerId, value: 12_000_000, quoteId: quote.id });
  });

  it('gắn và chuyển cùng lúc một báo giá: đúng một đường thành công, một hợp đồng', async () => {
    const quote = await accept((await orderQuote()).id);
    const results = await Promise.allSettled([contracts.create(nv1, request(quote.id)), conversion.convert(nv1, quote.id)]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await count(`SELECT count(*) AS n FROM crm_schema.contracts WHERE quote_id = $1`, [quote.id])).toBe(1);
  });

  it('khác khách, chưa chấp nhận, ngoài phạm vi: bị từ chối, báo giá giữ nguyên', async () => {
    const quote = await accept((await orderQuote()).id);
    await expect(contracts.create(nv1, request(quote.id, { customerId: otherCustomerId }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUOTE_CUSTOMER_MISMATCH',
      message: expect.stringContaining('Công ty Gắn Báo Giá'),
    });
    expect((await quotes.get(nv1, quote.id)).convertedAt).toBeNull();
    expect(await count(`SELECT count(*) AS n FROM crm_schema.contracts WHERE quote_id = $1`, [quote.id])).toBe(0);

    const sent = await orderQuote();
    let current = await quotes.submit(nv1, sent.id, 1, { revision: sent.version.revision });
    current = await quotes.send(nv1, sent.id, 1, { revision: current.version.revision });
    expect(current.status).toBe('SENT');
    await expect(contracts.create(nv1, request(sent.id))).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_NOT_ACCEPTED' });
    await expect(contracts.quotePreview(nv1, sent.id)).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_NOT_ACCEPTED' });
    const linkable = await quotes.list(nv1, { contractLinkable: true, customerId, limit: 50 });
    expect(linkable.items.map((item) => item.id)).not.toContain(sent.id);

    // NV3 không thấy báo giá của NV1 (khác nhánh tổ chức): như không có.
    await expect(contracts.quotePreview(nv3, quote.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(contracts.create(nv3, request(quote.id))).rejects.toMatchObject({ statusCode: 404, message: 'Không tìm thấy báo giá.' });
    // Không có quyền hợp đồng.
    await expect(contracts.create(actor(NV1, { canWriteContract: false }), request(quote.id))).rejects.toMatchObject({ statusCode: 403 });
    expect((await quotes.get(nv1, quote.id)).convertedAt).toBeNull();
  });
});
