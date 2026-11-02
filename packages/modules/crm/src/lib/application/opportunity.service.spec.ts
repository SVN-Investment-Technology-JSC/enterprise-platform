import { CRM_NO_CAPABILITIES, type OpportunityDetail, type OpportunityStagePlanItem, type Pipeline } from '@enterprise-platform/contracts-crm';
import { findStage, stageRef } from '../domain/opportunity.js';
import { buildPipeline, fiveStagePipeline, sevenStagePipeline } from '../domain/pipeline-fixture.js';
import type { CrmActor } from './crm-actor.js';
import { scopeIncludes, type CrmDataScope, type CrmDataScopeService } from './data-scope.js';
import { OpportunityService, type OpportunityDocumentChecker } from './opportunity.service.js';
import { CachedPipelineConfig } from './pipeline-config.cache.js';
import type { PipelineConfigProvider } from './pipeline-config.port.js';
import type { CustomerStore, OpportunityStore } from './sales-store.port.js';

const NV1 = '00000000-0000-4000-8000-000000000001';
const NV3 = '00000000-0000-4000-8000-000000000003';
const OPP_ID = '30000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

const writer: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: NV1, displayName: 'NV1', canWriteOpportunity: true };

const SEVEN = sevenStagePipeline();
const FIVE = fiveStagePipeline();

function opportunity(
  pipeline: Pipeline,
  stageCode: string,
  patch: Partial<OpportunityDetail> = {},
  owner = NV1,
): OpportunityDetail {
  const stage = findStage(pipeline, stageCode);
  if (!stage) throw new Error(stageCode);
  return {
    id: OPP_ID,
    name: 'Dự án A',
    customerId: CUSTOMER_ID,
    customerCode: 'KH000001',
    customerName: 'Minh Anh',
    stage: stage.code,
    pipeline: { id: pipeline.id, code: pipeline.code, name: pipeline.name },
    stageInfo: { id: stage.id, code: stage.code, name: stage.name, semantic: stage.semantic },
    probability: 40,
    expectedValue: 1000,
    expectedCloseDate: null,
    ownerUserId: owner,
    version: 2,
    updatedAt: '',
    need: null,
    budget: null,
    lostReason: null,
    leadId: null,
    closedAt: null,
    createdAt: '',
    history: [],
    nextStages: [],
    ...patch,
  };
}

function setup(
  current: OpportunityDetail,
  options: {
    customerOwner?: string;
    pipelines?: readonly Pipeline[];
    acceptedQuote?: boolean;
    documents?: OpportunityDocumentChecker;
    plan?: OpportunityStagePlanItem[];
  } = {},
) {
  const scope: CrmDataScope = { kind: 'users', userIds: [NV1] };
  const opportunities = {
    getOpportunity: jest.fn(async (_t: string, readScope: CrmDataScope) =>
      scopeIncludes(readScope, current.ownerUserId) ? current : undefined,
    ),
    changeStage: jest.fn().mockResolvedValue(undefined),
    createOpportunity: jest.fn().mockResolvedValue(OPP_ID),
    updateOpportunity: jest.fn().mockResolvedValue(undefined),
    hasAcceptedQuote: jest.fn().mockResolvedValue(options.acceptedQuote ?? false),
    getStagePlan: jest.fn().mockResolvedValue(options.plan ?? []),
    setStageAssignee: jest.fn().mockResolvedValue(undefined),
    skipStage: jest.fn().mockResolvedValue(undefined),
    listMyStageTasks: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<OpportunityStore>;
  const customers = {
    getCustomer: jest.fn(async (_t: string, readScope: CrmDataScope) =>
      scopeIncludes(readScope, options.customerOwner ?? NV1) ? { id: CUSTOMER_ID } : undefined,
    ),
  } as unknown as CustomerStore;
  const scopes = { resolve: jest.fn().mockResolvedValue(scope) } as unknown as CrmDataScopeService;
  const pipelines: jest.Mocked<PipelineConfigProvider> = {
    pipelines: jest.fn().mockResolvedValue(options.pipelines ?? [SEVEN, FIVE]),
    invalidate: jest.fn(),
  };
  const service = new OpportunityService(opportunities, customers, scopes, pipelines, () => new Date('2026-11-02T03:00:00Z'), options.documents);
  return { opportunities, pipelines, service };
}

describe('OpportunityService, luồng mặc định 7 giai đoạn', () => {
  it('chuyển hợp lệ gọi store với id và mã giai đoạn hiện tại làm điều kiện', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'NEW'));
    await service.changeStage(writer, OPP_ID, { stage: 'CONTACTED', version: 2 });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      {
        pipelineId: SEVEN.id,
        fromStageId: findStage(SEVEN, 'NEW')?.id,
        from: 'NEW',
        fromSemantic: 'OPEN',
        toStageId: findStage(SEVEN, 'CONTACTED')?.id,
        to: 'CONTACTED',
        toSemantic: 'OPEN',
        fromSortOrder: 10,
        toSortOrder: 20,
        reason: null,
        expectedVersion: 2,
      },
      NV1,
    );
  });

  it('chuyển sai bảng: 409, không ghi', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'WON'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'NEW' })).rejects.toMatchObject({ statusCode: 409 });
    expect(opportunities.changeStage).not.toHaveBeenCalled();
  });

  it('TC-OPP-04/05: Thua thiếu lý do 400; có lý do thì lưu lý do đã cắt khoảng trắng và từ chối báo giá mở', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'NEGOTIATION'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'LOST' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Phải ghi lý do thua.',
    });
    await service.changeStage(writer, OPP_ID, { stage: 'LOST', reason: ' Giá cao hơn đối thủ ' });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      expect.objectContaining({ from: 'NEGOTIATION', to: 'LOST', toSemantic: 'LOST', reason: 'Giá cao hơn đối thủ', declineOpenQuotes: true }),
      NV1,
    );
  });

  it('TC-PL-08: sang Thắng thiếu báo giá được chấp nhận: 409 ACCEPTED_QUOTE_REQUIRED, không ghi', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'NEGOTIATION'), { acceptedQuote: false });
    await expect(service.changeStage(writer, OPP_ID, { stage: 'WON' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACCEPTED_QUOTE_REQUIRED',
      message: 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.',
    });
    expect(opportunities.changeStage).not.toHaveBeenCalled();
  });

  it('TC-PL-08: có báo giá được chấp nhận thì chuyển, store kiểm lại trong transaction', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'NEGOTIATION'), { acceptedQuote: true });
    await service.changeStage(writer, OPP_ID, { stage: 'WON' });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      expect.objectContaining({
        to: 'WON',
        toSemantic: 'WON',
        requireAcceptedQuote: { message: 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.' },
      }),
      NV1,
    );
  });

  it('sang Báo giá đặt hạn nháp báo giá theo ngày Việt Nam', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'DISCOVERY'));
    await service.changeStage(writer, OPP_ID, { stage: 'QUOTING' });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      expect.objectContaining({ draftQuoteValidUntil: '2026-12-02' }),
      NV1,
    );
  });

  it('giai đoạn lạ: 400', async () => {
    const { service } = setup(opportunity(SEVEN, 'NEW'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'DONE' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.changeStage(writer, OPP_ID, { stage: '' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cơ hội của người ngoài phạm vi: 404', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'NEW', {}, NV3));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'CONTACTED' })).rejects.toMatchObject({ statusCode: 404 });
    expect(opportunities.changeStage).not.toHaveBeenCalled();
  });

  it('chi tiết kèm các giai đoạn đích chuyển được ngay', async () => {
    const { service } = setup(opportunity(SEVEN, 'NEGOTIATION'));
    const detail = await service.get(writer, OPP_ID);
    expect(detail.nextStages.map((stage) => stage.code)).toEqual(['QUOTING', 'WON', 'LOST']);
    expect(detail.nextStages[1]).toMatchObject({ name: 'Thắng', semantic: 'WON' });
  });

  it('TC-OPP-06: tạo với xác suất ngoài 0–100 trả 400; 50 lưu được ở giai đoạn đầu của luồng mặc định', async () => {
    const { opportunities, service } = setup(opportunity(SEVEN, 'NEW'), { pipelines: [FIVE, SEVEN] });
    for (const probability of [-1, 101]) {
      await expect(
        service.create(writer, { customerId: CUSTOMER_ID, name: 'Cơ hội', probability }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    await service.create(writer, { customerId: CUSTOMER_ID, name: 'Cơ hội', probability: 50 });
    expect(opportunities.createOpportunity).toHaveBeenCalledWith(
      't1',
      CUSTOMER_ID,
      expect.objectContaining({ probability: 50, ownerUserId: NV1 }),
      NV1,
      expect.objectContaining({ pipelineId: SEVEN.id, stageId: findStage(SEVEN, 'NEW')?.id, stageCode: 'NEW' }),
    );
  });

  it('tạo cơ hội cho khách ngoài phạm vi: 404', async () => {
    const { service } = setup(opportunity(SEVEN, 'NEW'), { customerOwner: NV3 });
    await expect(service.create(writer, { customerId: CUSTOMER_ID, name: 'X' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cơ hội đã đóng không sửa được, theo nghĩa giai đoạn', async () => {
    for (const [pipeline, code] of [[SEVEN, 'LOST'], [SEVEN, 'WON'], [FIVE, 'CLOSED_LOST']] as const) {
      const { service } = setup(opportunity(pipeline, code));
      await expect(service.update(writer, OPP_ID, { name: 'Y', version: 2 })).rejects.toMatchObject({
        statusCode: 409,
        code: 'OPPORTUNITY_CLOSED',
      });
    }
  });
});

describe('OpportunityService, luồng tuỳ biến', () => {
  it('TC-PL-05: tạo ở luồng được chọn thì vào giai đoạn đầu của luồng đó', async () => {
    const { opportunities, service } = setup(opportunity(FIVE, 'LEAD'));
    await service.create(writer, { customerId: CUSTOMER_ID, name: 'Dự án nhỏ', pipelineId: FIVE.id });
    expect(opportunities.createOpportunity).toHaveBeenCalledWith(
      't1',
      CUSTOMER_ID,
      expect.anything(),
      NV1,
      expect.objectContaining({ pipelineId: FIVE.id, stageId: findStage(FIVE, 'LEAD')?.id, stageCode: 'LEAD' }),
    );
  });

  it('TC-PL-11: luồng không tồn tại 400; luồng tắt không tạo mới được; luồng không có giai đoạn đầu 409', async () => {
    const ghost = '40000000-0000-4000-8000-000000000009';
    const off = { ...buildPipeline({ code: 'OFF', stages: [{ code: 'A', name: 'A', semantic: 'OPEN' }], transitions: [] }), active: false };
    const noStart = buildPipeline({ code: 'NOSTART', stages: [{ code: 'W', name: 'W', semantic: 'WON' }], transitions: [] });
    const { opportunities, service } = setup(opportunity(FIVE, 'LEAD'), { pipelines: [SEVEN, FIVE, off, noStart] });
    await expect(service.create(writer, { customerId: CUSTOMER_ID, name: 'X', pipelineId: ghost })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_PIPELINE',
    });
    await expect(service.create(writer, { customerId: CUSTOMER_ID, name: 'X', pipelineId: off.id })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PIPELINE_INACTIVE',
    });
    await expect(service.create(writer, { customerId: CUSTOMER_ID, name: 'X', pipelineId: noStart.id })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PIPELINE_NO_START_STAGE',
    });
    expect(opportunities.createOpportunity).not.toHaveBeenCalled();
  });

  it('TC-PL-06: chuyển cách bước không có trong bảng: 409 tiếng Việt, không ghi', async () => {
    const { opportunities, service } = setup(opportunity(FIVE, 'LEAD'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'PROPOSAL' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_STAGE_TRANSITION',
      message: 'Không thể chuyển cơ hội từ "Tiếp cận" sang "Đề xuất".',
    });
    expect(opportunities.changeStage).not.toHaveBeenCalled();
  });

  it('mã giai đoạn của luồng khác bị từ chối: 400', async () => {
    const { service } = setup(opportunity(FIVE, 'LEAD'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'CONTACTED' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('TC-PL-07: sang giai đoạn nghĩa LOST tên "Rớt" cần lý do; có lý do thì chuyển và từ chối báo giá mở', async () => {
    const { opportunities, service } = setup(opportunity(FIVE, 'PROPOSAL'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'CLOSED_LOST' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'LOST_REASON_REQUIRED',
    });
    await service.changeStage(writer, OPP_ID, { stage: 'CLOSED_LOST', reason: 'Mất thầu' });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      expect.objectContaining({ to: 'CLOSED_LOST', toSemantic: 'LOST', reason: 'Mất thầu', declineOpenQuotes: true }),
      NV1,
    );
  });

  it('luồng 5 giai đoạn không đòi báo giá được chấp nhận khi sang giai đoạn Thắng vì cấu hình không có điều kiện', async () => {
    const { opportunities, service } = setup(opportunity(FIVE, 'PROPOSAL'));
    await service.changeStage(writer, OPP_ID, { stage: 'CLOSED_WON' });
    expect(opportunities.hasAcceptedQuote).not.toHaveBeenCalled();
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      expect.not.objectContaining({ requireAcceptedQuote: expect.anything() }),
      NV1,
    );
  });

  it('TC-PL-09: điều kiện FIELD đọc từ cơ hội; thiếu thì 409 nêu trường, đủ thì chuyển', async () => {
    const pipeline = buildPipeline({
      code: 'FIELDS',
      stages: [
        { code: 'A', name: 'Mới', semantic: 'OPEN' },
        { code: 'B', name: 'Khảo sát', semantic: 'OPEN', requirements: [{ kind: 'FIELD', ref: 'budget' }] },
      ],
      transitions: [['A', 'B']],
    });
    const missing = setup(opportunity(pipeline, 'A', { budget: null }), { pipelines: [pipeline] });
    await expect(missing.service.changeStage(writer, OPP_ID, { stage: 'B' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cần điền "Ngân sách" trước khi chuyển sang "Khảo sát".',
    });
    expect(missing.opportunities.changeStage).not.toHaveBeenCalled();
    const filled = setup(opportunity(pipeline, 'A', { budget: 1_000_000 }), { pipelines: [pipeline] });
    await filled.service.changeStage(writer, OPP_ID, { stage: 'B' });
    expect(filled.opportunities.changeStage).toHaveBeenCalled();
  });

  it('TC-PL-20: điều kiện tài liệu bắt buộc chặn, không bắt buộc chỉ vào danh sách cần có', async () => {
    const pipeline = buildPipeline({
      code: 'DOCS',
      stages: [
        { code: 'A', name: 'Mới', semantic: 'OPEN' },
        {
          code: 'B',
          name: 'Ký',
          semantic: 'OPEN',
          requirements: [
            { kind: 'DOCUMENT_TYPE', ref: 'A', required: true, message: 'Cần tài liệu A.' },
            { kind: 'DOCUMENT_TYPE', ref: 'B', required: false, message: 'Nên có tài liệu B.' },
          ],
        },
      ],
      transitions: [['A', 'B']],
    });
    let present = new Set<string>();
    const documents: OpportunityDocumentChecker = { presentDocumentTypes: jest.fn(async () => present) };
    const { opportunities, service } = setup(opportunity(pipeline, 'A'), { pipelines: [pipeline], documents });
    await expect(service.changeStage(writer, OPP_ID, { stage: 'B' })).rejects.toMatchObject({ statusCode: 409, message: 'Cần tài liệu A.' });
    present = new Set(['A']);
    await service.changeStage(writer, OPP_ID, { stage: 'B' });
    expect(opportunities.changeStage).toHaveBeenCalledTimes(1);
    const list = await service.stageRequirements(writer, OPP_ID, 'B');
    expect(list.map((check) => [check.ref, check.required, check.met])).toEqual([
      ['A', true, true],
      ['B', false, false],
    ]);
  });

  it('cấu hình trong cache cũ (thiếu giai đoạn): tải lại một lần rồi dùng cấu hình mới', async () => {
    const stale = buildPipeline({
      code: 'FIVE',
      stages: [{ code: 'LEAD', name: 'Tiếp cận', semantic: 'OPEN' }],
      transitions: [],
    });
    const fresh = fiveStagePipeline();
    const { opportunities, pipelines, service } = setup(opportunity(fresh, 'LEAD'), { pipelines: [fresh] });
    const old = [{ ...stale, id: fresh.id }];
    // Lần đọc cho chi tiết cơ hội và lần đọc đầu của changeStage đều trả cấu hình cũ.
    pipelines.pipelines.mockResolvedValueOnce(old).mockResolvedValueOnce(old).mockResolvedValue([fresh]);
    await service.changeStage(writer, OPP_ID, { stage: 'QUALIFIED' });
    expect(pipelines.invalidate).toHaveBeenCalledWith('t1');
    expect(opportunities.changeStage).toHaveBeenCalled();
  });
});

describe('CachedPipelineConfig', () => {
  it('cache theo tenant trong thời hạn, gom lần tải đồng thời, huỷ được', async () => {
    let now = 0;
    const load = jest.fn(async (tenantId: string) => (tenantId === 't1' ? [SEVEN] : [FIVE]));
    const cache = new CachedPipelineConfig({ loadPipelines: load }, 1000, () => now);
    await Promise.all([cache.pipelines('t1'), cache.pipelines('t1')]);
    await cache.pipelines('t2');
    expect(load).toHaveBeenCalledTimes(2);
    now = 999;
    await cache.pipelines('t1');
    expect(load).toHaveBeenCalledTimes(2);
    cache.invalidate('t1');
    await cache.pipelines('t1');
    expect(load).toHaveBeenCalledTimes(3);
    now = 5000;
    await cache.pipelines('t1');
    expect(load).toHaveBeenCalledTimes(4);
    cache.invalidate();
    await cache.pipelines('t2');
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('lần tải lỗi không bị giữ lại', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue([SEVEN]);
    const cache = new CachedPipelineConfig({ loadPipelines: load });
    await expect(cache.pipelines('t1')).rejects.toThrow('down');
    await new Promise((resolve) => setImmediate(resolve));
    await expect(cache.pipelines('t1')).resolves.toEqual([SEVEN]);
  });
});

describe('OpportunityService, kế hoạch giai đoạn, bỏ qua, quyền chuyển (GĐ B P2B-15..18)', () => {
  const PIPE = buildPipeline({
    code: 'PLAN',
    isDefault: true,
    stages: [
      { code: 'A', name: 'A', semantic: 'OPEN', assigneeRule: 'PROJECT_OWNER' },
      { code: 'B', name: 'B', semantic: 'OPEN', skippable: true, assigneeRule: 'DIRECT_MANAGER' },
      { code: 'C', name: 'C', semantic: 'OPEN', assigneeRule: 'FIXED_USER', assigneeParam: NV3 },
      { code: 'W', name: 'W', semantic: 'WON' },
      { code: 'L', name: 'L', semantic: 'LOST' },
    ],
    transitions: [['A', 'B'], ['B', 'C'], ['C', 'W'], ['A', 'L'], ['B', 'L'], ['C', 'L']],
  });
  const item = (code: string, status: OpportunityStagePlanItem['status'], assigneeUserId: string | null = null) => ({
    stage: stageRef(findStage(PIPE, code)!),
    sortOrder: findStage(PIPE, code)!.sortOrder,
    status,
    skippable: findStage(PIPE, code)!.skippable,
    assigneeUserId,
    assigneeWarning: null,
    assignedBy: null,
    assignedAt: null,
    dueDate: null,
    skippedReason: null,
    skippedBy: null,
    skippedAt: null,
  }) as OpportunityStagePlanItem;
  const stageId = (code: string) => findStage(PIPE, code)!.id;
  const NV2 = '00000000-0000-4000-8000-000000000002';
  const plan = (current = 'A') =>
    ['A', 'B', 'C', 'W', 'L'].map((code) => item(code, code === current ? 'ACTIVE' : 'PENDING', code === current ? NV2 : null));
  const manager: CrmActor = { ...writer, userId: NV3, canManage: true };
  const stranger: CrmActor = { ...writer, userId: '00000000-0000-4000-8000-000000000009', canReadAll: true };
  const assignee: CrmActor = { ...writer, userId: NV2, canReadAll: true };

  it('TC-ASG-01/05: tạo dự án dựng kế hoạch theo quy tắc, giai đoạn không tìm được người để trống kèm cảnh báo', async () => {
    const { opportunities, service } = setup(opportunity(PIPE, 'A'), { pipelines: [PIPE] });
    await service.create(writer, { customerId: CUSTOMER_ID, name: 'X', skipStages: [{ stage: 'B', reason: 'Khách đã khảo sát' }] });
    const placement = opportunities.createOpportunity.mock.calls[0][4];
    expect(placement.plan).toEqual([
      { stageId: stageId('A'), status: 'ACTIVE', assigneeUserId: NV1, assigneeWarning: null, skippedReason: null },
      { stageId: stageId('B'), status: 'SKIPPED', assigneeUserId: null, assigneeWarning: null, skippedReason: 'Khách đã khảo sát' },
      expect.objectContaining({ stageId: stageId('C'), status: 'PENDING', assigneeWarning: expect.stringContaining('gán cố định') }),
      { stageId: stageId('W'), status: 'PENDING', assigneeUserId: null, assigneeWarning: null, skippedReason: null },
      { stageId: stageId('L'), status: 'PENDING', assigneeUserId: null, assigneeWarning: null, skippedReason: null },
    ]);
  });

  it('TC-ASG-06: chỉ chủ dự án hoặc crm.manage ghi đè người đảm nhận; người khác 403', async () => {
    const { opportunities, service } = setup(opportunity(PIPE, 'A'), { pipelines: [PIPE], plan: plan() });
    await service.updateStageAssignee(writer, OPP_ID, stageId('C'), { assigneeUserId: NV2 });
    expect(opportunities.setStageAssignee).toHaveBeenCalledWith('t1', OPP_ID, { stageId: stageId('C'), assigneeUserId: NV2 }, NV1);
    await expect(
      service.updateStageAssignee(assignee, OPP_ID, stageId('C'), { assigneeUserId: NV2 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.updateStageAssignee(writer, OPP_ID, stageId('C'), {} as never)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('TC-ASG-09: người đảm nhận giai đoạn hiện tại, chủ và crm.manage chuyển được; người khác 403', async () => {
    const current = opportunity(PIPE, 'A');
    // người đảm nhận không phải chủ: nằm trong phạm vi nhờ canReadAll của actor giả lập
    const { opportunities, service } = setup(current, { pipelines: [PIPE], plan: plan() });
    const scopeAll = { resolve: jest.fn().mockResolvedValue({ kind: 'all' }) } as unknown as CrmDataScopeService;
    const svc = new OpportunityService(opportunities, { getCustomer: jest.fn() } as unknown as CustomerStore, scopeAll, {
      pipelines: jest.fn().mockResolvedValue([PIPE]),
      invalidate: jest.fn(),
    });
    await expect(svc.changeStage(stranger, OPP_ID, { stage: 'B' })).rejects.toMatchObject({ statusCode: 403 });
    await svc.changeStage(assignee, OPP_ID, { stage: 'B' });
    await svc.changeStage(writer, OPP_ID, { stage: 'B' });
    await svc.changeStage(manager, OPP_ID, { stage: 'B' });
    expect(opportunities.changeStage).toHaveBeenCalledTimes(3);
    expect(service).toBeDefined();
  });

  it('TC-SKP-03/09/08: bỏ qua giai đoạn: 403 người ngoài, 400 thiếu lý do, 409 giai đoạn hiện tại hoặc không cho bỏ qua', async () => {
    const { opportunities, service } = setup(opportunity(PIPE, 'A'), { pipelines: [PIPE], plan: plan() });
    await expect(service.skipStage({ ...stranger, canReadAll: false, userId: NV3 }, OPP_ID, stageId('B'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.skipStage(writer, OPP_ID, stageId('B'), { reason: ' ' })).rejects.toMatchObject({ statusCode: 400, code: 'SKIP_REASON_REQUIRED' });
    await expect(service.skipStage(writer, OPP_ID, stageId('A'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.skipStage(writer, OPP_ID, stageId('C'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.skipStage(writer, OPP_ID, stageId('W'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.skipStage(writer, OPP_ID, stageId('L'), { reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    expect(opportunities.skipStage).not.toHaveBeenCalled();
    await service.skipStage(writer, OPP_ID, stageId('B'), { reason: ' Đã khảo sát ' });
    expect(opportunities.skipStage).toHaveBeenCalledWith('t1', OPP_ID, { stageId: stageId('B'), reason: 'Đã khảo sát' }, NV1);
  });

  it('TC-SKP-04: chuyển một bước chỉ ra giai đoạn kế còn áp dụng; bước tới giai đoạn đã bỏ qua là 409', async () => {
    const skipped = plan().map((p) => (p.stage.code === 'B' ? { ...p, status: 'SKIPPED' as const } : p));
    const { opportunities, service } = setup(opportunity(PIPE, 'A'), { pipelines: [PIPE], plan: skipped });
    const detail = await service.get(writer, OPP_ID);
    expect(detail.nextStages.map((s) => s.code)).toEqual(['C', 'L']);
    await expect(service.changeStage(writer, OPP_ID, { stage: 'B' })).rejects.toMatchObject({ statusCode: 409 });
    await service.changeStage(writer, OPP_ID, { stage: 'C' });
    expect(opportunities.changeStage).toHaveBeenCalledTimes(1);
  });
});
