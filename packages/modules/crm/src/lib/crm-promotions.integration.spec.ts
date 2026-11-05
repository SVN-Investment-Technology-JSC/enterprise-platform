import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DocumentService } from './application/document.service.js';
import type { DocumentStorage } from './application/document-store.port.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { PriceListService } from './application/price-list.service.js';
import { PromotionService } from './application/promotion.service.js';
import { QuoteDocumentService } from './application/quote-document.service.js';
import { QuoteService } from './application/quote.service.js';
import type { ApprovalLinks } from './application/quote-store.port.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresDocumentStore } from './infrastructure/postgres-document.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { PostgresPriceListStore, PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresPromotionStore } from './infrastructure/postgres-promotion.store.js';
import { PostgresQuoteDocumentStore } from './infrastructure/postgres-quote-document.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
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
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

/** Kho giả: URL ký giả theo khoá object; `put` mô phỏng trình duyệt tải lên. */
class FakeStorage implements DocumentStorage {
  readonly objects = new Map<string, number>();
  async createUploadUrl(input: { key: string }) {
    return `http://storage.test/up/${input.key}`;
  }
  async createDownloadUrl(key: string) {
    return `http://storage.test/down/${key}`;
  }
  async objectSize(key: string) {
    return this.objects.get(key) ?? null;
  }
}

const noLinks: ApprovalLinks = { start: async () => undefined };

integration('Bán hàng GĐI: khuyến mãi của báo giá (P2I-11) và tài liệu có sẵn đính kèm báo giá (Q-P2-11) (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    canWriteQuote: true,
    canWriteDocument: true,
    ...extra,
  });
  const nv1 = actor(NV1);
  const nv3 = actor(NV3);
  const tn = actor(TN);
  const viewer = actor(NV1, { canWriteOpportunity: false, canWriteQuote: false, canWriteDocument: false });
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true, canWriteDocument: true, canDeleteDocument: true });

  let promotions: PromotionService;
  let quotes: QuoteService;
  let documents: DocumentService;
  let refs: QuoteDocumentService;
  let opportunities: OpportunityService;
  let storage: FakeStorage;
  let customerId: string;
  let foreignCustomerId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    storage = new FakeStorage();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const quoteStore = new PostgresQuoteStore(handle.database);
    const customers = new CustomerService(customerStore, scopes);
    opportunities = new OpportunityService(
      opportunityStore,
      customerStore,
      scopes,
      new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database)),
    );
    quotes = new QuoteService(
      quoteStore,
      new PostgresQuoteSettingsStore(handle.database),
      new PostgresPricingStore(handle.database),
      new FakeCatalog(),
      customerStore,
      opportunityStore,
      scopes,
      noLinks,
      { snapshot: async () => ORGANIZATION },
    );
    promotions = new PromotionService(new PostgresPromotionStore(handle.database), opportunityStore, quoteStore, scopes);
    const documentStore = new PostgresDocumentStore(handle.database);
    documents = new DocumentService(documentStore, storage, scopes);
    refs = new QuoteDocumentService(new PostgresQuoteDocumentStore(handle.database), documentStore, storage, scopes);

    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 }],
    });
    customerId = (await customers.create(nv1, { name: 'Công ty Khuyến Mãi', ownerUserId: NV1 })).id;
    foreignCustomerId = (await customers.create(nv3, { name: 'Công ty Của NV3', ownerUserId: NV3 })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const program = (code: string, extra: Record<string, unknown> = {}) =>
    promotions.createCatalog(admin, { kind: 'PROGRAM', code, name: `Chương trình ${code}`, discountType: 'PERCENT', value: 5, ...extra } as never);
  const policy = (code: string, extra: Record<string, unknown> = {}) =>
    promotions.createCatalog(admin, { kind: 'DISCOUNT_POLICY', code, name: `Chính sách ${code}`, discountType: 'AMOUNT', value: 1_000_000, ...extra } as never);

  async function quoteOf(opportunityId: string | undefined, owner = nv1) {
    const created = await quotes.create(owner, { customerId: owner === nv1 ? customerId : foreignCustomerId, ...(opportunityId ? { opportunityId } : {}) });
    return quotes.addLine(owner, created.id, created.currentVersion, { revision: created.version.revision, materialId: CAP, quantity: 10 });
  }

  const audit = async (id: string) =>
    (await handle.pool.query<{ action: string }>(`SELECT action FROM crm_schema.audit_log WHERE entity_id = $1 ORDER BY at, id`, [id])).rows.map((row) => row.action);

  // -------------------------------------------------------------------------------------------------------------
  // Danh mục
  // -------------------------------------------------------------------------------------------------------------

  it('danh mục: chỉ crm.manage ghi; mọi người đọc; kiểm dữ liệu; vô hiệu hoá thay vì xoá', async () => {
    const km = await program('km-tet', { validFrom: '2026-01-01', validTo: '2099-12-31' });
    expect(km).toMatchObject({ kind: 'PROGRAM', code: 'KM-TET', discountType: 'PERCENT', value: 5, active: true, effective: true });
    const ck = await policy('ck-vip');
    expect(ck).toMatchObject({ kind: 'DISCOUNT_POLICY', discountType: 'AMOUNT', value: 1_000_000 });

    await expect(promotions.createCatalog(nv1, { kind: 'PROGRAM', code: 'TROM', name: 'Trộm' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(promotions.updateCatalog(nv1, km.id, { name: 'Sửa trộm' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(program('KM-TET')).rejects.toMatchObject({ statusCode: 409, code: 'PROMOTION_CODE_EXISTS' });
    await expect(program('KM-SAI', { value: 150 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(program('KM-NGAY', { validFrom: '2026-05-01', validTo: '2026-04-01' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(promotions.createCatalog(admin, { code: 'KHONGLOAI', name: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(promotions.updateCatalog(admin, ck.id, { kind: 'PROGRAM' })).rejects.toMatchObject({ code: 'PROMOTION_KIND_LOCKED' });
    await expect(promotions.getCatalog(nv1, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
    await expect(promotions.getCatalog(nv1, 'khong-phai-uuid')).rejects.toMatchObject({ statusCode: 404 });

    // Mọi người có quyền xem CRM đọc được danh mục.
    expect((await promotions.listCatalog(viewer, {})).map((item) => item.code)).toEqual(expect.arrayContaining(['KM-TET', 'CK-VIP']));
    expect((await promotions.listCatalog(nv1, { kind: 'DISCOUNT_POLICY' })).every((item) => item.kind === 'DISCOUNT_POLICY')).toBe(true);
    await expect(promotions.listCatalog(nv1, { kind: 'XYZ' })).rejects.toMatchObject({ statusCode: 400 });

    // Vô hiệu hoá: ẩn khỏi danh sách mặc định, vẫn đọc được khi xin cả mục tắt.
    const off = await promotions.updateCatalog(admin, km.id, { active: false });
    expect(off).toMatchObject({ active: false, effective: false, code: 'KM-TET', value: 5 });
    expect((await promotions.listCatalog(nv1, {})).map((item) => item.code)).not.toContain('KM-TET');
    expect((await promotions.listCatalog(nv1, { includeInactive: 'true' })).map((item) => item.code)).toContain('KM-TET');
    expect(await audit(km.id)).toEqual(['create', 'deactivate']);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Dự án bán hàng
  // -------------------------------------------------------------------------------------------------------------

  it('dự án: chọn nhiều lựa chọn; chỉ mục đang bật và còn hiệu lực; quyền và phạm vi theo cơ hội', async () => {
    const opp = await opportunities.create(nv1, { customerId, name: 'Dự án khuyến mãi' });
    const a = await program('DA-A');
    const b = await policy('DA-B');
    const expired = await program('DA-HET', { validFrom: '2020-01-01', validTo: '2020-12-31' });
    const future = await program('DA-SAU', { validFrom: '2099-01-01', validTo: '2099-12-31' });
    const off = await program('DA-TAT');
    await promotions.updateCatalog(admin, off.id, { active: false });

    expect(await promotions.listForOpportunity(nv1, opp.id)).toEqual([]);
    let list = await promotions.addToOpportunity(nv1, opp.id, { catalogId: a.id, note: 'Tặng kèm cáp' });
    list = await promotions.addToOpportunity(nv1, opp.id, { catalogId: b.id });
    expect(list.map((item) => item.catalog.code)).toEqual(['DA-A', 'DA-B']);
    expect(list[0]).toMatchObject({ opportunityId: opp.id, note: 'Tặng kèm cáp', catalog: { kind: 'PROGRAM', effective: true } });
    expect(list[1].catalog.kind).toBe('DISCOUNT_POLICY');

    await expect(promotions.addToOpportunity(nv1, opp.id, { catalogId: a.id })).rejects.toMatchObject({ statusCode: 409, code: 'PROMOTION_EXISTS' });
    await expect(promotions.addToOpportunity(nv1, opp.id, { catalogId: expired.id })).rejects.toMatchObject({ statusCode: 409, code: 'PROMOTION_NOT_EFFECTIVE' });
    await expect(promotions.addToOpportunity(nv1, opp.id, { catalogId: future.id })).rejects.toMatchObject({ code: 'PROMOTION_NOT_EFFECTIVE' });
    await expect(promotions.addToOpportunity(nv1, opp.id, { catalogId: off.id })).rejects.toMatchObject({ code: 'PROMOTION_NOT_EFFECTIVE' });
    await expect(promotions.addToOpportunity(nv1, opp.id, { catalogId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    await expect(promotions.addToOpportunity(nv1, opp.id, { catalogId: 'x' })).rejects.toMatchObject({ statusCode: 400 });

    // Quyền: thiếu crm.opportunity.write thì 403; ngoài phạm vi (người khác không liên quan) thì 404 cả đọc lẫn ghi.
    await expect(promotions.addToOpportunity(viewer, opp.id, { catalogId: a.id })).rejects.toMatchObject({ statusCode: 403 });
    await expect(promotions.listForOpportunity(nv3, opp.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(promotions.addToOpportunity(nv3, opp.id, { catalogId: a.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(promotions.removeFromOpportunity(nv3, opp.id, list[0].id)).rejects.toMatchObject({ statusCode: 404 });
    // Người xem được dự án nhưng không ghi (chỉ đọc) vẫn xem được danh sách.
    expect(await promotions.listForOpportunity(viewer, opp.id)).toHaveLength(2);
    // Cấp trên trong phạm vi chọn được.
    const more = await policy('DA-C');
    expect((await promotions.addToOpportunity(tn, opp.id, { catalogId: more.id })).map((item) => item.catalog.code)).toContain('DA-C');

    // Bỏ chọn.
    await expect(promotions.removeFromOpportunity(nv1, opp.id, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
    list = await promotions.removeFromOpportunity(nv1, opp.id, list[1].id);
    expect(list.map((item) => item.catalog.code)).toEqual(['DA-A', 'DA-C']);
    expect(await audit(opp.id)).toEqual(expect.arrayContaining(['promotion-add', 'promotion-remove']));
  });

  // -------------------------------------------------------------------------------------------------------------
  // Báo giá
  // -------------------------------------------------------------------------------------------------------------

  it('báo giá: chọn nhiều khuyến mãi từ tập của dự án, chụp lại trên phiên bản, không đổi tổng', async () => {
    const opp = await opportunities.create(nv1, { customerId, name: 'Dự án báo giá khuyến mãi' });
    const otherOpp = await opportunities.create(nv1, { customerId, name: 'Dự án khác' });
    const a = await program('BG-A', { value: 10 });
    const b = await policy('BG-B', { value: 2_000_000 });
    const c = await program('BG-C');
    await promotions.addToOpportunity(nv1, opp.id, { catalogId: a.id });
    await promotions.addToOpportunity(nv1, opp.id, { catalogId: b.id });
    await promotions.addToOpportunity(nv1, otherOpp.id, { catalogId: c.id });

    const quote = await quoteOf(opp.id);
    expect(quote.version.promotions).toEqual([]);
    const totalsBefore = quote.version.totals;

    const saved = await promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [a.id, b.id], revision: quote.version.revision });
    expect(saved.promotions).toEqual([
      { catalogId: a.id, kind: 'PROGRAM', code: 'BG-A', name: 'Chương trình BG-A', discountType: 'PERCENT', value: 10 },
      { catalogId: b.id, kind: 'DISCOUNT_POLICY', code: 'BG-B', name: 'Chính sách BG-B', discountType: 'AMOUNT', value: 2_000_000 },
    ]);
    expect(saved.revision).toBe(quote.version.revision + 1);
    const loaded = await quotes.get(nv1, quote.id);
    expect(loaded.version.promotions).toEqual(saved.promotions);
    expect(loaded.version.totals).toEqual(totalsBefore);
    expect(loaded.version.revision).toBe(saved.revision);

    // Khoá lạc quan.
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [a.id], revision: quote.version.revision })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_VERSION' });
    // Chỉ chọn từ tập của dự án; trùng, sai dạng bị chặn.
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [c.id], revision: saved.revision })).rejects.toMatchObject({ statusCode: 400, code: 'PROMOTION_NOT_IN_OPPORTUNITY' });
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [a.id, a.id], revision: saved.revision })).rejects.toMatchObject({ code: 'PROMOTIONS_DUPLICATE' });
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: ['x'], revision: saved.revision })).rejects.toMatchObject({ statusCode: 400 });
    // Quyền và phạm vi.
    await expect(promotions.saveForQuote(viewer, quote.id, 1, { catalogIds: [], revision: saved.revision })).rejects.toMatchObject({ statusCode: 403 });
    await expect(promotions.saveForQuote(nv3, quote.id, 1, { catalogIds: [], revision: saved.revision })).rejects.toMatchObject({ statusCode: 404 });
    await expect(promotions.saveForQuote(nv1, quote.id, 7, { catalogIds: [], revision: saved.revision })).rejects.toMatchObject({ statusCode: 404 });

    // Đổi danh mục sau đó không đụng ảnh chụp; mục hết hiệu lực vẫn giữ nếu đã áp từ trước, nhưng không thêm mới được.
    await promotions.updateCatalog(admin, a.id, { value: 99, name: 'Tên đã đổi', active: false });
    expect((await quotes.get(nv1, quote.id)).version.promotions[0]).toMatchObject({ name: 'Chương trình BG-A', value: 10 });
    const kept = await promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [b.id, a.id], revision: saved.revision });
    expect(kept.promotions.map((item) => item.code)).toEqual(['BG-B', 'BG-A']);
    expect(kept.promotions[1].value).toBe(10);
    const stale = await program('BG-D', { validFrom: '2020-01-01', validTo: '2020-02-01' });
    await handle.pool.query(`INSERT INTO crm_schema.opportunity_promotions (opportunity_id, catalog_id) VALUES ($1, $2)`, [opp.id, stale.id]);
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [b.id, stale.id], revision: kept.revision })).rejects.toMatchObject({ code: 'PROMOTION_NOT_EFFECTIVE' });
    // Bỏ hết.
    expect((await promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [], revision: kept.revision })).promotions).toEqual([]);
    expect(await audit(quote.id)).toEqual(expect.arrayContaining(['promotions-set']));
  });

  it('báo giá: không có dự án thì không chọn được; đã gửi duyệt thì khoá; phiên bản mới chép theo; phiên bản cũ chỉ đọc', async () => {
    const opp = await opportunities.create(nv1, { customerId, name: 'Dự án khoá phiên bản' });
    const a = await program('KH-A');
    await promotions.addToOpportunity(nv1, opp.id, { catalogId: a.id });

    const loose = await quoteOf(undefined);
    await expect(promotions.saveForQuote(nv1, loose.id, 1, { catalogIds: [a.id], revision: loose.version.revision })).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_NO_OPPORTUNITY' });
    expect((await promotions.saveForQuote(nv1, loose.id, 1, { catalogIds: [], revision: loose.version.revision })).promotions).toEqual([]);

    const quote = await quoteOf(opp.id);
    const saved = await promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [a.id], revision: quote.version.revision });
    let current = await quotes.get(nv1, quote.id);
    current = await quotes.submit(nv1, quote.id, 1, { revision: current.version.revision });
    expect(current.status).toBe('APPROVED');
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [], revision: current.version.revision })).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_PROMOTIONS_LOCKED' });
    expect((await quotes.get(nv1, quote.id)).version.promotions).toEqual(saved.promotions);

    // Sinh phiên bản mới: khuyến mãi chép theo; phiên bản cũ thành chỉ đọc.
    const revised = await quotes.revise(nv1, quote.id, 1, { revision: current.version.revision });
    expect(revised.currentVersion).toBe(2);
    expect(revised.version.promotions).toEqual(saved.promotions);
    expect((await quotes.get(nv1, quote.id, 1)).version.promotions).toEqual(saved.promotions);
    await expect(promotions.saveForQuote(nv1, quote.id, 1, { catalogIds: [], revision: 99 })).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_VERSION_READ_ONLY' });
    const second = await promotions.saveForQuote(nv1, quote.id, 2, { catalogIds: [], revision: revised.version.revision });
    expect(second.promotions).toEqual([]);
    expect((await quotes.get(nv1, quote.id, 1)).version.promotions).toEqual(saved.promotions);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Tài liệu có sẵn đính kèm báo giá
  // -------------------------------------------------------------------------------------------------------------

  async function uploaded(by: CrmActor, entityType: 'customer' | 'opportunity' | 'quote' | 'contract', entityId: string, name: string, finish = true) {
    const created = await documents.create(by, { entityType, entityId, name, fileName: `${name}.pdf`, contentType: 'application/pdf', sizeBytes: 500 });
    if (finish) {
      storage.objects.set(storage_key(created.uploadUrl), 500);
      await documents.completeUpload(by, created.document.id, created.version.id, { sizeBytes: 500 });
    }
    return created.document;
  }
  const storage_key = (url: string) => url.replace('http://storage.test/up/', '');

  it('tài liệu đính kèm: chọn từ khách, dự án, báo giá cùng dự án; kiểm quyền và phạm vi; không nhân bản file', async () => {
    const opp = await opportunities.create(nv1, { customerId, name: 'Dự án tài liệu đính kèm' });
    const quote = await quoteOf(opp.id);
    const sibling = await quoteOf(opp.id);
    const plain = await quoteOf(undefined);

    const docCustomer = await uploaded(nv1, 'customer', customerId, 'giay-phep-kd');
    const docOpp = await uploaded(nv1, 'opportunity', opp.id, 'ho-so-thau');
    const docSibling = await uploaded(nv1, 'quote', sibling.id, 'bao-gia-cu');
    const docOwn = await uploaded(nv1, 'quote', quote.id, 'tai-lieu-cua-bao-gia');
    const docPending = await uploaded(nv1, 'customer', customerId, 'chua-tai-xong', false);

    // Tài liệu ngoài nguồn cho phép và nguồn ngoài phạm vi: hợp đồng, báo giá cùng dự án của người khác, khách của người khác.
    const contract = await handle.pool.query<{ id: string }>(
      `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, owner_user_id)
       VALUES ('HD-DOC', 'SALE', $1, 'Hợp đồng thử', '2026-01-01', $2) RETURNING id`,
      [customerId, NV1],
    );
    const hidden = await handle.pool.query<{ id: string }>(
      `INSERT INTO crm_schema.quotes (code, opportunity_id, customer_id, owner_user_id) VALUES ('BG2600888', $1, $2, $3) RETURNING id`,
      [opp.id, foreignCustomerId, NV3],
    );
    const docHidden = await uploaded(admin, 'quote', hidden.rows[0].id, 'bao-gia-cua-nv3');
    const docForeignCustomer = await uploaded(admin, 'customer', foreignCustomerId, 'khach-nguoi-khac');

    const candidates = await refs.candidates(nv1, quote.id, {});
    const names = candidates.map((candidate) => candidate.document.name).sort();
    expect(names).toEqual(['bao-gia-cu', 'giay-phep-kd', 'ho-so-thau']);
    expect(candidates.find((candidate) => candidate.document.id === docCustomer.id)?.source).toMatchObject({ entityType: 'customer', entityId: customerId, label: 'Công ty Khuyến Mãi' });
    expect(candidates.every((candidate) => candidate.attached === false)).toBe(true);
    expect((await refs.candidates(nv1, quote.id, { sourceType: 'opportunity' })).map((candidate) => candidate.document.name)).toEqual(['ho-so-thau']);
    expect((await refs.candidates(nv1, quote.id, { search: 'PHEP' })).map((candidate) => candidate.document.name)).toEqual(['giay-phep-kd']);
    await expect(refs.candidates(nv1, quote.id, { sourceType: 'contract' as never })).rejects.toMatchObject({ statusCode: 400 });
    // Báo giá ngoài phạm vi: 404; báo giá không dự án chỉ có nguồn khách.
    await expect(refs.candidates(nv3, quote.id, {})).rejects.toMatchObject({ statusCode: 404 });
    expect((await refs.candidates(nv1, plain.id, {})).map((candidate) => candidate.document.name)).toEqual(['giay-phep-kd']);

    // Quyền ghi tài liệu ở báo giá đích.
    await expect(refs.add(viewer, quote.id, { documentId: docCustomer.id })).rejects.toMatchObject({ statusCode: 403 });
    await expect(refs.add(nv3, quote.id, { documentId: docCustomer.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(refs.add(nv1, quote.id, { documentId: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(refs.add(nv1, quote.id, { documentId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    // Không lộ tài liệu ngoài phạm vi: 404 như không có.
    await expect(refs.add(nv1, quote.id, { documentId: docHidden.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(refs.add(nv1, quote.id, { documentId: docForeignCustomer.id })).rejects.toMatchObject({ statusCode: 404 });
    // Tài liệu của chính báo giá, tài liệu chưa tải xong.
    await expect(refs.add(nv1, quote.id, { documentId: docOwn.id })).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_ALREADY_ON_QUOTE' });
    await expect(refs.add(nv1, quote.id, { documentId: docPending.id })).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_NOT_READY' });
    const docContract = await uploaded(nv1, 'contract', contract.rows[0].id, 'hop-dong');
    await expect(refs.add(nv1, quote.id, { documentId: docContract.id })).rejects.toMatchObject({ statusCode: 404 });

    const versionsBefore = Number((await handle.pool.query(`SELECT count(*) AS n FROM crm_schema.document_versions`)).rows[0].n);
    const documentsBefore = Number((await handle.pool.query(`SELECT count(*) AS n FROM crm_schema.documents`)).rows[0].n);
    let attached = await refs.add(nv1, quote.id, { documentId: docCustomer.id });
    attached = await refs.add(nv1, quote.id, { documentId: docOpp.id });
    attached = await refs.add(nv1, quote.id, { documentId: docSibling.id });
    expect(attached.map((reference) => reference.document.name)).toEqual(['giay-phep-kd', 'ho-so-thau', 'bao-gia-cu']);
    expect(attached[2].source).toMatchObject({ entityType: 'quote', entityId: sibling.id, label: expect.stringMatching(/^BG/) });
    await expect(refs.add(nv1, quote.id, { documentId: docCustomer.id })).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_REFERENCE_EXISTS' });
    // Không nhân bản: không thêm tài liệu hay phiên bản nào.
    expect(Number((await handle.pool.query(`SELECT count(*) AS n FROM crm_schema.document_versions`)).rows[0].n)).toBe(versionsBefore);
    expect(Number((await handle.pool.query(`SELECT count(*) AS n FROM crm_schema.documents`)).rows[0].n)).toBe(documentsBefore);
    expect((await refs.candidates(nv1, quote.id, {})).filter((candidate) => candidate.attached)).toHaveLength(3);
    expect(await audit(quote.id)).toEqual(expect.arrayContaining(['document-ref-add']));

    // Đọc: ai đọc được báo giá xem được danh sách; người ngoài phạm vi 404.
    expect(await refs.list(viewer, quote.id)).toHaveLength(3);
    await expect(refs.list(nv3, quote.id)).rejects.toMatchObject({ statusCode: 404 });

    // Tải xuống: URL ký theo object của tài liệu nguồn.
    const ticket = await refs.download(nv1, quote.id, attached[0].id);
    expect(ticket).toMatchObject({ fileName: 'giay-phep-kd.pdf', contentType: 'application/pdf', versionNo: 1, expiresInSeconds: 300 });
    const sourceKey = (await handle.pool.query<{ object_key: string }>(`SELECT object_key FROM crm_schema.document_versions WHERE document_id = $1`, [docCustomer.id])).rows[0].object_key;
    expect(ticket.downloadUrl).toBe(`http://storage.test/down/${sourceKey}`);
    await expect(refs.download(nv3, quote.id, attached[0].id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(refs.download(nv1, plain.id, attached[0].id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(refs.download(nv1, quote.id, randomUUID())).rejects.toMatchObject({ statusCode: 404 });

    // Bỏ đính kèm chỉ xoá liên kết, tài liệu nguồn còn nguyên.
    await expect(refs.remove(viewer, quote.id, attached[0].id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(refs.remove(nv1, quote.id, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
    const after = await refs.remove(nv1, quote.id, attached[0].id);
    expect(after.map((reference) => reference.document.name)).toEqual(['ho-so-thau', 'bao-gia-cu']);
    expect(await documents.get(nv1, docCustomer.id)).toMatchObject({ name: 'giay-phep-kd' });

    // Xoá tài liệu nguồn thì liên kết mất theo.
    await documents.remove(admin, docOpp.id);
    expect((await refs.list(nv1, quote.id)).map((reference) => reference.document.name)).toEqual(['bao-gia-cu']);
  });
});
