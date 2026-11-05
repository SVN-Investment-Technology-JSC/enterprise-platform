import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES, type CustomFieldDefinition } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteConversionService } from './application/quote-conversion.service.js';
import { QuoteFormService } from './application/quote-form.service.js';
import { QuoteRelationService } from './application/quote-relation.service.js';
import type { ApprovalLinks } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteConversionStore } from './infrastructure/postgres-quote-conversion.store.js';
import { PostgresQuoteFormStore } from './infrastructure/postgres-quote-form.store.js';
import { PostgresQuoteRelationStore } from './infrastructure/postgres-quote-relation.store.js';
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

const noLinks: ApprovalLinks = { start: async () => undefined };
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

integration('Bán hàng GĐI: trường tuỳ biến, người theo dõi, đối tượng liên quan, cập nhật và chuyển đổi (PostgreSQL)', () => {
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
    ...extra,
  });
  const nv1 = actor(NV1);
  const nv3 = actor(NV3);
  const tn = actor(TN, { canApproveQuote: true });
  const viewer = actor(randomUUID(), { canWriteQuote: false });
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true });

  let quotes: QuoteService;
  let form: QuoteFormService;
  let relations: QuoteRelationService;
  let conversion: QuoteConversionService;
  let opportunities: OpportunityService;
  let customerId: string;
  let foreignCustomerId: string;
  let lineTemplateId: string;
  let orderTemplateId: string;
  let mixedTemplateId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const customers = new CustomerService(customerStore, scopes);
    const formStore = new PostgresQuoteFormStore(handle.database);
    const quoteStore = new PostgresQuoteStore(handle.database);
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
      undefined,
      undefined,
      formStore,
    );
    form = new QuoteFormService(formStore);
    // Danh bạ nhân sự: chỉ NV1, NV3, TN còn hoạt động.
    relations = new QuoteRelationService(new PostgresQuoteRelationStore(handle.database), scopes, {
      people: async () => [NV1, NV3, TN].map((userId) => ({ userId, displayName: 'Nhân sự' })) as never,
    });
    conversion = new QuoteConversionService(new PostgresQuoteConversionStore(handle.database), quoteStore, scopes);

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
    customerId = (await customers.create(nv1, { name: 'Công ty Theo Dõi', ownerUserId: NV1 })).id;
    foreignCustomerId = (await customers.create(nv3, { name: 'Công ty Của NV3', ownerUserId: NV3 })).id;
    const templates = await form.listTemplates(nv1, false);
    lineTemplateId = templates.find((template) => template.isDefault)?.id as string;
    orderTemplateId = templates.find((template) => template.discountMode === 'ORDER')?.id as string;
    mixedTemplateId = (await form.createTemplate(admin, { name: 'Chiết khấu tổng đơn, thuế theo dòng', discountMode: 'ORDER', taxMode: 'LINE' })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  async function draft(extra: Record<string, unknown> = {}, quantity = 10, owner = nv1) {
    const created = await quotes.create(owner, { customerId: owner === nv1 ? customerId : foreignCustomerId, ...extra });
    return quotes.addLine(owner, created.id, created.currentVersion, { revision: created.version.revision, materialId: CAP, quantity });
  }

  const outbox = async (aggregateId: string, type?: string) =>
    (
      await handle.pool.query<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
        `SELECT event_type, payload FROM integration_schema.outbox_events
          WHERE aggregate_id = $1 AND ($2::text IS NULL OR event_type = $2) ORDER BY occurred_at, id`,
        [aggregateId, type ?? null],
      )
    ).rows;

  const audit = async (quoteId: string) =>
    (await handle.pool.query<{ action: string }>(`SELECT action FROM crm_schema.audit_log WHERE entity_id = $1 ORDER BY at, id`, [quoteId])).rows.map(
      (row) => row.action,
    );

  /** Đưa báo giá Nháp qua Duyệt, Gửi, Khách chấp nhận. */
  async function accept(id: string) {
    let current = await quotes.get(nv1, id);
    current = await quotes.submit(nv1, id, current.currentVersion, { revision: current.version.revision });
    expect(current.status).toBe('APPROVED');
    current = await quotes.send(nv1, id, current.currentVersion, { revision: current.version.revision });
    return quotes.accept(nv1, id, current.currentVersion, { revision: current.version.revision });
  }

  // -------------------------------------------------------------------------------------------------------------
  // P2I-06 Trường tuỳ biến
  // -------------------------------------------------------------------------------------------------------------

  it('TC-QF-11: định nghĩa trường ở Cài đặt chỉ crm.manage; bắt buộc ép khi lưu báo giá, nêu rõ tên trường', async () => {
    // Báo giá cũ (chèn bằng cột phase 1) chưa có giá trị: xem không bị chặn.
    const old = await handle.pool.query<{ id: string }>(
      `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id) VALUES ('BG2600777', $1, $2) RETURNING id`,
      [customerId, NV1],
    );
    await handle.pool.query(`INSERT INTO crm_schema.quote_versions (quote_id, version_no) VALUES ($1, 1)`, [old.rows[0].id]);

    const dept = await form.createCustomField(admin, {
      name: 'Phòng ban phụ trách',
      fieldType: 'SELECT',
      options: ['Kỹ thuật', 'Kinh doanh'],
      required: true,
      sortOrder: 1,
    });
    expect(dept).toMatchObject({ entityType: 'quote', fieldType: 'SELECT', options: ['Kỹ thuật', 'Kinh doanh'], required: true, active: true });
    const note = await form.createCustomField(admin, { name: 'Ghi chú nội bộ', fieldType: 'TEXT', sortOrder: 2 });
    const qty = await form.createCustomField(admin, { name: 'Số hợp đồng khung', fieldType: 'NUMBER', sortOrder: 3 });
    const day = await form.createCustomField(admin, { name: 'Ngày dự kiến ký', fieldType: 'DATE', sortOrder: 4 });

    // Quyền: chỉ crm.manage thêm, sửa; người khác chỉ xem.
    await expect(form.createCustomField(nv1, { name: 'Trộm', fieldType: 'TEXT' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(form.updateCustomField(nv1, dept.id, { name: 'Sửa trộm', fieldType: 'SELECT', options: ['a'] })).rejects.toMatchObject({ statusCode: 403 });
    expect((await form.listCustomFields(nv1, 'quote', false)).map((entry: CustomFieldDefinition) => entry.name)).toEqual([
      'Phòng ban phụ trách',
      'Ghi chú nội bộ',
      'Số hợp đồng khung',
      'Ngày dự kiến ký',
    ]);
    // Dữ liệu định nghĩa sai: 400/409.
    await expect(form.createCustomField(admin, { name: 'phòng ban phụ trách', fieldType: 'TEXT' })).rejects.toMatchObject({ statusCode: 409, code: 'CUSTOM_FIELD_NAME_EXISTS' });
    await expect(form.createCustomField(admin, { name: 'Chọn gì đó', fieldType: 'SELECT', options: [] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(form.createCustomField(admin, { name: 'Trùng', fieldType: 'SELECT', options: ['A', 'a'] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(form.createCustomField(admin, { name: 'Sai kiểu', fieldType: 'XYZ' as never })).rejects.toMatchObject({ statusCode: 400 });
    await expect(form.createCustomField(admin, { entityType: 'invoice' as never, name: 'Hoá đơn', fieldType: 'TEXT' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(form.updateCustomField(admin, dept.id, { name: 'Phòng ban phụ trách', fieldType: 'TEXT' })).rejects.toMatchObject({ statusCode: 409, code: 'CUSTOM_FIELD_TYPE_LOCKED' });

    // Xem và các sửa dòng hàng không bị chặn dù thiếu trường bắt buộc; báo giá cũ vẫn xem được.
    const loadedOld = await quotes.get(nv1, old.rows[0].id);
    expect(loadedOld.version.form.customFields).toEqual({});
    const created = await draft();
    expect(created.version.form.customFields).toEqual({});

    // Lưu thiếu trường bắt buộc: 400 nêu tên trường, không ghi gì.
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: created.version.revision, note: 'Ghi chú' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'CUSTOM_FIELD_REQUIRED',
      message: expect.stringContaining('"Phòng ban phụ trách"'),
    });
    expect((await quotes.get(nv1, created.id)).version.note).toBeNull();
    // Báo giá cũ chưa có giá trị: lưu cũng bị ép (vì là lưu), nhưng chỉ xem thì không.
    await expect(
      quotes.updateVersion(nv1, old.rows[0].id, 1, { revision: loadedOld.version.revision, note: 'Cập nhật' }),
    ).rejects.toMatchObject({ code: 'CUSTOM_FIELD_REQUIRED' });

    // Giá trị sai kiểu, sai lựa chọn, trường lạ: 400.
    const rev = created.version.revision;
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: rev, customFields: { [dept.id]: 'Nhân sự' } })).rejects.toMatchObject({ statusCode: 400, code: 'CUSTOM_FIELD_INVALID' });
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: rev, customFields: { [dept.id]: 'Kỹ thuật', [qty.id]: 'abc' } })).rejects.toMatchObject({ code: 'CUSTOM_FIELD_INVALID' });
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: rev, customFields: { [dept.id]: 'Kỹ thuật', [day.id]: '31/12/2026' } })).rejects.toMatchObject({ code: 'CUSTOM_FIELD_INVALID' });
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: rev, customFields: { [dept.id]: 'Kỹ thuật', 'khong-co': 'x' } })).rejects.toMatchObject({ code: 'CUSTOM_FIELD_UNKNOWN' });
    expect((await quotes.get(nv1, created.id)).version.revision).toBe(rev);

    // Điền đủ: lưu được, giá trị lưu theo id trường trên phiên bản.
    const saved = await quotes.updateVersion(nv1, created.id, 1, {
      revision: rev,
      customFields: { [dept.id]: 'Kỹ thuật', [note.id]: ' Khách quen ', [qty.id]: '12.5', [day.id]: '2026-12-31' },
    });
    expect(saved.version.form.customFields).toEqual({ [dept.id]: 'Kỹ thuật', [note.id]: 'Khách quen', [qty.id]: 12.5, [day.id]: '2026-12-31' });
    const stored = await handle.pool.query<{ custom_fields: Record<string, unknown> }>(
      `SELECT custom_fields FROM crm_schema.quote_versions WHERE quote_id = $1`,
      [created.id],
    );
    expect(stored.rows[0].custom_fields).toEqual(saved.version.form.customFields);
    // Lần lưu sau không gửi lại: giữ nguyên; xoá trường không bắt buộc bằng null.
    const again = await quotes.updateVersion(nv1, created.id, 1, { revision: saved.version.revision, note: 'Ghi chú mới', customFields: { [note.id]: null } });
    expect(again.version.form.customFields).toEqual({ [dept.id]: 'Kỹ thuật', [qty.id]: 12.5, [day.id]: '2026-12-31' });
    // Xoá trường bắt buộc: bị chặn.
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: again.version.revision, customFields: { [dept.id]: null } })).rejects.toMatchObject({ code: 'CUSTOM_FIELD_REQUIRED' });

    // Tạo báo giá nhận giá trị trường (kiểm kiểu, chưa ép bắt buộc).
    const born = await quotes.create(nv1, { customerId, customFields: { [dept.id]: 'Kinh doanh' } });
    expect(born.version.form.customFields).toEqual({ [dept.id]: 'Kinh doanh' });
    await expect(quotes.create(nv1, { customerId, customFields: { [dept.id]: 'Nhân sự' } })).rejects.toMatchObject({ statusCode: 400 });

    // Tắt trường: không nhập được nữa, không còn bắt buộc, giá trị cũ giữ nguyên.
    await form.updateCustomField(admin, dept.id, { name: 'Phòng ban phụ trách', fieldType: 'SELECT', options: ['Kỹ thuật', 'Kinh doanh'], required: true, active: false });
    expect((await form.listCustomFields(nv1, 'quote', false)).some((entry) => entry.id === dept.id)).toBe(false);
    expect((await form.listCustomFields(admin, 'quote', true)).find((entry) => entry.id === dept.id)?.active).toBe(false);
    const after = await quotes.updateVersion(nv1, created.id, 1, { revision: again.version.revision, note: 'Sau khi tắt' });
    expect(after.version.form.customFields[dept.id]).toBe('Kỹ thuật');
    await expect(quotes.updateVersion(nv1, created.id, 1, { revision: after.version.revision, customFields: { [dept.id]: 'Kinh doanh' } })).rejects.toMatchObject({ code: 'CUSTOM_FIELD_UNKNOWN' });
    // Dọn để các case sau không bị ép trường bắt buộc.
    for (const field of [note, qty, day]) {
      await form.updateCustomField(admin, field.id, { name: field.name, fieldType: field.fieldType, active: false });
    }
    expect(await form.listCustomFields(nv1, 'quote', false)).toEqual([]);
    expect(await audit(created.id)).toContain('create');
    const settingAudit = await handle.pool.query<{ action: string }>(
      `SELECT action FROM crm_schema.audit_log WHERE entity_type = 'custom_field' ORDER BY at, id`,
    );
    expect(settingAudit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'deactivate']));
  });

  // -------------------------------------------------------------------------------------------------------------
  // P2I-07 Người theo dõi
  // -------------------------------------------------------------------------------------------------------------

  it('TC-QF-14, TC-QF-18: người theo dõi đọc được báo giá (chỉ đọc), nhận thông báo khi gửi duyệt và đổi trạng thái; bỏ theo dõi thì thôi', async () => {
    const mine = await draft();
    // NV3 ngoài phạm vi: 404; chưa theo dõi thì không thêm người theo dõi được và không thấy danh sách.
    await expect(quotes.get(nv3, mine.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.listFollowers(nv3, mine.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.addFollower(nv3, mine.id, { userId: NV3 })).rejects.toMatchObject({ statusCode: 404 });
    expect((await quotes.list(nv3, {})).items.some((item) => item.id === mine.id)).toBe(false);

    // Kiểm đầu vào.
    await expect(relations.addFollower(nv1, mine.id, { userId: 'khong-phai-uuid' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(relations.addFollower(nv1, mine.id, { userId: randomUUID() })).rejects.toMatchObject({ statusCode: 400, code: 'FOLLOWER_INVALID' });
    await expect(relations.addFollower(viewer, mine.id, { userId: NV3 })).rejects.toMatchObject({ statusCode: 403 });

    await relations.addFollower(nv1, mine.id, { userId: NV3 });
    await relations.addFollower(nv1, mine.id, { userId: TN });
    await expect(relations.addFollower(nv1, mine.id, { userId: NV3 })).rejects.toMatchObject({ statusCode: 409, code: 'FOLLOWER_EXISTS' });
    expect((await relations.listFollowers(nv1, mine.id)).map((entry) => entry.userId).sort()).toEqual([NV3, TN].sort());

    // Người theo dõi đọc được: chi tiết, danh sách, danh sách người theo dõi, nhưng không sửa được và không thêm người khác.
    expect((await quotes.get(nv3, mine.id)).id).toBe(mine.id);
    expect((await quotes.list(nv3, {})).items.some((item) => item.id === mine.id)).toBe(true);
    expect((await relations.listFollowers(nv3, mine.id)).length).toBe(2);
    const revision = mine.version.revision;
    await expect(quotes.updateVersion(nv3, mine.id, 1, { revision, quoteName: 'Sửa trộm' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(quotes.addLine(nv3, mine.id, 1, { revision, materialId: CAP, quantity: 1 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(quotes.submit(nv3, mine.id, 1, { revision })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.addFollower(nv3, mine.id, { userId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.removeFollower(nv3, mine.id, TN)).rejects.toMatchObject({ statusCode: 404 });
    // Người khác ngoài phạm vi vẫn 404.
    await expect(quotes.get(actor(randomUUID()), mine.id)).rejects.toBeDefined();

    // Gửi duyệt (không vượt ngưỡng nên Đã duyệt thẳng) và đổi trạng thái: người theo dõi nhận, người thao tác không tự nhận.
    let current = await quotes.submit(nv1, mine.id, 1, { revision });
    current = await quotes.send(nv1, mine.id, 1, { revision: current.version.revision });
    const events = await outbox(mine.id, 'crm.quote.status-changed');
    expect(events.map((row) => [row.payload.payload.fromStatus, row.payload.payload.toStatus])).toEqual([
      ['DRAFT', 'APPROVED'],
      ['APPROVED', 'SENT'],
    ]);
    for (const row of events) {
      expect((row.payload.payload.recipientUserIds as string[]).sort()).toEqual([NV3, TN].sort());
      expect(row.payload.payload).toMatchObject({ quoteId: mine.id, quoteCode: mine.code, actorUserId: NV1, deepLink: expect.stringContaining(mine.id) });
    }

    // TN (cấp trên, người duyệt) tự bỏ theo dõi: sự kiện sau chỉ còn NV3. NV3 bỏ theo dõi thì hết quyền đọc.
    await relations.removeFollower(tn, mine.id, TN);
    await quotes.accept(nv1, mine.id, 1, { revision: current.version.revision });
    const afterTn = await outbox(mine.id, 'crm.quote.status-changed');
    expect(afterTn[2].payload.payload).toMatchObject({ toStatus: 'ACCEPTED', recipientUserIds: [NV3] });
    expect(await relations.removeFollower(nv3, mine.id, NV3)).toEqual([]);
    await expect(quotes.get(nv3, mine.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await quotes.list(nv3, {})).items.some((item) => item.id === mine.id)).toBe(false);
    await expect(relations.removeFollower(nv1, mine.id, NV3)).rejects.toMatchObject({ statusCode: 404 });
    expect((await outbox(mine.id, 'crm.quote.status-changed')).length).toBe(3);
    expect(await audit(mine.id)).toEqual(expect.arrayContaining(['follower-add', 'follower-remove']));
    // Sự kiện cũ vẫn được phát như trước (chỉ thêm sự kiện mới).
    expect((await outbox(mine.id)).map((row) => row.event_type)).not.toContain('crm.quote.renamed');
  });

  it('TC-QF-14: gửi duyệt vượt ngưỡng (Chờ duyệt) báo người theo dõi, không báo trùng cấp trên đã nhận thông báo cần duyệt', async () => {
    const created = await draft({ templateId: orderTemplateId });
    await relations.addFollower(nv1, created.id, { userId: NV3 });
    await relations.addFollower(nv1, created.id, { userId: TN });
    const big = await quotes.updateVersion(nv1, created.id, 1, { revision: created.version.revision, orderDiscount: { percent: 10 } });
    const pending = await quotes.submit(nv1, created.id, 1, { revision: big.version.revision });
    expect(pending.status).toBe('PENDING');
    const approval = await outbox(created.id, 'crm.quote.approval-requested');
    expect(approval).toHaveLength(1);
    const changed = await outbox(created.id, 'crm.quote.status-changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].payload.payload).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'PENDING' });
    const approvalRecipients = approval[0].payload.payload.recipientUserIds as string[];
    const followerRecipients = changed[0].payload.payload.recipientUserIds as string[];
    expect(followerRecipients.some((userId) => approvalRecipients.includes(userId))).toBe(false);
    expect(followerRecipients).toContain(NV3);
    // Duyệt: người gửi nhận kết quả duyệt (sự kiện cũ), người theo dõi nhận sự kiện mới.
    const approved = await quotes.approve(tn, created.id, 1, { revision: pending.version.revision, reason: 'Đồng ý' });
    expect(approved.status).toBe('APPROVED');
    const decided = await outbox(created.id, 'crm.quote.approval-decided');
    expect(decided[0].payload.payload.recipientUserIds).toEqual([NV1]);
    const afterApprove = (await outbox(created.id, 'crm.quote.status-changed'))[1];
    expect(afterApprove.payload.payload).toMatchObject({ fromStatus: 'PENDING', toStatus: 'APPROVED' });
    expect(afterApprove.payload.payload.recipientUserIds).toEqual(expect.arrayContaining([NV3]));
    expect(afterApprove.payload.payload.recipientUserIds).not.toContain(TN);
  });

  // -------------------------------------------------------------------------------------------------------------
  // P2I-07 Đối tượng liên quan
  // -------------------------------------------------------------------------------------------------------------

  it('TC-QF-13: thêm, xoá đối tượng liên quan; chỉ liên kết được đối tượng trong phạm vi dữ liệu; kiểm tồn tại, không trùng', async () => {
    const mine = await draft();
    const other = await draft();
    const opportunity = await opportunities.create(nv1, { customerId, name: 'Dự án liên quan' });
    const accepted = await draft();
    const done = await accept(accepted.id);
    const converted = await conversion.convert(nv1, done.id);
    const foreignQuote = await draft({}, 1, nv3);
    const foreignOpportunity = await opportunities.create(nv3, { customerId: foreignCustomerId, name: 'Dự án của NV3' });

    let links = await relations.addLink(nv1, mine.id, { targetType: 'CUSTOMER', targetId: customerId });
    links = await relations.addLink(nv1, mine.id, { targetType: 'OPPORTUNITY', targetId: opportunity.id });
    links = await relations.addLink(nv1, mine.id, { targetType: 'CONTRACT', targetId: converted.contractId });
    links = await relations.addLink(nv1, mine.id, { targetType: 'SALES_ORDER', targetId: converted.orderId });
    links = await relations.addLink(nv1, mine.id, { targetType: 'QUOTE', targetId: other.id });
    expect(links.map((entry) => [entry.targetType, entry.targetId, entry.targetLabel])).toEqual([
      ['CUSTOMER', customerId, 'Công ty Theo Dõi'],
      ['OPPORTUNITY', opportunity.id, 'Dự án liên quan'],
      ['CONTRACT', converted.contractId, converted.contractCode],
      ['SALES_ORDER', converted.orderId, converted.orderCode],
      ['QUOTE', other.id, other.code],
    ]);
    expect((await relations.listLinks(nv1, mine.id)).length).toBe(5);

    // Không trùng, không liên kết chính nó, id không tồn tại, loại sai.
    await expect(relations.addLink(nv1, mine.id, { targetType: 'CUSTOMER', targetId: customerId })).rejects.toMatchObject({ statusCode: 409, code: 'LINK_EXISTS' });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'QUOTE', targetId: mine.id })).rejects.toMatchObject({ statusCode: 400, code: 'LINK_SELF' });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'CONTRACT', targetId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'CONTRACT', targetId: customerId })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'CUSTOMER', targetId: 'abc' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'LEAD' as never, targetId: customerId })).rejects.toMatchObject({ statusCode: 400, code: 'LINK_TYPE_INVALID' });

    // Ngoài phạm vi dữ liệu của NV1: 404 như không có, không lộ sự tồn tại.
    await expect(relations.addLink(nv1, mine.id, { targetType: 'CUSTOMER', targetId: foreignCustomerId })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'QUOTE', targetId: foreignQuote.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.addLink(nv1, mine.id, { targetType: 'OPPORTUNITY', targetId: foreignOpportunity.id })).rejects.toMatchObject({ statusCode: 404 });
    // Quản trị (phạm vi toàn bộ) liên kết được.
    expect((await relations.addLink(admin, mine.id, { targetType: 'CUSTOMER', targetId: foreignCustomerId })).length).toBe(6);

    // Người chỉ đọc, người theo dõi: xem được, không thêm hay xoá được.
    await relations.addFollower(nv1, mine.id, { userId: NV3 });
    expect((await relations.listLinks(nv3, mine.id)).length).toBe(6);
    await expect(relations.addLink(nv3, mine.id, { targetType: 'CUSTOMER', targetId: foreignCustomerId })).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.removeLink(nv3, mine.id, links[0].id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.removeLink(viewer, mine.id, links[0].id)).rejects.toMatchObject({ statusCode: 403 });

    // Xoá: đúng liên kết, xoá lại 404, id của báo giá khác 404; nhật ký.
    const afterRemove = await relations.removeLink(nv1, mine.id, links[0].id);
    expect(afterRemove.some((entry) => entry.id === links[0].id)).toBe(false);
    expect(afterRemove.length).toBe(5);
    await expect(relations.removeLink(nv1, mine.id, links[0].id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(relations.removeLink(nv1, other.id, links[1].id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await relations.listLinks(nv1, mine.id)).length).toBe(5);
    expect(await audit(mine.id)).toEqual(expect.arrayContaining(['link-add', 'link-remove']));
    // Xoá khỏi báo giá không xoá đối tượng đích.
    expect(await quotes.get(nv1, other.id)).toMatchObject({ id: other.id });
  });

  // -------------------------------------------------------------------------------------------------------------
  // P2I-09 Cập nhật báo giá trong quá trình bán hàng
  // -------------------------------------------------------------------------------------------------------------

  it('TC-QF-15/16: Nháp sửa tại chỗ; đã gửi sửa trường mới thì tạo phiên bản mới, tính lại giá, kiểm duyệt lại, nhật ký', async () => {
    const field = await form.createCustomField(admin, { name: 'Mã dự toán', fieldType: 'TEXT' });
    const created = await draft({ templateId: orderTemplateId });
    // Nháp: sửa tại chỗ, vẫn phiên bản 1.
    let current = await quotes.updateVersion(nv1, created.id, 1, {
      revision: created.version.revision,
      orderDiscount: { percent: 5 },
      customFields: { [field.id]: 'DT-01' },
    });
    expect(current).toMatchObject({ currentVersion: 1, status: 'DRAFT' });
    expect(current.versions).toHaveLength(1);
    current = await quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, orderTax: { percent: 8 }, quoteName: 'Báo giá lần 1' });
    expect(current).toMatchObject({ currentVersion: 1, status: 'DRAFT' });
    expect(current.versions).toHaveLength(1);
    expect(current.version.totals).toMatchObject({ netAmount: 9_500_000, vatAmount: 760_000, totalAmount: 10_260_000 });

    current = await quotes.submit(nv1, created.id, 1, { revision: current.version.revision });
    current = await quotes.send(nv1, created.id, 1, { revision: current.version.revision });
    expect(current.status).toBe('SENT');

    // Đã gửi: mỗi nhóm trường mới đều sinh phiên bản mới ở Nháp, tính lại giá, giữ phiên bản cũ nguyên vẹn.
    // 1) chiết khấu tổng đơn
    const v2 = await quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, orderDiscount: { percent: 10 } });
    expect(v2).toMatchObject({ currentVersion: 2, status: 'DRAFT' });
    expect(v2.version.form).toMatchObject({ orderDiscount: { percent: 10, amount: 1_000_000 }, customFields: { [field.id]: 'DT-01' } });
    expect(v2.version.totals).toMatchObject({ netAmount: 9_000_000, vatAmount: 720_000, totalAmount: 9_720_000 });
    // Kiểm duyệt chạy lại: chiết khấu 10% vượt ngưỡng nhân viên 5% nên phải duyệt.
    expect(v2.approvalCheck?.length).toBeGreaterThan(0);
    const v1 = await quotes.get(nv1, created.id, '1');
    expect(v1.version).toMatchObject({ status: 'SUPERSEDED' });
    expect(v1.version.form.orderDiscount.percent).toBe(5);
    expect(v1.version.totals.totalAmount).toBe(10_260_000);
    expect(v1.version.form.customFields).toEqual({ [field.id]: 'DT-01' });

    // 2) Gửi duyệt lại: Chờ duyệt vì vượt ngưỡng; sau đó từ chối, rồi sửa mẫu, thuế, phí, tuỳ biến thì sinh phiên bản 3.
    const pending = await quotes.submit(nv1, created.id, 2, { revision: v2.version.revision });
    expect(pending.status).toBe('PENDING');
    expect((await outbox(created.id, 'crm.quote.approval-requested')).length).toBe(1);
    const rejected = await quotes.reject(tn, created.id, 2, { revision: pending.version.revision, reason: 'Giảm quá sâu' });
    expect(rejected.status).toBe('REJECTED');
    const v3 = await quotes.updateVersion(nv1, created.id, 2, {
      revision: rejected.version.revision,
      templateId: lineTemplateId,
      fees: [{ feeType: 'Lắp đặt', amount: 100_000 }],
      customFields: { [field.id]: 'DT-02' },
    });
    expect(v3).toMatchObject({ currentVersion: 3, status: 'DRAFT' });
    expect(v3.version.form).toMatchObject({
      templateId: lineTemplateId,
      discountMode: 'LINE',
      taxMode: 'LINE',
      fees: [{ feeType: 'Lắp đặt', amount: 100_000 }],
      customFields: { [field.id]: 'DT-02' },
    });
    // Mẫu theo dòng: chiết khấu tổng đơn bị xoá, giá về như phase 1 (cáp 10 x 1.000.000, CK 3%, VAT 10%) cộng phí 100.000.
    expect(v3.version.totals).toMatchObject({ netAmount: 9_700_000, vatAmount: 970_000, totalAmount: 10_670_000 + 100_000 });
    expect((await quotes.get(nv1, created.id, '2')).version.form.customFields).toEqual({ [field.id]: 'DT-01' });
    expect(v3.versions.map((entry) => [entry.versionNo, entry.status])).toEqual([
      [3, 'DRAFT'],
      [2, 'SUPERSEDED'],
      [1, 'SUPERSEDED'],
    ]);
    // Nhật ký ghi lần sinh phiên bản và gửi duyệt.
    expect((await audit(created.id)).filter((action) => action === 'revise')).toHaveLength(2);
    await form.updateCustomField(admin, field.id, { name: field.name, fieldType: 'TEXT', active: false });
  });

  // -------------------------------------------------------------------------------------------------------------
  // P2I-09 Chuyển đổi sang hợp đồng, đơn bán
  // -------------------------------------------------------------------------------------------------------------

  it('chuyển đổi báo giá mẫu LINE: dòng hợp đồng, đơn giữ nguyên như phase 1; tổng đơn, hợp đồng bằng tổng báo giá', async () => {
    const created = await draft({ templateId: lineTemplateId }, 10);
    const quote = await accept(created.id);
    const result = await conversion.convert(nv1, quote.id);
    const order = await handle.pool.query<Record<string, string>>(`SELECT * FROM crm_schema.sales_orders WHERE id = $1`, [result.orderId]);
    const lines = await handle.pool.query<Record<string, string>>(`SELECT * FROM crm_schema.sales_order_lines WHERE order_id = $1 ORDER BY line_no`, [result.orderId]);
    expect(lines.rows.map((line) => [Number(line.quantity), Number(line.unit_price), Number(line.discount_percent), Number(line.line_amount), Number(line.vat_amount), Number(line.line_total)])).toEqual(
      quote.version.lines.map((line) => [line.quantity, line.unitPrice, line.discountPercent, line.lineAmount, line.vatAmount, line.lineTotal]),
    );
    expect(Number(order.rows[0].total_amount)).toBe(quote.version.totals.totalAmount);
    const contract = await handle.pool.query<Record<string, string>>(`SELECT value FROM crm_schema.contracts WHERE id = $1`, [result.contractId]);
    expect(Number(contract.rows[0].value)).toBe(quote.version.totals.totalAmount);
    expect(quote.version.totals.totalAmount).toBe(10_670_000);
  });

  async function orderQuote(templateId: string, adjust: Parameters<QuoteService['updateVersion']>[3]) {
    const created = await quotes.create(nv1, { customerId, templateId });
    let current = await quotes.addLine(nv1, created.id, 1, { revision: created.version.revision, materialId: CAP, quantity: 3 });
    current = await quotes.addLine(nv1, created.id, 1, { revision: current.version.revision, materialId: CAP, quantity: 7 });
    current = await quotes.updateVersion(nv1, created.id, 1, { ...adjust, revision: current.version.revision });
    return current;
  }

  async function converted(id: string) {
    const quote = await accept(id);
    const result = await conversion.convert(nv1, quote.id);
    const lines = (await handle.pool.query<Record<string, string>>(`SELECT * FROM crm_schema.sales_order_lines WHERE order_id = $1 ORDER BY line_no`, [result.orderId])).rows;
    const order = (await handle.pool.query<Record<string, string>>(`SELECT * FROM crm_schema.sales_orders WHERE id = $1`, [result.orderId])).rows[0];
    const contract = (await handle.pool.query<Record<string, string>>(`SELECT value FROM crm_schema.contracts WHERE id = $1`, [result.contractId])).rows[0];
    const contractLines = (await handle.pool.query<Record<string, string>>(`SELECT * FROM crm_schema.contract_lines WHERE contract_id = $1 ORDER BY line_no`, [result.contractId])).rows;
    return { quote, result, lines, order, contract, contractLines };
  }

  it('chuyển đổi báo giá mẫu ORDER (chiết khấu, thuế tổng đơn, phí, vận chuyển): tổng dòng, đơn, hợp đồng khớp tổng báo giá đến đồng', async () => {
    const adjusted = await orderQuote(orderTemplateId, {
      revision: 0,
      orderDiscount: { percent: 3.3333 },
      orderTax: { percent: 8 },
      fees: [{ feeType: 'Lắp đặt', amount: 150_000 }],
      shipping: { amount: 200_000 },
    });
    // Số học của báo giá: hàng 10.000.000, chiết khấu 3,3333% = 333.330, thuế 8% của 9.666.670 = 773.333,6 làm tròn 773.334.
    expect(adjusted.version.totals).toMatchObject({ netAmount: 9_666_670, vatAmount: 773_334, shippingAmount: 200_000, totalAmount: 10_790_004 });
    expect(adjusted.version.lines.map((line) => line.vatAmount)).toEqual([0, 0]);
    const { quote, lines, order, contract, contractLines } = await converted(adjusted.id);
    const total = quote.version.totals.totalAmount;
    expect(total).toBe(10_790_004);

    // Tổng thành tiền các dòng = tiền hàng sau chiết khấu; tổng thuế dòng = thuế tổng đơn; đến đồng.
    const lineAmounts = lines.map((line) => Number(line.line_amount));
    const lineVats = lines.map((line) => Number(line.vat_amount));
    const lineTotals = lines.map((line) => Number(line.line_total));
    expect(sum(lineAmounts)).toBe(9_666_670);
    expect(sum(lineVats)).toBe(773_334);
    expect(lineTotals).toEqual(lineAmounts.map((amount, index) => amount + lineVats[index]));
    expect(lines.every((line) => Number.isInteger(Number(line.line_amount)) && Number.isInteger(Number(line.vat_amount)))).toBe(true);
    // Chiết khấu chia theo tỷ trọng 3 : 7, phần dư dồn dòng cuối: 99.999 + 233.331.
    expect(lines.map((line) => Number(line.discount_amount))).toEqual([99_999, 233_331]);
    expect(lineAmounts).toEqual([2_900_001, 6_766_669]);
    // Đơn và hợp đồng: tổng bằng tổng báo giá; phần chênh với tổng dòng chính là phí vận chuyển và phí hợp đồng.
    expect(Number(order.total_amount)).toBe(total);
    expect(Number(contract.value)).toBe(total);
    expect(total - sum(lineTotals)).toBe(200_000 + 150_000);
    expect(Number(order.net_amount)).toBe(sum(lineAmounts));
    expect(Number(order.vat_amount)).toBe(sum(lineVats));
    // Hợp đồng: thành tiền dòng (đã gộp theo mặt hàng) = tiền hàng sau chiết khấu.
    expect(sum(contractLines.map((line) => Number(line.line_amount)))).toBe(9_666_670);
    // Công nợ theo lần giao dùng "tổng đơn - tổng dòng" làm phí không thuộc dòng: không âm, nên không thu thừa.
    expect(Math.max(total - sum(lineTotals), 0)).toBe(350_000);
  });

  it('chuyển đổi báo giá mẫu ORDER chiết khấu, thuế theo dòng: thuế dòng giảm theo chiết khấu, tổng khớp báo giá', async () => {
    const adjusted = await orderQuote(mixedTemplateId, { revision: 0, orderDiscount: { amount: 400_000 }, fees: [{ feeType: 'Phí', amount: 50_000 }] });
    // Hàng 10.000.000 (chưa chiết khấu theo dòng), chiết khấu 400.000 (4%), VAT 10% của 9.600.000 = 960.000.
    expect(adjusted.version.totals).toMatchObject({ netAmount: 9_600_000, vatAmount: 960_000, totalAmount: 10_610_000 });
    const { quote, lines, order, contract } = await converted(adjusted.id);
    expect(sum(lines.map((line) => Number(line.line_amount)))).toBe(9_600_000);
    expect(sum(lines.map((line) => Number(line.vat_amount)))).toBe(960_000);
    expect(Number(order.total_amount)).toBe(quote.version.totals.totalAmount);
    expect(Number(contract.value)).toBe(quote.version.totals.totalAmount);
    expect(quote.version.totals.totalAmount - sum(lines.map((line) => Number(line.line_total)))).toBe(50_000);
  });

  it('chuyển đổi báo giá mẫu ORDER không nhập chiết khấu, thuế: dòng nguyên trạng, tổng khớp', async () => {
    const adjusted = await orderQuote(orderTemplateId, { revision: 0 });
    const { quote, lines, order } = await converted(adjusted.id);
    expect(lines.map((line) => Number(line.line_amount))).toEqual(quote.version.lines.map((line) => line.lineAmount));
    expect(Number(order.total_amount)).toBe(quote.version.totals.totalAmount);
    expect(quote.version.totals.totalAmount - sum(lines.map((line) => Number(line.line_total)))).toBe(0);
  });
});
