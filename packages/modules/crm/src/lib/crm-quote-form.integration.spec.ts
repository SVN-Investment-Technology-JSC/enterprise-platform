import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteFormService } from './application/quote-form.service.js';
import type { ApprovalLinks } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteFormStore } from './infrastructure/postgres-quote-form.store.js';
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

/** Danh mục Kho giả: một mặt hàng tồn, giá 1.000.000 trong bảng giá chuẩn, chính sách chiết khấu 3%. */
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

const noLinks: ApprovalLinks = { start: async () => undefined };

integration('Bán hàng GĐI: báo giá theo mẫu, mã báo giá, chiết khấu, thuế, phí (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    canWriteQuote: true,
    ...extra,
  });
  const nv1 = actor(NV1);
  const nv3 = actor(NV3);
  const tn = actor(TN, { canApproveQuote: true });
  const viewer = actor(randomUUID(), { canWriteQuote: false });
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true });

  let quotes: QuoteService;
  /** Dịch vụ không có kho mẫu: hành vi như phase 1, đối chứng cho TC-QF-16. */
  let phase1Quotes: QuoteService;
  let form: QuoteFormService;
  let customerId: string;
  let lineTemplateId: string;
  let orderTemplateId: string;
  let defaultTypeId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const customers = new CustomerService(customerStore, scopes);
    const settingsStore = new PostgresQuoteSettingsStore(handle.database);
    const formStore = new PostgresQuoteFormStore(handle.database);
    const build = (withForm: boolean) =>
      new QuoteService(
        new PostgresQuoteStore(handle.database),
        settingsStore,
        new PostgresPricingStore(handle.database),
        new FakeCatalog(),
        customerStore,
        opportunityStore,
        scopes,
        noLinks,
        { snapshot: async () => ORGANIZATION },
        undefined,
        undefined,
        withForm ? formStore : undefined,
      );
    quotes = build(true);
    phase1Quotes = build(false);
    form = new QuoteFormService(formStore);

    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 }],
    });
    await new DiscountPolicyService(new PostgresDiscountPolicyStore(handle.database)).create(admin, {
      code: 'CK-CAP-3',
      name: 'Cáp 3%',
      percent: 3,
      validFrom: '2026-01-01',
      appliesToAllCustomers: true,
      rules: [{ criterion: 'MATERIAL', refId: CAP, refText: 'QA-KHO-CAP' }],
    });
    customerId = (await customers.create(nv1, { name: 'Công ty Mẫu Báo Giá', ownerUserId: NV1 })).id;
    const templates = await form.listTemplates(nv1, false);
    lineTemplateId = templates.find((template) => template.isDefault)?.id as string;
    orderTemplateId = templates.find((template) => template.discountMode === 'ORDER')?.id as string;
    defaultTypeId = (await form.listTypes(nv1, false)).find((type) => type.isDefault)?.id as string;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  async function draft(service: QuoteService, extra: Record<string, unknown> = {}, quantity = 10) {
    const created = await service.create(nv1, { customerId, ...extra });
    return service.addLine(nv1, created.id, created.currentVersion, {
      revision: created.version.revision,
      materialId: CAP,
      quantity,
    });
  }

  it('migration 0028 đến 0030: bộ mẫu và loại mặc định nạp sẵn; báo giá cũ giữ nguyên, không bắt buộc mẫu', async () => {
    const templates = await form.listTemplates(nv1, false);
    expect(templates).toEqual([
      expect.objectContaining({ name: 'Báo giá theo dòng (mặc định)', discountMode: 'LINE', taxMode: 'LINE', isDefault: true, active: true }),
      expect.objectContaining({ name: 'Chiết khấu trên tổng giá trị đơn hàng', discountMode: 'ORDER', taxMode: 'ORDER', isDefault: false }),
    ]);
    expect(await form.listTypes(nv1, false)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Báo đơn giá và số lượng', isDefault: true })]),
    );
    // Báo giá của phase 1: chèn bằng các cột cũ, không đụng cột mới.
    const old = await handle.pool.query<{ id: string }>(
      `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id) VALUES ('BG2600001', $1, $2) RETURNING id`,
      [customerId, NV1],
    );
    await handle.pool.query(`INSERT INTO crm_schema.quote_versions (quote_id, version_no) VALUES ($1, 1)`, [old.rows[0].id]);
    const loaded = await quotes.get(nv1, old.rows[0].id);
    expect(loaded.version.form).toMatchObject({
      templateId: null,
      quoteTypeId: null,
      quoteName: null,
      discountMode: 'LINE',
      taxMode: 'LINE',
      fees: [],
      feesAmount: 0,
      orderDiscount: { percent: 0, amount: 0, inputKind: null },
    });
    // Sửa báo giá cũ mà không chọn mẫu hay loại: không bị bắt buộc.
    const edited = await quotes.addLine(nv1, old.rows[0].id, 1, { revision: loaded.version.revision, materialId: CAP, quantity: 1 });
    expect(edited.version.totals.totalAmount).toBe(1_067_000);
    expect(edited.version.form.templateId).toBeNull();
    await expect(
      quotes.updateVersion(nv1, old.rows[0].id, 1, { revision: edited.version.revision, templateId: null, quoteTypeId: null }),
    ).resolves.toBeDefined();
    const columns = await handle.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'crm_schema' AND table_name = 'quote_versions' AND column_name = 'custom_fields'`,
    );
    expect(columns.rows).toHaveLength(1);
  });

  it('TC-QF-16: báo giá lập từ mẫu mặc định cho đúng kết quả giá của phase 1', async () => {
    const withTemplate = await draft(quotes);
    const phase1 = await draft(phase1Quotes);
    expect(withTemplate.version.form).toMatchObject({ templateId: lineTemplateId, discountMode: 'LINE', taxMode: 'LINE', quoteTypeId: defaultTypeId });
    expect(withTemplate.version.form.quoteName).toBe(`Báo giá ${withTemplate.code}`);
    // Cùng số như TC-QUO-01 của phase 1: cáp 10 x 1.000.000, chiết khấu chính sách 3%, VAT 10%.
    expect(withTemplate.version.totals).toMatchObject({ grossAmount: 10_000_000, discountAmount: 300_000, netAmount: 9_700_000, vatAmount: 970_000, totalAmount: 10_670_000 });
    expect(withTemplate.version.totals).toEqual(phase1.version.totals);
    expect(withTemplate.version.lines[0]).toMatchObject({ discountPercent: 3, vatRate: 10, lineAmount: 9_700_000, vatAmount: 970_000, lineTotal: 10_670_000 });
    // Dịch vụ dựng như phase 1 (không kho mẫu) vẫn nhận mẫu mặc định từ DB, cho cùng chế độ theo dòng.
    expect(phase1.version.form).toMatchObject({ templateId: lineTemplateId, discountMode: 'LINE', taxMode: 'LINE' });
  });

  it('TC-QF-04: mẫu chiết khấu trên tổng đơn bỏ chiết khấu và VAT theo dòng, áp ở tổng đơn, không tính trùng', async () => {
    const created = await draft(quotes, { templateId: orderTemplateId });
    expect(created.version.form).toMatchObject({ templateId: orderTemplateId, discountMode: 'ORDER', taxMode: 'ORDER' });
    // Chưa nhập chiết khấu và thuế tổng đơn: chính sách 3% và VAT 10% theo dòng đều không áp.
    expect(created.version.lines[0]).toMatchObject({ discountPercent: 0, vatRate: 0, vatAmount: 0, lineAmount: 10_000_000, appliedPolicies: [] });
    expect(created.version.totals).toMatchObject({ discountAmount: 0, netAmount: 10_000_000, vatAmount: 0, totalAmount: 10_000_000 });

    const priced = await quotes.updateVersion(nv1, created.id, 1, {
      revision: created.version.revision,
      orderDiscount: { percent: 5 },
      orderTax: { percent: 8 },
    });
    expect(priced.version.form.orderDiscount).toEqual({ percent: 5, amount: 500_000, inputKind: 'PERCENT' });
    expect(priced.version.form.orderTax).toEqual({ percent: 8, amount: 760_000, inputKind: 'PERCENT' });
    expect(priced.version.totals).toMatchObject({ grossAmount: 10_000_000, discountAmount: 500_000, netAmount: 9_500_000, vatAmount: 760_000, totalAmount: 10_260_000 });
    // Tải lại từ DB cho cùng kết quả (cột đã lưu).
    expect((await quotes.get(nv1, created.id)).version.totals.totalAmount).toBe(10_260_000);

    // Nhập số tiền thay vì phần trăm: phần trăm tính ngược, loại trừ nhau.
    const byAmount = await quotes.updateVersion(nv1, created.id, 1, {
      revision: priced.version.revision,
      orderDiscount: { amount: 500_000 },
      orderTax: { amount: 760_000 },
    });
    expect(byAmount.version.form.orderDiscount).toEqual({ percent: 5, amount: 500_000, inputKind: 'AMOUNT' });
    expect(byAmount.version.form.orderTax).toEqual({ percent: 8, amount: 760_000, inputKind: 'AMOUNT' });
    expect(byAmount.version.totals.totalAmount).toBe(10_260_000);
    await expect(
      quotes.updateVersion(nv1, created.id, 1, {
        revision: byAmount.version.revision,
        orderDiscount: { percent: 5, amount: 500_000 },
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'ORDER_AMOUNT_CONFLICT', message: expect.stringContaining('không nhập cả hai') });
    // Thêm dòng thì phần trăm tính lại trên tổng mới, số tiền giữ nguyên.
    const more = await quotes.addLine(nv1, created.id, 1, { revision: byAmount.version.revision, materialId: CAP, quantity: 10 });
    expect(more.version.form.orderDiscount).toMatchObject({ amount: 500_000, percent: 2.5, inputKind: 'AMOUNT' });
    // Mẫu theo dòng không nhận chiết khấu tổng đơn.
    const lineQuote = await draft(quotes);
    await expect(
      quotes.updateVersion(nv1, lineQuote.id, 1, { revision: lineQuote.version.revision, orderDiscount: { percent: 5 } }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'ORDER_DISCOUNT_NOT_ALLOWED' });
    await expect(
      quotes.updateVersion(nv1, created.id, 1, { revision: more.version.revision, orderDiscount: { amount: 99_999_999 } }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DISCOUNT_EXCEEDS_TOTAL' });
  });

  it('đổi mẫu: chế độ theo mẫu mới; về mẫu theo dòng thì xoá chiết khấu, thuế tổng đơn; mẫu đã tắt không chọn được', async () => {
    const created = await draft(quotes, { templateId: orderTemplateId });
    const priced = await quotes.updateVersion(nv1, created.id, 1, {
      revision: created.version.revision,
      orderDiscount: { percent: 10 },
      orderTax: { percent: 10 },
    });
    expect(priced.version.totals.totalAmount).toBe(9_900_000);
    const switched = await quotes.updateVersion(nv1, created.id, 1, { revision: priced.version.revision, templateId: lineTemplateId });
    expect(switched.version.form).toMatchObject({
      templateId: lineTemplateId,
      discountMode: 'LINE',
      taxMode: 'LINE',
      orderDiscount: { amount: 0, inputKind: null },
      orderTax: { amount: 0, inputKind: null },
    });
    expect(switched.version.totals).toMatchObject({ discountAmount: 300_000, vatAmount: 970_000, totalAmount: 10_670_000 });
    await expect(
      quotes.updateVersion(nv1, created.id, 1, { revision: switched.version.revision, templateId: null }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'TEMPLATE_REQUIRED', message: 'Vui lòng chọn mẫu báo giá.' });
    await expect(
      quotes.updateVersion(nv1, created.id, 1, { revision: switched.version.revision, quoteTypeId: null }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'QUOTE_TYPE_REQUIRED' });
  });

  it('TC-QF-09: phí trên hợp đồng nhiều khoản, thêm, sửa, xoá; cộng sau thuế', async () => {
    const created = await draft(quotes);
    const base = created.version.totals.totalAmount;
    const two = await quotes.updateVersion(nv1, created.id, 1, {
      revision: created.version.revision,
      fees: [
        { feeType: 'Vận chuyển', amount: 300_000 },
        { feeType: 'Lắp đặt', amount: 150_000 },
      ],
    });
    expect(two.version.form.fees).toEqual([
      { feeType: 'Vận chuyển', amount: 300_000 },
      { feeType: 'Lắp đặt', amount: 150_000 },
    ]);
    expect(two.version.form.feesAmount).toBe(450_000);
    expect(two.version.totals).toMatchObject({ vatAmount: 970_000, netAmount: 9_700_000, totalAmount: base + 450_000 });
    const edited = await quotes.updateVersion(nv1, created.id, 1, {
      revision: two.version.revision,
      fees: [{ feeType: 'Vận chuyển', amount: 350_000 }],
    });
    expect(edited.version.totals.totalAmount).toBe(base + 350_000);
    const cleared = await quotes.updateVersion(nv1, created.id, 1, { revision: edited.version.revision, fees: [] });
    expect(cleared.version.form.fees).toEqual([]);
    expect(cleared.version.totals.totalAmount).toBe(base);
    const rows = await handle.pool.query(`SELECT count(*)::int AS n FROM crm_schema.quote_fees f JOIN crm_schema.quote_versions v ON v.id = f.version_id WHERE v.quote_id = $1`, [created.id]);
    expect(rows.rows[0].n).toBe(0);
    await expect(
      quotes.updateVersion(nv1, created.id, 1, { revision: cleared.version.revision, fees: [{ feeType: '', amount: 1 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      quotes.updateVersion(nv1, created.id, 1, { revision: cleared.version.revision, fees: [{ feeType: 'Âm', amount: -5 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('TC-QF-15 (nền): báo giá đã gửi sửa trường mới thì sinh phiên bản mới, chép trường tuỳ biến, tính lại giá', async () => {
    const created = await draft(quotes, { templateId: orderTemplateId });
    await handle.pool.query(
      `UPDATE crm_schema.quote_versions SET custom_fields = '{"phong-ban": "Kỹ thuật"}'::jsonb WHERE quote_id = $1`,
      [created.id],
    );
    let current = await quotes.updateVersion(nv1, created.id, 1, { revision: created.version.revision, orderDiscount: { percent: 5 }, fees: [{ feeType: 'Lắp đặt', amount: 100_000 }] });
    current = await quotes.submit(nv1, created.id, 1, { revision: current.version.revision });
    current = await quotes.send(nv1, created.id, 1, { revision: current.version.revision });
    expect(current.status).toBe('SENT');
    const v2 = await quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, orderDiscount: { percent: 10 } });
    expect(v2).toMatchObject({ currentVersion: 2, status: 'DRAFT' });
    expect(v2.version.form).toMatchObject({ discountMode: 'ORDER', fees: [{ feeType: 'Lắp đặt', amount: 100_000 }], orderDiscount: { percent: 10, amount: 1_000_000 } });
    expect(v2.version.totals.totalAmount).toBe(9_000_000 + 0 + 100_000);
    const v1 = await quotes.get(nv1, created.id, '1');
    expect(v1.version.form.orderDiscount.percent).toBe(5);
    expect(v1.version.status).toBe('SUPERSEDED');
    const custom = await handle.pool.query<{ version_no: number; custom_fields: Record<string, string> }>(
      `SELECT version_no, custom_fields FROM crm_schema.quote_versions WHERE quote_id = $1 ORDER BY version_no`,
      [created.id],
    );
    expect(custom.rows.map((row) => row.custom_fields)).toEqual([{ 'phong-ban': 'Kỹ thuật' }, { 'phong-ban': 'Kỹ thuật' }]);
  });

  it('TC-QF-02/03: mã báo giá mặc định giữ dạng BG<yy>; mẫu mã cấu hình, sinh lại lấy số kế tiếp, trùng mã bị 409', async () => {
    // Chưa cấu hình mẫu: mã mới vẫn là BG<yy><5 chữ số> từ quote_code_seq; mã cũ vẫn hợp lệ.
    expect(await form.codeSettings(nv1)).toMatchObject({ pattern: null });
    const legacy = await quotes.create(nv1, { customerId });
    expect(legacy.code).toMatch(/^BG\d{7}$/);
    const typed = await quotes.create(nv1, { customerId, code: 'BG2699999' });
    expect(typed.code).toBe('BG2699999');

    await expect(form.saveCodeSettings(nv1, { pattern: '{yyyymmdd}/BG//{seq}' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(form.saveCodeSettings(admin, { pattern: 'BG-{yy}' })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_QUOTE_CODE_PATTERN' });
    const saved = await form.saveCodeSettings(admin, { pattern: '{yyyymmdd}/BG//{seq}' });
    expect(saved.pattern).toBe('{yyyymmdd}/BG//{seq}');
    expect(saved.example).toMatch(/^\d{8}\/BG\/\/1$/);

    const first = (await form.generateCode(nv1)).code;
    const second = (await form.generateCode(nv1)).code;
    expect(first).toMatch(/^\d{8}\/BG\/\/\d+$/);
    const number = (code: string) => Number(code.split('//')[1]);
    expect(number(second)).toBe(number(first) + 1);
    expect(first.split('/BG//')[0]).toBe(second.split('/BG//')[0]);

    const created = await quotes.create(nv1, { customerId });
    expect(created.code).toMatch(/^\d{8}\/BG\/\/\d+$/);
    expect(number(created.code)).toBe(number(second) + 1);
    // Dùng mã đã sinh cho báo giá mới; dùng lại lần hai bị từ chối.
    const usingGenerated = await quotes.create(nv1, { customerId, code: first });
    expect(usingGenerated.code).toBe(first);
    await expect(quotes.create(nv1, { customerId, code: first })).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUOTE_CODE_EXISTS',
      message: 'Mã báo giá đã tồn tại. Vui lòng nhập mã khác hoặc bấm sinh lại.',
    });
    await expect(quotes.create(nv1, { customerId, code: 'BG2699999' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(quotes.create(nv1, { customerId, code: 'mã có dấu' })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_QUOTE_CODE' });
    // Sinh lại trong lúc có mã trùng nhập tay: số kế tiếp trùng một mã đã có thì bỏ qua.
    const next = number((await form.generateCode(nv1)).code);
    const day = first.split('/BG//')[0];
    await quotes.create(nv1, { customerId, code: `${day}/BG//${next + 1}` });
    expect(number((await form.generateCode(nv1)).code)).toBe(next + 2);

    // Đổi mã khi Nháp: trùng 409, không trùng được; ghi nhật ký.
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: created.version.revision, code: first })).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUOTE_CODE_EXISTS',
    });
    const renamed = await quotes.updateVersion(nv1, created.id, 1, { revision: created.version.revision, code: `${day}/BG//5000` });
    expect(renamed.code).toBe(`${day}/BG//5000`);
    expect(renamed.history.map((entry) => entry.action)).toContain('change-code');
    // Giữ nguyên mã của chính mình không bị coi là trùng.
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: renamed.version.revision, code: renamed.code })).resolves.toBeDefined();
    // Người không có quyền lập báo giá không sinh mã được.
    await expect(form.generateCode(viewer)).rejects.toMatchObject({ statusCode: 403 });

    // Bỏ mẫu: trở về mã cũ, quote_code_seq không bị phá (số kế tiếp liền sau số đã dùng).
    await form.saveCodeSettings(admin, { pattern: null });
    const back = await quotes.create(nv1, { customerId });
    expect(Number(back.code.slice(4))).toBe(Number(legacy.code.slice(4)) + 1);
  });

  it('TC-QF-05: cài đặt mẫu và loại báo giá: thêm, sửa, tắt; chỉ crm.manage; bộ mặc định; nhật ký', async () => {
    await expect(
      form.createTemplate(nv1, { name: 'Mẫu của NV', discountMode: 'LINE', taxMode: 'LINE' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(form.createType(nv1, { name: 'Loại của NV' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(form.createTemplate(admin, { name: 'Thiếu chế độ', discountMode: 'XX' as never, taxMode: 'LINE' })).rejects.toMatchObject({ statusCode: 400 });

    const created = await form.createTemplate(admin, { name: 'Chiết khấu tổng, thuế theo dòng', discountMode: 'ORDER', taxMode: 'LINE', description: 'Thử' });
    expect(created).toMatchObject({ discountMode: 'ORDER', taxMode: 'LINE', active: true, isDefault: false });
    await expect(form.createTemplate(admin, { name: 'chiết khấu tổng, thuế theo dòng', discountMode: 'LINE', taxMode: 'LINE' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUOTE_TEMPLATE_NAME_EXISTS',
    });

    // Chiết khấu theo tổng đơn, VAT theo dòng: VAT dòng giảm theo tỷ lệ chiết khấu.
    const mixed = await draft(quotes, { templateId: created.id });
    expect(mixed.version.lines[0]).toMatchObject({ discountPercent: 0, vatRate: 10, vatAmount: 1_000_000 });
    const discounted = await quotes.updateVersion(nv1, mixed.id, 1, { revision: mixed.version.revision, orderDiscount: { percent: 10 } });
    expect(discounted.version.totals).toMatchObject({ discountAmount: 1_000_000, netAmount: 9_000_000, vatAmount: 900_000, totalAmount: 9_900_000 });
    await expect(
      quotes.updateVersion(nv1, mixed.id, 1, { revision: discounted.version.revision, orderTax: { percent: 5 } }),
    ).rejects.toMatchObject({ code: 'ORDER_TAX_NOT_ALLOWED' });

    // Sửa chế độ của mẫu không đổi báo giá đã lập (chụp lúc chọn mẫu).
    const edited = await form.updateTemplate(admin, created.id, { name: 'Chiết khấu tổng, thuế theo dòng', discountMode: 'LINE', taxMode: 'LINE' });
    expect(edited).toMatchObject({ discountMode: 'LINE', taxMode: 'LINE' });
    expect((await quotes.get(nv1, mixed.id)).version.form).toMatchObject({ discountMode: 'ORDER', templateId: created.id });

    // Tắt: không chọn được khi lập, báo giá cũ vẫn sửa được.
    const off = await form.updateTemplate(admin, created.id, { name: 'Chiết khấu tổng, thuế theo dòng', discountMode: 'LINE', taxMode: 'LINE', active: false });
    expect(off.active).toBe(false);
    expect((await form.listTemplates(nv1, false)).map((template) => template.id)).not.toContain(created.id);
    expect((await form.listTemplates(nv1, true)).map((template) => template.id)).toContain(created.id);
    await expect(quotes.create(nv1, { customerId, templateId: created.id })).rejects.toMatchObject({
      statusCode: 400,
      code: 'TEMPLATE_INACTIVE',
      message: 'Mẫu báo giá này đã tắt, vui lòng chọn mẫu khác.',
    });
    await expect(quotes.create(nv1, { customerId, templateId: randomUUID() })).rejects.toMatchObject({ statusCode: 400, code: 'TEMPLATE_NOT_FOUND' });
    await expect(quotes.addLine(nv1, mixed.id, 1, { revision: discounted.version.revision, materialId: CAP, quantity: 1 })).resolves.toBeDefined();

    // Mẫu mặc định: luôn có một, luôn đang bật; chọn mẫu khác làm mặc định thì mẫu cũ bỏ cờ.
    await expect(
      form.updateTemplate(admin, lineTemplateId, { name: 'Báo giá theo dòng (mặc định)', discountMode: 'LINE', taxMode: 'LINE', isDefault: false }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DEFAULT_TEMPLATE_REQUIRED' });
    await expect(
      form.updateTemplate(admin, lineTemplateId, { name: 'Báo giá theo dòng (mặc định)', discountMode: 'LINE', taxMode: 'LINE', active: false }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DEFAULT_TEMPLATE_INACTIVE' });
    await form.updateTemplate(admin, orderTemplateId, { name: 'Chiết khấu trên tổng giá trị đơn hàng', discountMode: 'ORDER', taxMode: 'ORDER', isDefault: true });
    expect((await form.listTemplates(nv1, true)).filter((template) => template.isDefault).map((template) => template.id)).toEqual([orderTemplateId]);
    const withNewDefault = await quotes.create(nv1, { customerId });
    expect(withNewDefault.version.form).toMatchObject({ templateId: orderTemplateId, discountMode: 'ORDER' });
    await form.updateTemplate(admin, lineTemplateId, { name: 'Báo giá theo dòng (mặc định)', discountMode: 'LINE', taxMode: 'LINE', isDefault: true });

    // Loại báo giá.
    const type = await form.createType(admin, { name: 'Báo giá dự án', description: 'Dự án lớn' });
    await expect(form.createType(admin, { name: 'BÁO GIÁ DỰ ÁN' })).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_TYPE_NAME_EXISTS' });
    const withType = await quotes.create(nv1, { customerId, quoteTypeId: type.id, quoteName: 'Cung cấp cáp đồng', quoteDate: '2026-11-02' });
    expect(withType.version.form).toMatchObject({ quoteTypeId: type.id, quoteTypeName: 'Báo giá dự án', quoteName: 'Cung cấp cáp đồng', quoteDate: '2026-11-02' });
    expect(withType).toMatchObject({ quoteName: 'Cung cấp cáp đồng' });
    await form.updateType(admin, type.id, { name: 'Báo giá dự án', active: false });
    await expect(quotes.create(nv1, { customerId, quoteTypeId: type.id })).rejects.toMatchObject({ statusCode: 400, code: 'QUOTE_TYPE_INACTIVE' });
    await expect(form.updateType(admin, defaultTypeId, { name: 'Báo đơn giá và số lượng', isDefault: false })).rejects.toMatchObject({
      statusCode: 409,
      code: 'DEFAULT_TYPE_REQUIRED',
    });
    await expect(form.updateType(nv1, type.id, { name: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(form.updateTemplate(admin, randomUUID(), { name: 'x', discountMode: 'LINE', taxMode: 'LINE' })).rejects.toMatchObject({ statusCode: 404 });

    const audit = await handle.pool.query<{ entity_type: string; action: string }>(
      `SELECT entity_type, action FROM crm_schema.audit_log WHERE entity_type IN ('quote_template', 'quote_type', 'quote_code_setting') ORDER BY at, id`,
    );
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        { entity_type: 'quote_template', action: 'create' },
        { entity_type: 'quote_template', action: 'update' },
        { entity_type: 'quote_template', action: 'deactivate' },
        { entity_type: 'quote_type', action: 'create' },
        { entity_type: 'quote_type', action: 'deactivate' },
        { entity_type: 'quote_code_setting', action: 'update' },
      ]),
    );
  });

  it('TC-QF-18 (nền): phạm vi dữ liệu và quyền ghi của trường mới như báo giá hiện có', async () => {
    const mine = await draft(quotes, { templateId: orderTemplateId });
    // Người ngoài phạm vi: 404 khi xem lẫn khi sửa trường mới, không lộ sự tồn tại.
    await expect(quotes.get(nv3, mine.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(quotes.updateVersion(nv3, mine.id, 1, { revision: mine.version.revision, orderDiscount: { percent: 5 } })).rejects.toMatchObject({ statusCode: 404 });
    await expect(quotes.updateVersion(nv3, mine.id, 1, { revision: mine.version.revision, fees: [{ feeType: 'A', amount: 1 }] })).rejects.toMatchObject({ statusCode: 404 });
    // Cấp trên thấy; người chỉ có quyền đọc (không lập báo giá) sửa thì 403.
    expect((await quotes.get(tn, mine.id)).version.form.templateId).toBe(orderTemplateId);
    await expect(
      quotes.updateVersion(viewer, mine.id, 1, { revision: mine.version.revision, quoteName: 'Sửa trộm' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(quotes.create(viewer, { customerId })).rejects.toMatchObject({ statusCode: 403 });
    // Chọn mẫu hay loại giả: 400, không ghi.
    await expect(quotes.updateVersion(nv1, mine.id, 1, { revision: mine.version.revision, templateId: 'khong-phai-uuid' })).rejects.toMatchObject({ statusCode: 400 });
    expect((await quotes.get(nv1, mine.id)).version.revision).toBe(mine.version.revision);
    // Quản trị thấy mọi báo giá.
    expect((await quotes.get(admin, mine.id)).id).toBe(mine.id);
  });
});
