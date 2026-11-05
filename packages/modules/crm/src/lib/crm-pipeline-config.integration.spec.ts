import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES, type AdminPipeline } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { PipelineConfigService } from './application/pipeline-config.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineAdminStore } from './infrastructure/postgres-pipeline-admin.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const NV1 = randomUUID();

/**
 * Cấu hình luồng cho quản trị viên (GĐ G, P2G-01, P2G-02, P2G-04, P2G-05) trên PostgreSQL thật:
 * TC-CFG-01 đến 05, 08, 09, 10; TC-CFG-07 phần API (mẫu luồng).
 */
integration('Bán hàng GĐ G: cấu hình luồng (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let pipelines: PipelineConfigService;
  let config: CachedPipelineConfig;
  let customerId: string;
  const tenantId = randomUUID();
  const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId, userId: NV1, displayName: 'NV1', canWriteOpportunity: true, canReadAll: true };
  const admin: CrmActor = { ...seller, canManage: true };

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> => (await handle.pool.query(text, values)).rows as T[];
  const pipelineOf = (list: readonly AdminPipeline[], code: string): AdminPipeline => {
    const found = list.find((pipeline) => pipeline.code === code);
    if (!found) throw new Error(`Không có luồng ${code}`);
    return found;
  };
  const stageOf = (pipeline: AdminPipeline, code: string) => {
    const found = pipeline.stages.find((stage) => stage.code === code);
    if (!found) throw new Error(`Không có giai đoạn ${code}`);
    return found;
  };
  const audit = (entityType: string, entityId: string) =>
    query<{ action: string; actor_id: string; metadata: Record<string, unknown> }>(
      `SELECT action, actor_id, metadata FROM crm_schema.audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY at, id`,
      [entityType, entityId],
    );
  const historyCount = async (): Promise<number> =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM crm_schema.opportunity_stage_history`))[0].n);
  const newOpportunity = async (pipelineId: string): Promise<string> =>
    (await opportunities.create(seller, { name: 'Dự án cấu hình', customerId, pipelineId } as never)).id;
  const expectError = async (promise: Promise<unknown>, statusCode: number, code?: string) => {
    await expect(promise).rejects.toMatchObject({ statusCode, ...(code ? { code } : {}) });
  };

  /** Tạo luồng mới từ mẫu bán hàng đơn giản (NEW, QUOTING, NEGOTIATION, WON, LOST). */
  const createSimple = async (code: string): Promise<AdminPipeline> =>
    pipelineOf(await pipelines.createPipeline(admin, { code, name: `Luồng ${code}`, templateId: 'SALES_SIMPLE' }), code);

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(handle.database);
    config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(new PostgresOpportunityStore(handle.database), customerStore, scopes, config);
    pipelines = new PipelineConfigService(new PostgresPipelineAdminStore(handle.database), config);
    customerId = (await new CustomerService(customerStore, scopes).create(seller, { name: 'Khách cấu hình' })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-CFG-08: chỉ crm.manage cấu hình được; người khác nhận 403 ở mọi thao tác', async () => {
    const list = await pipelines.list(admin);
    const standard = list.find((pipeline) => pipeline.isDefault)!;
    const stage = standard.stages[0];
    const body = {};
    await expectError(pipelines.list(seller), 403);
    expect(() => pipelines.templates(seller)).toThrow(expect.objectContaining({ statusCode: 403 }));
    for (const call of [
      pipelines.createPipeline(seller, { code: 'X', name: 'X' }),
      pipelines.updatePipeline(seller, standard.id, { name: 'Y' }),
      pipelines.setDefaultPipeline(seller, standard.id),
      pipelines.reorderPipelines(seller, { pipelineIds: [] }),
      pipelines.deletePipeline(seller, standard.id),
      pipelines.addStage(seller, standard.id, { code: 'X', name: 'X' }),
      pipelines.updateStage(seller, standard.id, stage.id, { name: 'Y' }),
      pipelines.reorderStages(seller, standard.id, { stageIds: [] }),
      pipelines.deleteStage(seller, standard.id, stage.id),
      pipelines.setTransitions(seller, standard.id, stage.id, { toStageIds: [] }),
      pipelines.setRequirements(seller, standard.id, stage.id, { requirements: [] }),
    ]) {
      await expectError(call, 403);
    }
    expect(body).toEqual({});
    // Không có gì bị ghi: không có audit_log cấu hình.
    expect(await query(`SELECT 1 FROM crm_schema.audit_log WHERE entity_type IN ('pipeline', 'pipeline_stage')`)).toHaveLength(0);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(standard.stages.every((s) => s.opportunityCount === 0 && s.used === false)).toBe(true);
  });

  it('TC-CFG-01: thêm giai đoạn "Gửi mẫu" vào luồng thường, có bước chuyển, xuất hiện ở danh sách và chuyển vào được', async () => {
    const created = await createSimple('CFG_A');
    expect(created.stages.map((s) => s.code)).toEqual(['NEW', 'QUOTING', 'NEGOTIATION', 'WON', 'LOST']);
    const afterAdd = await pipelines.addStage(admin, created.id, { code: 'gui_mau', name: 'Gửi mẫu', semantic: 'OPEN', defaultProbability: 20, skippable: true, assigneeRule: 'DIRECT_MANAGER' });
    const sample = stageOf(pipelineOf(afterAdd, 'CFG_A'), 'GUI_MAU');
    expect(sample).toMatchObject({ name: 'Gửi mẫu', semantic: 'OPEN', defaultProbability: 20, skippable: true, assigneeRule: 'DIRECT_MANAGER', assigneeParam: null, active: true, sortOrder: 60 });
    // Thêm xong chưa có bước chuyển: đặt NEW → SAMPLE → QUOTING (và về NEW), Thua từ SAMPLE.
    const pipeline = pipelineOf(afterAdd, 'CFG_A');
    const id = (code: string) => stageOf(pipeline, code).id;
    await pipelines.setTransitions(admin, pipeline.id, id('NEW'), { toStageIds: [id('QUOTING'), id('GUI_MAU'), id('LOST')] });
    const after = await pipelines.setTransitions(admin, pipeline.id, sample.id, { toStageIds: [id('NEW'), id('QUOTING'), id('LOST')] });
    expect([...stageOf(pipelineOf(after, 'CFG_A'), 'GUI_MAU').nextStageIds].sort()).toEqual([id('NEW'), id('QUOTING'), id('LOST')].sort());

    const opportunityId = await newOpportunity(pipeline.id);
    const detail = await opportunities.changeStage(seller, opportunityId, { stage: 'GUI_MAU' });
    expect(detail.stageInfo).toMatchObject({ code: 'GUI_MAU', name: 'Gửi mẫu' });
    expect((await opportunities.listPipelines(seller)).find((p) => p.id === pipeline.id)?.stages.map((s) => s.code)).toContain('GUI_MAU');
    // Dự án đang chạy sẵn có nhận dòng kế hoạch "chờ" cho giai đoạn mới.
    const another = await newOpportunity(pipeline.id);
    await pipelines.addStage(admin, pipeline.id, { code: 'THEM', name: 'Thêm sau' });
    const plan = await query<{ status: string }>(
      `SELECT sp.status FROM crm_schema.opportunity_stage_plan sp JOIN crm_schema.pipeline_stages s ON s.id = sp.stage_id WHERE sp.opportunity_id = $1 AND s.code = 'THEM'`,
      [another],
    );
    expect(plan).toEqual([{ status: 'PENDING' }]);
  });

  it('TC-CFG-01 (kiểm dữ liệu vào): mã trùng 409, mã sai, thiếu tên, xác suất sai, tham số gán sai, luồng lạ 404', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_A');
    await expectError(pipelines.addStage(admin, pipeline.id, { code: 'new', name: 'Trùng mã' }), 409, 'STAGE_CODE_TAKEN');
    await expectError(pipelines.addStage(admin, pipeline.id, { code: 'Gửi mẫu', name: 'x' }), 400, 'INVALID_CODE');
    await expectError(pipelines.addStage(admin, pipeline.id, { code: 'OK1', name: ' ' }), 400, 'NAME_REQUIRED');
    await expectError(pipelines.addStage(admin, pipeline.id, { code: 'OK1', name: 'x', defaultProbability: 150 }), 400, 'INVALID_PROBABILITY');
    await expectError(pipelines.addStage(admin, pipeline.id, { code: 'OK1', name: 'x', assigneeRule: 'FIXED_USER' }), 400, 'INVALID_ASSIGNEE_PARAM');
    await expectError(pipelines.addStage(admin, randomUUID(), { code: 'OK1', name: 'x' }), 404);
    await expectError(pipelines.addStage(admin, 'không-phải-uuid', { code: 'OK1', name: 'x' }), 404);
    await expectError(pipelines.createPipeline(admin, { code: 'CFG_A', name: 'Trùng' }), 409, 'PIPELINE_CODE_TAKEN');
    await expectError(pipelines.createPipeline(admin, { code: 'Z', name: 'x', templateId: 'KHONG_CO' }), 400, 'INVALID_TEMPLATE');
    await expectError(pipelines.createPipeline(admin, { code: 'Z', name: 'x', profile: 'STANDARD', templateId: 'TENDER' }), 400, 'PROFILE_MISMATCH');
    // Gán người đủ tham số.
    const ok = await pipelines.updateStage(admin, pipeline.id, stageOf(pipeline, 'NEW').id, { assigneeRule: 'FIXED_USER', assigneeParam: NV1 });
    expect(stageOf(pipelineOf(ok, 'CFG_A'), 'NEW')).toMatchObject({ assigneeRule: 'FIXED_USER', assigneeParam: NV1 });
    const back = await pipelines.updateStage(admin, pipeline.id, stageOf(pipeline, 'NEW').id, { assigneeRule: 'PROJECT_OWNER' });
    expect(stageOf(pipelineOf(back, 'CFG_A'), 'NEW')).toMatchObject({ assigneeRule: 'PROJECT_OWNER', assigneeParam: null });
  });

  it('TC-CFG-02: đổi thứ tự giai đoạn; luồng và danh sách theo thứ tự mới; lịch sử cũ không đổi', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_A');
    const opportunityId = await newOpportunity(pipeline.id);
    await opportunities.changeStage(seller, opportunityId, { stage: 'QUOTING' });
    const history = await query(`SELECT * FROM crm_schema.opportunity_stage_history ORDER BY at, id`);
    const reversed = [...pipeline.stages].map((s) => s.id).reverse();
    await expectError(pipelines.reorderStages(admin, pipeline.id, { stageIds: reversed.slice(1) }), 400, 'INVALID_ORDER');
    const after = await pipelines.reorderStages(admin, pipeline.id, { stageIds: reversed });
    expect(pipelineOf(after, 'CFG_A').stages.map((s) => s.id)).toEqual(reversed);
    expect((await opportunities.listPipelines(seller)).find((p) => p.id === pipeline.id)?.stages.map((s) => s.id)).toEqual(reversed);
    expect(await query(`SELECT * FROM crm_schema.opportunity_stage_history ORDER BY at, id`)).toEqual(history);
    // Sắp xếp luồng.
    const all = await pipelines.list(admin);
    const flipped = all.map((p) => p.id).reverse();
    expect((await pipelines.reorderPipelines(admin, { pipelineIds: flipped })).map((p) => p.id)).toEqual(flipped);
    await expectError(pipelines.reorderPipelines(admin, { pipelineIds: flipped.slice(1) }), 400, 'INVALID_ORDER');
    await pipelines.reorderStages(admin, pipeline.id, { stageIds: [...reversed].reverse() });
  });

  it('TC-CFG-03: tắt giai đoạn đang có cơ hội; cơ hội vẫn xem và chuyển đi được; không chuyển mới vào', async () => {
    const pipeline = pipelineOf(await pipelines.createPipeline(admin, { code: 'CFG_B', name: 'Luồng B', templateId: 'SALES_WITH_BUSINESS_PLAN' }), 'CFG_B');
    const ids = [await newOpportunity(pipeline.id), await newOpportunity(pipeline.id), await newOpportunity(pipeline.id)];
    for (const id of ids) await opportunities.changeStage(seller, id, { stage: 'QUOTING' });
    const outsider = await newOpportunity(pipeline.id);
    const quoting = stageOf(pipeline, 'QUOTING');
    const before = await historyCount();

    const after = await pipelines.updateStage(admin, pipeline.id, quoting.id, { active: false });
    expect(stageOf(pipelineOf(after, 'CFG_B'), 'QUOTING')).toMatchObject({ active: false, opportunityCount: 3, used: true });
    expect(await historyCount()).toBe(before);
    // Xem được và chuyển đi được.
    const detail = await opportunities.get(seller, ids[0]);
    expect(detail.stageInfo.code).toBe('QUOTING');
    expect((await opportunities.changeStage(seller, ids[0], { stage: 'NEW' })).stageInfo.code).toBe('NEW');
    // Không chuyển mới vào.
    await expectError(opportunities.changeStage(seller, outsider, { stage: 'QUOTING' }), 409);
    await expectError(opportunities.changeStage(seller, ids[0], { stage: 'QUOTING' }), 409);
    // Bật lại thì chuyển được.
    await pipelines.updateStage(admin, pipeline.id, quoting.id, { active: true });
    expect((await opportunities.changeStage(seller, outsider, { stage: 'QUOTING' })).stageInfo.code).toBe('QUOTING');
  });

  it('TC-CFG-04: không xoá giai đoạn đang có cơ hội (409, đề nghị tắt); đã có lịch sử cũng không xoá; chưa dùng thì xoá và dọn liên quan', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_B');
    const quoting = stageOf(pipeline, 'QUOTING');
    expect(quoting.opportunityCount).toBeGreaterThan(0);
    const error = await pipelines.deleteStage(admin, pipeline.id, quoting.id).catch((e: unknown) => e as { statusCode: number; code: string; message: string });
    expect(error).toMatchObject({ statusCode: 409, code: 'STAGE_IN_USE' });
    expect((error as { message: string }).message).toContain('tắt');
    expect(pipelineOf(await pipelines.list(admin), 'CFG_B').stages.map((s) => s.code)).toContain('QUOTING');

    // Đã có lịch sử (NEW từng là điểm xuất phát) nhưng hiện không còn cơ hội: vẫn không xoá.
    const draft = stageOf(pipeline, 'PAKD_DRAFT');
    const holder = await newOpportunity(pipeline.id);
    await opportunities.changeStage(seller, holder, { stage: 'QUOTING' });
    await opportunities.changeStage(seller, holder, { stage: 'PAKD_DRAFT' });
    await opportunities.changeStage(seller, holder, { stage: 'QUOTING' });
    const drafts = pipelineOf(await pipelines.list(admin), 'CFG_B');
    expect(stageOf(drafts, 'PAKD_DRAFT')).toMatchObject({ opportunityCount: 0, used: true });
    await expectError(pipelines.deleteStage(admin, pipeline.id, draft.id), 409, 'STAGE_HAS_HISTORY');

    // Giai đoạn chưa dùng: xoá được; bước chuyển, điều kiện, dòng kế hoạch "chờ" của nó biến mất.
    const fresh = pipelineOf(await pipelines.addStage(admin, pipeline.id, { code: 'TAM', name: 'Tạm' }), 'CFG_B');
    const temp = stageOf(fresh, 'TAM');
    const open = await newOpportunity(pipeline.id);
    await pipelines.setTransitions(admin, pipeline.id, temp.id, { toStageIds: [stageOf(fresh, 'NEW').id] });
    await pipelines.setTransitions(admin, pipeline.id, stageOf(fresh, 'NEW').id, { toStageIds: [stageOf(fresh, 'QUOTING').id, temp.id] });
    await pipelines.setRequirements(admin, pipeline.id, temp.id, { requirements: [{ kind: 'REASON', message: 'Ghi lý do.' }] });
    expect(await query(`SELECT 1 FROM crm_schema.opportunity_stage_plan WHERE stage_id = $1 AND opportunity_id = $2`, [temp.id, open])).toHaveLength(1);
    const after = await pipelines.deleteStage(admin, pipeline.id, temp.id);
    expect(pipelineOf(after, 'CFG_B').stages.map((s) => s.code)).not.toContain('TAM');
    expect(stageOf(pipelineOf(after, 'CFG_B'), 'NEW').nextStageIds).not.toContain(temp.id);
    for (const table of ['pipeline_stage_requirements', 'pipeline_stage_transitions']) {
      expect(await query(`SELECT 1 FROM crm_schema.${table} WHERE stage_id = $1`.replace('stage_id', table.endsWith('transitions') ? 'from_stage_id' : 'stage_id'), [temp.id])).toHaveLength(0);
    }
    expect(await query(`SELECT 1 FROM crm_schema.opportunity_stage_plan WHERE stage_id = $1`, [temp.id])).toHaveLength(0);
    await expectError(pipelines.deleteStage(admin, pipeline.id, temp.id), 404);
  });

  it('TC-CFG-05: mỗi luồng giữ ít nhất một WON và một LOST đang bật (và một OPEN); luồng giữ nguyên khi bị từ chối', async () => {
    const pipeline = pipelineOf(await pipelines.createPipeline(admin, { code: 'CFG_C', name: 'Luồng C' }), 'CFG_C');
    expect(pipeline.stages.map((s) => [s.code, s.semantic])).toEqual([['NEW', 'OPEN'], ['WON', 'WON'], ['LOST', 'LOST']]);
    const snapshot = JSON.stringify(await pipelines.list(admin));
    const won = stageOf(pipeline, 'WON');
    const lost = stageOf(pipeline, 'LOST');
    const open = stageOf(pipeline, 'NEW');
    await expectError(pipelines.deleteStage(admin, pipeline.id, won.id), 409, 'LAST_WON_STAGE');
    await expectError(pipelines.updateStage(admin, pipeline.id, won.id, { active: false }), 409, 'LAST_WON_STAGE');
    await expectError(pipelines.updateStage(admin, pipeline.id, won.id, { semantic: 'OPEN' }), 409, 'LAST_WON_STAGE');
    await expectError(pipelines.deleteStage(admin, pipeline.id, lost.id), 409, 'LAST_LOST_STAGE');
    await expectError(pipelines.updateStage(admin, pipeline.id, lost.id, { active: false }), 409, 'LAST_LOST_STAGE');
    await expectError(pipelines.updateStage(admin, pipeline.id, lost.id, { semantic: 'WON' }), 409, 'LAST_LOST_STAGE');
    await expectError(pipelines.updateStage(admin, pipeline.id, open.id, { active: false }), 409, 'LAST_OPEN_STAGE');
    expect(JSON.stringify(await pipelines.list(admin))).toBe(snapshot);

    // Có WON thứ hai thì tắt cái đầu được; chuyển nghĩa chưa dùng thì xoá bước chuyển đi.
    const two = pipelineOf(await pipelines.addStage(admin, pipeline.id, { code: 'WON2', name: 'Thắng 2', semantic: 'WON' }), 'CFG_C');
    const afterOff = await pipelines.updateStage(admin, pipeline.id, won.id, { active: false });
    expect(stageOf(pipelineOf(afterOff, 'CFG_C'), 'WON').active).toBe(false);
    await expectError(pipelines.updateStage(admin, pipeline.id, stageOf(two, 'WON2').id, { active: false }), 409, 'LAST_WON_STAGE');
    // Giai đoạn WON không có bước chuyển đi, và chuyển nghĩa sang kết thúc thì bước chuyển đi bị xoá.
    await expectError(pipelines.setTransitions(admin, pipeline.id, won.id, { toStageIds: [open.id] }), 400, 'TERMINAL_STAGE_TRANSITION');
    const extra = stageOf(pipelineOf(await pipelines.addStage(admin, pipeline.id, { code: 'X1', name: 'X1', skippable: true }), 'CFG_C'), 'X1');
    await pipelines.setTransitions(admin, pipeline.id, extra.id, { toStageIds: [open.id, lost.id] });
    const converted = await pipelines.updateStage(admin, pipeline.id, extra.id, { semantic: 'LOST' });
    expect(stageOf(pipelineOf(converted, 'CFG_C'), 'X1')).toMatchObject({ semantic: 'LOST', nextStageIds: [], skippable: false });
  });

  it('quy tắc luồng: mặc định đúng một và phải STANDARD; không tắt/xoá mặc định; luồng có cơ hội chỉ tắt; TENDER không bật gợi ý chăm sóc', async () => {
    const list = await pipelines.list(admin);
    const def = list.find((p) => p.isDefault)!;
    const tender = pipelineOf(list, 'TENDER_STANDARD');
    expect(list.filter((p) => p.isDefault)).toHaveLength(1);
    await expectError(pipelines.setDefaultPipeline(admin, tender.id), 409, 'DEFAULT_MUST_BE_STANDARD');
    await expectError(pipelines.updatePipeline(admin, def.id, { active: false }), 409, 'DEFAULT_PIPELINE_LOCKED');
    await expectError(pipelines.deletePipeline(admin, def.id), 409, 'DEFAULT_PIPELINE_LOCKED');
    await expectError(pipelines.updatePipeline(admin, tender.id, { careSuggestion: true }), 400, 'CARE_SUGGESTION_NOT_APPLICABLE');
    await expectError(pipelines.updatePipeline(admin, tender.id, { profile: 'STANDARD' }), 400, 'PROFILE_LOCKED');
    expect(pipelineOf(await pipelines.updatePipeline(admin, tender.id, { name: 'Chào thầu (đổi tên)' }), 'TENDER_STANDARD').name).toBe('Chào thầu (đổi tên)');

    // Luồng đang có cơ hội: chỉ tắt, không xoá.
    const b = pipelineOf(list, 'CFG_B');
    expect(b.opportunityCount).toBeGreaterThan(0);
    await expectError(pipelines.deletePipeline(admin, b.id), 409, 'PIPELINE_IN_USE');
    const off = await pipelines.updatePipeline(admin, b.id, { active: false });
    expect(pipelineOf(off, 'CFG_B').active).toBe(false);
    await expectError(opportunities.create(seller, { name: 'Vào luồng tắt', customerId, pipelineId: b.id } as never), 400);
    await pipelines.updatePipeline(admin, b.id, { active: true });

    // Đổi luồng mặc định: đúng một mặc định; luồng cũ không còn mặc định.
    const c = pipelineOf(list, 'CFG_C');
    await pipelines.updatePipeline(admin, c.id, { active: true });
    const switched = await pipelines.setDefaultPipeline(admin, c.id);
    expect(switched.filter((p) => p.isDefault).map((p) => p.code)).toEqual(['CFG_C']);
    expect((await opportunities.create(seller, { name: 'Vào mặc định mới', customerId } as never)).pipeline.id).toBe(c.id);
    await pipelines.setDefaultPipeline(admin, def.id);
    expect((await pipelines.list(admin)).filter((p) => p.isDefault).map((p) => p.code)).toEqual([def.code]);

    // Luồng chưa dùng xoá được (cùng giai đoạn của nó); mọi dòng liên quan biến mất.
    const empty = pipelineOf(await pipelines.createPipeline(admin, { code: 'CFG_D', name: 'Luồng D' }), 'CFG_D');
    const gone = await pipelines.deletePipeline(admin, empty.id);
    expect(gone.map((p) => p.code)).not.toContain('CFG_D');
    expect(await query(`SELECT 1 FROM crm_schema.pipeline_stages WHERE pipeline_id = $1`, [empty.id])).toHaveLength(0);
    await expectError(pipelines.deletePipeline(admin, empty.id), 404);
  });

  it('điều kiện: kiểm ref (loại tài liệu có thật, trường hợp lệ), lưu cờ bắt buộc, áp ở lần chuyển kế tiếp', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_A');
    const target = stageOf(pipeline, 'NEGOTIATION');
    const bad = (requirements: unknown[], code: string) => expectError(pipelines.setRequirements(admin, pipeline.id, target.id, { requirements } as never), 400, code);
    await bad([{ kind: 'DOCUMENT_TYPE', ref: 'KHONG_CO', message: 'm' }], 'INVALID_DOCUMENT_TYPE');
    await bad([{ kind: 'FIELD', ref: 'khongCo', message: 'm' }], 'INVALID_FIELD');
    await bad([{ kind: 'TENDER_FIELD', ref: 'winningPrice', message: 'm' }], 'REQUIREMENT_NOT_FOR_PROFILE');
    const saved = await pipelines.setRequirements(admin, pipeline.id, target.id, {
      requirements: [
        { kind: 'DOCUMENT_TYPE', ref: 'LEGAL_DOSSIER', required: false, message: 'Nên có hồ sơ pháp lý.' },
        { kind: 'DOCUMENT_TYPE', ref: 'ESTIMATE', required: true, message: 'Cần có dự toán.' },
        { kind: 'FIELD', ref: 'expectedValue', required: true, message: 'Cần nhập giá trị dự kiến.' },
      ],
    });
    expect(stageOf(pipelineOf(saved, 'CFG_A'), 'NEGOTIATION').requirements.map((r) => [r.kind, r.ref, r.required])).toEqual([
      ['DOCUMENT_TYPE', 'LEGAL_DOSSIER', false],
      ['DOCUMENT_TYPE', 'ESTIMATE', true],
      ['FIELD', 'expectedValue', true],
    ]);
    // Điều kiện áp ngay ở lần chuyển kế tiếp: thiếu dự toán và giá trị thì bị chặn.
    const opportunityId = await newOpportunity(pipeline.id);
    await opportunities.changeStage(seller, opportunityId, { stage: 'QUOTING' });
    await expectError(opportunities.changeStage(seller, opportunityId, { stage: 'NEGOTIATION' }), 409, 'STAGE_REQUIREMENTS_NOT_MET');
    // Gỡ điều kiện thì chuyển được.
    await pipelines.setRequirements(admin, pipeline.id, target.id, { requirements: [] });
    expect((await opportunities.changeStage(seller, opportunityId, { stage: 'NEGOTIATION' })).stageInfo.code).toBe('NEGOTIATION');
  });

  it('TC-CFG-07 (API): ba mẫu luồng; tạo luồng từ mẫu đúng giai đoạn, bước chuyển, điều kiện; chào thầu giống luồng nạp sẵn', async () => {
    expect(pipelines.templates(admin).map((t) => t.id)).toEqual(['SALES_SIMPLE', 'SALES_WITH_BUSINESS_PLAN', 'TENDER']);
    const list = await pipelines.createPipeline(admin, { code: 'MAU_PAKD', name: 'Bán hàng có PAKD', templateId: 'SALES_WITH_BUSINESS_PLAN' });
    const pakd = pipelineOf(list, 'MAU_PAKD');
    expect(pakd).toMatchObject({ profile: 'STANDARD', isDefault: false, active: true, careSuggestion: true });
    expect(pakd.stages.map((s) => s.code)).toEqual(['NEW', 'QUOTING', 'PAKD_DRAFT', 'PAKD_REVIEW', 'NEGOTIATION', 'WON', 'LOST']);
    expect(stageOf(pakd, 'PAKD_REVIEW').requirements.map((r) => [r.kind, r.ref, r.required])).toEqual([['DOCUMENT_TYPE', 'BUSINESS_PLAN', true]]);
    expect(stageOf(pakd, 'WON').requirements.map((r) => r.kind)).toEqual(['QUOTE_APPROVED']);
    expect(stageOf(pakd, 'WON').nextStageIds).toEqual([]);

    const tenderList = await pipelines.createPipeline(admin, { code: 'MAU_THAU', name: 'Chào thầu mới', templateId: 'TENDER' });
    const copy = pipelineOf(tenderList, 'MAU_THAU');
    const original = pipelineOf(tenderList, 'TENDER_STANDARD');
    expect(copy).toMatchObject({ profile: 'TENDER', careSuggestion: false, isDefault: false });
    const shape = (p: AdminPipeline) =>
      p.stages.map((s) => ({
        code: s.code,
        name: s.name,
        semantic: s.semantic,
        probability: s.defaultProbability,
        rule: s.assigneeRule,
        next: s.nextStageIds.map((id) => p.stages.find((x) => x.id === id)?.code).sort(),
        requirements: s.requirements.map((r) => [r.kind, r.ref, r.required, r.sortOrder]),
      }));
    expect(shape(copy)).toEqual(shape(original));
    // Mã không trùng, tên do người dùng đặt.
    await expectError(pipelines.createPipeline(admin, { code: 'mau_thau', name: 'Lại', templateId: 'TENDER' }), 409, 'PIPELINE_CODE_TAKEN');
    // Luồng tạo từ mẫu dùng được: tạo cơ hội và chuyển giai đoạn.
    const opportunityId = await newOpportunity(pakd.id);
    expect((await opportunities.changeStage(seller, opportunityId, { stage: 'QUOTING' })).stageInfo.code).toBe('QUOTING');
    expect((await pipelines.list(admin)).filter((p) => p.isDefault)).toHaveLength(1);
  });

  it('TC-CFG-09: có audit_log; huỷ cache ngay, lần chuyển kế tiếp dùng cấu hình mới', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_A');
    const opportunityId = await newOpportunity(pipeline.id);
    // Hâm nóng cache (30 giây là TTL thật; ở đây 60 giây) bằng một lần đọc và một lần chuyển.
    await opportunities.changeStage(seller, opportunityId, { stage: 'QUOTING' });
    await opportunities.listPipelines(seller);
    const target = stageOf(pipeline, 'NEGOTIATION');
    // NEGOTIATION đang không có điều kiện (xem test trước). Thêm điều kiện lý do bắt buộc rồi chuyển NGAY.
    await pipelines.setRequirements(admin, pipeline.id, target.id, { requirements: [{ kind: 'REASON', message: 'Phải ghi lý do đàm phán.' }] });
    await expectError(opportunities.changeStage(seller, opportunityId, { stage: 'NEGOTIATION' }), 409);
    const moved = await opportunities.changeStage(seller, opportunityId, { stage: 'NEGOTIATION', reason: 'Khách đồng ý đàm phán' });
    expect(moved.stageInfo.code).toBe('NEGOTIATION');
    // Gỡ điều kiện rồi chuyển ngay: không còn bị chặn bởi cấu hình cũ trong cache.
    await opportunities.changeStage(seller, opportunityId, { stage: 'QUOTING' });
    await pipelines.setRequirements(admin, pipeline.id, target.id, { requirements: [] });
    expect((await opportunities.changeStage(seller, opportunityId, { stage: 'NEGOTIATION' })).stageInfo.code).toBe('NEGOTIATION');
    // Tắt giai đoạn rồi chuyển vào ngay: bị từ chối ngay.
    const other = await newOpportunity(pipeline.id);
    await opportunities.changeStage(seller, other, { stage: 'QUOTING' });
    await opportunities.listPipelines(seller);
    await pipelines.updateStage(admin, pipeline.id, target.id, { active: false });
    await expectError(opportunities.changeStage(seller, other, { stage: 'NEGOTIATION' }), 409);
    await pipelines.updateStage(admin, pipeline.id, target.id, { active: true });

    const stageLog = await audit('pipeline_stage', target.id);
    expect(stageLog.map((row) => row.action).slice(-2)).toEqual(['update', 'update']);
    expect(stageLog.filter((row) => row.action === 'set_requirements').length).toBeGreaterThanOrEqual(2);
    expect(stageLog.every((row) => row.actor_id === admin.userId)).toBe(true);
    expect(stageLog[stageLog.length - 2].metadata).toMatchObject({ pipelineId: pipeline.id, stageCode: 'NEGOTIATION', before: { active: true }, after: { active: false } });
    const pipelineLog = await audit('pipeline', pipeline.id);
    expect(pipelineLog[0]).toMatchObject({ action: 'create_from_template', actor_id: admin.userId });
    // Mọi loại thay đổi đều để lại dấu vết.
    const actions = new Set((await query<{ action: string }>(`SELECT DISTINCT action FROM crm_schema.audit_log WHERE entity_type IN ('pipeline', 'pipeline_stage')`)).map((r) => r.action));
    for (const action of ['create', 'create_from_template', 'update', 'delete', 'set_default', 'reorder', 'reorder_stages', 'set_transitions', 'set_requirements']) {
      expect(actions).toContain(action);
    }
    // Lệnh bị từ chối không để lại audit.
    const before = (await audit('pipeline_stage', target.id)).length;
    await expectError(pipelines.deleteStage(admin, pipeline.id, target.id), 409);
    expect((await audit('pipeline_stage', target.id)).length).toBe(before);
  });

  it('audit cùng transaction: lỗi giữa chừng huỷ cả thay đổi lẫn audit', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_A');
    const countBefore = Number((await query<{ n: string }>(`SELECT count(*) AS n FROM crm_schema.audit_log`))[0].n);
    const failing = new PipelineConfigService(
      {
        snapshot: (id) => new PostgresPipelineAdminStore(handle.database).snapshot(id),
        run: (id, work) =>
          new PostgresPipelineAdminStore(handle.database).run(id, (tx) =>
            work({
              ...tx,
              load: () => tx.load(),
              updatePipeline: tx.updatePipeline.bind(tx),
              audit: async () => {
                throw new Error('ghi audit lỗi');
              },
            } as typeof tx),
          ),
      },
      config,
    );
    await expect(failing.updatePipeline(admin, pipeline.id, { name: 'Tên không được lưu' })).rejects.toThrow('ghi audit lỗi');
    expect(pipelineOf(await pipelines.list(admin), 'CFG_A').name).toBe('Luồng CFG_A');
    expect(Number((await query<{ n: string }>(`SELECT count(*) AS n FROM crm_schema.audit_log`))[0].n)).toBe(countBefore);
  });

  it('TC-CFG-10: đổi bước chuyển khi cơ hội đang ở X; lịch sử không bị viết lại; lần chuyển sau theo cấu hình mới', async () => {
    const pipeline = pipelineOf(await pipelines.list(admin), 'CFG_A');
    const x = stageOf(pipeline, 'QUOTING');
    const opportunityId = await newOpportunity(pipeline.id);
    await opportunities.changeStage(seller, opportunityId, { stage: 'QUOTING' });
    const historyBefore = await query(`SELECT * FROM crm_schema.opportunity_stage_history WHERE opportunity_id = $1 ORDER BY at, id`, [opportunityId]);
    expect(historyBefore).toHaveLength(2);
    expect((await opportunities.get(seller, opportunityId)).nextStages.map((s) => s.code)).toContain('NEGOTIATION');

    // Chỉ cho đi tiếp sang LOST (bỏ NEGOTIATION, NEW).
    await pipelines.setTransitions(admin, pipeline.id, x.id, { toStageIds: [stageOf(pipeline, 'LOST').id] });
    expect(await query(`SELECT * FROM crm_schema.opportunity_stage_history WHERE opportunity_id = $1 ORDER BY at, id`, [opportunityId])).toEqual(historyBefore);
    expect((await opportunities.get(seller, opportunityId)).nextStages.map((s) => s.code)).toEqual(['LOST']);
    await expectError(opportunities.changeStage(seller, opportunityId, { stage: 'NEGOTIATION' }), 409);
    const lost = await opportunities.changeStage(seller, opportunityId, { stage: 'LOST', reason: 'Khách chọn nhà thầu khác' });
    expect(lost.stageInfo.code).toBe('LOST');
    const historyAfter = await query<{ from_stage: string; to_stage: string }>(`SELECT * FROM crm_schema.opportunity_stage_history WHERE opportunity_id = $1 ORDER BY at, id`, [opportunityId]);
    expect(historyAfter.slice(0, 2)).toEqual(historyBefore);
    expect(historyAfter).toHaveLength(3);
    // Đổi tên và đổi mã giai đoạn đã dùng: tên đổi được, mã bị khoá; lịch sử vẫn ghi mã cũ.
    await expectError(pipelines.updateStage(admin, pipeline.id, x.id, { code: 'BAO_GIA' }), 409, 'STAGE_CODE_LOCKED');
    await expectError(pipelines.updateStage(admin, pipeline.id, x.id, { semantic: 'LOST' }), 409, 'STAGE_SEMANTIC_LOCKED');
    const renamed = await pipelines.updateStage(admin, pipeline.id, x.id, { name: 'Báo giá (đổi tên)', defaultProbability: 55 });
    expect(stageOf(pipelineOf(renamed, 'CFG_A'), 'QUOTING')).toMatchObject({ name: 'Báo giá (đổi tên)', defaultProbability: 55, code: 'QUOTING' });
    expect(await query(`SELECT * FROM crm_schema.opportunity_stage_history WHERE opportunity_id = $1 ORDER BY at, id`, [opportunityId])).toEqual(historyAfter);
    // Chưa dùng thì đổi mã, nghĩa được.
    const fresh = stageOf(pipelineOf(await pipelines.addStage(admin, pipeline.id, { code: 'CHO_DOI', name: 'Chờ đổi' }), 'CFG_A'), 'CHO_DOI');
    const changed = await pipelines.updateStage(admin, pipeline.id, fresh.id, { code: 'DA_DOI', semantic: 'LOST' });
    expect(stageOf(pipelineOf(changed, 'CFG_A'), 'DA_DOI')).toMatchObject({ semantic: 'LOST' });
    await expectError(pipelines.updateStage(admin, pipeline.id, fresh.id, { code: 'NEW' }), 409, 'STAGE_CODE_TAKEN');
  });
});
