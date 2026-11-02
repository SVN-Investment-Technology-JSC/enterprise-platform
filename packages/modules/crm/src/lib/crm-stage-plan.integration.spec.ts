import { randomUUID } from 'node:crypto';
import {
  CRM_NO_CAPABILITIES,
  CRM_OPPORTUNITY_STAGE_ASSIGNED,
  type OpportunityStagePlan,
} from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { StageAssigneeResolver } from './application/stage-assignee.resolver.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const QL = randomUUID();
const NV1 = randomUUID();
const NV2 = randomUUID();
const NV3 = randomUUID();
const NV4 = randomUUID();
const OUTSIDER = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-ql', reportsToPositionId: null },
    { id: 'p-nv1', reportsToPositionId: 'p-ql' },
    { id: 'p-nv2', reportsToPositionId: 'p-ql' },
    { id: 'p-nv3', reportsToPositionId: 'p-ql' },
    { id: 'p-nv4', reportsToPositionId: 'p-ql' },
  ],
  assignments: [
    { userId: QL, positionId: 'p-ql' },
    { userId: NV1, positionId: 'p-nv1' },
    { userId: NV2, positionId: 'p-nv2' },
    { userId: NV3, positionId: 'p-nv3' },
    { userId: NV4, positionId: 'p-nv4' },
  ],
};
const PEOPLE = [QL, NV1, NV2, NV3, NV4].map((userId) => ({ userId, displayName: userId.slice(0, 4) }));

/**
 * Kế hoạch giai đoạn, bỏ qua giai đoạn, phạm vi theo người được gán, quyền chuyển giai đoạn, "Việc của tôi"
 * (GĐ B, P2B-15..18), trên luồng mặc định 7 giai đoạn với cấu hình gán người ghi trực tiếp vào DB.
 */
integration('Bán hàng GĐ B: kế hoạch giai đoạn, bỏ qua, phạm vi và quyền chuyển (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let leads: LeadService;
  let quotes: PostgresQuoteStore;
  let scopes: CrmDataScopeService;
  let config: CachedPipelineConfig;
  let customerId: string;
  const tenantId = randomUUID();
  const actorOf = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    ...extra,
  });
  const nv1 = actorOf(NV1);
  const nv2 = actorOf(NV2);
  const nv3 = actorOf(NV3);
  const nv4 = actorOf(NV4);
  const manager = actorOf(QL, { canManage: true, canReadAll: true });

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await handle.pool.query(text, values)).rows as T[];
  const stageIdOf = async (pipelineId: string, code: string): Promise<string> =>
    (await query<{ id: string }>(`SELECT id FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 AND code = $2`, [pipelineId, code]))[0].id;
  const item = (plan: OpportunityStagePlan, code: string) => plan.items.find((candidate) => candidate.stage.code === code)!;
  const create = (actor: CrmActor, name: string, extra: Record<string, unknown> = {}) =>
    opportunities.create(actor, { customerId, name, ...extra });
  const outbox = (opportunityId: string, type: string) =>
    query<{ payload: { payload: Record<string, unknown> } }>(
      `SELECT payload FROM integration_schema.outbox_events WHERE aggregate_id = $1 AND event_type = $2 ORDER BY occurred_at, id`,
      [opportunityId, type],
    );
  const audit = (opportunityId: string, action: string) =>
    query<{ reason: string | null; actor_id: string; metadata: Record<string, unknown> }>(
      `SELECT reason, actor_id, metadata FROM crm_schema.audit_log
        WHERE entity_type = 'opportunity' AND entity_id = $1 AND action = $2 ORDER BY at, id`,
      [opportunityId, action],
    );

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const store = new PostgresOpportunityStore(handle.database);
    quotes = new PostgresQuoteStore(handle.database);
    config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    const organization = { snapshot: async () => ORGANIZATION, people: async () => PEOPLE };
    opportunities = new OpportunityService(
      store,
      customerStore,
      scopes,
      config,
      undefined,
      undefined,
      new StageAssigneeResolver(organization),
      organization,
    );
    leads = new LeadService(new PostgresLeadStore(handle.database), scopes);
    customerId = (await new CustomerService(customerStore, scopes).create(manager, { name: 'Khách kế hoạch', ownerUserId: NV1 })).id;

    // Cấu hình gán người và bỏ qua trên luồng mặc định.
    await query(
      `UPDATE crm_schema.pipeline_stages s
          SET skippable = v.skippable, assignee_rule = v.rule, assignee_param = v.param
         FROM (VALUES ('NEW', false, 'PROJECT_OWNER', NULL), ('CONTACTED', true, 'PROJECT_OWNER', NULL),
                      ('DISCOVERY', true, 'DIRECT_MANAGER', NULL), ('QUOTING', false, 'POSITION', 'p-ql'),
                      ('NEGOTIATION', false, 'NONE', NULL)) AS v (code, skippable, rule, param)
        WHERE s.code = v.code AND s.pipeline_id = (SELECT id FROM crm_schema.pipelines WHERE is_default)`,
    );
    // Điều kiện của giai đoạn Khảo sát: phải có nhu cầu (kiểm TC-SKP-05).
    const defaultPipelineId = (await query<{ id: string }>(`SELECT id FROM crm_schema.pipelines WHERE is_default`))[0].id;
    await query(
      `INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order)
       VALUES ($1, 'FIELD', 'need', true, 'Cần điền nhu cầu trước khi sang Khảo sát.', 1)`,
      [await stageIdOf(defaultPipelineId, 'DISCOVERY')],
    );
    config.invalidate();
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-ASG-01/02 và quy tắc theo chức danh: tạo dự án sinh kế hoạch, gán theo chủ dự án, quản lý trực tiếp, chức danh', async () => {
    const created = await create(nv1, 'Kế hoạch 1');
    const plan = await opportunities.stagePlan(nv1, created.id);
    expect(plan.items.map((entry) => [entry.stage.code, entry.status])).toEqual([
      ['NEW', 'ACTIVE'], ['CONTACTED', 'PENDING'], ['DISCOVERY', 'PENDING'], ['QUOTING', 'PENDING'],
      ['NEGOTIATION', 'PENDING'], ['WON', 'PENDING'], ['LOST', 'PENDING'],
    ]);
    expect(item(plan, 'NEW').assigneeUserId).toBe(NV1);
    expect(item(plan, 'CONTACTED').assigneeUserId).toBe(NV1);
    expect(item(plan, 'DISCOVERY').assigneeUserId).toBe(QL);
    expect(item(plan, 'QUOTING').assigneeUserId).toBe(QL);
    expect(item(plan, 'NEGOTIATION')).toMatchObject({ assigneeUserId: null, assigneeWarning: null });
    // Mỗi người được gán (khác người tạo) có thông báo qua sự kiện outbox cùng transaction.
    const events = await outbox(created.id, CRM_OPPORTUNITY_STAGE_ASSIGNED);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.some((event) => (event.payload.payload['recipientUserIds'] as string[]).includes(QL))).toBe(true);
  });

  it('TC-ASG-05: không tìm được người (chủ ngoài sơ đồ) thì tạo được, giai đoạn trống kèm cảnh báo', async () => {
    const outsiderCustomer = (await new CustomerService(new PostgresCustomerStore(handle.database), scopes).create(actorOf(OUTSIDER), { name: 'Khách ngoài sơ đồ' })).id;
    const created = await opportunities.create(actorOf(OUTSIDER), { customerId: outsiderCustomer, name: 'Chủ ngoài sơ đồ' });
    const plan = await opportunities.stagePlan(actorOf(OUTSIDER), created.id);
    expect(item(plan, 'DISCOVERY')).toMatchObject({ assigneeUserId: null });
    expect(item(plan, 'DISCOVERY').assigneeWarning).toContain('sơ đồ tổ chức');
    expect(item(plan, 'NEW').assigneeUserId).toBe(OUTSIDER);
  });

  it('TC-ASG-06: ghi đè người đảm nhận theo từng dự án, ghi audit_log; người không phải chủ hay quản trị bị 403', async () => {
    const a = await create(nv1, 'Dự án A');
    const b = await create(manager, 'Dự án B', { ownerUserId: NV4 });
    const quoting = await stageIdOf(a.pipeline.id, 'QUOTING');
    const planA = await opportunities.updateStageAssignee(nv1, a.id, quoting, { assigneeUserId: NV2, dueDate: '2026-12-01' });
    const planB = await opportunities.updateStageAssignee(manager, b.id, quoting, { assigneeUserId: NV3 });
    expect(item(planA, 'QUOTING')).toMatchObject({ assigneeUserId: NV2, assignedBy: NV1, dueDate: '2026-12-01', assigneeWarning: null });
    expect(item(planB, 'QUOTING')).toMatchObject({ assigneeUserId: NV3, assignedBy: QL });
    expect((await opportunities.stagePlan(nv1, a.id)).items.find((x) => x.stage.code === 'QUOTING')?.assigneeUserId).toBe(NV2);

    const rows = await audit(a.id, 'assign_stage');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: NV1, metadata: { stageCode: 'QUOTING', fromAssigneeUserId: QL, toAssigneeUserId: NV2 } });
    // Đổi sang cùng người: không ghi thêm.
    await opportunities.updateStageAssignee(nv1, a.id, quoting, { assigneeUserId: NV2 });
    expect(await audit(a.id, 'assign_stage')).toHaveLength(1);

    await expect(opportunities.updateStageAssignee(nv4, a.id, quoting, { assigneeUserId: NV4 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(opportunities.updateStageAssignee(nv2, a.id, quoting, { assigneeUserId: NV2 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(opportunities.updateStageAssignee(nv1, a.id, quoting, { assigneeUserId: randomUUID() })).rejects.toMatchObject({ statusCode: 400 });
    // Giai đoạn đã xong không đổi người được.
    await expect(opportunities.updateStageAssignee(nv1, a.id, await stageIdOf(a.pipeline.id, 'NEW'), { assigneeUserId: NV3 })).resolves.toBeDefined();
  });

  it('TC-ASG-07: người được gán thấy dự án, báo giá và tên khách của dự án đó; không thấy dự án khác của khách', async () => {
    const a = await create(nv1, 'Dự án A7');
    const b = await create(manager, 'Dự án B7', { ownerUserId: NV4 });
    const quoting = await stageIdOf(a.pipeline.id, 'QUOTING');
    await opportunities.updateStageAssignee(nv1, a.id, quoting, { assigneeUserId: NV2 });
    // Chủ chuyển tới Báo giá: sinh nháp báo giá của dự án A.
    await handle.pool.query(`UPDATE crm_schema.opportunities SET need = 'Cần' WHERE id = $1`, [a.id]);
    for (const stage of ['CONTACTED', 'DISCOVERY']) await opportunities.changeStage(manager, a.id, { stage });
    await opportunities.changeStage(manager, a.id, { stage: 'QUOTING' });
    const quoteId = (await query<{ id: string }>(`SELECT id FROM crm_schema.quotes WHERE opportunity_id = $1`, [a.id]))[0].id;

    const scopeNv2 = await scopes.resolve(nv2);
    expect(scopeNv2).toMatchObject({ kind: 'users', selfUserId: NV2 });
    const list = await opportunities.list(nv2, { customerId });
    // Khách có nhiều dự án (cả dự án A của TC-ASG-06 NV2 cũng được gán); dự án B7 của NV4 không lọt vào.
    expect(list.items.map((entry) => entry.id)).toContain(a.id);
    expect(list.items.map((entry) => entry.id)).not.toContain(b.id);
    expect(list.items.find((entry) => entry.id === a.id)).toMatchObject({ customerName: 'Khách kế hoạch' });
    await expect(opportunities.get(nv2, a.id)).resolves.toMatchObject({ id: a.id, customerName: 'Khách kế hoạch' });
    await expect(opportunities.get(nv2, b.id)).rejects.toMatchObject({ statusCode: 404 });
    // Bảng kanban cũng lọc theo phạm vi.
    const board = await opportunities.board(nv2, {});
    const onBoard = board.columns.flatMap((column) => column.items.map((entry) => entry.id));
    expect(onBoard).toContain(a.id);
    expect(onBoard).not.toContain(b.id);
    // Báo giá của dự án A đọc được (danh sách và chi tiết); báo giá dự án khác thì không.
    expect((await quotes.listQuotes(tenantId, scopeNv2, { opportunityId: a.id, limit: 10 })).items.map((q) => q.id)).toEqual([quoteId]);
    await expect(quotes.getQuote(tenantId, scopeNv2, quoteId)).resolves.toMatchObject({ id: quoteId });
    await opportunities.changeStage(manager, b.id, { stage: 'CONTACTED' });
    const visibleQuotes = (await quotes.listQuotes(tenantId, scopeNv2, { limit: 50 })).items;
    expect(visibleQuotes.map((q) => q.id)).toContain(quoteId);
    expect(visibleQuotes.every((q) => q.opportunityId !== b.id)).toBe(true);
  });

  it('TC-ASG-08: người ngoài phạm vi và không được gán nhận 404 (mọi đường đọc, kế hoạch, bỏ qua, gán người)', async () => {
    const a = await create(nv1, 'Dự án A8');
    for (const act of [
      () => opportunities.get(nv3, a.id),
      () => opportunities.stagePlan(nv3, a.id),
      () => opportunities.skipStage(nv3, a.id, randomUUID(), { reason: 'x' }),
      () => opportunities.changeStage(nv3, a.id, { stage: 'CONTACTED' }),
    ]) {
      await expect(act()).rejects.toMatchObject({ statusCode: 404 });
    }
    expect((await opportunities.list(nv3, {})).items.map((entry) => entry.id)).not.toContain(a.id);
    const scope3 = await scopes.resolve(nv3);
    await expect(quotes.getQuote(tenantId, scope3, randomUUID())).resolves.toBeUndefined();
  });

  it('TC-ASG-07: giai đoạn đã xong (DONE) không còn mở phạm vi cho người được gán', async () => {
    const a = await create(nv1, 'Dự án A7b');
    await opportunities.updateStageAssignee(nv1, a.id, await stageIdOf(a.pipeline.id, 'CONTACTED'), { assigneeUserId: NV3 });
    await expect(opportunities.get(nv3, a.id)).resolves.toMatchObject({ id: a.id });
    await opportunities.changeStage(nv1, a.id, { stage: 'CONTACTED' });
    await opportunities.changeStage(nv1, a.id, { stage: 'LOST', reason: 'Khách huỷ' });
    // Dự án đóng: giai đoạn CONTACTED là ACTIVE -> DONE khi đóng; NV3 hết việc.
    expect((await opportunities.myStageTasks(nv3)).map((task) => task.opportunityId)).not.toContain(a.id);
  });

  it('TC-ASG-09: chỉ người đảm nhận giai đoạn hiện tại, chủ dự án hoặc crm.manage chuyển giai đoạn; còn lại 403', async () => {
    const outsider = actorOf(NV3, { canReadAll: true });
    const c = await create(nv1, 'Dự án C9');
    await opportunities.updateStageAssignee(nv1, c.id, await stageIdOf(c.pipeline.id, 'NEW'), { assigneeUserId: NV2 });
    await expect(opportunities.changeStage(outsider, c.id, { stage: 'CONTACTED' })).rejects.toMatchObject({ statusCode: 403 });
    await opportunities.changeStage(nv2, c.id, { stage: 'CONTACTED' });
    // Giai đoạn NEW đã xong: NV2 hết được gán nên không còn thấy dự án (404), càng không chuyển được.
    await expect(opportunities.changeStage(nv2, c.id, { stage: 'DISCOVERY' })).rejects.toMatchObject({ statusCode: 404 });
    await handle.pool.query(`UPDATE crm_schema.opportunities SET need = 'Cần' WHERE id = $1`, [c.id]);
    await opportunities.changeStage(nv1, c.id, { stage: 'DISCOVERY' });
    await opportunities.changeStage(manager, c.id, { stage: 'QUOTING' });
    const plan = await opportunities.stagePlan(manager, c.id);
    expect(plan.items.map((entry) => [entry.stage.code, entry.status]).slice(0, 5)).toEqual([
      ['NEW', 'DONE'], ['CONTACTED', 'DONE'], ['DISCOVERY', 'DONE'], ['QUOTING', 'ACTIVE'], ['NEGOTIATION', 'PENDING'],
    ]);
    // Lùi lại: giai đoạn rời đi về PENDING, giai đoạn đích ACTIVE.
    await opportunities.changeStage(manager, c.id, { stage: 'DISCOVERY' });
    const back = await opportunities.stagePlan(manager, c.id);
    expect(back.items.map((entry) => entry.status).slice(0, 5)).toEqual(['DONE', 'DONE', 'ACTIVE', 'PENDING', 'PENDING']);
  });

  it('TC-ASG-10: đổi người thì phát sự kiện cho người cũ và mới; "Việc của tôi" cập nhật theo', async () => {
    const d = await create(nv1, 'Dự án D10');
    const negotiation = await stageIdOf(d.pipeline.id, 'NEGOTIATION');
    await opportunities.updateStageAssignee(nv1, d.id, negotiation, { assigneeUserId: NV2 });
    expect((await opportunities.myStageTasks(nv2)).filter((task) => task.opportunityId === d.id)).toMatchObject([
      { stage: { code: 'NEGOTIATION' }, status: 'PENDING', customerName: 'Khách kế hoạch' },
    ]);
    await opportunities.updateStageAssignee(nv1, d.id, negotiation, { assigneeUserId: NV3 });
    expect((await opportunities.myStageTasks(nv2)).map((task) => task.opportunityId)).not.toContain(d.id);
    expect((await opportunities.myStageTasks(nv3)).map((task) => task.opportunityId)).toContain(d.id);

    const events = (await outbox(d.id, CRM_OPPORTUNITY_STAGE_ASSIGNED)).map((event) => event.payload.payload);
    const last = events[events.length - 1];
    expect(last).toMatchObject({
      stageCode: 'NEGOTIATION',
      assigneeUserId: NV3,
      previousAssigneeUserId: NV2,
      cause: 'OVERRIDE',
      actorUserId: NV1,
    });
    expect([...(last['recipientUserIds'] as string[])].sort()).toEqual([NV2, NV3].sort());
    // Sự kiện nằm trong outbox cùng transaction: kiểm tra sự kiện có envelope hợp lệ.
    const envelope = (await query<{ payload: { type: string; source: string; tenantId: string } }>(
      `SELECT payload FROM integration_schema.outbox_events WHERE aggregate_id = $1 AND event_type = $2 LIMIT 1`,
      [d.id, CRM_OPPORTUNITY_STAGE_ASSIGNED],
    ))[0].payload;
    expect(envelope).toMatchObject({ type: CRM_OPPORTUNITY_STAGE_ASSIGNED, source: 'crm', tenantId });
  });

  it('TC-SKP-02/06: bỏ qua lúc tạo dự án, kế hoạch ghi lý do, nhật ký và lịch sử có dòng bỏ qua', async () => {
    const e = await create(nv1, 'Dự án E', { skipStages: [{ stage: 'DISCOVERY', reason: 'Khách đã khảo sát trước' }] });
    const plan = await opportunities.stagePlan(nv1, e.id);
    expect(item(plan, 'DISCOVERY')).toMatchObject({
      status: 'SKIPPED',
      skippedReason: 'Khách đã khảo sát trước',
      skippedBy: NV1,
      assigneeUserId: null,
    });
    expect(item(plan, 'NEW').status).toBe('ACTIVE');
    const rows = await audit(e.id, 'skip_stage');
    expect(rows).toMatchObject([{ reason: 'Khách đã khảo sát trước', actor_id: NV1, metadata: { stageCode: 'DISCOVERY', atCreation: true } }]);
    const detail = await opportunities.get(nv1, e.id);
    expect(detail.history.filter((entry) => entry.kind === 'SKIP')).toMatchObject([
      { toStage: 'DISCOVERY', toStageName: 'Khảo sát nhu cầu', actorId: NV1, reason: 'Khách đã khảo sát trước' },
    ]);
    // Không bỏ qua giai đoạn đầu, giai đoạn không cho bỏ qua; thiếu lý do 400.
    await expect(create(nv1, 'X', { skipStages: [{ stage: 'NEW', reason: 'x' }] })).rejects.toMatchObject({ statusCode: 409 });
    await expect(create(nv1, 'X', { skipStages: [{ stage: 'QUOTING', reason: 'x' }] })).rejects.toMatchObject({ statusCode: 409 });
    await expect(create(nv1, 'X', { skipStages: [{ stage: 'DISCOVERY', reason: ' ' }] })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('TC-SKP-04/05: tiến tới giai đoạn kế còn áp dụng; điều kiện của giai đoạn bỏ qua không kiểm', async () => {
    const f = await create(nv1, 'Dự án F', { skipStages: [{ stage: 'DISCOVERY', reason: 'Bỏ qua khảo sát' }] });
    await opportunities.changeStage(nv1, f.id, { stage: 'CONTACTED' });
    const detail = await opportunities.get(nv1, f.id);
    // Từ Đã liên hệ: Khảo sát đã bỏ qua nên tiến thẳng Báo giá (và lùi Mới, Thua).
    expect(detail.nextStages.map((stage) => stage.code)).toEqual(['NEW', 'QUOTING', 'LOST']);
    // Khảo sát yêu cầu "nhu cầu" nhưng dự án chưa có nhu cầu: không bị chặn.
    expect(detail.need).toBeNull();
    await expect(opportunities.changeStage(nv1, f.id, { stage: 'DISCOVERY' })).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STAGE_TRANSITION' });
    await opportunities.changeStage(nv1, f.id, { stage: 'QUOTING' });
    const plan = await opportunities.stagePlan(nv1, f.id);
    expect(plan.items.map((entry) => entry.status).slice(0, 5)).toEqual(['DONE', 'DONE', 'SKIPPED', 'ACTIVE', 'PENDING']);
    // Lùi lại cũng bỏ qua Khảo sát.
    expect((await opportunities.get(nv1, f.id)).nextStages.map((stage) => stage.code)).toEqual(['CONTACTED', 'NEGOTIATION', 'LOST']);
  });

  it('TC-SKP-01/03/06/08/09: bỏ qua lúc đang chạy cần lý do và quyền; chặn giai đoạn không cho bỏ qua, hiện tại, Thắng, Thua', async () => {
    const g = await create(nv1, 'Dự án G');
    const stage = (code: string) => stageIdOf(g.pipeline.id, code);
    const outsider = actorOf(NV3, { canReadAll: true });
    await expect(opportunities.skipStage(outsider, g.id, await stage('CONTACTED'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(opportunities.skipStage(nv1, g.id, await stage('CONTACTED'), { reason: '  ' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(opportunities.skipStage(nv1, g.id, await stage('QUOTING'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409, code: 'STAGE_NOT_SKIPPABLE' });
    await expect(opportunities.skipStage(nv1, g.id, await stage('NEW'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(opportunities.skipStage(nv1, g.id, await stage('WON'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(opportunities.skipStage(nv1, g.id, await stage('LOST'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    const plan = await opportunities.skipStage(nv1, g.id, await stage('CONTACTED'), { reason: ' Khách đã liên hệ rồi ' });
    expect(item(plan, 'CONTACTED')).toMatchObject({ status: 'SKIPPED', skippedReason: 'Khách đã liên hệ rồi', skippedBy: NV1 });
    // Bỏ qua hai lần: 409.
    await expect(opportunities.skipStage(nv1, g.id, await stage('CONTACTED'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await audit(g.id, 'skip_stage')).toMatchObject([{ reason: 'Khách đã liên hệ rồi', actor_id: NV1, metadata: { stageCode: 'CONTACTED', atCreation: false } }]);
    expect((await opportunities.get(nv1, g.id)).history.filter((entry) => entry.kind === 'SKIP')).toHaveLength(1);
    // Từ Mới, giai đoạn kế (Đã liên hệ) bỏ qua nên tới Khảo sát.
    expect((await opportunities.get(nv1, g.id)).nextStages.map((entry) => entry.code)).toEqual(['DISCOVERY', 'LOST']);
    // Dự án đã Thua: không bỏ qua gì nữa.
    await opportunities.changeStage(nv1, g.id, { stage: 'LOST', reason: 'Dừng' });
    await expect(opportunities.skipStage(nv1, g.id, await stage('DISCOVERY'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('dự án tạo bằng chuyển đổi lead vẫn có kế hoạch giai đoạn (chưa gán người)', async () => {
    const lead = await leads.create(nv1, { name: 'Lead kế hoạch' });
    const converted = await leads.convert(nv1, lead.id, {});
    const plan = await opportunities.stagePlan(nv1, converted.opportunityId);
    expect(plan.items).toHaveLength(7);
    expect(item(plan, 'NEW').status).toBe('ACTIVE');
    expect(plan.items.every((entry) => entry.assigneeUserId === null)).toBe(true);
  });

  it('chỉ mục tìm theo người được gán có trong DB (bộ lọc phạm vi dùng index)', async () => {
    const rows = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'crm_schema' AND tablename = 'opportunity_stage_plan'`,
    );
    expect(rows.map((row) => row.indexname)).toContain('ix_crm_opportunity_stage_plan_assignee');
  });
});
