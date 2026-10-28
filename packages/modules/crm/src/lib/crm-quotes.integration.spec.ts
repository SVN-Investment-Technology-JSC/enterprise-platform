import { randomUUID } from 'node:crypto';
import {
  CRM_NO_CAPABILITIES,
  CRM_QUOTE_APPROVAL_DECIDED,
  CRM_QUOTE_APPROVAL_REQUESTED,
  CRM_QUOTE_EXPIRED,
  type ProcedureDefinitionOption,
} from '@enterprise-platform/contracts-crm';
import { CustomerTimelineService } from './application/activity.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { OpportunityService } from './application/opportunity.service.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteApprovalSettingsService } from './application/quote-approval-settings.service.js';
import type { ProcedureClient, StartProcedureInstance } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { procedureUnavailable } from './infrastructure/http-procedure-client.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import {
  applyQuoteProcedureResult,
  applyQuoteProcedureReversed,
  PostgresApprovalLinks,
  reconcileRunningLinks,
} from './infrastructure/quote-procedure-links.js';
import type { ProcedureInstanceState } from './infrastructure/http-procedure-client.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const BT = randomUUID();
const TN = randomUUID();
const NV1 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-tn', reportsToPositionId: null },
    { id: 'p-nv1', reportsToPositionId: 'p-tn' },
  ],
  assignments: [
    { userId: TN, positionId: 'p-tn' },
    { userId: NV1, positionId: 'p-nv1' },
  ],
};

/** Danh mục Kho giả: `QA-KHO-CAP` tồn khả dụng 70, giá bình quân 800.000; `QA-KHO-BT` là dịch vụ. */
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

/** Quy trình giả: khoá chống lặp như Quy trình thật (một khoá, một hồ sơ). */
class FakeProcedure implements ProcedureClient {
  available = true;
  calls: StartProcedureInstance[] = [];
  readonly byKey = new Map<string, { id: string; code: string }>();
  readonly definition: ProcedureDefinitionOption = { id: randomUUID(), code: 'QT-BG', name: 'Duyệt báo giá' };

  async startInstance(_tenantId: string, request: StartProcedureInstance) {
    this.calls.push(request);
    await new Promise((done) => setTimeout(done, 20));
    if (!this.available) throw procedureUnavailable();
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return existing;
    const created = { id: randomUUID(), code: `HS${this.byKey.size + 1}` };
    this.byKey.set(request.idempotencyKey, created);
    return created;
  }
  async publishedDefinition(_tenantId: string, definitionId: string) {
    if (definitionId !== this.definition.id) throw new Error('not published');
    return this.definition;
  }
  async listPublished() {
    return [this.definition];
  }
}

integration('Bán hàng GĐ3b: báo giá, phiên bản, duyệt qua Quy trình (PostgreSQL)', () => {
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
  const tn = actor(TN, { canApproveQuote: true });
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true });

  const procedure = new FakeProcedure();
  let quotes: QuoteService;
  let settings: QuoteApprovalSettingsService;
  let opportunities: OpportunityService;
  let timeline: CustomerTimelineService;
  let links: PostgresApprovalLinks;
  let customerId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const customers = new CustomerService(customerStore, scopes);
    opportunities = new OpportunityService(opportunityStore, customerStore, scopes);
    timeline = new CustomerTimelineService(new PostgresTimelineStore(handle.database), customerStore, scopes);
    links = new PostgresApprovalLinks(handle.database, procedure);
    const settingsStore = new PostgresQuoteSettingsStore(handle.database);
    settings = new QuoteApprovalSettingsService(settingsStore, procedure);
    quotes = new QuoteService(
      new PostgresQuoteStore(handle.database),
      settingsStore,
      new PostgresPricingStore(handle.database),
      new FakeCatalog(),
      customerStore,
      opportunityStore,
      scopes,
      links,
      { snapshot: async () => ORGANIZATION },
    );

    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [
        { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
        { materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Gói bảo trì', unit: 'Gói', price: 500_000, vatRate: 10 },
      ],
    });
    // Chính sách 3% cho cáp: báo giá không ghi đè có chiết khấu 3%, biên 17,53% (dưới hạn mức nhân viên).
    await new DiscountPolicyService(new PostgresDiscountPolicyStore(handle.database)).create(admin, {
      code: 'CK-CAP-3',
      name: 'Cáp 3%',
      percent: 3,
      validFrom: '2026-01-01',
      appliesToAllCustomers: true,
      rules: [{ criterion: 'MATERIAL', refId: CAP, refText: 'QA-KHO-CAP' }],
    });
    customerId = (await customers.create(nv1, { name: 'Công ty Báo Giá', ownerUserId: NV1 })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  /** Báo giá Nháp có một dòng `QA-KHO-CAP` × 10, tuỳ chọn chiết khấu ghi đè. */
  async function draftQuote(discount?: number) {
    const created = await quotes.create(nv1, { customerId });
    return quotes.addLine(nv1, created.id, created.currentVersion, {
      revision: created.version.revision,
      materialId: CAP,
      quantity: 10,
      overrideDiscountPercent: discount ?? null,
    });
  }

  const linksOf = async (quoteId: string) =>
    (
      await handle.pool.query(
        `SELECT l.* FROM crm_schema.procedure_links l JOIN crm_schema.quote_versions v ON v.id = l.source_id WHERE v.quote_id = $1`,
        [quoteId],
      )
    ).rows;
  const events = async (quoteId: string) =>
    (
      await handle.pool.query<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id = $1 ORDER BY occurred_at, id`,
        [quoteId],
      )
    ).rows;

  it('TC-QUO-01/02/03: dòng lấy giá vốn Kho; dịch vụ không cần tồn; tồn khả dụng hiện khi xem', async () => {
    const draft = await draftQuote();
    const withService = await quotes.addLine(nv1, draft.id, 1, { revision: draft.version.revision, materialId: BT, quantity: 5 });
    expect(withService.version.lines).toEqual([
      expect.objectContaining({
        materialCode: 'QA-KHO-CAP',
        estUnitCost: 800_000,
        estCost: 8_000_000,
        availableStock: 70,
        lineAmount: 9_700_000,
        appliedPolicies: [expect.objectContaining({ code: 'CK-CAP-3', percent: 3 })],
      }),
      expect.objectContaining({ materialCode: 'QA-KHO-BT', materialKind: 'SERVICE', estUnitCost: null, availableStock: null, lineAmount: 2_500_000 }),
    ]);
    expect(withService.version.totals).toMatchObject({ netAmount: 12_200_000, vatAmount: 1_220_000, totalAmount: 13_420_000, profit: 4_200_000 });
  });

  it('TC-QUO-08: không vượt ngưỡng thì duyệt thẳng, không có phiên Quy trình', async () => {
    const draft = await draftQuote();
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted).toMatchObject({ status: 'APPROVED', version: { status: 'APPROVED', requiresApproval: false } });
    expect(await linksOf(draft.id)).toEqual([]);
    expect((await events(draft.id)).map((row) => row.event_type)).toEqual([]);
  });

  it('TC-QUO-05/06/07: sửa bản Đã duyệt sinh v2 Nháp, v1 Đã thay thế chỉ đọc; so sánh hai phiên bản', async () => {
    const draft = await draftQuote();
    const approved = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    const lineId = approved.version.lines[0].id;
    const v2 = await quotes.updateLine(nv1, draft.id, 1, lineId, { revision: approved.version.revision, materialId: CAP, quantity: 12 });
    expect(v2).toMatchObject({ currentVersion: 2, status: 'DRAFT', version: { versionNo: 2, status: 'DRAFT' } });
    expect(v2.versions.map((entry) => [entry.versionNo, entry.status])).toEqual([
      [2, 'DRAFT'],
      [1, 'SUPERSEDED'],
    ]);
    const v1 = await quotes.get(nv1, draft.id, '1');
    expect(v1.version).toMatchObject({ status: 'SUPERSEDED', lines: [expect.objectContaining({ quantity: 10 })] });

    await expect(
      quotes.updateLine(nv1, draft.id, 1, lineId, { revision: v1.version.revision, materialId: CAP, quantity: 99 }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Phiên bản cũ chỉ đọc.' });
    expect((await quotes.get(nv1, draft.id, '1')).version.lines[0].quantity).toBe(10);

    const comparison = await quotes.compare(nv1, draft.id, '1', '2');
    expect(comparison.lines).toEqual([expect.objectContaining({ change: 'CHANGED', fields: expect.arrayContaining(['quantity']) })]);
    expect(comparison.totalsDelta.netAmount).toBe(2 * 970_000);
    expect(v2.history.map((entry) => entry.action)).toEqual(['revise', 'submit', 'create']);
  });

  it('TC-INT-01: vượt ngưỡng, gắn Quy trình: Chờ duyệt, một liên kết, một phiên crm_quote', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const before = procedure.calls.length;
    const draft = await draftQuote(12);
    expect(draft.approvalCheck?.map((reason) => reason.code)).toEqual(['DISCOUNT_OVER_LIMIT', 'OVERRIDE', 'MARGIN_BELOW_MIN']);
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted).toMatchObject({ status: 'PENDING', procedure: { status: 'RUNNING', instanceId: expect.any(String) } });
    const [link] = await linksOf(draft.id);
    expect(procedure.calls.slice(before)).toEqual([
      expect.objectContaining({
        definitionId: procedure.definition.id,
        sourceType: 'crm_quote',
        sourceId: link.id,
        idempotencyKey: `crm:${link.id}`,
        autoCompleteInitiatorStep: true,
        initiatedBy: NV1,
      }),
    ]);
    const requested = (await events(draft.id)).find((row) => row.event_type === CRM_QUOTE_APPROVAL_REQUESTED);
    expect(requested?.payload.payload).toMatchObject({ mode: 'PROCEDURE', recipientUserIds: [], requesterUserId: NV1 });

    // Đang duyệt qua Quy trình: không duyệt tay được.
    await expect(quotes.approve(tn, draft.id, 1, { revision: submitted.version.revision })).rejects.toMatchObject({
      code: 'QUOTE_IN_PROCEDURE',
    });
  });

  it('TC-INT-02/03: kết quả Quy trình áp một lần; nhận trùng bỏ qua', async () => {
    const approvedDraft = await draftQuote(12);
    await quotes.submit(nv1, approvedDraft.id, 1, { revision: approvedDraft.version.revision });
    const [approvedLink] = await linksOf(approvedDraft.id);
    const completed = { sourceType: 'crm_quote', sourceId: approvedLink.id, instanceId: approvedLink.instance_id, status: 'completed', actorId: TN };
    await expect(applyQuoteProcedureResult(handle.database, tenantId, completed)).resolves.toBe('applied');
    await expect(applyQuoteProcedureResult(handle.database, tenantId, completed)).resolves.toBe('ignored');
    const approved = await quotes.get(nv1, approvedDraft.id);
    expect(approved).toMatchObject({ status: 'APPROVED', version: { approvedBy: TN }, procedure: { status: 'APPLIED', result: 'completed' } });
    expect(approved.history.filter((entry) => entry.action === 'approve')).toHaveLength(1);

    const rejectedDraft = await draftQuote(12);
    await quotes.submit(nv1, rejectedDraft.id, 1, { revision: rejectedDraft.version.revision });
    const [rejectedLink] = await linksOf(rejectedDraft.id);
    await applyQuoteProcedureResult(handle.database, tenantId, {
      sourceType: 'crm_quote',
      sourceId: rejectedLink.id,
      status: 'rejected',
      reason: 'Chiết khấu quá cao',
    });
    const rejected = await quotes.get(nv1, rejectedDraft.id);
    expect(rejected.version).toMatchObject({ status: 'REJECTED', decisionReason: 'Chiết khấu quá cao' });
    const decided = (await events(rejectedDraft.id)).find((row) => row.event_type === CRM_QUOTE_APPROVAL_DECIDED);
    expect(decided?.payload.payload).toMatchObject({ status: 'REJECTED', recipientUserIds: [NV1] });

    // Phiên khác hoặc nguồn khác: bỏ qua.
    await expect(
      applyQuoteProcedureResult(handle.database, tenantId, { ...completed, sourceType: 'finance_voucher' }),
    ).resolves.toBe('ignored');
  });

  it('TC-CONC-06: gửi duyệt hai lần cùng lúc: một liên kết, một lần gọi Quy trình', async () => {
    const draft = await draftQuote(12);
    const before = procedure.calls.length;
    const results = await Promise.allSettled([
      quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision }),
      quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(await linksOf(draft.id)).toHaveLength(1);
    expect(procedure.calls.length - before).toBe(1);
  });

  it('TC-INT-04: Quy trình không phản hồi: giữ Chờ duyệt, worker thử lại theo lease và tạo đúng một phiên', async () => {
    const draft = await draftQuote(12);
    procedure.available = false;
    try {
      const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
      expect(submitted).toMatchObject({ status: 'PENDING', procedure: { status: 'FAILED', instanceId: null } });
    } finally {
      procedure.available = true;
    }
    const [link] = await linksOf(draft.id);
    expect(link.attempts).toBe(1);
    const created = procedure.byKey.size;
    await links.sync(tenantId);
    await links.sync(tenantId);
    const [after] = await linksOf(draft.id);
    expect(after).toMatchObject({ status: 'RUNNING', attempts: 2 });
    expect(procedure.byKey.size).toBe(created + 1);
  });

  it('duyệt trực tiếp: báo cấp trên; không có quyền duyệt thì bị chặn; TN duyệt được', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'DIRECT' });
    const draft = await draftQuote(12);
    const pending = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(pending).toMatchObject({ status: 'PENDING', procedure: null });
    const requested = (await events(draft.id)).find((row) => row.event_type === CRM_QUOTE_APPROVAL_REQUESTED);
    expect(requested?.payload.payload).toMatchObject({ mode: 'DIRECT', recipientUserIds: [TN] });
    await expect(quotes.approve(nv1, draft.id, 1, { revision: pending.version.revision })).rejects.toMatchObject({ statusCode: 403 });
    const approved = await quotes.approve(tn, draft.id, 1, { revision: pending.version.revision });
    expect(approved).toMatchObject({ status: 'APPROVED', version: { approvedBy: TN } });
  });

  it('TC-QUO-09/10: job hết hạn chuyển Hết hạn, người làm là hệ thống; báo giá hết hạn không chốt được', async () => {
    const draft = await draftQuote();
    const approved = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    const sent = await quotes.send(nv1, draft.id, 1, { revision: approved.version.revision });
    expect(sent.status).toBe('SENT');
    await handle.pool.query(
      `UPDATE crm_schema.quote_versions SET valid_until = current_date - 1 WHERE quote_id = $1;`,
      [draft.id],
    );
    await expect(quotes.accept(nv1, draft.id, 1, { revision: sent.version.revision })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Báo giá đã hết hạn.',
    });
    const store = new PostgresQuoteStore(handle.database);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    expect(await store.expireDue(tenantId, today, 100)).toBeGreaterThanOrEqual(1);
    const expired = await quotes.get(nv1, draft.id);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.history[0]).toMatchObject({ action: 'expire', actorId: null, toStatus: 'EXPIRED' });
    expect((await events(draft.id)).map((row) => row.event_type)).toContain(CRM_QUOTE_EXPIRED);
    await expect(quotes.accept(nv1, draft.id, 1, { revision: expired.version.revision })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Báo giá đã hết hạn.',
    });
    // Chạy lại không đổi gì.
    expect(await store.expireDue(tenantId, today, 100)).toBe(0);
  });

  it('TC-OPP-08: sang Báo giá tạo đúng một nháp; Thắng cần báo giá khách chấp nhận', async () => {
    const opportunity = await opportunities.create(nv1, { customerId, name: 'Dự án báo giá' });
    for (const stage of ['CONTACTED', 'DISCOVERY', 'QUOTING', 'DISCOVERY', 'QUOTING', 'NEGOTIATION'] as const) {
      await opportunities.changeStage(nv1, opportunity.id, { stage });
    }
    const page = await quotes.list(nv1, { opportunityId: opportunity.id });
    expect(page.items).toEqual([expect.objectContaining({ status: 'DRAFT', opportunityId: opportunity.id, ownerUserId: NV1 })]);

    await expect(opportunities.changeStage(nv1, opportunity.id, { stage: 'WON' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACCEPTED_QUOTE_REQUIRED',
    });

    const quoteId = page.items[0].id;
    let detail = await quotes.addLine(nv1, quoteId, 1, { revision: (await quotes.get(nv1, quoteId)).version.revision, materialId: CAP, quantity: 1 });
    detail = await quotes.submit(nv1, quoteId, 1, { revision: detail.version.revision });
    detail = await quotes.send(nv1, quoteId, 1, { revision: detail.version.revision });
    detail = await quotes.accept(nv1, quoteId, 1, { revision: detail.version.revision });
    expect(detail).toMatchObject({ status: 'ACCEPTED', acceptedVersion: 1 });
    await expect(opportunities.changeStage(nv1, opportunity.id, { stage: 'WON' })).resolves.toMatchObject({ stage: 'WON' });

    const entries = await timeline.list(nv1, customerId, {});
    expect(entries.items.some((entry) => entry.kind === 'quote' && entry.quoteId === quoteId && entry.action === 'accept')).toBe(true);
  });

  it('Quy trình hỏi thu hồi: cho phép khi chưa chuyển hợp đồng, chặn khi đã chuyển', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const draft = await draftQuote(12);
    await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    const [link] = await linksOf(draft.id);
    const store = new PostgresQuoteStore(handle.database);
    await expect(store.reversalCheck(tenantId, link.instance_id)).resolves.toEqual({ allowed: true });
    await handle.pool.query(`UPDATE crm_schema.quotes SET converted_at = now() WHERE id = $1`, [draft.id]);
    await expect(store.reversalCheck(tenantId, link.instance_id)).resolves.toMatchObject({ allowed: false });
    await expect(store.reversalCheck(tenantId, link.id)).resolves.toMatchObject({ allowed: false });
  });

  it('cấu hình: gắn quy trình chưa công bố bị từ chối; ngưỡng chỉ quản trị bán hàng sửa', async () => {
    await expect(settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: randomUUID() })).rejects.toThrow();
    await expect(settings.saveApprovalSettings(nv1, { roleLimits: { staff: 7 }, minMarginPercent: 10 })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      settings.saveApprovalSettings(admin, { roleLimits: { staff: 7, teamLead: 15, manager: null }, minMarginPercent: 8 }),
    ).resolves.toEqual({ roleLimits: { staff: 7, teamLead: 15, manager: null }, minMarginPercent: 8 });
  });

  it('TC-INT-03 (T3-19): Quy trình thu hồi phiên đã duyệt: báo giá chưa chuyển hợp đồng về Từ chối duyệt, nhận lặp bỏ qua', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const draft = await draftQuote(12);
    await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    const [link] = await linksOf(draft.id);
    // Chưa áp kết quả thì thu hồi không làm gì.
    const reversed = { sourceType: 'crm_quote', sourceId: link.id, instanceId: link.instance_id, reason: 'Duyệt nhầm', reversedBy: TN };
    await expect(applyQuoteProcedureReversed(handle.database, tenantId, reversed)).resolves.toBe('ignored');
    await applyQuoteProcedureResult(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: link.id, instanceId: link.instance_id, status: 'completed', actorId: TN });
    const approved = await quotes.get(nv1, draft.id);
    await quotes.send(nv1, draft.id, 1, { revision: approved.version.revision });
    await expect(applyQuoteProcedureReversed(handle.database, tenantId, reversed)).resolves.toBe('applied');
    await expect(applyQuoteProcedureReversed(handle.database, tenantId, reversed)).resolves.toBe('ignored');
    const detail = await quotes.get(nv1, draft.id);
    expect(detail).toMatchObject({ status: 'REJECTED', version: { status: 'REJECTED', decisionReason: 'Quy trình đã thu hồi: Duyệt nhầm' } });
    expect(detail.history[0]).toMatchObject({ action: 'procedure-reversed', actorId: TN, fromStatus: 'SENT', toStatus: 'REJECTED' });

    // Đã chuyển hợp đồng: không đổi (reversal-check đã chặn từ trước).
    const converted = await draftQuote(12);
    await quotes.submit(nv1, converted.id, 1, { revision: converted.version.revision });
    const [other] = await linksOf(converted.id);
    await applyQuoteProcedureResult(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: other.id, status: 'completed' });
    await handle.pool.query(`UPDATE crm_schema.quotes SET converted_at = now() WHERE id = $1`, [converted.id]);
    await expect(applyQuoteProcedureReversed(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: other.id })).resolves.toBe('ignored');
    expect((await quotes.get(nv1, converted.id)).status).toBe('APPROVED');
  });

  it('TC-INT-04 (T3-20): lỡ mất sự kiện kết quả: job hỏi Quy trình phiên chạy lâu rồi áp như consumer', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const done = await draftQuote(12);
    await quotes.submit(nv1, done.id, 1, { revision: done.version.revision });
    const running = await draftQuote(12);
    await quotes.submit(nv1, running.id, 1, { revision: running.version.revision });
    const [doneLink] = await linksOf(done.id);
    const [runningLink] = await linksOf(running.id);
    const asked: string[][] = [];
    const reader = {
      instanceStatuses: async (_tenantId: string, ids: readonly string[]): Promise<ProcedureInstanceState[]> => {
        asked.push([...ids]);
        return ids.map((id) => ({ instanceId: id, instanceCode: 'HS-X', status: id === doneLink.instance_id ? 'rejected' : 'running', lastActorId: TN }));
      },
    };
    // Mới chạy: chưa hỏi.
    expect(await reconcileRunningLinks(handle.database, reader, tenantId)).toEqual([]);
    expect(asked).toEqual([]);
    await handle.pool.query(`UPDATE crm_schema.procedure_links SET updated_at = now() - interval '10 minutes' WHERE id = ANY($1::uuid[])`, [[doneLink.id, runningLink.id]]);
    const finished = await reconcileRunningLinks(handle.database, reader, tenantId);
    expect(asked[0]).toEqual(expect.arrayContaining([doneLink.instance_id, runningLink.instance_id]));
    expect(finished).toEqual([expect.objectContaining({ sourceType: 'crm_quote', sourceId: doneLink.id, status: 'rejected', actorId: TN })]);
    for (const event of finished) await applyQuoteProcedureResult(handle.database, tenantId, event);
    expect((await quotes.get(nv1, done.id)).version.status).toBe('REJECTED');
    expect((await quotes.get(nv1, running.id)).status).toBe('PENDING');
    // Phiên còn chạy được đẩy mốc, lượt sau chưa hỏi lại.
    expect(await reconcileRunningLinks(handle.database, reader, tenantId)).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('TC-SM-04, TC-OPP-05 (T3-21): cơ hội chuyển Thua: mọi báo giá chưa kết thúc sang Khách từ chối, phiên Quy trình đóng', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const opportunity = await opportunities.create(nv1, { customerId, name: 'Dự án thua' });
    for (const stage of ['CONTACTED', 'DISCOVERY', 'QUOTING'] as const) await opportunities.changeStage(nv1, opportunity.id, { stage });
    const [draftId] = (await quotes.list(nv1, { opportunityId: opportunity.id })).items.map((item) => item.id);
    // Báo giá thứ hai của cơ hội đang Chờ duyệt qua Quy trình; thứ ba đã Khách chấp nhận thì giữ nguyên.
    const pendingQuote = await quotes.create(nv1, { customerId, opportunityId: opportunity.id });
    const withLine = await quotes.addLine(nv1, pendingQuote.id, 1, { revision: pendingQuote.version.revision, materialId: CAP, quantity: 10, overrideDiscountPercent: 12 });
    await quotes.submit(nv1, pendingQuote.id, 1, { revision: withLine.version.revision });
    const acceptedQuote = await quotes.create(nv1, { customerId, opportunityId: opportunity.id });
    let accepted = await quotes.addLine(nv1, acceptedQuote.id, 1, { revision: acceptedQuote.version.revision, materialId: CAP, quantity: 1 });
    accepted = await quotes.submit(nv1, acceptedQuote.id, 1, { revision: accepted.version.revision });
    accepted = await quotes.send(nv1, acceptedQuote.id, 1, { revision: accepted.version.revision });
    await quotes.accept(nv1, acceptedQuote.id, 1, { revision: accepted.version.revision });

    await opportunities.changeStage(nv1, opportunity.id, { stage: 'LOST', reason: 'Khách chọn đối thủ' });
    for (const id of [draftId, pendingQuote.id]) {
      const detail = await quotes.get(nv1, id);
      expect(detail).toMatchObject({ status: 'DECLINED', version: { status: 'DECLINED', decisionReason: 'Cơ hội đã thua' } });
      expect(detail.history[0]).toMatchObject({ action: 'decline', toStatus: 'DECLINED', reason: 'Cơ hội đã thua', actorId: NV1 });
    }
    expect((await quotes.get(nv1, acceptedQuote.id)).status).toBe('ACCEPTED');
    const [link] = await linksOf(pendingQuote.id);
    expect(link).toMatchObject({ status: 'CLOSED', result_reason: 'Cơ hội đã thua' });
    // Kết quả Quy trình đến sau bị bỏ qua.
    await expect(
      applyQuoteProcedureResult(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: link.id, status: 'completed' }),
    ).resolves.toBe('ignored');
    expect((await quotes.get(nv1, pendingQuote.id)).status).toBe('DECLINED');
  });
});
