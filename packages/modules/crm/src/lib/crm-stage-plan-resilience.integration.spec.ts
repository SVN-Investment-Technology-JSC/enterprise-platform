import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRM_NO_CAPABILITIES, type OpportunityStagePlan } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { vietnamToday } from './application/pricing.service.js';
import { SalesDashboardService } from './application/sales-dashboard.service.js';
import { StageAssigneeResolver } from './application/stage-assignee.resolver.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { addDays } from './domain/receivables.js';
import { HttpOrganizationScope } from './infrastructure/http-organization-scope.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresSalesDashboardStore } from './infrastructure/postgres-sales-dashboard.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;
const here = dirname(fileURLToPath(import.meta.url));

const QL = randomUUID();
const NV1 = randomUUID();
const NV2 = randomUUID();

/** Payload organization context của Tenant Core (không có gì của HRM): QL quản lý NV1 và NV2. */
const CORE_PAYLOAD = {
  units: [
    { id: 'p-ql', typeCategory: 'position', reportsToPositionId: null },
    { id: 'p-nv1', typeCategory: 'position', reportsToPositionId: 'p-ql' },
    { id: 'p-nv2', typeCategory: 'position', reportsToPositionId: 'p-ql' },
  ],
  members: [
    { userId: QL, positionId: 'p-ql', displayName: 'Quản lý' },
    { userId: NV1, positionId: 'p-nv1', displayName: 'Nhân viên 1' },
    { userId: NV2, positionId: 'p-nv2', displayName: 'Nhân viên 2' },
  ],
};

/**
 * Chịu lỗi tổ chức (TC-ASG-11), tenant không có HRM (TC-ASG-12) và phễu khi bỏ qua giai đoạn (TC-SKP-07),
 * chạy thật trên PostgreSQL với `HttpOrganizationScope` thật (fetcher giả lập Tenant Core).
 */
integration('Bán hàng GĐ B: tổ chức lỗi, tenant không HRM, phễu với giai đoạn bỏ qua (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let dashboard: SalesDashboardService;
  let customerId: string;
  let clock = Date.parse('2026-06-01T00:00:00Z');
  let coreUp = true;
  let fetchUrls: string[] = [];
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
  const manager = actorOf(QL, { canManage: true, canReadAll: true });

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await handle.pool.query(text, values)).rows as T[];
  const stageIdOf = async (pipelineId: string, code: string): Promise<string> =>
    (await query<{ id: string }>(`SELECT id FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 AND code = $2`, [pipelineId, code]))[0].id;
  const item = (plan: OpportunityStagePlan, code: string) => plan.items.find((candidate) => candidate.stage.code === code)!;
  const create = (actor: CrmActor, name: string, extra: Record<string, unknown> = {}) =>
    opportunities.create(actor, { customerId, name, ...extra });

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const fetcher = (async (input: unknown) => {
      fetchUrls.push(String(input));
      if (!coreUp) throw new Error('Tenant Core ngừng phục vụ');
      return { ok: true, status: 200, json: async () => CORE_PAYLOAD } as Response;
    }) as unknown as typeof fetch;
    const organization = new HttpOrganizationScope('http://core/ctx', 'bi-mat', fetcher, () => clock);
    const scopes = new CrmDataScopeService(organization);
    const customerStore = new PostgresCustomerStore(handle.database);
    const config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(
      new PostgresOpportunityStore(handle.database),
      customerStore,
      scopes,
      config,
      undefined,
      undefined,
      new StageAssigneeResolver(organization),
      organization,
    );
    dashboard = new SalesDashboardService(
      new PostgresSalesDashboardStore(handle.database),
      scopes,
      new PostgresSalesSettingsStore(handle.database),
    );
    customerId = (await new CustomerService(customerStore, scopes).create(manager, { name: 'Khách chịu lỗi', ownerUserId: NV1 })).id;
    await query(
      `UPDATE crm_schema.pipeline_stages s
          SET skippable = v.skippable, assignee_rule = v.rule, assignee_param = v.param
         FROM (VALUES ('NEW', false, 'PROJECT_OWNER', NULL), ('CONTACTED', true, 'PROJECT_OWNER', NULL),
                      ('DISCOVERY', true, 'DIRECT_MANAGER', NULL), ('QUOTING', false, 'POSITION', 'p-ql'),
                      ('NEGOTIATION', false, 'NONE', NULL)) AS v (code, skippable, rule, param)
        WHERE s.code = v.code AND s.pipeline_id = (SELECT id FROM crm_schema.pipelines WHERE is_default)`,
    );
    config.invalidate();
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-ASG-11: Tenant Core lỗi, chưa có cache: tạo được, giai đoạn theo quản lý/chức danh để trống kèm cảnh báo, không đoán người', async () => {
    coreUp = false;
    clock += 10 * 60_000; // bỏ hiệu lực mọi cache của các bước trước
    // Quản trị (phạm vi "all") không cần sơ đồ để tạo; người nhận sơ đồ lỗi chỉ ảnh hưởng việc gán người.
    const created = await create(manager, 'Tổ chức lỗi 1', { ownerUserId: NV1 });
    const plan = await opportunities.stagePlan(manager, created.id);
    for (const code of ['DISCOVERY', 'QUOTING']) {
      expect(item(plan, code).assigneeUserId).toBeNull();
      expect(item(plan, code).assigneeWarning).toContain('Tenant Core');
    }
    // Quy tắc không cần tổ chức vẫn gán bình thường.
    expect(item(plan, 'NEW')).toMatchObject({ assigneeUserId: NV1, assigneeWarning: null });
    expect(item(plan, 'CONTACTED')).toMatchObject({ assigneeUserId: NV1, assigneeWarning: null });
    // Không ai (kể cả QL, người đáng lẽ được đoán) bị ghi vào dòng nào của kế hoạch ngoài những dòng PROJECT_OWNER.
    const rows = await query<{ code: string; assignee_user_id: string | null; assignee_warning: string | null }>(
      `SELECT s.code, p.assignee_user_id, p.assignee_warning
         FROM crm_schema.opportunity_stage_plan p JOIN crm_schema.pipeline_stages s ON s.id = p.stage_id
        WHERE p.opportunity_id = $1 AND s.code IN ('DISCOVERY', 'QUOTING')`,
      [created.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.assignee_user_id === null && !!row.assignee_warning)).toBe(true);
  });

  it('TC-ASG-11 (hành vi thực tế): tổ chức lỗi, chưa có cache thì người không có quyền xem tất cả nhận 503 ở mọi đường đọc và tạo, không mở rộng phạm vi', async () => {
    coreUp = false;
    clock += 10 * 60_000;
    const created = await create(manager, 'Tổ chức lỗi 2', { ownerUserId: NV1 });
    // Người được gán (và cả chủ dự án) đều bị 503 chứ không bị 404 hay thấy dữ liệu.
    for (const act of [
      () => opportunities.get(nv1, created.id),
      () => opportunities.list(nv1, {}),
      () => opportunities.stagePlan(nv1, created.id),
      () => create(nv1, 'Tạo lúc tổ chức lỗi'),
    ]) {
      await expect(act()).rejects.toMatchObject({ statusCode: 503, code: 'ORGANIZATION_UNAVAILABLE' });
    }
    // Dự án không bị tạo dở bởi lần thử 503.
    expect((await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.opportunities WHERE name = 'Tạo lúc tổ chức lỗi'`))[0].n).toBe(0);
  });

  it('TC-ASG-11 (hành vi thực tế): đã có cache cũ thì Tenant Core lỗi vẫn dùng bản cũ, người được gán mở được dự án, phạm vi không rộng hơn', async () => {
    coreUp = true;
    clock += 10 * 60_000;
    const quoting = async (id: string, pipelineId: string) => stageIdOf(pipelineId, 'QUOTING');
    const created = await create(manager, 'Tổ chức lỗi 3', { ownerUserId: NV1 });
    const other = await create(manager, 'Dự án của người khác', { ownerUserId: QL });
    await opportunities.updateStageAssignee(manager, created.id, await quoting(created.id, created.pipeline.id), { assigneeUserId: NV2 });
    // Tổ chức bình thường: NV2 thấy dự án được gán, không thấy dự án của QL.
    await expect(opportunities.get(nv2, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(opportunities.get(nv2, other.id)).rejects.toMatchObject({ statusCode: 404 });

    coreUp = false;
    clock += 61_000; // cache hết hạn: gọi Tenant Core lỗi, rơi về bản cũ
    const before = fetchUrls.length;
    await expect(opportunities.get(nv2, created.id)).resolves.toMatchObject({ id: created.id });
    expect(fetchUrls.length).toBeGreaterThan(before); // đã thử hỏi lại Tenant Core
    // Phạm vi y như bản cũ: không mở rộng (vẫn 404 với dự án của người khác), không thu hẹp (vẫn thấy dự án được gán).
    await expect(opportunities.get(nv2, other.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await opportunities.list(nv2, {})).items.map((entry) => entry.id)).toEqual(expect.arrayContaining([created.id]));
    expect((await opportunities.list(nv2, {})).items.map((entry) => entry.id)).not.toContain(other.id);
  });

  it('TC-ASG-12: tenant không có HRM: chỉ dựa Tenant Core vẫn gán theo quản lý trực tiếp và chức danh', async () => {
    coreUp = true;
    clock += 10 * 60_000;
    fetchUrls = [];
    const created = await create(manager, 'Không HRM', { ownerUserId: NV1 });
    const plan = await opportunities.stagePlan(manager, created.id);
    expect(item(plan, 'DISCOVERY')).toMatchObject({ assigneeUserId: QL, assigneeWarning: null });
    expect(item(plan, 'QUOTING')).toMatchObject({ assigneeUserId: QL, assigneeWarning: null });
    // Mọi lần đọc tổ chức chỉ đi tới endpoint organization context của Tenant Core.
    expect(fetchUrls.length).toBeGreaterThan(0);
    expect(fetchUrls.every((url) => url.startsWith('http://core/ctx/'))).toBe(true);
    // DB của tenant không có schema HRM.
    const schemas = await query<{ schema_name: string }>(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'hrm_schema'`);
    expect(schemas).toEqual([]);
  });

  it('TC-ASG-12 (kiến trúc): resolver, đọc tổ chức và package của CRM không import hay gọi HRM', () => {
    const importLines = (file: string): string[] =>
      readFileSync(join(here, file), 'utf8').split('\n').filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line));
    for (const file of ['application/stage-assignee.resolver.ts', 'infrastructure/http-organization-scope.ts', 'application/data-scope.ts']) {
      expect(importLines(file).filter((line) => /hrm/i.test(line))).toEqual([]);
    }
    const http = readFileSync(join(here, 'infrastructure/http-organization-scope.ts'), 'utf8');
    expect(http).not.toMatch(/hrm_schema|\/api\/hrm|module-hrm|hrm-api/i);
    const dependencies = Object.keys(JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8')).dependencies ?? {});
    expect(dependencies.filter((name) => /hrm/i.test(name))).toEqual([]);
  });

  it('TC-SKP-07 (quy ước: phễu đếm dự án theo giai đoạn HIỆN TẠI, giai đoạn bị bỏ qua không tạo dòng đếm; tỷ lệ thắng theo semantic WON/LOST)', async () => {
    coreUp = true;
    clock += 10 * 60_000;
    const today = vietnamToday(new Date());
    const range = { period: 'custom' as const, from: addDays(today, -1), to: addDays(today, 1) };
    // Các test trước để lại dự án mở ở Mới: lấy số đếm nền để so theo mức tăng.
    const baseline = new Map((await dashboard.dashboard(manager, range)).pipeline.map((entry) => [entry.stage, entry.count]));
    const base = await create(manager, 'Mốc', { ownerUserId: NV1 });
    const pipelineId = base.pipeline.id;
    const stage = (code: string) => stageIdOf(pipelineId, code);
    // A: bỏ qua Khảo sát lúc tạo, đã tới Báo giá.
    const a = await create(manager, 'A', { ownerUserId: NV1, skipStages: [{ stage: 'DISCOVERY', reason: 'Đã khảo sát' }] });
    await opportunities.changeStage(manager, a.id, { stage: 'CONTACTED' });
    await opportunities.changeStage(manager, a.id, { stage: 'QUOTING' });
    // B: bỏ qua Khảo sát lúc tạo, đứng ở Mới.
    await create(manager, 'B', { ownerUserId: NV1, skipStages: [{ stage: 'DISCOVERY', reason: 'Đã khảo sát' }] });
    // C: bỏ qua Đã liên hệ khi đang chạy, chuyển tiếp sang Khảo sát.
    const c = await create(manager, 'C', { ownerUserId: NV1 });
    await opportunities.skipStage(manager, c.id, await stage('CONTACTED'), { reason: 'Đã liên hệ' });
    await opportunities.changeStage(manager, c.id, { stage: 'DISCOVERY' });
    // D: không bỏ qua, ở Đã liên hệ.
    const d = await create(manager, 'D', { ownerUserId: NV1 });
    await opportunities.changeStage(manager, d.id, { stage: 'CONTACTED' });
    // E, G: bỏ qua Đã liên hệ rồi Thắng / Thua. H: không bỏ qua, Thắng.
    // Đóng Thua qua luồng thật; Thắng đóng ở tầng dữ liệu để không phụ thuộc điều kiện báo giá/đơn của luồng.
    const closeWon = async (id: string) =>
      handle.pool.query(
        `UPDATE crm_schema.opportunities SET stage_id = $2, closed_at = now() WHERE id = $1`,
        [id, await stage('WON')],
      );
    const skipContacted = [{ stage: 'CONTACTED', reason: 'Bỏ qua' }];
    const e = await create(manager, 'E', { ownerUserId: NV1, skipStages: skipContacted });
    await closeWon(e.id);
    const g = await create(manager, 'G', { ownerUserId: NV1, skipStages: skipContacted });
    await opportunities.changeStage(manager, g.id, { stage: 'LOST', reason: 'Khách huỷ' });
    const h = await create(manager, 'H', { ownerUserId: NV1 });
    await closeWon(h.id);

    const result = await dashboard.dashboard(manager, range);
    const row = (code: string) => result.pipeline.find((entry) => entry.stage === code)!;
    // Đúng số dự án đang mở theo giai đoạn hiện tại: Mới {mốc, B}, Đã liên hệ {D}, Khảo sát {C}, Báo giá {A}.
    expect(result.pipeline.map((entry) => [entry.stage, entry.count - (baseline.get(entry.stage) ?? 0)])).toEqual([
      // Phễu chỉ gồm luồng profile STANDARD: giai đoạn của luồng mẫu "Chào thầu" (0024) không lẫn vào.
      ['NEW', 2], ['CONTACTED', 1], ['DISCOVERY', 1], ['QUOTING', 1], ['NEGOTIATION', 0],
    ]);
    // Giai đoạn bỏ qua không sinh dòng đếm riêng: tổng dòng = số dự án mở, không đếm đôi.
    const baselineTotal = [...baseline.values()].reduce((sum, n) => sum + n, 0);
    expect(result.pipeline.reduce((sum, entry) => sum + entry.count, 0)).toBe(baselineTotal + 5);
    expect(result.kpis.pipeline.count).toBe(baselineTotal + 5);
    expect(row('DISCOVERY').count - (baseline.get('DISCOVERY') ?? 0)).toBe(1); // A và B bỏ qua Khảo sát nhưng không được đếm vào đây
    expect(result.pipeline.every((entry) => entry.semantic === 'OPEN')).toBe(true);
    // Thắng/thua theo semantic, dự án bỏ qua giai đoạn không làm lệch: 2 thắng (E có bỏ qua, H không), 1 thua (G có bỏ qua).
    expect(result.kpis.winRate).toMatchObject({ won: 2, lost: 1 });
    expect(result.kpis.winRate.value).toBeCloseTo(66.7, 0);
  });
});
