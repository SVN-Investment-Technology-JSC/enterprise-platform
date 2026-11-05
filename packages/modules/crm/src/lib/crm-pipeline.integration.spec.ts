import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES, CRM_OPPORTUNITY_STAGE_CHANGED } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const QL = randomUUID();
const NV1 = randomUUID();
const NV3 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-ql', reportsToPositionId: null },
    { id: 'p-nv1', reportsToPositionId: 'p-ql' },
    { id: 'p-nv3', reportsToPositionId: 'p-ql' },
  ],
  assignments: [
    { userId: QL, positionId: 'p-ql', reportsToOverrideId: null },
    { userId: NV1, positionId: 'p-nv1', reportsToOverrideId: null },
    { userId: NV3, positionId: 'p-nv3', reportsToOverrideId: null },
  ],
};

/**
 * Luồng cơ hội theo cấu hình (GĐ B, P2B-04..08): luồng mặc định 7 giai đoạn và một luồng
 * tuỳ biến 5 giai đoạn (giai đoạn thua tên "Rớt") trong cùng tenant.
 */
integration('Bán hàng GĐ B: luồng cơ hội theo cấu hình (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let leads: LeadService;
  let store: PostgresOpportunityStore;
  let config: CachedPipelineConfig;
  let customerId: string;
  let simpleId: string;
  const tenantId = randomUUID();
  const seller = (userId: string): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Nhân viên',
    canWriteOpportunity: true,
  });
  const manager: CrmActor = { ...seller(QL), canReadAll: true };

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await handle.pool.query(text, values)).rows as T[];
  const stageId = async (pipelineId: string, code: string): Promise<string> =>
    (await query<{ id: string }>(`SELECT id FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 AND code = $2`, [pipelineId, code]))[0].id;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    store = new PostgresOpportunityStore(handle.database);
    config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(store, customerStore, scopes, config);
    leads = new LeadService(new PostgresLeadStore(handle.database), scopes);
    customerId = (await new CustomerService(customerStore, scopes).create(seller(NV1), { name: 'Khách luồng' })).id;

    // Luồng tuỳ biến 5 giai đoạn.
    simpleId = (
      await query<{ id: string }>(
        `INSERT INTO crm_schema.pipelines (code, name, sort_order) VALUES ('SALES_SIMPLE', 'Bán hàng đơn giản', 10) RETURNING id`,
      )
    )[0].id;
    const codes: [string, string, string, number][] = [
      ['LEAD', 'Tiếp cận', 'OPEN', 10],
      ['QUALIFIED', 'Đủ điều kiện', 'OPEN', 20],
      ['PROPOSAL', 'Đề xuất', 'OPEN', 30],
      ['CLOSED_WON', 'Chốt', 'WON', 40],
      ['CLOSED_LOST', 'Rớt', 'LOST', 50],
    ];
    for (const [code, name, semantic, order] of codes) {
      await query(
        `INSERT INTO crm_schema.pipeline_stages (pipeline_id, code, name, semantic, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [simpleId, code, name, semantic, order],
      );
    }
    const moves = [
      ['LEAD', 'QUALIFIED'], ['LEAD', 'CLOSED_LOST'],
      ['QUALIFIED', 'LEAD'], ['QUALIFIED', 'PROPOSAL'], ['QUALIFIED', 'CLOSED_LOST'],
      ['PROPOSAL', 'QUALIFIED'], ['PROPOSAL', 'CLOSED_WON'], ['PROPOSAL', 'CLOSED_LOST'],
    ];
    for (const [from, to] of moves) {
      await query(`INSERT INTO crm_schema.pipeline_stage_transitions (from_stage_id, to_stage_id) VALUES ($1, $2)`, [
        await stageId(simpleId, from),
        await stageId(simpleId, to),
      ]);
    }
    // Vào Đề xuất cần ngân sách (FIELD) và có gợi ý tài liệu không bắt buộc.
    await query(
      `INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order) VALUES
         ($1, 'FIELD', 'budget', true, 'Cần nhập ngân sách trước khi sang Đề xuất.', 1),
         ($1, 'DOCUMENT_TYPE', 'BAO_GIA_PDF', false, 'Nên đính báo giá PDF.', 2)`,
      [await stageId(simpleId, 'PROPOSAL')],
    );
    await query(
      `INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message)
       VALUES ($1, 'REASON', '', true, 'Phải ghi lý do rớt.')`,
      [await stageId(simpleId, 'CLOSED_LOST')],
    );
    config.invalidate();
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-PL-04: luồng mặc định cư xử như phase 1, ghi cả stage và stage_id, pipeline_id', async () => {
    const created = await opportunities.create(seller(NV1), { customerId, name: 'Mặc định', probability: 30 });
    expect(created).toMatchObject({
      stage: 'NEW',
      pipeline: { code: 'SALES_STANDARD', name: 'Bán hàng thông thường' },
      stageInfo: { code: 'NEW', name: 'Mới', semantic: 'OPEN' },
    });
    expect(created.nextStages.map((stage) => stage.code)).toEqual(['CONTACTED', 'LOST']);
    const row = (
      await query<{ stage: string; stage_code: string; pipeline_code: string }>(
        `SELECT o.stage, s.code AS stage_code, p.code AS pipeline_code
           FROM crm_schema.opportunities o JOIN crm_schema.pipeline_stages s ON s.id = o.stage_id
           JOIN crm_schema.pipelines p ON p.id = o.pipeline_id WHERE o.id = $1`,
        [created.id],
      )
    )[0];
    expect(row).toEqual({ stage: 'NEW', stage_code: 'NEW', pipeline_code: 'SALES_STANDARD' });

    await opportunities.changeStage(seller(NV1), created.id, { stage: 'CONTACTED' });
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'NEW' });
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'CONTACTED' });
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'DISCOVERY' });
    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'WON' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'LOST' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Phải ghi lý do thua.',
    });
    const lost = await opportunities.changeStage(seller(NV1), created.id, { stage: 'LOST', reason: 'Giá cao' });
    expect(lost).toMatchObject({ stage: 'LOST', lostReason: 'Giá cao', probability: 0, nextStages: [] });
    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'NEW' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('TC-PL-08: Thắng cần báo giá được chấp nhận (điều kiện QUOTE_APPROVED của luồng mặc định)', async () => {
    const created = await opportunities.create(seller(NV1), { customerId, name: 'Thắng được' });
    for (const stage of ['CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION']) {
      await opportunities.changeStage(seller(NV1), created.id, { stage });
    }
    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'WON' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACCEPTED_QUOTE_REQUIRED',
      message: 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.',
    });
    const checks = await opportunities.stageRequirements(seller(NV1), created.id, 'WON');
    expect(checks).toEqual([expect.objectContaining({ kind: 'QUOTE_APPROVED', required: true, met: false })]);
    await query(`UPDATE crm_schema.quotes SET status = 'ACCEPTED' WHERE opportunity_id = $1`, [created.id]);
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'WON' });
    await expect(opportunities.get(seller(NV1), created.id)).resolves.toMatchObject({ stage: 'WON', probability: 100 });
  });

  it('TC-PL-05, TC-PL-06, TC-PL-07: luồng 5 giai đoạn, kanban đúng 5 cột, 409 khi nhảy cách, Thua nghĩa LOST cần lý do', async () => {
    const created = await opportunities.create(seller(NV1), { customerId, name: 'Luồng đơn giản', pipelineId: simpleId });
    expect(created).toMatchObject({ stage: 'LEAD', pipeline: { code: 'SALES_SIMPLE' } });
    const board = await opportunities.board(seller(NV1), { pipelineId: simpleId });
    expect(board.pipeline.code).toBe('SALES_SIMPLE');
    expect(board.columns.map((column) => column.stage)).toEqual(['LEAD', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']);
    expect(board.columns[0].items.map((item) => item.id)).toContain(created.id);

    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'PROPOSAL' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_STAGE_TRANSITION',
      message: 'Không thể chuyển cơ hội từ "Tiếp cận" sang "Đề xuất".',
    });
    expect((await opportunities.get(seller(NV1), created.id)).stage).toBe('LEAD');
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'QUALIFIED' });

    // TC-PL-09: điều kiện FIELD của giai đoạn Đề xuất.
    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'PROPOSAL' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'STAGE_REQUIREMENTS_NOT_MET',
      message: 'Cần nhập ngân sách trước khi sang Đề xuất.',
    });
    const current = await opportunities.get(seller(NV1), created.id);
    await opportunities.update(seller(NV1), created.id, { name: current.name, budget: 5_000_000, version: current.version });
    // TC-PL-20 (một phần): tài liệu không bắt buộc không chặn, vào danh sách "cần có" với met = null khi chưa có kho tài liệu.
    const checks = await opportunities.stageRequirements(seller(NV1), created.id, 'PROPOSAL');
    expect(checks.map((check) => [check.kind, check.ref, check.required, check.met])).toEqual([
      ['FIELD', 'budget', true, true],
      ['DOCUMENT_TYPE', 'BAO_GIA_PDF', false, null],
    ]);
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'PROPOSAL' });

    for (const reason of [undefined, '  ']) {
      await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'CLOSED_LOST', reason })).rejects.toMatchObject({
        statusCode: 400,
        code: 'LOST_REASON_REQUIRED',
      });
    }
    const lost = await opportunities.changeStage(seller(NV1), created.id, { stage: 'CLOSED_LOST', reason: 'Mất thầu' });
    expect(lost).toMatchObject({ stage: 'CLOSED_LOST', lostReason: 'Mất thầu', probability: 0, stageInfo: { name: 'Rớt', semantic: 'LOST' } });
    expect(lost.closedAt).not.toBeNull();
    // Đã đóng theo nghĩa giai đoạn (mã không phải WON/LOST) thì không sửa được.
    await expect(opportunities.update(seller(NV1), created.id, { name: 'Sửa', version: lost.version })).rejects.toMatchObject({
      statusCode: 409,
      code: 'OPPORTUNITY_CLOSED',
    });
  });

  it('TC-PL-11, TC-PL-16: hai luồng trong một tenant, lọc theo luồng; phạm vi dữ liệu không đổi', async () => {
    const standard = await opportunities.create(seller(NV1), { customerId, name: 'Hai luồng A' });
    const simple = await opportunities.create(seller(NV1), { customerId, name: 'Hai luồng B', pipelineId: simpleId });
    const own = await opportunities.create(seller(NV3), { customerId: (await ownCustomer(NV3)), name: 'Của NV3', pipelineId: simpleId });

    const names = async (actor: CrmActor, pipelineId?: string) =>
      (await opportunities.list(actor, { pipelineId, q: 'Hai luồng' })).items.map((item) => item.name).sort();
    expect(await names(seller(NV1))).toEqual(['Hai luồng A', 'Hai luồng B']);
    expect(await names(seller(NV1), simpleId)).toEqual(['Hai luồng B']);
    expect(simple.pipeline.id).toBe(simpleId);
    expect(standard.pipeline.id).not.toBe(simpleId);
    const defaultBoard = await opportunities.board(seller(NV1), {});
    expect(defaultBoard.columns.map((column) => column.stage)).toEqual(['NEW', 'CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION', 'WON', 'LOST']);

    // NV1 không thấy cơ hội của NV3 (404); quản lý đọc được cả hai.
    await expect(opportunities.get(seller(NV1), own.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(opportunities.changeStage(seller(NV1), own.id, { stage: 'QUALIFIED' })).rejects.toMatchObject({ statusCode: 404 });
    expect((await opportunities.list(seller(NV1), { pipelineId: simpleId })).items.some((item) => item.id === own.id)).toBe(false);
    expect((await opportunities.list(manager, { pipelineId: simpleId })).items.some((item) => item.id === own.id)).toBe(true);

    await expect(
      opportunities.create(seller(NV1), { customerId, name: 'Sai luồng', pipelineId: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PIPELINE' });
  });

  it('TC-PL-13, TC-PL-14: sự kiện outbox giữ trường cũ, thêm semantic và pipelineId; lịch sử và audit_log có mã và id', async () => {
    const created = await opportunities.create(seller(NV1), { customerId, name: 'Sự kiện' });
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'CONTACTED' });
    const lost = await opportunities.changeStage(seller(NV1), created.id, { stage: 'LOST', reason: 'Khách huỷ' });

    const events = await query<{ event_type: string; aggregate_type: string; payload: { type: string; payload: Record<string, unknown> } }>(
      `SELECT event_type, aggregate_type, payload FROM integration_schema.outbox_events
        WHERE aggregate_id = $1 AND event_type = $2 ORDER BY occurred_at, id`,
      [created.id, CRM_OPPORTUNITY_STAGE_CHANGED],
    );
    expect(events).toHaveLength(2);
    expect(events[0].aggregate_type).toBe('crm-opportunity');
    const defaultStages = await query<{ id: string; code: string }>(
      `SELECT id, code FROM crm_schema.pipeline_stages WHERE pipeline_id = $1`,
      [lost.pipeline.id],
    );
    const idOf = (code: string) => defaultStages.find((stage) => stage.code === code)?.id;
    expect(events[0].payload.payload).toEqual({
      opportunityId: created.id,
      customerId,
      name: 'Sự kiện',
      ownerUserId: NV1,
      fromStage: 'NEW',
      stage: 'CONTACTED',
      reason: null,
      actorUserId: NV1,
      semantic: 'OPEN',
      pipelineId: lost.pipeline.id,
      stageId: idOf('CONTACTED'),
      fromStageId: idOf('NEW'),
      fromSemantic: 'OPEN',
    });
    expect(events[1].payload.payload).toMatchObject({ fromStage: 'CONTACTED', stage: 'LOST', semantic: 'LOST', reason: 'Khách huỷ' });

    const history = await query<{ from_stage: string | null; to_stage: string; from_stage_id: string | null; to_stage_id: string; actor_id: string; reason: string | null }>(
      `SELECT from_stage, to_stage, from_stage_id, to_stage_id, actor_id, reason
         FROM crm_schema.opportunity_stage_history WHERE opportunity_id = $1 ORDER BY at, id`,
      [created.id],
    );
    expect(history.map((row) => [row.from_stage, row.to_stage, row.reason, row.actor_id])).toEqual([
      [null, 'NEW', null, NV1],
      ['NEW', 'CONTACTED', null, NV1],
      ['CONTACTED', 'LOST', 'Khách huỷ', NV1],
    ]);
    expect(history.map((row) => [row.from_stage_id, row.to_stage_id])).toEqual([
      [null, idOf('NEW')],
      [idOf('NEW'), idOf('CONTACTED')],
      [idOf('CONTACTED'), idOf('LOST')],
    ]);
    const audit = await query<{ action: string; from_status: string | null; to_status: string; reason: string | null; actor_id: string; metadata: Record<string, unknown> }>(
      `SELECT action, from_status, to_status, reason, actor_id, metadata FROM crm_schema.audit_log
        WHERE entity_type = 'opportunity' AND entity_id = $1 ORDER BY at, id`,
      [created.id],
    );
    expect(audit.map((row) => [row.action, row.from_status, row.to_status, row.reason])).toEqual([
      ['create', null, 'NEW', null],
      ['change_stage', 'NEW', 'CONTACTED', null],
      ['change_stage', 'CONTACTED', 'LOST', 'Khách huỷ'],
    ]);
    expect(audit[2].metadata).toMatchObject({ pipelineId: lost.pipeline.id, fromStageId: idOf('CONTACTED'), toStageId: idOf('LOST'), semantic: 'LOST' });
    // Chi tiết trả id và tên giai đoạn trong lịch sử.
    expect(lost.history[0]).toMatchObject({ fromStage: 'CONTACTED', toStage: 'LOST', fromStageName: 'Đã liên hệ', toStageName: 'Thua' });
  });

  it('TC-PL-15: giai đoạn đã tắt, cơ hội vẫn xem và chuyển đi được, không chuyển mới vào', async () => {
    const a = await opportunities.create(seller(NV1), { customerId, name: 'Ở giai đoạn sắp tắt', pipelineId: simpleId });
    const b = await opportunities.create(seller(NV1), { customerId, name: 'Chưa vào', pipelineId: simpleId });
    await opportunities.changeStage(seller(NV1), a.id, { stage: 'QUALIFIED' });
    await opportunities.changeStage(seller(NV1), b.id, { stage: 'QUALIFIED' }).catch(() => undefined);
    await query(`UPDATE crm_schema.pipeline_stages SET active = false WHERE pipeline_id = $1 AND code = 'QUALIFIED'`, [simpleId]);
    config.invalidate(tenantId);
    try {
      const seen = await opportunities.get(seller(NV1), a.id);
      expect(seen.stage).toBe('QUALIFIED');
      expect(seen.nextStages.map((stage) => stage.code)).toEqual(['LEAD', 'PROPOSAL', 'CLOSED_LOST']);
      const board = await opportunities.board(seller(NV1), { pipelineId: simpleId });
      const column = board.columns.find((item) => item.stage === 'QUALIFIED');
      expect(column?.items.map((item) => item.id)).toContain(a.id);
      // Không chuyển mới vào giai đoạn đã tắt.
      const fresh = await opportunities.create(seller(NV1), { customerId, name: 'Mới vào luồng', pipelineId: simpleId });
      await expect(opportunities.changeStage(seller(NV1), fresh.id, { stage: 'QUALIFIED' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'INVALID_STAGE_TRANSITION',
      });
      // Chuyển đi khỏi giai đoạn đã tắt vẫn được.
      await opportunities.changeStage(seller(NV1), a.id, { stage: 'LEAD' });
    } finally {
      await query(`UPDATE crm_schema.pipeline_stages SET active = true WHERE pipeline_id = $1 AND code = 'QUALIFIED'`, [simpleId]);
      config.invalidate(tenantId);
    }
  });

  it('cache cấu hình: đổi cấu hình rồi huỷ cache thì lần chuyển kế tiếp dùng cấu hình mới', async () => {
    const created = await opportunities.create(seller(NV1), { customerId, name: 'Đổi cấu hình', pipelineId: simpleId });
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'QUALIFIED' }); // nạp cache
    await query(
      `UPDATE crm_schema.pipeline_stage_requirements SET required = false
        WHERE kind = 'FIELD' AND stage_id = $1`,
      [await stageId(simpleId, 'PROPOSAL')],
    );
    // Cache còn cấu hình cũ: vẫn chặn.
    await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'PROPOSAL' })).rejects.toMatchObject({ statusCode: 409 });
    config.invalidate(tenantId);
    await opportunities.changeStage(seller(NV1), created.id, { stage: 'PROPOSAL' });
    await query(
      `UPDATE crm_schema.pipeline_stage_requirements SET required = true WHERE kind = 'FIELD' AND stage_id = $1`,
      [await stageId(simpleId, 'PROPOSAL')],
    );
    config.invalidate(tenantId);
  });

  it('TC-PL-19: hai người đổi giai đoạn cùng lúc với cùng version: một thành công, một 409, lịch sử không mâu thuẫn', async () => {
    const created = await opportunities.create(seller(NV1), { customerId, name: 'Đua giai đoạn' });
    const results = await Promise.allSettled([
      opportunities.changeStage(seller(NV1), created.id, { stage: 'CONTACTED', version: created.version }),
      opportunities.changeStage(seller(NV1), created.id, { stage: 'LOST', reason: 'Huỷ', version: created.version }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409 });
    const detail = await opportunities.get(seller(NV1), created.id);
    expect(detail.history).toHaveLength(2);
    const events = await query(`SELECT 1 FROM integration_schema.outbox_events WHERE aggregate_id = $1 AND event_type = $2`, [
      created.id,
      CRM_OPPORTUNITY_STAGE_CHANGED,
    ]);
    expect(events).toHaveLength(1);
  });

  it('chuyển đổi lead vào luồng mặc định, ghi stage_id', async () => {
    const lead = await leads.create(seller(NV1), { name: 'Lead luồng' });
    const result = await leads.convert(seller(NV1), lead.id, {});
    const detail = await opportunities.get(seller(NV1), result.opportunityId);
    expect(detail).toMatchObject({ stage: 'NEW', pipeline: { code: 'SALES_STANDARD' }, stageInfo: { code: 'NEW' } });
    const history = await query<{ to_stage_id: string | null }>(
      `SELECT to_stage_id FROM crm_schema.opportunity_stage_history WHERE opportunity_id = $1`,
      [result.opportunityId],
    );
    expect(history[0].to_stage_id).toBe(detail.stageInfo.id);
  });

  async function ownCustomer(owner: string): Promise<string> {
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    return (await new CustomerService(new PostgresCustomerStore(handle.database), scopes).create(seller(owner), { name: `Khách của ${owner}` })).id;
  }
});
