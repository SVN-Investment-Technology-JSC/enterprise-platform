import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const NV1 = randomUUID();

/** Cờ gợi ý chăm sóc lại theo luồng (GĐ F, P2F-01, P2F-02): TC-CARE-04, TC-CARE-05. */
integration('Bán hàng GĐ F: gợi ý chăm sóc lại khi Thua (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let customerId: string;
  const tenantId = randomUUID();
  const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId, userId: NV1, displayName: 'NV1', canWriteOpportunity: true, canReadAll: true };
  const admin: CrmActor = { ...seller, canManage: true };

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await handle.pool.query(text, values)).rows as T[];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(handle.database);
    const config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(new PostgresOpportunityStore(handle.database), customerStore, scopes, config);
    customerId = (await new CustomerService(customerStore, scopes).create(seller, { name: 'Khách chăm sóc' })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const createInPipeline = async (pipelineId: string): Promise<string> =>
    (await opportunities.create(seller, { name: 'Dự án thua', customerId, pipelineId } as never)).id;

  it('backfill: luồng mặc định bật, luồng TENDER tắt', async () => {
    const rows = await query<{ profile: string; care_suggestion: boolean }>(
      `SELECT profile, care_suggestion FROM crm_schema.pipelines`,
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(row.care_suggestion).toBe(row.profile !== 'TENDER');
  });

  it('TC-CARE-05: tắt cờ thì Thua không gợi ý; bật lại thì gợi ý; ghi audit_log; luồng TENDER bị từ chối', async () => {
    const standard = (await opportunities.listPipelines(admin)).find((pipeline) => pipeline.isDefault);
    const tender = (await opportunities.listPipelines(admin)).find((pipeline) => pipeline.profile === 'TENDER');
    expect(standard?.careSuggestion).toBe(true);
    expect(tender?.careSuggestion).toBe(false);

    const lose = async () => {
      const id = (await opportunities.create(seller, { name: 'Dự án thua', customerId } as never)).id;
      const detail = await opportunities.changeStage(seller, id, { stage: 'LOST', reason: 'Giá cao' });
      return detail.careSuggestion;
    };
    expect(await lose()).toEqual({ enabled: true });

    await expect(opportunities.setCareSuggestion(seller, standard!.id, { careSuggestion: false })).rejects.toMatchObject({ statusCode: 403 });
    const after = await opportunities.setCareSuggestion(admin, standard!.id, { careSuggestion: false });
    expect(after.find((pipeline) => pipeline.id === standard!.id)?.careSuggestion).toBe(false);
    expect(await lose()).toEqual({ enabled: false });

    await opportunities.setCareSuggestion(admin, standard!.id, { careSuggestion: true });
    expect(await lose()).toEqual({ enabled: true });

    const audit = await query<{ metadata: { from: boolean; to: boolean } }>(
      `SELECT metadata FROM crm_schema.audit_log WHERE entity_type = 'pipeline' AND entity_id = $1 AND action = 'set_care_suggestion' ORDER BY at, id`,
      [standard!.id],
    );
    expect(audit.map((row) => row.metadata)).toEqual([
      { from: true, to: false },
      { from: false, to: true },
    ]);

    await expect(opportunities.setCareSuggestion(admin, tender!.id, { careSuggestion: true })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('TC-CARE-04: luồng TENDER ghi Trượt thì gợi ý tắt dù cờ bật trong DB', async () => {
    const tender = (await opportunities.listPipelines(admin)).find((pipeline) => pipeline.profile === 'TENDER')!;
    await query(`UPDATE crm_schema.pipelines SET care_suggestion = true WHERE id = $1`, [tender.id]);
    const config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 0);
    const service = new OpportunityService(
      new PostgresOpportunityStore(handle.database),
      new PostgresCustomerStore(handle.database),
      new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) }),
      config,
    );
    const id = await createInPipeline(tender.id);
    const detail = await service.changeStage(seller, id, { stage: 'LOST', reason: 'Trượt thầu' });
    expect(detail.careSuggestion).toEqual({ enabled: false });
  });
});
