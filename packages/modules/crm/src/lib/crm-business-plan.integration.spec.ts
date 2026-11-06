import { randomUUID } from 'node:crypto';
import {
  CRM_NO_CAPABILITIES,
  DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS,
  type BusinessPlanCostLineInput,
  type ProcedureDefinitionOption,
} from '@enterprise-platform/contracts-crm';
import { BusinessPlanService } from './application/business-plan.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteApprovalSettingsService } from './application/quote-approval-settings.service.js';
import type { ProcedureClient, StartProcedureInstance } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresBusinessPlanStore } from './infrastructure/postgres-business-plan.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { applyQuoteProcedureResult, applyQuoteProcedureReversed, PostgresApprovalLinks } from './infrastructure/quote-procedure-links.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const TN = randomUUID();
const NV1 = randomUUID();
const NV3 = randomUUID();
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

/** Kho giả: `QA-KHO-CAP` giá bình quân 800.000. */
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

class FakeProcedure implements ProcedureClient {
  readonly byKey = new Map<string, { id: string; code: string }>();
  readonly definition: ProcedureDefinitionOption = { id: randomUUID(), code: 'QT-BG', name: 'Duyệt báo giá' };
  async startInstance(_tenantId: string, request: StartProcedureInstance) {
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return existing;
    const created = { id: randomUUID(), code: `HS${this.byKey.size + 1}` };
    this.byKey.set(request.idempotencyKey, created);
    return created;
  }
  async publishedDefinition() {
    return this.definition;
  }
  async listPublished() {
    return [this.definition];
  }
}

/** Ba dòng chi phí: chiết khấu 100.000, giảm giá 50.000, thầu phụ 200.000 (tổng 350.000). */
const LINES: BusinessPlanCostLineInput[] = [
  { kind: 'DISCOUNT', description: 'Chiết khấu thêm', amount: 100_000 },
  { kind: 'PRICE_REDUCTION', amount: 50_000 },
  { kind: 'SUBCONTRACT', description: 'Thầu phụ lắp đặt', amount: 200_000 },
];

integration('Bán hàng GĐ D: phương án kinh doanh (PostgreSQL)', () => {
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
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true });
  /** Người chỉ xem (thấy mọi dữ liệu) nhưng không lập, duyệt, không có quyền xem giá vốn. */
  const viewer = actor(randomUUID(), { canWriteOpportunity: false, canWriteQuote: false, canReadAll: true });
  /** Có cả quyền lập và duyệt. */
  const both = actor(NV1, { canApproveQuote: true });

  const procedure = new FakeProcedure();
  let quotes: QuoteService;
  let plans: BusinessPlanService;
  let settings: QuoteApprovalSettingsService;
  let customerId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const customers = new CustomerService(customerStore, scopes);
    const settingsStore = new PostgresQuoteSettingsStore(handle.database);
    settings = new QuoteApprovalSettingsService(settingsStore, procedure);
    const quoteStore = new PostgresQuoteStore(handle.database);
    plans = new BusinessPlanService(new PostgresBusinessPlanStore(handle.database), quoteStore, scopes);
    quotes = new QuoteService(
      quoteStore,
      settingsStore,
      new PostgresPricingStore(handle.database),
      new FakeCatalog(),
      customerStore,
      opportunityStore,
      scopes,
      new PostgresApprovalLinks(handle.database, procedure),
      { snapshot: async () => ORGANIZATION },
      undefined,
      plans,
    );
    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 }],
    });
    // Chính sách 3%: 10 cáp = 10.000.000 giá gốc, chiết khấu 300.000, doanh thu 9.700.000, giá vốn 8.000.000.
    await new DiscountPolicyService(new PostgresDiscountPolicyStore(handle.database)).create(admin, {
      code: 'CK-CAP-3',
      name: 'Cáp 3%',
      percent: 3,
      validFrom: '2026-01-01',
      appliesToAllCustomers: true,
      rules: [{ criterion: 'MATERIAL', refId: CAP, refText: 'QA-KHO-CAP' }],
    });
    customerId = (await customers.create(nv1, { name: 'Công ty PAKD', ownerUserId: NV1 })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  beforeEach(async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'DIRECT' });
    await plans.saveDeviationSettings(admin, DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS);
  });

  async function draftQuote() {
    const created = await quotes.create(nv1, { customerId });
    return quotes.addLine(nv1, created.id, created.currentVersion, { revision: created.version.revision, materialId: CAP, quantity: 10 });
  }
  const revisionOf = async (id: string, versionNo = 1) => (await quotes.get(nv1, id, versionNo)).version.revision;
  const auditActions = async (planId: string) =>
    (
      await handle.pool.query<{ action: string; to_status: string | null }>(
        `SELECT action, to_status FROM crm_schema.audit_log WHERE entity_type = 'business_plan' AND entity_id = $1 ORDER BY at, id`,
        [planId],
      )
    ).rows;

  /** Báo giá v1 có PAKD, gửi duyệt cùng báo giá, TN duyệt, đã gửi khách: mốc so lệch. */
  async function approvedBase() {
    const draft = await draftQuote();
    await plans.save(nv1, draft.id, 1, { lines: LINES });
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted.status).toBe('PENDING');
    await quotes.approve(tn, draft.id, 1, { revision: submitted.version.revision });
    await quotes.send(nv1, draft.id, 1, { revision: await revisionOf(draft.id) });
    return draft.id;
  }

  /** Sinh phiên bản mới từ phiên bản `from` đã gửi, đặt chi phí vận chuyển bên bán chịu (làm giảm lợi nhuận đúng bằng số đó). */
  async function reviseWithCost(id: string, from: number, shippingCost: number) {
    const revised = await quotes.revise(nv1, id, from, { revision: await revisionOf(id, from) });
    return quotes.updateVersion(nv1, id, revised.currentVersion, {
      revision: revised.version.revision,
      shipping: { amount: 0, vatRate: 10, cost: shippingCost },
    });
  }
  const checkCodes = async (id: string, versionNo: number) => ((await quotes.get(nv1, id, versionNo)).approvalCheck ?? []).map((reason) => reason.code);

  it('TC-BP-01: lập PAKD ở báo giá nháp, tính doanh thu, giá vốn, chi phí, lợi nhuận, tỷ suất', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES, note: 'PAKD thử' });
    expect(plan).toMatchObject({
      status: 'DRAFT',
      version: 1,
      quoteVersionNo: 1,
      costVisible: true,
      editable: true,
      note: 'PAKD thử',
      figures: {
        revenue: 9_700_000,
        goodsCost: 8_000_000,
        extraCostTotal: 350_000,
        totalCost: 8_350_000,
        profit: 1_350_000,
        marginPercent: 13.92,
        discountAmount: 450_000,
        discountPercent: 4.5,
      },
    });
    expect(plan.lines.map((line) => [line.lineNo, line.kind, line.amount])).toEqual([
      [1, 'DISCOUNT', 100_000],
      [2, 'PRICE_REDUCTION', 50_000],
      [3, 'SUBCONTRACT', 200_000],
    ]);
    // Tiền lưu NUMERIC(18,2), chụp lại ở cột.
    const row = (await handle.pool.query(`SELECT profit, total_cost FROM crm_schema.business_plans WHERE id = $1`, [plan.id])).rows[0];
    expect(row).toEqual({ profit: '1350000.00', total_cost: '8350000.00' });

    // Sửa: lưu lại với version đúng, đổi dòng; tính lại.
    const updated = await plans.save(nv1, draft.id, 1, { version: plan.version, lines: [{ kind: 'OTHER', amount: 1_000 }] });
    expect(updated).toMatchObject({ version: 2, figures: { extraCostTotal: 1_000, profit: 1_699_000 } });
    // Đọc lại: có PAKD ở chi tiết báo giá (người duyệt thấy số liệu qua `businessPlan`).
    expect((await quotes.get(nv1, draft.id)).businessPlan).toMatchObject({ id: plan.id, figures: { profit: 1_699_000 } });
    // Đã có thì không tạo lại: gửi không kèm version là thiếu số lần sửa; kèm version cũ là 409.
    await expect(plans.save(nv1, draft.id, 1, { lines: LINES })).rejects.toMatchObject({ statusCode: 400, code: 'VERSION_REQUIRED' });
    await expect(plans.save(nv1, draft.id, 1, { version: 1, lines: LINES })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_VERSION' });
    // Dữ liệu sai: loại, số tiền.
    await expect(plans.save(nv1, draft.id, 1, { version: 2, lines: [{ kind: 'HOA_HONG' as never, amount: 1 }] })).rejects.toMatchObject({ code: 'INVALID_KIND' });
    await expect(plans.save(nv1, draft.id, 1, { version: 2, lines: [{ kind: 'OTHER', amount: -5 }] })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('TC-BP-01: chép dòng chi phí từ PAKD của phiên bản trước khi tạo cho phiên bản mới', async () => {
    const id = await approvedBase();
    const revised = await quotes.revise(nv1, id, 1, { revision: await revisionOf(id) });
    const copy = await plans.save(nv1, id, revised.currentVersion, { copyFromVersionNo: 1 });
    expect(copy).toMatchObject({ quoteVersionNo: 2, status: 'DRAFT', figures: { extraCostTotal: 350_000 } });
    await expect(plans.save(nv1, randomUUID(), 1, { copyFromVersionNo: 1 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-BP-03: trình duyệt báo giá kèm PAKD (duyệt trực tiếp): PAKD đi cùng hồ sơ, báo giá và PAKD bị khoá', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES });
    expect((await quotes.get(nv1, draft.id)).approvalCheck?.map((reason) => reason.code)).toEqual(['BUSINESS_PLAN']);
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted.status).toBe('PENDING');
    expect(submitted.version.approvalReasons.map((reason) => reason.code)).toEqual(['BUSINESS_PLAN']);
    // Người duyệt thấy doanh thu, giá vốn, lợi nhuận qua chi tiết báo giá.
    const seen = await quotes.get(tn, draft.id);
    expect(seen.businessPlan).toMatchObject({
      status: 'PENDING',
      currentRoundNo: 1,
      editable: false,
      figures: { revenue: 9_700_000, goodsCost: 8_000_000, profit: 1_350_000 },
      rounds: [{ roundNo: 1, via: 'QUOTE', submittedBy: NV1, decision: null }],
    });
    // Khoá: PAKD không sửa được khi chờ duyệt; báo giá cũng không.
    await expect(plans.save(nv1, draft.id, 1, { version: seen.businessPlan!.version, lines: [] })).rejects.toMatchObject({ code: 'PLAN_LOCKED' });
    await expect(quotes.recalculate(nv1, draft.id, 1, { revision: submitted.version.revision })).rejects.toMatchObject({ code: 'QUOTE_PENDING' });
    // Trình riêng PAKD đang đi cùng báo giá: không trình lại, không duyệt riêng.
    await expect(plans.submit(nv1, draft.id, 1, { version: seen.businessPlan!.version })).rejects.toMatchObject({ statusCode: 409 });
    await expect(plans.approve(tn, draft.id, 1, { version: seen.businessPlan!.version })).rejects.toMatchObject({ code: 'PLAN_IN_QUOTE_APPROVAL' });

    const approved = await quotes.approve(tn, draft.id, 1, { revision: submitted.version.revision });
    expect(approved.status).toBe('APPROVED');
    expect(approved.businessPlan).toMatchObject({
      id: plan.id,
      status: 'APPROVED',
      decidedBy: TN,
      rounds: [{ roundNo: 1, decision: 'APPROVED', decidedBy: TN }],
    });
    // PAKD đã duyệt thì không sửa được nữa.
    await expect(plans.save(nv1, draft.id, 1, { version: approved.businessPlan!.version, lines: [] })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('TC-BP-03: duyệt qua Quy trình: PAKD đi cùng hồ sơ, kết quả Quy trình áp lên cả PAKD (duyệt, từ chối, thu hồi)', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const linkOf = async (quoteId: string) =>
      (await handle.pool.query(`SELECT l.* FROM crm_schema.procedure_links l JOIN crm_schema.quote_versions v ON v.id = l.source_id WHERE v.quote_id = $1`, [quoteId])).rows[0];

    const first = await draftQuote();
    await plans.save(nv1, first.id, 1, { lines: LINES });
    const submitted = await quotes.submit(nv1, first.id, 1, { revision: first.version.revision });
    expect(submitted).toMatchObject({ status: 'PENDING', procedure: { status: 'RUNNING' }, businessPlan: { status: 'PENDING' } });
    const link = await linkOf(first.id);
    await applyQuoteProcedureResult(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: link.id, instanceId: link.instance_id, status: 'completed', actorId: TN });
    expect((await quotes.get(tn, first.id)).businessPlan).toMatchObject({ status: 'APPROVED', decidedBy: TN, rounds: [{ decision: 'APPROVED' }] });

    // Thu hồi kết quả duyệt: PAKD cũng về từ chối.
    const sentRevision = (await quotes.get(nv1, first.id)).version.revision;
    await quotes.send(nv1, first.id, 1, { revision: sentRevision });
    await applyQuoteProcedureReversed(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: link.id, instanceId: link.instance_id, reason: 'Duyệt nhầm', reversedBy: TN });
    expect((await quotes.get(nv1, first.id)).businessPlan).toMatchObject({ status: 'REJECTED', rounds: [{ decision: 'REJECTED' }] });

    // Quy trình từ chối.
    const second = await draftQuote();
    await plans.save(nv1, second.id, 1, { lines: LINES });
    await quotes.submit(nv1, second.id, 1, { revision: second.version.revision });
    const secondLink = await linkOf(second.id);
    await applyQuoteProcedureResult(handle.database, tenantId, { sourceType: 'crm_quote', sourceId: secondLink.id, status: 'rejected', reason: 'Thầu phụ cao' });
    expect((await quotes.get(nv1, second.id)).businessPlan).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Thầu phụ cao',
      rounds: [{ decision: 'REJECTED', reason: 'Thầu phụ cao' }],
    });
  });

  it('TC-BP-05: duyệt không đạt, sửa lại, trình lại: vòng duyệt mới, giữ lịch sử các vòng', async () => {
    // Trình riêng, từ chối, sửa tại chỗ, trình lại.
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES });
    const pending = await plans.submit(nv1, draft.id, 1, { version: plan.version });
    expect(pending).toMatchObject({ status: 'PENDING', currentRoundNo: 1, rounds: [{ via: 'STANDALONE' }] });
    await expect(plans.reject(tn, draft.id, 1, { version: pending.version })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const rejected = await plans.reject(tn, draft.id, 1, { version: pending.version, reason: 'Thầu phụ quá cao' });
    expect(rejected).toMatchObject({ status: 'REJECTED', decisionReason: 'Thầu phụ quá cao', editable: true });
    await expect(plans.submit(nv1, draft.id, 1, { version: rejected.version })).rejects.toMatchObject({ code: 'PLAN_REJECTED' });
    const fixed = await plans.save(nv1, draft.id, 1, { version: rejected.version, lines: [{ kind: 'SUBCONTRACT', amount: 100_000 }] });
    expect(fixed.status).toBe('DRAFT');
    const again = await plans.submit(nv1, draft.id, 1, { version: fixed.version });
    expect(again).toMatchObject({ status: 'PENDING', currentRoundNo: 2 });
    expect(again.rounds.map((round) => [round.roundNo, round.decision, round.reason])).toEqual([
      [1, 'REJECTED', 'Thầu phụ quá cao'],
      [2, null, null],
    ]);
    expect(again.rounds[0].figures?.extraCostTotal).toBe(350_000);
    expect(again.rounds[1].figures?.extraCostTotal).toBe(100_000);
    // Gửi duyệt báo giá khi PAKD đang chờ duyệt riêng thì 409.
    await expect(quotes.submit(nv1, draft.id, 1, { revision: await revisionOf(draft.id) })).rejects.toMatchObject({ code: 'PLAN_PENDING' });
    const approved = await plans.approve(tn, draft.id, 1, { version: again.version });
    expect(approved).toMatchObject({ status: 'APPROVED' });
    // PAKD đã duyệt riêng: gửi duyệt báo giá không cần duyệt thêm vì PAKD.
    expect((await quotes.submit(nv1, draft.id, 1, { revision: await revisionOf(draft.id) })).status).toBe('APPROVED');

    // Báo giá bị từ chối: sửa (phiên bản mới), chép PAKD, trình lại; vòng tiếp theo đánh số tiếp, giữ vòng cũ.
    const second = await draftQuote();
    await plans.save(nv1, second.id, 1, { lines: LINES });
    const sub = await quotes.submit(nv1, second.id, 1, { revision: second.version.revision });
    const rej = await quotes.reject(tn, second.id, 1, { revision: sub.version.revision, reason: 'Chiết khấu cao' });
    expect(rej.businessPlan).toMatchObject({ status: 'REJECTED', rounds: [{ roundNo: 1, decision: 'REJECTED', reason: 'Chiết khấu cao' }] });
    // Báo giá đã khoá ở phiên bản từ chối: PAKD không sửa tại đó.
    await expect(plans.save(nv1, second.id, 1, { version: rej.businessPlan!.version, lines: [] })).rejects.toMatchObject({ code: 'QUOTE_NOT_DRAFT' });
    const v2 = await quotes.revise(nv1, second.id, 1, { revision: rej.version.revision });
    const copy = await plans.save(nv1, second.id, v2.currentVersion, { copyFromVersionNo: 1, lines: [{ kind: 'SUBCONTRACT', amount: 150_000 }] });
    const resubmitted = await quotes.submit(nv1, second.id, 2, { revision: v2.version.revision });
    expect(resubmitted.businessPlan).toMatchObject({ id: copy.id, status: 'PENDING', currentRoundNo: 2 });
    expect(resubmitted.businessPlan!.rounds.map((round) => [round.roundNo, round.quoteVersionNo, round.decision])).toEqual([
      [1, 1, 'REJECTED'],
      [2, 2, null],
    ]);
  });

  it('TC-BP-06, TC-BP-07: sửa báo giá đã gửi, lợi nhuận lệch 3% thì không phải trình lại, lệch 8% thì buộc trình lại', async () => {
    const id = await approvedBase();
    // Mốc: lợi nhuận 1.350.000. Lệch 3% = 40.500.
    const small = await reviseWithCost(id, 1, 40_500);
    expect(await checkCodes(id, 2)).toEqual([]);
    const smallSubmitted = await quotes.submit(nv1, id, 2, { revision: small.version.revision });
    expect(smallSubmitted.status).toBe('APPROVED');
    expect(smallSubmitted.version.approvalReasons).toEqual([]);

    // Phiên bản khác lệch 8% = 108.000: buộc trình lại, không gửi khách được trước khi duyệt.
    const other = await approvedBase();
    const big = await reviseWithCost(other, 1, 108_000);
    expect(await checkCodes(other, 2)).toEqual(['PLAN_DEVIATION']);
    const bigSubmitted = await quotes.submit(nv1, other, 2, { revision: big.version.revision });
    expect(bigSubmitted).toMatchObject({ status: 'PENDING', version: { approvalReasons: [{ code: 'PLAN_DEVIATION', message: expect.stringContaining('8%') }] } });
    await expect(quotes.send(nv1, other, 2, { revision: bigSubmitted.version.revision })).rejects.toMatchObject({ code: 'QUOTE_NOT_APPROVED' });
    const decided = await quotes.approve(tn, other, 2, { revision: bigSubmitted.version.revision });
    expect(decided.status).toBe('APPROVED');
    expect((await quotes.send(nv1, other, 2, { revision: decided.version.revision })).status).toBe('SENT');
  });

  it('TC-BP-06: biên ngưỡng: đúng 5% không buộc trình lại, hơn một đồng thì buộc', async () => {
    const id = await approvedBase();
    const revised = await reviseWithCost(id, 1, 67_500);
    expect(await checkCodes(id, 2)).toEqual([]);
    await quotes.updateVersion(nv1, id, 2, { revision: revised.version.revision, shipping: { amount: 0, vatRate: 10, cost: 67_501 } });
    expect(await checkCodes(id, 2)).toEqual(['PLAN_DEVIATION']);
  });

  it('TC-BP-06: PAKD duyệt riêng rồi sửa báo giá cùng phiên bản: lệch quá ngưỡng thì buộc trình lại', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES });
    const pending = await plans.submit(nv1, draft.id, 1, { version: plan.version });
    await plans.approve(tn, draft.id, 1, { version: pending.version });
    expect(await checkCodes(draft.id, 1)).toEqual([]);
    // Mốc: lợi nhuận PAKD đã duyệt 1.350.000; chi phí vận chuyển 108.000 làm giảm 8%.
    const edited = await quotes.updateVersion(nv1, draft.id, 1, {
      revision: await revisionOf(draft.id),
      shipping: { amount: 0, vatRate: 10, cost: 108_000 },
    });
    expect(await checkCodes(draft.id, 1)).toEqual(['PLAN_DEVIATION']);
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: edited.version.revision });
    expect(submitted.status).toBe('PENDING');
    expect(submitted.version.approvalReasons.map((reason) => reason.code)).toContain('PLAN_DEVIATION');
  });

  it('TC-BP-10: so với PAKD đã duyệt gần nhất: sửa nhỏ nhiều lần vẫn dồn lệch và bị buộc trình lại', async () => {
    const id = await approvedBase();
    // v2: lệch 3% (40.500), trong ngưỡng, duyệt thẳng, gửi khách.
    const v2 = await reviseWithCost(id, 1, 40_500);
    const approved2 = await quotes.submit(nv1, id, 2, { revision: v2.version.revision });
    expect(approved2.status).toBe('APPROVED');
    await quotes.send(nv1, id, 2, { revision: approved2.version.revision });
    // v3: thêm 30.000 nữa; so với v2 chỉ lệch ~2,2% nhưng so với PAKD đã duyệt (v1) là 5,2%.
    const v3 = await reviseWithCost(id, 2, 70_500);
    expect(v3.currentVersion).toBe(3);
    expect(await checkCodes(id, 3)).toEqual(['PLAN_DEVIATION']);
    expect((await quotes.submit(nv1, id, 3, { revision: v3.version.revision })).status).toBe('PENDING');
  });

  it('TC-BP-08: đổi ngưỡng và chế độ so lệch có hiệu lực ngay', async () => {
    const id = await approvedBase();
    const revised = await reviseWithCost(id, 1, 108_000);
    expect(await checkCodes(id, 2)).toEqual(['PLAN_DEVIATION']);
    // Nâng ngưỡng lên 10%: lệch 8% không còn bắt trình lại.
    await plans.saveDeviationSettings(admin, { mode: 'PROFIT', thresholdPercent: 10 });
    expect(await checkCodes(id, 2)).toEqual([]);
    // Chế độ theo chiết khấu: chỉ đổi chi phí vận chuyển thì chiết khấu không đổi nên không lệch, dù lợi nhuận giảm 8%.
    await plans.saveDeviationSettings(admin, { mode: 'DISCOUNT', thresholdPercent: 0 });
    expect(await checkCodes(id, 2)).toEqual([]);
    // Ghi đè chiết khấu 6% (từ 3%): tỷ lệ chiết khấu 4,5% (đã duyệt) lên 7,5%, tăng đúng 3 điểm.
    const lineId = (await quotes.get(nv1, id, 2)).version.lines[0].id;
    await quotes.updateLine(nv1, id, 2, lineId, {
      revision: (await quotes.get(nv1, id, 2)).version.revision,
      materialId: CAP,
      quantity: 10,
      overrideDiscountPercent: 6,
    });
    expect(revised.currentVersion).toBe(2);
    await plans.saveDeviationSettings(admin, { mode: 'DISCOUNT', thresholdPercent: 3 });
    expect(await checkCodes(id, 2)).not.toContain('PLAN_DEVIATION');
    await plans.saveDeviationSettings(admin, { mode: 'DISCOUNT', thresholdPercent: 2.99 });
    expect(await checkCodes(id, 2)).toContain('PLAN_DEVIATION');
    // Giá trị đã lưu đọc lại đúng; mặc định khi tenant chưa cấu hình.
    expect(await plans.deviationSettings(nv1)).toEqual({ mode: 'DISCOUNT', thresholdPercent: 2.99 });
    await handle.pool.query(`DELETE FROM crm_schema.settings WHERE key = 'business-plan.deviation'`);
    expect(await plans.deviationSettings(nv1)).toEqual({ mode: 'PROFIT', thresholdPercent: 5 });
    // Giá trị hỏng trong DB: dùng mặc định.
    await handle.pool.query(`INSERT INTO crm_schema.settings (key, value) VALUES ('business-plan.deviation', '{"mode":"X"}'::jsonb)`);
    expect(await plans.deviationSettings(nv1)).toEqual({ mode: 'PROFIT', thresholdPercent: 5 });
  });

  it('TC-BP-08: chỉ crm.manage đổi được cấu hình; giá trị sai bị từ chối', async () => {
    await expect(plans.saveDeviationSettings(nv1, { mode: 'PROFIT', thresholdPercent: 10 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(plans.saveDeviationSettings(tn, { mode: 'PROFIT', thresholdPercent: 10 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(plans.saveDeviationSettings(admin, { mode: 'PROFIT', thresholdPercent: 120 })).rejects.toMatchObject({ code: 'INVALID_NUMBER' });
    await expect(plans.saveDeviationSettings(admin, { mode: 'HOA_HONG', thresholdPercent: 5 })).rejects.toMatchObject({ code: 'INVALID_MODE' });
    await expect(plans.deviationSettings(nv1)).resolves.toEqual({ mode: 'PROFIT', thresholdPercent: 5 });
    await expect(plans.saveDeviationSettings(admin, { mode: 'DISCOUNT', thresholdPercent: 7.5 })).resolves.toEqual({ mode: 'DISCOUNT', thresholdPercent: 7.5 });
  });

  it('TC-BP-09, TC-P2PERM-01: người chỉ xem không thấy giá vốn, lợi nhuận ở PAKD và báo giá; người có quyền thì thấy', async () => {
    const id = await approvedBase();
    const asViewer = await plans.get(viewer, id, 1);
    expect(asViewer).toMatchObject({ costVisible: false, figures: null, lines: [], visibleFigures: { revenue: 9_700_000 }, deviation: null });
    expect(asViewer?.rounds.every((round) => round.figures === null)).toBe(true);
    expect(JSON.stringify(asViewer)).not.toMatch(/goodsCost|"profit"|marginPercent|8000000|1350000/);

    const quoteAsViewer = await quotes.get(viewer, id);
    expect(quoteAsViewer.version).toMatchObject({ costHidden: true, totals: { estCost: 0, profit: 0, marginPercent: null } });
    expect(quoteAsViewer.version.lines.every((line) => line.estCost === 0 && line.estUnitCost === null && line.margin === null)).toBe(true);
    expect(quoteAsViewer.businessPlan).toMatchObject({ costVisible: false, figures: null });
    expect(quoteAsViewer.approvalCheck).toBeNull();
    // So sánh phiên bản cũng không lộ lợi nhuận.
    const revised = await quotes.revise(nv1, id, 1, { revision: await revisionOf(id) });
    expect(revised.currentVersion).toBe(2);
    const comparison = await quotes.compare(viewer, id, 1, 2);
    expect(comparison.from.totals.profit).toBe(0);
    expect(comparison.totalsDelta.profit).toBe(0);

    for (const who of [nv1, tn, admin, actor(randomUUID(), { canWriteQuote: false, canReadAll: true, canViewQuoteCost: true })]) {
      const detail = await plans.get(who, id, 1);
      expect(detail).toMatchObject({ costVisible: true, figures: { goodsCost: 8_000_000, profit: 1_350_000 } });
      expect((await quotes.get(who, id, 1)).version).toMatchObject({ totals: { estCost: 8_000_000 } });
    }
    // Người chỉ xem không ghi, không trình, không duyệt.
    await expect(plans.save(viewer, id, 2, { lines: LINES })).rejects.toMatchObject({ statusCode: 403 });
    await expect(plans.submit(viewer, id, 2, { version: 1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(plans.approve(viewer, id, 1, { version: 1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(plans.reject(nv1, id, 1, { version: 1, reason: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    // Người chỉ xem cơ hội (ngoài phạm vi: NV3 không phụ trách) không thấy cả báo giá: 404.
    await expect(plans.get(nv3, id, 1)).rejects.toMatchObject({ statusCode: 404 });
    await expect(plans.save(nv3, id, 1, { lines: LINES })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-BP-11: không tự duyệt PAKD của chính mình (trình riêng và đi cùng báo giá)', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(both, draft.id, 1, { lines: LINES });
    const pending = await plans.submit(both, draft.id, 1, { version: plan.version });
    await expect(plans.approve(both, draft.id, 1, { version: pending.version })).rejects.toMatchObject({ statusCode: 403 });
    await expect(plans.reject(both, draft.id, 1, { version: pending.version, reason: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    expect((await plans.get(admin, draft.id, 1))?.status).toBe('PENDING');
    // Người khác có quyền duyệt thì được.
    await expect(plans.approve(tn, draft.id, 1, { version: pending.version })).resolves.toMatchObject({ status: 'APPROVED', decidedBy: TN });
    // Người không có quyền duyệt.
    await expect(plans.approve(nv1, draft.id, 1, { version: pending.version })).rejects.toMatchObject({ statusCode: 403 });

    // Đi cùng báo giá: quy tắc duyệt báo giá hiện có chặn tự duyệt.
    const second = await draftQuote();
    await plans.save(both, second.id, 1, { lines: LINES });
    const submitted = await quotes.submit(both, second.id, 1, { revision: second.version.revision });
    await expect(quotes.approve(both, second.id, 1, { revision: submitted.version.revision })).rejects.toMatchObject({ statusCode: 403 });
    expect((await plans.get(admin, second.id, 1))?.status).toBe('PENDING');
  });

  it('TC-BP-14: hai người lưu cùng version: một thành công, một 409', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES });
    const manager = actor(NV1, { canManage: true, canReadAll: true });
    const results = await Promise.allSettled([
      plans.save(nv1, draft.id, 1, { version: plan.version, lines: [{ kind: 'OTHER', amount: 1 }] }),
      plans.save(manager, draft.id, 1, { version: plan.version, lines: [{ kind: 'OTHER', amount: 2 }] }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ statusCode: 409, code: 'STALE_VERSION' });
    // Lưu với version cũ sau đó cũng 409.
    await expect(plans.save(nv1, draft.id, 1, { version: plan.version, lines: [] })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    // Trình duyệt với version cũ: 409.
    await expect(plans.submit(nv1, draft.id, 1, { version: plan.version })).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('TC-BP-15: nhật ký PAKD: tạo, sửa, trình, duyệt, từ chối đều có dòng audit_log', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES });
    const updated = await plans.save(nv1, draft.id, 1, { version: plan.version, lines: LINES.slice(0, 2) });
    const pending = await plans.submit(nv1, draft.id, 1, { version: updated.version });
    const rejected = await plans.reject(tn, draft.id, 1, { version: pending.version, reason: 'Chưa đạt' });
    const fixed = await plans.save(nv1, draft.id, 1, { version: rejected.version, lines: LINES });
    const again = await plans.submit(nv1, draft.id, 1, { version: fixed.version });
    await plans.approve(tn, draft.id, 1, { version: again.version });
    expect(await auditActions(plan.id)).toEqual([
      { action: 'create', to_status: 'DRAFT' },
      { action: 'update', to_status: 'DRAFT' },
      { action: 'submit', to_status: 'PENDING' },
      { action: 'reject', to_status: 'REJECTED' },
      { action: 'update', to_status: 'DRAFT' },
      { action: 'submit', to_status: 'PENDING' },
      { action: 'approve', to_status: 'APPROVED' },
    ]);
    const rejectRow = (await handle.pool.query(`SELECT actor_id, reason, metadata FROM crm_schema.audit_log WHERE entity_type = 'business_plan' AND action = 'reject' AND entity_id = $1`, [plan.id])).rows[0];
    expect(rejectRow).toMatchObject({ actor_id: TN, reason: 'Chưa đạt', metadata: { versionNo: 1, round: 1, via: 'STANDALONE' } });
    // Duyệt cùng báo giá cũng có nhật ký của PAKD.
    const second = await draftQuote();
    const secondPlan = await plans.save(nv1, second.id, 1, { lines: LINES });
    const submitted = await quotes.submit(nv1, second.id, 1, { revision: second.version.revision });
    await quotes.approve(tn, second.id, 1, { revision: submitted.version.revision });
    expect((await auditActions(secondPlan.id)).map((row) => row.action)).toEqual(['create', 'submit', 'approve']);
  });

  it('TC-P2MIG-03, ràng buộc: một PAKD cho một phiên bản; số tiền không âm; loại hợp lệ', async () => {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: LINES });
    const versionId = (await handle.pool.query(`SELECT id FROM crm_schema.quote_versions WHERE quote_id = $1`, [draft.id])).rows[0].id;
    await expect(
      handle.pool.query(`INSERT INTO crm_schema.business_plans (quote_id, quote_version_id, created_by, updated_by) VALUES ($1, $2, $3, $3)`, [draft.id, versionId, NV1]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      handle.pool.query(`INSERT INTO crm_schema.business_plan_lines (plan_id, line_no, kind, amount) VALUES ($1, 99, 'OTHER', -1)`, [plan.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      handle.pool.query(`INSERT INTO crm_schema.business_plan_lines (plan_id, line_no, kind, amount) VALUES ($1, 99, 'COMMISSION', 1)`, [plan.id]),
    ).rejects.toMatchObject({ code: '23514' });
    // Báo giá bị xoá thì PAKD đi theo (khoá ngoại CASCADE).
    const columns = (await handle.pool.query(`SELECT numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'crm_schema' AND table_name = 'business_plan_lines' AND column_name = 'amount'`)).rows[0];
    expect(columns).toEqual({ numeric_precision: 18, numeric_scale: 2 });
  });

  it('báo giá không có PAKD chạy như trước: không thêm lý do, không đính gì', async () => {
    const draft = await draftQuote();
    expect(draft.approvalCheck).toEqual([]);
    expect(draft.businessPlan).toBeNull();
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted).toMatchObject({ status: 'APPROVED', businessPlan: null });
    // PAKD chỉ lập ở phiên bản Nháp.
    await expect(plans.save(nv1, draft.id, 1, { lines: LINES })).rejects.toMatchObject({ code: 'QUOTE_NOT_DRAFT' });
    expect(await plans.get(nv1, draft.id, 1)).toBeNull();
  });
});
