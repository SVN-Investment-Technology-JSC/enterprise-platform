import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES, type CrmPerson, type ProcedureDefinitionOption } from '@enterprise-platform/contracts-crm';
import { BusinessPlanService } from './application/business-plan.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CrmTaskService } from './application/crm-task.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { QuoteApprovalSettingsService } from './application/quote-approval-settings.service.js';
import type { ProcedureActionableReader, ProcedureClient, StartProcedureInstance } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { CrmConflictError } from './domain/crm.error.js';
import type { CrmSourceSummary } from './domain/procedure-source-summary.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { procedureUnavailable } from './infrastructure/http-procedure-client.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import {
  applyBusinessPlanProcedureResult,
  applyBusinessPlanProcedureReversed,
  PostgresBusinessPlanStore,
} from './infrastructure/postgres-business-plan.store.js';
import { PostgresCrmTaskStore } from './infrastructure/postgres-crm-task.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresDiscountPolicyStore, PostgresPriceListStore, PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { PostgresApprovalLinks } from './infrastructure/quote-procedure-links.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const TN = randomUUID();
const NV1 = randomUUID();
const NV2 = randomUUID();
const NV3 = randomUUID();
const QL = randomUUID();
/** TN quản lý NV1, NV2; NV3 ở nhánh khác (không có cấp dưới). */
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-tn', reportsToPositionId: null },
    { id: 'p-nv1', reportsToPositionId: 'p-tn' },
    { id: 'p-nv2', reportsToPositionId: 'p-tn' },
    { id: 'p-nv3', reportsToPositionId: null },
  ],
  assignments: [
    { userId: TN, positionId: 'p-tn' },
    { userId: NV1, positionId: 'p-nv1' },
    { userId: NV2, positionId: 'p-nv2' },
    { userId: NV3, positionId: 'p-nv3' },
  ],
};
const PEOPLE: CrmPerson[] = [
  { userId: NV1, displayName: 'Nhân viên Một' },
  { userId: TN, displayName: 'Trưởng nhóm' },
];

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

/** Quy trình giả: một khoá một hồ sơ; người thao tác được theo `assignees`; ghi lại thông tin nguồn nhận được. */
class FakeProcedure implements ProcedureClient, ProcedureActionableReader {
  calls: StartProcedureInstance[] = [];
  summaryUpdates: { instanceId: string; summary: CrmSourceSummary }[] = [];
  actionableCalls: string[][] = [];
  summaryAvailable = true;
  actionableAvailable = true;
  readonly assignees = new Map<string, Set<string>>();
  readonly byKey = new Map<string, { id: string; code: string }>();
  readonly definition: ProcedureDefinitionOption = { id: randomUUID(), code: 'QT-BG', name: 'Duyệt báo giá' };

  async startInstance(_tenantId: string, request: StartProcedureInstance) {
    this.calls.push(request);
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return existing;
    const created = { id: randomUUID(), code: `HS${this.byKey.size + 1}` };
    this.byKey.set(request.idempotencyKey, created);
    return created;
  }
  async publishedDefinition(_tenantId: string, definitionId: string) {
    if (definitionId !== this.definition.id) {
      throw new CrmConflictError('PROCEDURE_NOT_PUBLISHED', 'Quy trình không tồn tại hoặc chưa có phiên bản công bố.');
    }
    return this.definition;
  }
  async listPublished() {
    return [this.definition];
  }
  async updateSourceSummary(_tenantId: string, instanceId: string, summary: CrmSourceSummary) {
    if (!this.summaryAvailable) throw procedureUnavailable();
    this.summaryUpdates.push({ instanceId, summary });
    return true;
  }
  async actionableInstanceIds(_tenantId: string, actorUserId: string, ids: readonly string[]) {
    if (!this.actionableAvailable) throw procedureUnavailable();
    this.actionableCalls.push([...ids]);
    return ids.filter((id) => this.assignees.get(id)?.has(actorUserId));
  }
  lastCall(sourceType: string): StartProcedureInstance {
    const call = [...this.calls].reverse().find((entry) => entry.sourceType === sourceType);
    if (!call) throw new Error(`no ${sourceType} call`);
    return call;
  }
}

integration('Bán hàng phase 3 C7: thông tin nguồn, PAKD qua Quy trình, việc cần xử lý (PostgreSQL)', () => {
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
  const nv2 = actor(NV2, { canApproveQuote: true, canReadAll: true });
  const nv3 = actor(NV3, { canApproveQuote: true });
  const tn = actor(TN, { canApproveQuote: true });
  const ql = actor(QL, { canApproveQuote: true, canReadAll: true });
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true });

  const procedure = new FakeProcedure();
  let quotes: QuoteService;
  let plans: BusinessPlanService;
  let settings: QuoteApprovalSettingsService;
  let tasks: CrmTaskService;
  let links: PostgresApprovalLinks;
  let customerId: string;
  const warnings: string[] = [];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const people = { people: async () => PEOPLE };
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const customers = new CustomerService(customerStore, scopes);
    const settingsStore = new PostgresQuoteSettingsStore(handle.database);
    settings = new QuoteApprovalSettingsService(settingsStore, procedure);
    const quoteStore = new PostgresQuoteStore(handle.database);
    links = new PostgresApprovalLinks(handle.database, procedure, people);
    plans = new BusinessPlanService(new PostgresBusinessPlanStore(handle.database), quoteStore, scopes, settingsStore, links);
    tasks = new CrmTaskService(new PostgresCrmTaskStore(handle.database), scopes, procedure, people, (message) => warnings.push(message));
    quotes = new QuoteService(
      quoteStore,
      settingsStore,
      new PostgresPricingStore(handle.database),
      new FakeCatalog(),
      customerStore,
      opportunityStore,
      scopes,
      links,
      { snapshot: async () => ORGANIZATION },
      undefined,
      plans,
      undefined,
      undefined,
      tasks,
    );
    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 }],
    });
    // Chính sách 3%: 10 cáp không ghi đè, biên 17,53%, duyệt thẳng; ghi đè 12% thì vượt hạn mức nhân viên (Chờ duyệt).
    await new DiscountPolicyService(new PostgresDiscountPolicyStore(handle.database)).create(admin, {
      code: 'CK-CAP-3',
      name: 'Cáp 3%',
      percent: 3,
      validFrom: '2026-01-01',
      appliesToAllCustomers: true,
      rules: [{ criterion: 'MATERIAL', refId: CAP, refText: 'QA-KHO-CAP' }],
    });
    customerId = (await customers.create(nv1, { name: 'Công ty Việc Cần Làm', ownerUserId: NV1 })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  beforeEach(async () => {
    procedure.summaryAvailable = true;
    procedure.actionableAvailable = true;
    await settings.saveBinding(admin, 'QUOTE', { mode: 'DIRECT' });
    await settings.saveBinding(admin, 'BUSINESS_PLAN', { mode: 'DIRECT' });
  });

  async function draftQuote(discount?: number) {
    const created = await quotes.create(nv1, { customerId });
    return quotes.addLine(nv1, created.id, created.currentVersion, {
      revision: created.version.revision,
      materialId: CAP,
      quantity: 10,
      overrideDiscountPercent: discount ?? null,
    });
  }
  /** Báo giá Chờ duyệt (ghi đè 12%) do NV1 gửi. */
  async function pendingQuote() {
    const draft = await draftQuote(12);
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted.status).toBe('PENDING');
    return submitted;
  }
  /** Báo giá Nháp có PAKD đã trình riêng. */
  async function submittedPlan() {
    const draft = await draftQuote();
    const plan = await plans.save(nv1, draft.id, 1, { lines: [{ kind: 'SUBCONTRACT', description: 'Thầu phụ', amount: 200_000 }] });
    const submitted = await plans.submit(nv1, draft.id, 1, { version: plan.version });
    expect(submitted.status).toBe('PENDING');
    return { quote: draft, plan: submitted };
  }
  const planLink = async (quoteId: string) =>
    (
      await handle.pool.query<{ id: string; status: string; instance_id: string | null; source_summary_synced_at: Date | null }>(
        `SELECT l.id, l.status, l.instance_id, l.source_summary_synced_at
           FROM crm_schema.procedure_links l JOIN crm_schema.business_plan_rounds r ON r.id = l.source_id
          WHERE l.source_type = 'crm_business_plan' AND r.quote_id = $1 ORDER BY r.round_no DESC LIMIT 1`,
        [quoteId],
      )
    ).rows[0];
  const quoteLink = async (quoteId: string) =>
    (
      await handle.pool.query<{ id: string; instance_id: string; source_summary_synced_at: Date | null }>(
        `SELECT l.id, l.instance_id, l.source_summary_synced_at FROM crm_schema.procedure_links l
           JOIN crm_schema.quote_versions v ON v.id = l.source_id WHERE l.source_type = 'crm_quote' AND v.quote_id = $1`,
        [quoteId],
      )
    ).rows[0];
  const awaitingIds = async (viewer: CrmActor) => (await tasks.myTasks(viewer)).awaitingMe.map((task) => task.quoteId);

  // -------------------------------------------------------------------------

  it('TC-TSK-05: trình báo giá vượt ngưỡng có PAKD gửi thông tin nguồn; hồ sơ đang chạy chưa có thì đồng bộ bổ sung một lần', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const draft = await draftQuote(12);
    await plans.save(nv1, draft.id, 1, { lines: [{ kind: 'SUBCONTRACT', amount: 200_000 }] });
    const submitted = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(submitted.status).toBe('PENDING');

    const call = procedure.lastCall('crm_quote');
    const summary = call.sourceSummary as CrmSourceSummary;
    expect(summary.title).toBe(`Báo giá ${draft.code} v1`);
    expect(summary.url).toBe(`/modules/crm#quotes/${draft.id}`);
    expect(summary.urlLabel).toBe('Mở báo giá trong Bán hàng');
    const value = (label: string) => summary.items.find((item) => item.label === label)?.value;
    expect(value('Khách hàng')).toBe('Công ty Việc Cần Làm');
    expect(value('Người phụ trách')).toBe('Nhân viên Một');
    expect(value('Tổng tiền')).toBe(`${new Intl.NumberFormat('vi-VN').format(submitted.version.totals.totalAmount)} đ`);
    expect(value('Biên lợi nhuận ước tính')).toMatch(/^\d+(,\d+)?%$/);
    expect(value('PAKD - Lợi nhuận')).toMatch(/ đ$/);
    const reasons = summary.items.filter((item) => item.label === 'Lý do cần duyệt').map((item) => item.value);
    expect(reasons).toEqual(submitted.version.approvalReasons.map((reason) => reason.message));
    expect(reasons.length).toBeGreaterThan(1);
    expect((await quoteLink(draft.id)).source_summary_synced_at).not.toBeNull();

    // Hồ sơ cũ (tạo trước khi CRM gửi thông tin nguồn): Quy trình tạm lỗi thì để lượt sau, nhận rồi thì không gửi lại.
    await handle.pool.query(`UPDATE crm_schema.procedure_links SET source_summary_synced_at = NULL WHERE source_type = 'crm_quote'`);
    const link = await quoteLink(draft.id);
    procedure.summaryAvailable = false;
    await links.syncSourceSummaries(tenantId, 100);
    expect((await quoteLink(draft.id)).source_summary_synced_at).toBeNull();
    procedure.summaryAvailable = true;
    await links.syncSourceSummaries(tenantId, 100);
    const sent = procedure.summaryUpdates.filter((update) => update.instanceId === link.instance_id);
    expect(sent).toHaveLength(1);
    expect(sent[0].summary).toEqual(summary);
    await links.sync(tenantId);
    expect(procedure.summaryUpdates.filter((update) => update.instanceId === link.instance_id)).toHaveLength(1);
  });

  it('TC-TSK-06: loại PAKD trình riêng mặc định Trực tiếp; gắn Quy trình cần quy trình đã công bố', async () => {
    await handle.pool.query(`DELETE FROM crm_schema.approval_bindings WHERE kind = 'BUSINESS_PLAN'`);
    expect((await settings.bindings(admin)).find((binding) => binding.kind === 'BUSINESS_PLAN')).toMatchObject({ mode: 'DIRECT' });
    await expect(
      settings.saveBinding(admin, 'BUSINESS_PLAN', { mode: 'PROCEDURE', procedureDefinitionId: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PROCEDURE_NOT_PUBLISHED' });
    const saved = await settings.saveBinding(admin, 'BUSINESS_PLAN', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    expect(saved.find((binding) => binding.kind === 'BUSINESS_PLAN')).toMatchObject({
      mode: 'PROCEDURE',
      procedureDefinitionId: procedure.definition.id,
    });
  });

  it('TC-TSK-07: PAKD trình riêng qua Quy trình: hồ sơ crm_business_plan; chặn duyệt tay; duyệt, từ chối, thu hồi theo Quy trình', async () => {
    await settings.saveBinding(admin, 'BUSINESS_PLAN', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const first = await submittedPlan();
    const call = procedure.lastCall('crm_business_plan');
    expect(call).toMatchObject({
      definitionId: procedure.definition.id,
      title: `Duyệt PAKD báo giá ${first.quote.code} v1 - Công ty Việc Cần Làm`,
      autoCompleteInitiatorStep: true,
      initiatedBy: NV1,
    });
    expect(call.sourceSummary).toMatchObject({
      title: `PAKD báo giá ${first.quote.code} v1`,
      url: `/modules/crm#quotes/${first.quote.id}`,
      items: expect.arrayContaining([
        { label: 'Khách hàng', value: 'Công ty Việc Cần Làm' },
        { label: 'Người phụ trách', value: 'Nhân viên Một' },
        expect.objectContaining({ label: 'Doanh thu' }),
        expect.objectContaining({ label: 'Biên lợi nhuận' }),
      ]),
    });
    const link = await planLink(first.quote.id);
    expect(link).toMatchObject({ status: 'RUNNING' });
    expect(link.instance_id).toBe(procedure.byKey.get(`crm:${link.id}`)?.id);
    expect(link.source_summary_synced_at).not.toBeNull();

    await expect(plans.approve(tn, first.quote.id, 1, { version: first.plan.version })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_IN_PROCEDURE',
      message: 'Phương án kinh doanh đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.',
    });

    const completed = { sourceType: 'crm_business_plan', sourceId: link.id, instanceId: link.instance_id as string, instanceCode: 'HS-PAKD', status: 'completed', actorId: TN };
    expect(await applyBusinessPlanProcedureResult(handle.database, tenantId, completed)).toBe('applied');
    expect(await applyBusinessPlanProcedureResult(handle.database, tenantId, completed)).toBe('ignored');
    const approved = await plans.get(nv1, first.quote.id, 1);
    expect(approved).toMatchObject({ status: 'APPROVED', decidedBy: TN, decisionReason: 'Theo quy trình HS-PAKD' });

    // Thu hồi trên Quy trình: PAKD về Bị từ chối, sửa lại được.
    const reversed = { sourceType: 'crm_business_plan', sourceId: link.id, instanceId: link.instance_id as string, reason: 'Nhầm số', reversedBy: TN };
    expect(await applyBusinessPlanProcedureReversed(handle.database, tenantId, reversed)).toBe('applied');
    expect(await applyBusinessPlanProcedureReversed(handle.database, tenantId, reversed)).toBe('ignored');
    expect(await plans.get(nv1, first.quote.id, 1)).toMatchObject({ status: 'REJECTED', decisionReason: 'Quy trình đã thu hồi: Nhầm số' });

    // Trình lần 2 (báo giá khác), từ chối trên Quy trình kèm lý do.
    const second = await submittedPlan();
    const secondLink = await planLink(second.quote.id);
    expect(
      await applyBusinessPlanProcedureResult(handle.database, tenantId, {
        sourceType: 'crm_business_plan',
        sourceId: secondLink.id,
        instanceId: secondLink.instance_id as string,
        status: 'rejected',
        reason: 'Chi phí thầu phụ chưa hợp lý',
        actorId: TN,
      }),
    ).toBe('applied');
    const rejected = await plans.get(nv1, second.quote.id, 1);
    expect(rejected).toMatchObject({ status: 'REJECTED', decisionReason: 'Chi phí thầu phụ chưa hợp lý' });
    expect(rejected?.rounds.at(-1)).toMatchObject({ decision: 'REJECTED', reason: 'Chi phí thầu phụ chưa hợp lý', via: 'STANDALONE' });
    expect((await planLink(second.quote.id)).status).toBe('APPLIED');
  });

  it('TC-TSK-08: PAKD trình riêng trực tiếp: không tạo hồ sơ, duyệt trong CRM như phase 2', async () => {
    const before = procedure.calls.length;
    const { quote, plan } = await submittedPlan();
    expect(procedure.calls.length).toBe(before);
    expect(await planLink(quote.id)).toBeUndefined();
    await expect(plans.approve(nv1, quote.id, 1, { version: plan.version })).rejects.toMatchObject({ statusCode: 403 });
    expect(await plans.approve(tn, quote.id, 1, { version: plan.version })).toMatchObject({ status: 'APPROVED', decidedBy: TN });
  });

  it('TC-TSK-09: chờ tôi duyệt qua Quy trình: người được giao bước thấy kèm id hồ sơ; người khác và người trình không thấy', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const quote = await pendingQuote();
    const link = await quoteLink(quote.id);
    procedure.assignees.set(link.instance_id, new Set([TN, NV1]));

    const list = await tasks.myTasks(tn);
    const task = list.awaitingMe.find((entry) => entry.quoteId === quote.id);
    expect(task).toMatchObject({
      kind: 'QUOTE_APPROVAL',
      quoteCode: quote.code,
      versionNo: 1,
      customerName: 'Công ty Việc Cần Làm',
      ownerName: 'Nhân viên Một',
      actorUserId: NV1,
      actorName: 'Nhân viên Một',
      totalAmount: quote.version.totals.totalAmount,
      marginPercent: quote.version.totals.marginPercent,
      reasons: quote.version.approvalReasons.map((reason) => reason.message),
      approval: { subject: 'QUOTE', mode: 'PROCEDURE', procedureInstanceId: link.instance_id, procedureInstanceCode: expect.any(String) },
    });
    expect(await awaitingIds(nv2)).not.toContain(quote.id);
    // Người trình không tự duyệt, kể cả khi Quy trình giao cho họ.
    expect(await awaitingIds(nv1)).not.toContain(quote.id);
    expect(procedure.actionableCalls.every((ids) => ids.length <= 100)).toBe(true);

    // Quy trình lỗi: trang vẫn trả, chỉ thiếu việc qua Quy trình, có ghi log.
    procedure.actionableAvailable = false;
    const fallback = await tasks.myTasks(tn);
    expect(fallback.awaitingMe.map((entry) => entry.quoteId)).not.toContain(quote.id);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('TC-TSK-10: chờ tôi duyệt trực tiếp: người có quyền duyệt trong phạm vi thấy; ngoài phạm vi và người trình không thấy', async () => {
    const quote = await pendingQuote();
    const tnTask = (await tasks.myTasks(tn)).awaitingMe.find((entry) => entry.quoteId === quote.id);
    expect(tnTask?.approval).toEqual({ subject: 'QUOTE', mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null });
    expect(await awaitingIds(ql)).toContain(quote.id);
    expect(await awaitingIds(nv3)).not.toContain(quote.id);
    expect(await awaitingIds(nv1)).not.toContain(quote.id);

    // PAKD trình riêng chờ duyệt trực tiếp cũng vào danh sách.
    const { quote: planQuote } = await submittedPlan();
    const planTask = (await tasks.myTasks(tn)).awaitingMe.find((entry) => entry.quoteId === planQuote.id);
    expect(planTask).toMatchObject({ kind: 'BUSINESS_PLAN_APPROVAL', approval: { subject: 'BUSINESS_PLAN', mode: 'DIRECT' } });
    // Không có quyền duyệt thì không có việc chờ duyệt trực tiếp, kể cả khi thấy mọi dữ liệu.
    const reader = actor(randomUUID(), { canWriteQuote: false, canWriteOpportunity: false, canReadAll: true });
    expect(await awaitingIds(reader)).toEqual([]);
  });

  it('TC-TSK-11: việc của tôi: báo giá bị từ chối kèm lý do, báo giá đã duyệt chờ gửi, PAKD trình riêng bị từ chối', async () => {
    const rejected = await pendingQuote();
    await quotes.reject(tn, rejected.id, 1, { revision: rejected.version.revision, reason: 'Giá thấp quá' });
    const draft = await draftQuote();
    const approved = await quotes.submit(nv1, draft.id, 1, { revision: draft.version.revision });
    expect(approved.status).toBe('APPROVED');
    const { quote: planQuote, plan } = await submittedPlan();
    await plans.reject(tn, planQuote.id, 1, { version: plan.version, reason: 'Sửa chi phí' });

    const mine = (await tasks.myTasks(nv1)).mine;
    const of = (id: string) => mine.find((task) => task.quoteId === id);
    expect(of(rejected.id)).toMatchObject({ kind: 'QUOTE_REJECTED', reasons: ['Giá thấp quá'], actorUserId: TN, actorName: 'Trưởng nhóm', approval: null });
    expect(of(draft.id)).toMatchObject({ kind: 'QUOTE_READY_TO_SEND', reasons: [] });
    expect(of(planQuote.id)).toMatchObject({ kind: 'BUSINESS_PLAN_REJECTED', reasons: ['Sửa chi phí'], actorUserId: TN });
    const ats = mine.map((task) => task.at ?? '');
    expect([...ats].sort().reverse()).toEqual(ats);

    const other = (await tasks.myTasks(nv2)).mine.map((task) => task.quoteId);
    expect(other).not.toEqual(expect.arrayContaining([rejected.id]));
    expect(other).not.toContain(draft.id);
    expect(other).not.toContain(planQuote.id);
  });

  it('TC-TSK-12: lọc "Cần tôi duyệt" ở danh sách báo giá và cờ trên màn báo giá', async () => {
    await settings.saveBinding(admin, 'QUOTE', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    const mineQuote = await pendingQuote();
    const link = await quoteLink(mineQuote.id);
    procedure.assignees.set(link.instance_id, new Set([TN]));
    const notMine = await pendingQuote();

    const page = await quotes.list(tn, { awaitingMyApproval: true, limit: 100 });
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(mineQuote.id);
    expect(ids).not.toContain(notMine.id);
    expect([...ids].sort()).toEqual([...(await tasks.awaitingQuoteIds(tn))].sort());
    expect((await quotes.list(nv3, { awaitingMyApproval: true })).items).toEqual([]);
    // Không lọc thì vẫn thấy cả báo giá không chờ mình.
    expect((await quotes.list(tn, { limit: 100 })).items.map((item) => item.id)).toContain(notMine.id);

    expect((await quotes.get(tn, mineQuote.id)).awaitingMyApproval).toEqual({
      subject: 'QUOTE',
      mode: 'PROCEDURE',
      procedureInstanceId: link.instance_id,
      procedureInstanceCode: expect.any(String),
    });
    expect((await quotes.get(nv1, mineQuote.id)).awaitingMyApproval).toBeNull();
    expect((await quotes.get(tn, notMine.id)).awaitingMyApproval).toBeNull();
  });
});
