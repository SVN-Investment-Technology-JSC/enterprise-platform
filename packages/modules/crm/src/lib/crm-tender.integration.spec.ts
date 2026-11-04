import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CRM_NO_CAPABILITIES, type ProcedureDefinitionOption } from '@enterprise-platform/contracts-crm';
import { ContractService } from './application/contract.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { QuoteApprovalSettingsService } from './application/quote-approval-settings.service.js';
import type { ProcedureClient, StartProcedureInstance } from './application/quote-store.port.js';
import { StageAssigneeResolver } from './application/stage-assignee.resolver.js';
import { TenderService } from './application/tender.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresContractStore } from './infrastructure/postgres-contract.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { applyTenderPlanProcedureResult, PostgresTenderStore } from './infrastructure/postgres-tender.store.js';
import { PostgresApprovalLinks } from './infrastructure/quote-procedure-links.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const QL = randomUUID();
const TN = randomUUID();
const NV1 = randomUUID();
const NV3 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-ql', reportsToPositionId: null },
    { id: 'p-tn', reportsToPositionId: 'p-ql' },
    { id: 'p-nv1', reportsToPositionId: 'p-tn' },
    { id: 'p-nv3', reportsToPositionId: 'p-ql' },
  ],
  assignments: [
    { userId: QL, positionId: 'p-ql' },
    { userId: TN, positionId: 'p-tn' },
    { userId: NV1, positionId: 'p-nv1' },
    { userId: NV3, positionId: 'p-nv3' },
  ],
};
const PEOPLE = [QL, TN, NV1, NV3].map((userId) => ({ userId, displayName: userId.slice(0, 4) }));

class FakeProcedure implements ProcedureClient {
  readonly byKey = new Map<string, { id: string; code: string; request: StartProcedureInstance }>();
  readonly definition: ProcedureDefinitionOption = { id: randomUUID(), code: 'QT-THAU', name: 'Duyệt phương án chào thầu' };
  async startInstance(_tenantId: string, request: StartProcedureInstance) {
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return existing;
    const created = { id: randomUUID(), code: `HS-T${this.byKey.size + 1}`, request };
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

const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/**
 * Bán hàng GĐ E: chào thầu (P2E-01, P2E-02, P2E-03, P2E-04, P2E-06 và phần backend của P2E-09) trên PostgreSQL
 * thật: hồ sơ thầu 1-1, luồng mẫu "Chào thầu", điều kiện chuyển, duyệt phương án (trực tiếp và qua Quy trình),
 * kết quả thầu và danh sách đối tác liên danh.
 */
integration('Bán hàng GĐ E: chào thầu (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let tender: TenderService;
  let settings: QuoteApprovalSettingsService;
  let contracts: ContractService;
  let config: CachedPipelineConfig;
  let customerId: string;
  let tenderPipelineId: string;
  let standardPipelineId: string;
  const procedure = new FakeProcedure();
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
  const nv3 = actorOf(NV3);
  const tn = actorOf(TN, { canApproveQuote: true });
  const ql = actorOf(QL, { canManage: true, canReadAll: true, canApproveQuote: true });
  /** Có cả quyền ghi và duyệt: để kiểm chặn tự duyệt. */
  const nv1Approver = actorOf(NV1, { canApproveQuote: true });
  /** Thấy mọi dữ liệu nhưng không ghi, không duyệt. */
  const viewer = actorOf(randomUUID(), { canWriteOpportunity: false, canReadAll: true });

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> => (await handle.pool.query(text, values)).rows as T[];
  const stageIdOf = async (pipelineId: string, code: string): Promise<string> =>
    (await query<{ id: string }>(`SELECT id FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 AND code = $2`, [pipelineId, code]))[0].id;
  const addDocument = async (opportunityId: string, typeCode: string): Promise<void> => {
    await query(
      `INSERT INTO crm_schema.documents (entity_type, entity_id, document_type_id, name, current_version_no, created_by)
       SELECT 'opportunity', $1::uuid, t.id, t.name, 1, $2::uuid FROM crm_schema.document_types t WHERE t.code = $3::text`,
      [opportunityId, NV1, typeCode],
    );
  };
  const outbox = (profileId: string, type: string) =>
    query<{ payload: { payload: Record<string, unknown> } }>(
      `SELECT payload FROM integration_schema.outbox_events WHERE aggregate_id = $1 AND event_type = $2 ORDER BY occurred_at, id`,
      [profileId, type],
    );
  const auditActions = async (profileId: string): Promise<string[]> =>
    (await query<{ action: string }>(`SELECT action FROM crm_schema.audit_log WHERE entity_type = 'crm_tender_profile' AND entity_id = $1 ORDER BY at, id`, [profileId])).map(
      (row) => row.action,
    );
  const stageOf = async (opportunityId: string) => (await opportunities.get(ql, opportunityId)).stage;

  /** Tạo cơ hội luồng Chào thầu cùng hồ sơ thầu. */
  async function newTender(options: { actor?: CrmActor; joint?: boolean; scenario?: string | null; name?: string } = {}) {
    const actor = options.actor ?? nv1;
    const opportunity = await opportunities.create(actor, { customerId, name: options.name ?? `Gói thầu ${randomUUID().slice(0, 6)}`, pipelineId: tenderPipelineId });
    const profile = await tender.create(actor, opportunity.id, {
      packageName: `Gói ${opportunity.name}`,
      inviterName: 'Sở Y tế',
      packageCode: 'GT-01',
      submissionDeadline: inDays(10),
      hasJointVenture: options.joint ?? false,
      scenario: options.scenario === undefined ? 'Chào thầu trọn gói, giá cạnh tranh.' : options.scenario,
    });
    return { opportunityId: opportunity.id, profile };
  }
  const move = (actor: CrmActor, opportunityId: string, stage: string, reason?: string) =>
    opportunities.changeStage(actor, opportunityId, { stage, ...(reason ? { reason } : {}) });

  /** Đưa cơ hội tới Chuẩn bị hồ sơ rồi Chờ duyệt phương án (đủ hồ sơ pháp lý và dự toán). */
  async function toPlanReview(opportunityId: string, actor: CrmActor = nv1) {
    await move(actor, opportunityId, 'PREPARE');
    await addDocument(opportunityId, 'LEGAL_DOSSIER');
    await addDocument(opportunityId, 'ESTIMATE');
    await move(actor, opportunityId, 'PLAN_REVIEW');
  }
  /** Trình và duyệt trực tiếp phương án (người duyệt là trưởng nhóm). */
  async function approvedPlan(opportunityId: string) {
    const submitted = await tender.submitPlan(nv1, opportunityId, { version: (await tender.get(nv1, opportunityId))!.version });
    return tender.approvePlan(tn, opportunityId, { version: submitted.version });
  }

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const organization = { snapshot: async () => ORGANIZATION, people: async () => PEOPLE };
    const customerStore = new PostgresCustomerStore(handle.database);
    const opportunityStore = new PostgresOpportunityStore(handle.database);
    const tenderStore = new PostgresTenderStore(handle.database);
    const settingsStore = new PostgresQuoteSettingsStore(handle.database);
    config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(
      opportunityStore,
      customerStore,
      scopes,
      config,
      undefined,
      { presentDocumentTypes: async (_t, opportunityId, refs) => {
          const rows = await query<{ code: string }>(
            `SELECT DISTINCT t.code FROM crm_schema.documents d JOIN crm_schema.document_types t ON t.id = d.document_type_id
              WHERE d.entity_type = 'opportunity' AND d.entity_id = $1 AND d.current_version_no IS NOT NULL AND t.code = ANY($2::text[])`,
            [opportunityId, [...refs]],
          );
          return new Set(rows.map((row) => row.code));
        },
        documentTypeNames: async (_t, refs) => {
          const rows = await query<{ code: string; name: string }>(`SELECT code, name FROM crm_schema.document_types WHERE code = ANY($1::text[])`, [[...refs]]);
          return new Map(rows.map((row) => [row.code, row.name]));
        } },
      new StageAssigneeResolver(organization),
      organization,
      tenderStore,
    );
    tender = new TenderService(
      tenderStore,
      opportunityStore,
      scopes,
      config,
      opportunities,
      settingsStore,
      new PostgresApprovalLinks(handle.database, procedure),
      { snapshot: async () => ORGANIZATION },
    );
    settings = new QuoteApprovalSettingsService(settingsStore, procedure);
    contracts = new ContractService(
      new PostgresContractStore(handle.database),
      customerStore,
      new PendingCatalogReader(),
      scopes,
      {} as never,
      {} as never,
      {} as never,
    );
    customerId = (await new CustomerService(customerStore, scopes).create(ql, { name: 'Khách thầu', ownerUserId: NV1 })).id;
    tenderPipelineId = (await query<{ id: string }>(`SELECT id FROM crm_schema.pipelines WHERE code = 'TENDER_STANDARD'`))[0].id;
    standardPipelineId = (await query<{ id: string }>(`SELECT id FROM crm_schema.pipelines WHERE is_default`))[0].id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-TND-02, TC-P2MIG-03 (DB): migration 0023 và 0024 tạo bảng, luồng "Chào thầu" đúng giai đoạn, bước chuyển, điều kiện; chạy lại được', async () => {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm_schema'
        AND table_name IN ('tender_profiles', 'tender_partners', 'tender_plan_rounds')`,
    );
    expect(tables).toHaveLength(3);
    const pipeline = (await query<{ profile: string; is_default: boolean; name: string }>(`SELECT profile, is_default, name FROM crm_schema.pipelines WHERE code = 'TENDER_STANDARD'`))[0];
    expect(pipeline).toEqual({ profile: 'TENDER', is_default: false, name: 'Chào thầu' });
    expect((await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.pipelines WHERE is_default`))[0].n).toBe(1);
    const stages = await query<{ code: string; name: string; semantic: string }>(
      `SELECT code, name, semantic FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_order`,
      [tenderPipelineId],
    );
    expect(stages).toEqual([
      { code: 'HSMT', name: 'Thu thập HSMT', semantic: 'OPEN' },
      { code: 'PREPARE', name: 'Chuẩn bị hồ sơ', semantic: 'OPEN' },
      { code: 'PLAN_REVIEW', name: 'Chờ duyệt phương án', semantic: 'OPEN' },
      { code: 'SUBMITTED', name: 'Đã nộp', semantic: 'OPEN' },
      { code: 'WON', name: 'Trúng', semantic: 'WON' },
      { code: 'LOST', name: 'Trượt', semantic: 'LOST' },
    ]);
    const requirements = await query<{ stage: string; kind: string; ref: string; required: boolean }>(
      `SELECT s.code AS stage, r.kind, r.ref, r.required FROM crm_schema.pipeline_stage_requirements r
         JOIN crm_schema.pipeline_stages s ON s.id = r.stage_id WHERE s.pipeline_id = $1 ORDER BY s.sort_order, r.sort_order`,
      [tenderPipelineId],
    );
    expect(requirements).toEqual([
      { stage: 'PLAN_REVIEW', kind: 'DOCUMENT_TYPE', ref: 'LEGAL_DOSSIER', required: true },
      { stage: 'PLAN_REVIEW', kind: 'DOCUMENT_TYPE', ref: 'ESTIMATE', required: true },
      { stage: 'SUBMITTED', kind: 'TENDER_PLAN_APPROVED', ref: '', required: true },
      { stage: 'SUBMITTED', kind: 'TENDER_FIELD', ref: 'submissionMethod', required: true },
      { stage: 'WON', kind: 'TENDER_FIELD', ref: 'winningPrice', required: true },
      { stage: 'LOST', kind: 'REASON', ref: '', required: true },
    ]);
    // Trượt từ mọi giai đoạn mở; Trúng chỉ từ Đã nộp.
    const toLost = await query<{ code: string }>(
      `SELECT f.code FROM crm_schema.pipeline_stage_transitions t
         JOIN crm_schema.pipeline_stages f ON f.id = t.from_stage_id JOIN crm_schema.pipeline_stages l ON l.id = t.to_stage_id
        WHERE l.pipeline_id = $1 AND l.code = 'LOST' ORDER BY f.sort_order`,
      [tenderPipelineId],
    );
    expect(toLost.map((row) => row.code)).toEqual(['HSMT', 'PREPARE', 'PLAN_REVIEW', 'SUBMITTED']);
    const toWon = await query<{ code: string }>(
      `SELECT f.code FROM crm_schema.pipeline_stage_transitions t
         JOIN crm_schema.pipeline_stages f ON f.id = t.from_stage_id JOIN crm_schema.pipeline_stages w ON w.id = t.to_stage_id
        WHERE w.pipeline_id = $1 AND w.code = 'WON'`,
      [tenderPipelineId],
    );
    expect(toWon.map((row) => row.code)).toEqual(['SUBMITTED']);

    // Chạy lại nguyên file trên DB đã có dữ liệu: không lỗi, không nhân đôi, không ghi đè.
    for (const file of ['0023-tender.sql', '0024-tender-pipeline.sql']) {
      await handle.pool.query(await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm', file), 'utf8'));
    }
    expect((await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.pipeline_stages WHERE pipeline_id = $1`, [tenderPipelineId]))[0].n).toBe(6);
    expect((await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.pipeline_stage_requirements r JOIN crm_schema.pipeline_stages s ON s.id = r.stage_id WHERE s.pipeline_id = $1`, [tenderPipelineId]))[0].n).toBe(6);
    // Ràng buộc loại mới nhận TENDER_PLAN và crm_tender_plan, vẫn từ chối giá trị lạ.
    await expect(query(`INSERT INTO crm_schema.approval_bindings (kind, mode) VALUES ('TENDER_PLAN', 'DIRECT') ON CONFLICT DO NOTHING`)).resolves.toBeDefined();
    await expect(query(`INSERT INTO crm_schema.approval_bindings (kind, mode) VALUES ('KHAC', 'DIRECT')`)).rejects.toMatchObject({ code: '23514' });
    await query(`DELETE FROM crm_schema.approval_bindings WHERE kind = 'TENDER_PLAN'`);
  });

  it('TC-TND-01: tạo cơ hội luồng Chào thầu và hồ sơ thầu 1-1; giai đoạn đầu là Thu thập HSMT', async () => {
    const { opportunityId, profile } = await newTender();
    expect(await stageOf(opportunityId)).toBe('HSMT');
    expect(profile).toMatchObject({
      opportunityId,
      inviterName: 'Sở Y tế',
      packageCode: 'GT-01',
      hasJointVenture: false,
      submissionMethod: null,
      result: null,
      version: 1,
      editable: true,
      planLocked: false,
      plan: { status: 'DRAFT', roundNo: 0, via: null },
      partners: [],
      rounds: [],
      contractDraft: null,
    });
    expect(profile.submissionDeadline).not.toBeNull();
    expect(await auditActions(profile.id)).toEqual(['create']);
    const got = await tender.get(nv1, opportunityId);
    expect(got?.id).toBe(profile.id);
    // Sửa có khoá phiên bản.
    const edited = await tender.update(nv1, opportunityId, { version: 1, submissionMethod: 'ONLINE', submitterUserId: NV1 });
    expect(edited).toMatchObject({ submissionMethod: 'ONLINE', submitterUserId: NV1, version: 2 });
    await expect(tender.update(nv1, opportunityId, { version: 1, packageCode: 'X' })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_VERSION' });
    await expect(tender.update(nv1, opportunityId, { version: 2, packageName: ' ' })).rejects.toMatchObject({ statusCode: 400 });
    // Hạn nộp ở quá khứ bị từ chối khi tạo và khi đổi.
    await expect(tender.update(nv1, opportunityId, { version: 2, submissionDeadline: inDays(-1) })).rejects.toMatchObject({ statusCode: 400, code: 'DEADLINE_IN_PAST' });
    const second = await opportunities.create(nv1, { customerId, name: 'Hạn quá khứ', pipelineId: tenderPipelineId });
    await expect(tender.create(nv1, second.id, { packageName: 'A', inviterName: 'B', submissionDeadline: inDays(-2) })).rejects.toMatchObject({ code: 'DEADLINE_IN_PAST' });
    await expect(tender.create(nv1, second.id, { packageName: '', inviterName: 'B' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await tender.get(nv1, second.id)).toBeNull();
  });

  it('TC-TND-13: chỉ cơ hội luồng Chào thầu có hồ sơ; luồng thường bị từ chối; hai hồ sơ cho một cơ hội bị từ chối', async () => {
    const normal = await opportunities.create(nv1, { customerId, name: 'Cơ hội thường', pipelineId: standardPipelineId });
    await expect(tender.create(nv1, normal.id, { packageName: 'Gói', inviterName: 'Bên mời' })).rejects.toMatchObject({ statusCode: 409, code: 'NOT_TENDER_PIPELINE' });
    expect(await tender.get(nv1, normal.id)).toBeNull();
    expect(await query(`SELECT 1 FROM crm_schema.tender_profiles WHERE opportunity_id = $1`, [normal.id])).toHaveLength(0);

    const { opportunityId } = await newTender();
    await expect(tender.create(nv1, opportunityId, { packageName: 'Gói hai', inviterName: 'Bên mời' })).rejects.toMatchObject({ statusCode: 409, code: 'TENDER_PROFILE_EXISTS' });
    // Ràng buộc DB chặn cả khi đi đường khác (hai request đồng thời).
    await expect(
      query(`INSERT INTO crm_schema.tender_profiles (opportunity_id, package_name, inviter_name, created_by, updated_by) VALUES ($1, 'x', 'y', $2, $2)`, [opportunityId, NV1]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await query(`SELECT 1 FROM crm_schema.tender_profiles WHERE opportunity_id = $1`, [opportunityId])).toHaveLength(1);
  });

  it('TC-TND-12: phân quyền theo phạm vi dữ liệu CRM; người được gán giai đoạn thấy; ngoài phạm vi 404', async () => {
    const { opportunityId } = await newTender();
    // NV3 (đồng cấp, ngoài phạm vi của NV1): không thấy, không sửa, không tạo.
    await expect(tender.get(nv3, opportunityId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(tender.update(nv3, opportunityId, { version: 1, packageCode: 'X' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(tender.addPartner(nv3, opportunityId, { name: 'A' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(tender.submitPlan(nv3, opportunityId, { version: 1 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(tender.recordResult(nv3, opportunityId, { version: 1, result: 'LOST', reason: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    // Trưởng nhóm (cấp trên của NV1) và quản lý thấy và sửa được.
    expect((await tender.get(actorOf(TN), opportunityId))?.opportunityId).toBe(opportunityId);
    expect(await tender.update(actorOf(TN), opportunityId, { version: 1, packageCode: 'TN-1' })).toMatchObject({ packageCode: 'TN-1', version: 2 });
    expect((await tender.get(ql, opportunityId))?.packageCode).toBe('TN-1');
    // Người chỉ xem: đọc được, không ghi.
    expect((await tender.get(viewer, opportunityId))?.id).toBeDefined();
    await expect(tender.update(viewer, opportunityId, { version: 2, packageCode: 'V' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(tender.addPartner(viewer, opportunityId, { name: 'A' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(tender.recordResult(viewer, opportunityId, { version: 2, result: 'LOST', reason: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    // Người được gán giai đoạn hiện tại thấy hồ sơ dù ngoài phạm vi theo người phụ trách.
    const hsmt = await stageIdOf(tenderPipelineId, 'HSMT');
    await opportunities.updateStageAssignee(ql, opportunityId, hsmt, { assigneeUserId: NV3 });
    expect((await tender.get(nv3, opportunityId))?.opportunityId).toBe(opportunityId);
    // Id không phải UUID: 404.
    await expect(tender.get(nv1, 'khong-phai-uuid')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-TND-02: chuyển sang Chờ duyệt phương án cần hồ sơ pháp lý và dự toán; 409 nêu loại tài liệu thiếu; đủ thì chuyển', async () => {
    const { opportunityId } = await newTender();
    await move(nv1, opportunityId, 'PREPARE');
    const missing = (error: unknown) => (error as { details: { missing: { kind: string; ref: string; message: string }[] } }).details.missing;
    let thrown: unknown;
    await move(nv1, opportunityId, 'PLAN_REVIEW').catch((error) => (thrown = error));
    expect(thrown).toMatchObject({ statusCode: 409, code: 'STAGE_REQUIREMENTS_NOT_MET' });
    expect(missing(thrown).map((item) => item.ref)).toEqual(['LEGAL_DOSSIER', 'ESTIMATE']);
    expect(missing(thrown)[0].message).toContain('Hồ sơ pháp lý');
    expect(await stageOf(opportunityId)).toBe('PREPARE');
    await addDocument(opportunityId, 'LEGAL_DOSSIER');
    thrown = undefined;
    await move(nv1, opportunityId, 'PLAN_REVIEW').catch((error) => (thrown = error));
    expect(missing(thrown).map((item) => item.ref)).toEqual(['ESTIMATE']);
    await addDocument(opportunityId, 'ESTIMATE');
    expect((await move(nv1, opportunityId, 'PLAN_REVIEW')).stage).toBe('PLAN_REVIEW');
    // Bước chuyển tuần tự: không nhảy từ Thu thập HSMT sang Đã nộp.
    const other = await newTender();
    await expect(move(nv1, other.opportunityId, 'SUBMITTED')).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STAGE_TRANSITION' });
    await expect(move(nv1, other.opportunityId, 'WON')).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STAGE_TRANSITION' });
  });

  it('TC-TND-03, TC-TND-06: nhánh có liên danh - trình, duyệt, sang Đã nộp cần phương án đã duyệt và hình thức nộp; nhật ký đủ', async () => {
    const { opportunityId, profile } = await newTender({ joint: true });
    await toPlanReview(opportunityId);
    // Có liên danh mà chưa có đối tác: chưa trình được.
    await expect(tender.submitPlan(nv1, opportunityId, { version: profile.version })).rejects.toMatchObject({ statusCode: 409, code: 'PARTNERS_REQUIRED' });
    const withPartner = await tender.addPartner(nv1, opportunityId, { name: 'Công ty B', scope: 'Thi công hạ tầng' });
    expect(withPartner.partners).toEqual([{ id: expect.any(String), name: 'Công ty B', scope: 'Thi công hạ tầng' }]);

    // Chưa duyệt, chưa có hình thức nộp: 409 nêu đủ cả hai điều kiện.
    let thrown: unknown;
    await move(nv1, opportunityId, 'SUBMITTED').catch((error) => (thrown = error));
    expect(thrown).toMatchObject({ statusCode: 409, code: 'STAGE_REQUIREMENTS_NOT_MET' });
    const kinds = (thrown as { details: { missing: { kind: string; ref: string }[] } }).details.missing;
    expect(kinds.map((item) => `${item.kind}:${item.ref}`)).toEqual(['TENDER_PLAN_APPROVED:', 'TENDER_FIELD:submissionMethod']);

    // Trình (duyệt trực tiếp): chờ duyệt, báo cấp trên của người trình.
    const submitted = await tender.submitPlan(nv1, opportunityId, { version: withPartner.version });
    expect(submitted).toMatchObject({ planLocked: true, plan: { status: 'PENDING', roundNo: 1, via: 'DIRECT', submittedBy: NV1 } });
    expect(submitted.rounds).toHaveLength(1);
    expect(submitted.rounds[0]).toMatchObject({ roundNo: 1, hasJointVenture: true, partnerCount: 1, decision: null });
    const requested = await outbox(profile.id, 'crm.tender-plan.approval-requested');
    expect(requested).toHaveLength(1);
    expect(requested[0].payload.payload).toMatchObject({ opportunityId, roundNo: 1, mode: 'DIRECT', recipientUserIds: [TN], hasJointVenture: true });
    // Chờ duyệt: khoá sửa kịch bản, liên danh và đối tác; trình lại bị từ chối.
    await expect(tender.update(nv1, opportunityId, { version: submitted.version, scenario: 'Đổi' })).rejects.toMatchObject({ statusCode: 409, code: 'PLAN_LOCKED' });
    await expect(tender.addPartner(nv1, opportunityId, { name: 'Công ty C' })).rejects.toMatchObject({ statusCode: 409, code: 'PLAN_LOCKED' });
    await expect(tender.submitPlan(nv1, opportunityId, { version: submitted.version })).rejects.toMatchObject({ statusCode: 409, code: 'PLAN_PENDING' });
    // Không có quyền duyệt: 403; có quyền nhưng chính người trình: 403.
    await expect(tender.approvePlan(nv1, opportunityId, { version: submitted.version })).rejects.toMatchObject({ statusCode: 403 });
    await expect(tender.approvePlan(nv1Approver, opportunityId, { version: submitted.version })).rejects.toMatchObject({ statusCode: 403 });
    // Người duyệt ngoài phạm vi dữ liệu: 404.
    await expect(tender.approvePlan(actorOf(NV3, { canApproveQuote: true }), opportunityId, { version: submitted.version })).rejects.toMatchObject({ statusCode: 404 });
    // Phiên bản cũ: 409.
    await expect(tender.approvePlan(tn, opportunityId, { version: submitted.version - 1 })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    const approved = await tender.approvePlan(tn, opportunityId, { version: submitted.version });
    expect(approved).toMatchObject({ planLocked: false, plan: { status: 'APPROVED', decidedBy: TN } });
    expect(approved.rounds[0]).toMatchObject({ decision: 'APPROVED', decidedBy: TN });
    const decided = await outbox(profile.id, 'crm.tender-plan.approval-decided');
    expect(decided[0].payload.payload).toMatchObject({ status: 'APPROVED', recipientUserIds: [NV1], actorUserId: TN });

    // Đã duyệt nhưng thiếu hình thức nộp: vẫn 409 nêu hình thức nộp.
    thrown = undefined;
    await move(nv1, opportunityId, 'SUBMITTED').catch((error) => (thrown = error));
    expect((thrown as { details: { missing: { ref: string }[] } }).details.missing.map((item) => item.ref)).toEqual(['submissionMethod']);
    expect((await tender.get(nv1, opportunityId))!.submittedAt).toBeNull();
    const ready = await tender.update(nv1, opportunityId, { version: approved.version, submissionMethod: 'IN_PERSON' });
    expect((await move(nv1, opportunityId, 'SUBMITTED')).stage).toBe('SUBMITTED');
    // Sang Đã nộp tự ghi ngày nộp.
    expect((await tender.get(nv1, opportunityId))!.submittedAt).not.toBeNull();
    expect(ready.version).toBeGreaterThan(approved.version - 1);
    expect(await auditActions(profile.id)).toEqual(['create', 'partner-add', 'plan-submit', 'plan-approve', 'update']);
  });

  it('TC-TND-04: nhánh không liên danh vẫn phải duyệt phương án; chưa duyệt thì không sang Đã nộp', async () => {
    const { opportunityId } = await newTender({ joint: false });
    await toPlanReview(opportunityId);
    await tender.update(nv1, opportunityId, { version: 1, submissionMethod: 'ONLINE' });
    // Hình thức nộp đã có nhưng phương án chưa duyệt: chặn, chỉ nêu phương án.
    let thrown: unknown;
    await move(nv1, opportunityId, 'SUBMITTED').catch((error) => (thrown = error));
    expect(thrown).toMatchObject({ statusCode: 409 });
    expect((thrown as { details: { missing: { kind: string }[] } }).details.missing.map((item) => item.kind)).toEqual(['TENDER_PLAN_APPROVED']);
    // Trình xong nhưng chưa ai duyệt: vẫn chặn.
    const pending = await tender.submitPlan(nv1, opportunityId, { version: 2 });
    expect(pending.plan.status).toBe('PENDING');
    await expect(move(nv1, opportunityId, 'SUBMITTED')).rejects.toMatchObject({ statusCode: 409 });
    await tender.approvePlan(ql, opportunityId, { version: pending.version });
    expect((await move(nv1, opportunityId, 'SUBMITTED')).stage).toBe('SUBMITTED');
    // Trình phương án khi chưa có kịch bản: 400; (cả hai nhánh cùng luật).
    const blank = await newTender({ scenario: null });
    await expect(tender.submitPlan(nv1, blank.opportunityId, { version: 1 })).rejects.toMatchObject({ statusCode: 400, code: 'SCENARIO_REQUIRED' });
  });

  it('TC-TND-05: không duyệt thì trả về sửa; sửa và trình lại thành vòng mới; lịch sử các vòng được giữ', async () => {
    const { opportunityId, profile } = await newTender();
    const first = await tender.submitPlan(nv1, opportunityId, { version: profile.version });
    // Từ chối bắt buộc lý do.
    await expect(tender.rejectPlan(tn, opportunityId, { version: first.version })).rejects.toMatchObject({ statusCode: 400, code: 'REASON_REQUIRED' });
    expect((await tender.get(tn, opportunityId))!.plan.status).toBe('PENDING');
    const rejected = await tender.rejectPlan(tn, opportunityId, { version: first.version, reason: 'Giá chưa cạnh tranh' });
    expect(rejected.plan).toMatchObject({ status: 'REJECTED', decisionReason: 'Giá chưa cạnh tranh', decidedBy: TN });
    expect(rejected.planLocked).toBe(false);
    const decidedEvents = await outbox(profile.id, 'crm.tender-plan.approval-decided');
    expect(decidedEvents[0].payload.payload).toMatchObject({ status: 'REJECTED', reason: 'Giá chưa cạnh tranh', recipientUserIds: [NV1] });
    // Chưa được sang Đã nộp (cũng chưa tới được vì chưa qua Chờ duyệt, nhưng điều kiện vẫn phải chặn).
    // Sửa kịch bản rồi trình lại: vòng 2.
    const edited = await tender.update(nv1, opportunityId, { version: rejected.version, scenario: 'Hạ giá 5%, thêm bảo hành' });
    expect(edited.plan.status).toBe('REJECTED');
    const second = await tender.submitPlan(nv1, opportunityId, { version: edited.version });
    expect(second.plan).toMatchObject({ status: 'PENDING', roundNo: 2 });
    expect(second.rounds.map((round) => [round.roundNo, round.decision, round.reason])).toEqual([
      [1, 'REJECTED', 'Giá chưa cạnh tranh'],
      [2, null, null],
    ]);
    expect(second.rounds[0].scenario).toBe('Chào thầu trọn gói, giá cạnh tranh.');
    expect(second.rounds[1].scenario).toBe('Hạ giá 5%, thêm bảo hành');
    const approved = await tender.approvePlan(tn, opportunityId, { version: second.version });
    expect(approved.rounds.map((round) => round.decision)).toEqual(['REJECTED', 'APPROVED']);
    // Đã duyệt mà sửa kịch bản: quay về Đang soạn, phải duyệt lại (vòng cũ vẫn giữ).
    const reopened = await tender.update(nv1, opportunityId, { version: approved.version, scenario: 'Phương án mới' });
    expect(reopened.plan).toMatchObject({ status: 'DRAFT', decidedAt: null });
    expect(reopened.rounds).toHaveLength(2);
    // Duyệt lại khi không còn chờ duyệt: 409.
    await expect(tender.approvePlan(tn, opportunityId, { version: reopened.version })).rejects.toMatchObject({ statusCode: 409, code: 'PLAN_NOT_PENDING' });
    expect(await auditActions(profile.id)).toEqual(['create', 'plan-submit', 'plan-reject', 'update', 'plan-submit', 'plan-approve', 'update-reset-approval']);
  });

  it('TC-TND-03/05 qua Quy trình: cấu hình TENDER_PLAN gắn quy trình; kết quả hồ sơ Quy trình áp vào phương án; nhận trùng bỏ qua', async () => {
    await settings.saveBinding(ql, 'TENDER_PLAN', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    expect((await settings.bindings(ql)).find((binding) => binding.kind === 'TENDER_PLAN')).toMatchObject({ mode: 'PROCEDURE' });
    try {
      const { opportunityId, profile } = await newTender();
      const submitted = await tender.submitPlan(nv1, opportunityId, { version: profile.version });
      expect(submitted.plan).toMatchObject({ status: 'PENDING', via: 'PROCEDURE' });
      const link = (await query<{ id: string; source_id: string; status: string; instance_code: string | null; definition_id: string }>(
        `SELECT id, source_id, status, instance_code, definition_id FROM crm_schema.procedure_links WHERE source_type = 'crm_tender_plan'`,
      ))[0];
      expect(link).toMatchObject({ status: 'RUNNING', definition_id: procedure.definition.id });
      expect(link.instance_code).toMatch(/^HS-T/);
      expect(procedure.byKey.get(`crm:${link.id}`)?.request).toMatchObject({ sourceType: 'crm_tender_plan', sourceId: link.id, autoCompleteInitiatorStep: true });
      expect((await tender.get(nv1, opportunityId))!.plan.procedureInstanceCode).toBe(link.instance_code);
      // Đang qua Quy trình: không duyệt tay; không báo cấp trên (Quy trình tự giao bước).
      await expect(tender.approvePlan(tn, opportunityId, { version: submitted.version })).rejects.toMatchObject({ statusCode: 409, code: 'PLAN_IN_PROCEDURE' });
      const requested = await outbox(profile.id, 'crm.tender-plan.approval-requested');
      expect(requested[0].payload.payload).toMatchObject({ mode: 'PROCEDURE', recipientUserIds: [] });
      // Sai nguồn hoặc id lạ: bỏ qua.
      const database = (handle.database as unknown) as Parameters<typeof applyTenderPlanProcedureResult>[0];
      expect(await applyTenderPlanProcedureResult(database, tenantId, { sourceType: 'crm_quote', sourceId: link.id, status: 'completed' })).toBe('ignored');
      expect(await applyTenderPlanProcedureResult(database, tenantId, { sourceType: 'crm_tender_plan', sourceId: randomUUID(), status: 'completed' })).toBe('ignored');
      expect(await applyTenderPlanProcedureResult(database, tenantId, { sourceType: 'crm_tender_plan', sourceId: link.id, status: 'running' })).toBe('ignored');
      // Hoàn tất: phương án Đã duyệt; nhận trùng bỏ qua.
      const event = { sourceType: 'crm_tender_plan', sourceId: link.id, status: 'completed', instanceId: procedure.byKey.get(`crm:${link.id}`)!.id, actorId: TN };
      expect(await applyTenderPlanProcedureResult(database, tenantId, event)).toBe('applied');
      expect(await applyTenderPlanProcedureResult(database, tenantId, event)).toBe('ignored');
      const done = await tender.get(nv1, opportunityId);
      expect(done!.plan).toMatchObject({ status: 'APPROVED', decidedBy: TN });
      expect(done!.rounds[0]).toMatchObject({ decision: 'APPROVED', via: 'PROCEDURE' });
      expect((await query<{ status: string }>(`SELECT status FROM crm_schema.procedure_links WHERE id = $1`, [link.id]))[0].status).toBe('APPLIED');

      // Quy trình từ chối: trả về sửa, lý do lấy từ Quy trình.
      const other = await newTender();
      const sent = await tender.submitPlan(nv1, other.opportunityId, { version: other.profile.version });
      const link2 = (await query<{ id: string }>(`SELECT id FROM crm_schema.procedure_links WHERE source_type = 'crm_tender_plan' AND source_id = $1`, [sent.rounds[0].id]))[0];
      expect(await applyTenderPlanProcedureResult(database, tenantId, { sourceType: 'crm_tender_plan', sourceId: link2.id, status: 'rejected', reason: 'Quy trình: thiếu bảo lãnh' })).toBe('applied');
      const back = await tender.get(nv1, other.opportunityId);
      expect(back!.plan).toMatchObject({ status: 'REJECTED', decisionReason: 'Quy trình: thiếu bảo lãnh' });
      // Hoàn tất đến muộn khi vòng đã quyết định: bỏ qua, không đổi trạng thái.
      expect(await applyTenderPlanProcedureResult(database, tenantId, { sourceType: 'crm_tender_plan', sourceId: link2.id, status: 'completed' })).toBe('ignored');
      expect((await tender.get(nv1, other.opportunityId))!.plan.status).toBe('REJECTED');
    } finally {
      await settings.saveBinding(ql, 'TENDER_PLAN', { mode: 'DIRECT' });
    }
  });

  it('Quy trình không tạo được phiên (FAILED, chưa có hồ sơ): người có quyền duyệt tay được, liên kết đóng', async () => {
    await settings.saveBinding(ql, 'TENDER_PLAN', { mode: 'PROCEDURE', procedureDefinitionId: procedure.definition.id });
    try {
      const { opportunityId, profile } = await newTender();
      const submitted = await tender.submitPlan(nv1, opportunityId, { version: profile.version });
      await query(
        `UPDATE crm_schema.procedure_links SET status = 'FAILED', instance_id = NULL, instance_code = NULL
          WHERE source_type = 'crm_tender_plan' AND source_id = $1`,
        [submitted.rounds[0].id],
      );
      const approved = await tender.approvePlan(tn, opportunityId, { version: submitted.version });
      expect(approved.plan.status).toBe('APPROVED');
      expect((await query<{ status: string }>(`SELECT status FROM crm_schema.procedure_links WHERE source_id = $1`, [submitted.rounds[0].id]))[0].status).toBe('CLOSED');
    } finally {
      await settings.saveBinding(ql, 'TENDER_PLAN', { mode: 'DIRECT' });
    }
  });

  it('TC-TND-08, TC-TND-10: Trúng - ghi giá trúng, cơ hội WON, giá trị cơ hội = giá trúng, lập được hợp đồng từ gợi ý', async () => {
    const { opportunityId, profile } = await newTender();
    await toPlanReview(opportunityId);
    await tender.update(nv1, opportunityId, { version: profile.version, submissionMethod: 'ONLINE' });
    const approved = await approvedPlan(opportunityId);
    await move(nv1, opportunityId, 'SUBMITTED');
    const current = (await tender.get(nv1, opportunityId))!;
    expect(current.version).toBe(approved.version);
    // Chuyển thẳng sang Trúng bằng đường chung khi chưa ghi giá trúng: chặn theo điều kiện TENDER_FIELD.
    await expect(move(nv1, opportunityId, 'WON')).rejects.toMatchObject({ statusCode: 409, code: 'STAGE_REQUIREMENTS_NOT_MET' });
    expect(await stageOf(opportunityId)).toBe('SUBMITTED');
    // Thiếu giá trúng: 400, không đổi gì.
    await expect(tender.recordResult(nv1, opportunityId, { version: current.version, result: 'WON' })).rejects.toMatchObject({ statusCode: 400, code: 'WINNING_PRICE_REQUIRED' });
    // Phiên bản cũ: 409, giai đoạn không đổi.
    await expect(tender.recordResult(nv1, opportunityId, { version: current.version - 1, result: 'WON', winningPrice: 1 })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(await stageOf(opportunityId)).toBe('SUBMITTED');

    const won = await tender.recordResult(nv1, opportunityId, { version: current.version, result: 'WON', winningPrice: 2_500_000_000, winnerName: 'Liên danh của ta' });
    expect(won).toMatchObject({
      result: 'WON',
      winningPrice: 2_500_000_000,
      winnerName: 'Liên danh của ta',
      resultRecordedBy: NV1,
      editable: false,
    });
    const opportunity = await opportunities.get(ql, opportunityId);
    expect(opportunity).toMatchObject({ stage: 'WON', probability: 100, expectedValue: 2_500_000_000 });
    expect(opportunity.closedAt).not.toBeNull();
    expect(opportunity.stageInfo).toMatchObject({ code: 'WON', semantic: 'WON' });
    // Đường vào hợp đồng hiện có: gợi ý điền sẵn lập được hợp đồng bán, giá trị bằng giá trúng.
    expect(won.contractDraft).toMatchObject({ type: 'SALE', customerId, value: 2_500_000_000, ownerUserId: NV1 });
    const contract = await contracts.create(actorOf(NV1, { canWriteContract: true }), { ...won.contractDraft!, lines: [] });
    expect(contract).toMatchObject({ value: 2_500_000_000, customerId, status: 'DRAFT' });
    // Cơ hội đã đóng: không sửa, không đối tác, không ghi kết quả lần hai.
    await expect(tender.update(nv1, opportunityId, { version: won.version, packageCode: 'Z' })).rejects.toMatchObject({ statusCode: 409, code: 'OPPORTUNITY_CLOSED' });
    await expect(tender.recordResult(nv1, opportunityId, { version: won.version, result: 'LOST', reason: 'x' })).rejects.toMatchObject({ statusCode: 409, code: 'OPPORTUNITY_CLOSED' });
    expect(await auditActions(profile.id)).toContain('record-result');
  });

  it('TC-TND-08: chỉ Trúng được từ Đã nộp; cơ hội ở Chuẩn bị hồ sơ ghi Trúng bị 409 và không đổi gì', async () => {
    const { opportunityId, profile } = await newTender();
    await move(nv1, opportunityId, 'PREPARE');
    await expect(tender.recordResult(nv1, opportunityId, { version: profile.version, result: 'WON', winningPrice: 100 })).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STAGE_TRANSITION' });
    expect(await stageOf(opportunityId)).toBe('PREPARE');
    expect((await tender.get(nv1, opportunityId))).toMatchObject({ result: null, winningPrice: null });
  });

  it('TC-TND-09, TC-TND-10: Trượt - bắt buộc lý do, kết thúc, ghi đơn vị trúng; không phát sinh việc chăm sóc', async () => {
    const { opportunityId, profile } = await newTender();
    await toPlanReview(opportunityId);
    await tender.update(nv1, opportunityId, { version: profile.version, submissionMethod: 'POST' });
    await approvedPlan(opportunityId);
    await move(nv1, opportunityId, 'SUBMITTED');
    const current = (await tender.get(nv1, opportunityId))!;
    // Không lý do: bị chặn, không đổi gì.
    await expect(tender.recordResult(nv1, opportunityId, { version: current.version, result: 'LOST' })).rejects.toMatchObject({ statusCode: 400, code: 'LOST_REASON_REQUIRED' });
    await expect(tender.recordResult(nv1, opportunityId, { version: current.version, result: 'LOST', reason: '   ' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await stageOf(opportunityId)).toBe('SUBMITTED');
    const lost = await tender.recordResult(nv1, opportunityId, {
      version: current.version,
      result: 'LOST',
      reason: 'Giá cao hơn đối thủ 8%',
      winnerName: 'Công ty Đối Thủ',
      winningPrice: 2_000_000_000,
    });
    expect(lost).toMatchObject({
      result: 'LOST',
      lostReason: 'Giá cao hơn đối thủ 8%',
      winnerName: 'Công ty Đối Thủ',
      winningPrice: 2_000_000_000,
      editable: false,
      contractDraft: null,
    });
    const opportunity = await opportunities.get(ql, opportunityId);
    expect(opportunity).toMatchObject({ stage: 'LOST', probability: 0, lostReason: 'Giá cao hơn đối thủ 8%' });
    expect(opportunity.closedAt).not.toBeNull();
    expect(opportunity.nextStages).toEqual([]);
    // Kết thúc: giá trị cơ hội không bị ghi đè bởi giá của đối thủ; không có hoạt động chăm sóc nào được tạo.
    expect(opportunity.expectedValue).not.toBe(2_000_000_000);
    expect((await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.activities WHERE opportunity_id = $1`, [opportunityId]))[0].n).toBe(0);
    expect(await query(`SELECT 1 FROM integration_schema.outbox_events WHERE aggregate_id = $1 AND event_type LIKE '%care%'`, [opportunityId])).toHaveLength(0);
  });

  it('Trượt từ giai đoạn mở bất kỳ; đi đường chuyển giai đoạn chung sang Trượt vẫn ghi kết quả vào hồ sơ thầu', async () => {
    const early = await newTender();
    const lost = await tender.recordResult(nv1, early.opportunityId, { version: early.profile.version, result: 'LOST', reason: 'Không đủ năng lực' });
    expect(lost.result).toBe('LOST');
    expect(await stageOf(early.opportunityId)).toBe('LOST');

    const generic = await newTender();
    await expect(move(nv1, generic.opportunityId, 'LOST')).rejects.toMatchObject({ statusCode: 400, code: 'LOST_REASON_REQUIRED' });
    await move(nv1, generic.opportunityId, 'LOST', 'Bên mời huỷ thầu');
    expect(await tender.get(nv1, generic.opportunityId)).toMatchObject({ result: 'LOST', lostReason: 'Bên mời huỷ thầu', editable: false });
  });

  it('TC-TND-14 (backend): thêm, sửa, xoá đối tác và phạm vi; chỉ khi có liên danh; đối tác ngoài hồ sơ 404; bỏ liên danh cần xoá hết đối tác', async () => {
    const { opportunityId, profile } = await newTender({ joint: false });
    await expect(tender.addPartner(nv1, opportunityId, { name: 'A' })).rejects.toMatchObject({ statusCode: 409, code: 'NO_JOINT_VENTURE' });
    const joint = await tender.update(nv1, opportunityId, { version: profile.version, hasJointVenture: true });
    expect(joint.hasJointVenture).toBe(true);
    await expect(tender.addPartner(nv1, opportunityId, { name: ' ' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tender.addPartner(nv1, opportunityId, { name: 'x'.repeat(301) })).rejects.toMatchObject({ statusCode: 400 });
    const one = await tender.addPartner(nv1, opportunityId, { name: 'Công ty B', scope: 'Thiết bị' });
    const two = await tender.addPartner(nv1, opportunityId, { name: 'Công ty C' });
    expect(two.partners.map((partner) => [partner.name, partner.scope])).toEqual([['Công ty B', 'Thiết bị'], ['Công ty C', null]]);
    const partnerId = one.partners[0].id;
    const renamed = await tender.updatePartner(nv1, opportunityId, partnerId, { name: 'Công ty B (đổi tên)', scope: 'Thiết bị và lắp đặt' });
    expect(renamed.partners[0]).toEqual({ id: partnerId, name: 'Công ty B (đổi tên)', scope: 'Thiết bị và lắp đặt' });
    // Đối tác của hồ sơ khác hoặc id lạ: 404.
    const foreign = await newTender({ joint: true });
    const foreignPartner = (await tender.addPartner(nv1, foreign.opportunityId, { name: 'Của hồ sơ khác' })).partners[0].id;
    await expect(tender.updatePartner(nv1, opportunityId, foreignPartner, { name: 'Chiếm' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(tender.removePartner(nv1, opportunityId, foreignPartner)).rejects.toMatchObject({ statusCode: 404 });
    await expect(tender.removePartner(nv1, opportunityId, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
    expect((await tender.get(nv1, foreign.opportunityId))!.partners).toHaveLength(1);
    // Còn đối tác thì không bỏ chọn liên danh.
    const current = (await tender.get(nv1, opportunityId))!;
    await expect(tender.update(nv1, opportunityId, { version: current.version, hasJointVenture: false })).rejects.toMatchObject({ statusCode: 409, code: 'PARTNERS_EXIST' });
    const afterRemove = await tender.removePartner(nv1, opportunityId, partnerId);
    expect(afterRemove.partners.map((partner) => partner.name)).toEqual(['Công ty C']);
    const none = await tender.removePartner(nv1, opportunityId, afterRemove.partners[0].id);
    expect(none.partners).toEqual([]);
    expect((await tender.update(nv1, opportunityId, { version: none.version, hasJointVenture: false })).hasJointVenture).toBe(false);
    expect(await auditActions(profile.id)).toEqual(['create', 'update', 'partner-add', 'partner-add', 'partner-update', 'partner-remove', 'partner-remove', 'update']);
    // Đối tác đổi sau khi phương án đã duyệt: phải duyệt lại.
    const approvedCase = await newTender({ joint: true });
    await tender.addPartner(nv1, approvedCase.opportunityId, { name: 'Đối tác duyệt' });
    const approved = await approvedPlan(approvedCase.opportunityId);
    expect(approved.plan.status).toBe('APPROVED');
    const reset = await tender.addPartner(nv1, approvedCase.opportunityId, { name: 'Đối tác thêm sau duyệt' });
    expect(reset.plan.status).toBe('DRAFT');
    // Ghi hai request cùng phiên bản: một thành công, một 409 (mất đồng bộ không ghi đè lặng lẽ).
    const results = await Promise.allSettled([
      tender.update(nv1, approvedCase.opportunityId, { version: reset.version, packageCode: 'A' }),
      tender.update(nv1, approvedCase.opportunityId, { version: reset.version, packageCode: 'B' }),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
  });

  it('thông báo duyệt phương án chào thầu và loại duyệt TENDER_PLAN có trong cấu hình duyệt; chỉ quản trị bán hàng đổi được', async () => {
    const bindings = await settings.bindings(nv1);
    expect(bindings.map((binding) => binding.kind)).toEqual(expect.arrayContaining(['QUOTE', 'ORDER_CREDIT', 'TENDER_PLAN']));
    expect(bindings.find((binding) => binding.kind === 'TENDER_PLAN')).toMatchObject({ mode: 'DIRECT' });
    await expect(settings.saveBinding(nv1, 'TENDER_PLAN', { mode: 'DIRECT' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(settings.saveBinding(ql, 'KHONG_CO', { mode: 'DIRECT' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
