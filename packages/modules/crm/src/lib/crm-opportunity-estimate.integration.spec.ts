import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DocumentService } from './application/document.service.js';
import type { DocumentStorage } from './application/document-store.port.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresDocumentStore, PostgresOpportunityDocumentChecker } from './infrastructure/postgres-document.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const NV1 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [{ id: 'p-nv1', reportsToPositionId: null }],
  assignments: [{ userId: NV1, positionId: 'p-nv1' }],
};

/** Kho tài liệu giả: chỉ cần ký URL, không có mạng. */
const storage: DocumentStorage = {
  createUploadUrl: async ({ key }) => `http://storage.test/${key}`,
  createDownloadUrl: async (key) => `http://storage.test/${key}`,
  objectSize: async () => 1000,
};

/** TC-BP-12 (phần cơ hội): dự toán của dự án bán hàng trên PostgreSQL thật (P2D-09). */
integration('Bán hàng GĐ D: tổng giá trị và giá vốn dự toán của cơ hội (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let opportunities: OpportunityService;
  let documents: DocumentService;
  let oppId: string;
  const tenantId = randomUUID();
  const actor: CrmActor = {
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId: NV1,
    displayName: 'Nhân viên',
    canWriteOpportunity: true,
    canWriteDocument: true,
  };
  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> => (await handle.pool.query(text, values)).rows as T[];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(
      new PostgresOpportunityStore(handle.database),
      customerStore,
      scopes,
      config,
      undefined,
      new PostgresOpportunityDocumentChecker(handle.database),
    );
    documents = new DocumentService(new PostgresDocumentStore(handle.database), storage, scopes);
    const manager: CrmActor = { ...actor, canManage: true, canReadAll: true };
    const customerId = (await new CustomerService(customerStore, scopes).create(manager, { name: 'Khách dự toán', ownerUserId: NV1 })).id;
    oppId = (await opportunities.create(actor, { customerId, name: 'Dự án dự toán' })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('migration: hai cột NUMERIC(18,2) nullable, dòng cũ giữ NULL, chạy lại được', async () => {
    const cols = await query<{ column_name: string; data_type: string; numeric_precision: number; numeric_scale: number; is_nullable: string }>(
      `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm_schema' AND table_name = 'opportunities' AND column_name LIKE 'estimate_%' ORDER BY column_name`,
    );
    expect(cols).toEqual([
      { column_name: 'estimate_cost_value', data_type: 'numeric', numeric_precision: 18, numeric_scale: 2, is_nullable: 'YES' },
      { column_name: 'estimate_total_value', data_type: 'numeric', numeric_precision: 18, numeric_scale: 2, is_nullable: 'YES' },
    ]);
    const fresh = await opportunities.get(actor, oppId);
    expect(fresh.estimateTotalValue).toBeNull();
    expect(fresh.estimateCostValue).toBeNull();
    const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm/0022-opportunity-estimate.sql'), 'utf8');
    await handle.pool.query(sql);
    await handle.pool.query(sql);
    expect((await opportunities.get(actor, oppId)).estimateTotalValue).toBeNull();
  });

  it('TC-BP-12: lưu hai số, đọc lại đúng, tăng phiên bản và ghi audit khi đổi', async () => {
    const before = await opportunities.get(actor, oppId);
    const saved = await opportunities.update(actor, oppId, {
      name: before.name,
      version: before.version,
      estimateTotalValue: 1_500_000_000,
      estimateCostValue: 1_200_000_000,
    });
    expect(saved.estimateTotalValue).toBe(1_500_000_000);
    expect(saved.estimateCostValue).toBe(1_200_000_000);
    expect(saved.version).toBe(before.version + 1);
    const audit = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM crm_schema.audit_log WHERE entity_type = 'opportunity' AND entity_id = $1 AND action = 'update_estimate'`,
      [oppId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({
      fromEstimateTotalValue: null,
      toEstimateTotalValue: 1_500_000_000,
      fromEstimateCostValue: null,
      toEstimateCostValue: 1_200_000_000,
    });
  });

  it('sửa trường khác không đụng dự toán và không ghi audit dự toán; gửi null thì xoá', async () => {
    const before = await opportunities.get(actor, oppId);
    const renamed = await opportunities.update(actor, oppId, { name: 'Dự án dự toán (đổi tên)', version: before.version });
    expect(renamed.estimateTotalValue).toBe(1_500_000_000);
    expect(renamed.estimateCostValue).toBe(1_200_000_000);
    const count = async () =>
      (await query(`SELECT 1 FROM crm_schema.audit_log WHERE entity_id = $1 AND action = 'update_estimate'`, [oppId])).length;
    expect(await count()).toBe(1);
    const cleared = await opportunities.update(actor, oppId, { name: renamed.name, version: renamed.version, estimateCostValue: null });
    expect(cleared.estimateCostValue).toBeNull();
    expect(cleared.estimateTotalValue).toBe(1_500_000_000);
    expect(await count()).toBe(2);
  });

  it('số âm bị từ chối ở service (400) và ở ràng buộc DB', async () => {
    const current = await opportunities.get(actor, oppId);
    await expect(
      opportunities.update(actor, oppId, { name: current.name, version: current.version, estimateTotalValue: -5 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(query(`UPDATE crm_schema.opportunities SET estimate_cost_value = -1 WHERE id = $1`, [oppId])).rejects.toThrow(/ck_crm_opportunities_estimate_cost_nonneg/);
    expect((await opportunities.get(actor, oppId)).version).toBe(current.version);
  });

  it('phiên bản cũ: 409, dự toán không đổi', async () => {
    const current = await opportunities.get(actor, oppId);
    await expect(
      opportunities.update(actor, oppId, { name: current.name, version: current.version - 1, estimateTotalValue: 1 }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await opportunities.get(actor, oppId)).estimateTotalValue).toBe(1_500_000_000);
  });

  it('file dự toán đính bằng loại tài liệu "Dự toán" (ESTIMATE) theo kho tài liệu của cơ hội', async () => {
    const [type] = await query<{ id: string; name: string }>(`SELECT id, name FROM crm_schema.document_types WHERE code = 'ESTIMATE'`);
    expect(type.name).toBe('Dự toán');
    const created = await documents.create(actor, {
      entityType: 'opportunity',
      entityId: oppId,
      fileName: 'du-toan.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1000,
      documentTypeId: type.id,
    });
    await documents.completeUpload(actor, created.document.id, created.version.id, { sizeBytes: 1000 });
    const listed = await documents.list(actor, { entityType: 'opportunity', entityId: oppId, documentTypeId: type.id });
    expect(listed.map((item) => item.id)).toContain(created.document.id);
    const present = await new PostgresOpportunityDocumentChecker(handle.database).presentDocumentTypes(tenantId, oppId, ['ESTIMATE']);
    expect(present.has('ESTIMATE')).toBe(true);
  });
  it('TC-BP-12: PAKD mới nhất của dự án để đối chiếu; không có quyền xem giá vốn thì không nhận giá vốn, lợi nhuận', async () => {
    const [{ customer_id: customerId }] = await query<{ customer_id: string }>(
      `SELECT customer_id FROM crm_schema.opportunities WHERE id = $1`,
      [oppId],
    );
    expect((await opportunities.get(actor, oppId)).latestBusinessPlan).toBeNull();
    const addQuote = async (code: string, createdAt: string) =>
      (
        await query<{ id: string }>(
          `INSERT INTO crm_schema.quotes (code, opportunity_id, customer_id, owner_user_id, created_at)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [code, oppId, customerId, NV1, createdAt],
        )
      )[0].id;
    const addPlan = async (quoteId: string, versionNo: number, status: string, revenue: number, totalCost: number, decidedAt: string | null) => {
      const [version] = await query<{ id: string }>(
        `INSERT INTO crm_schema.quote_versions (quote_id, version_no) VALUES ($1, $2) RETURNING id`,
        [quoteId, versionNo],
      );
      await query(
        `INSERT INTO crm_schema.business_plans (quote_id, quote_version_id, status, revenue, total_cost, profit, decided_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [quoteId, version.id, status, revenue, totalCost, revenue - totalCost, decidedAt, NV1],
      );
    };
    // Báo giá cũ có PAKD khác; chỉ báo giá mới nhất được xét.
    const oldQuote = await addQuote('BG-EST-OLD', '2026-01-01T00:00:00Z');
    await addPlan(oldQuote, 1, 'APPROVED', 111, 11, '2026-01-02T00:00:00Z');
    const quote = await addQuote('BG-EST-NEW', '2026-02-01T00:00:00Z');
    await addPlan(quote, 1, 'APPROVED', 1_000, 700, '2026-02-02T00:00:00Z');
    await addPlan(quote, 2, 'APPROVED', 1_100, 800, '2026-02-05T00:00:00Z');
    await addPlan(quote, 3, 'DRAFT', 9_999, 9_000, null);
    const viewer = { ...actor, canViewQuoteCost: true };
    const full = (await opportunities.get(viewer, oppId)).latestBusinessPlan;
    expect(full).toEqual({
      quoteId: quote,
      quoteCode: 'BG-EST-NEW',
      versionNo: 2,
      status: 'APPROVED',
      revenue: 1_100,
      costVisible: true,
      totalCost: 800,
      profit: 300,
    });
    const hidden = (await opportunities.get(actor, oppId)).latestBusinessPlan;
    expect(hidden).toEqual({
      quoteId: quote,
      quoteCode: 'BG-EST-NEW',
      versionNo: 2,
      status: 'APPROVED',
      revenue: 1_100,
      costVisible: false,
      totalCost: null,
      profit: null,
    });
    expect(JSON.stringify(hidden)).not.toContain('800');
    // Ngoài phạm vi dữ liệu: như không có cơ hội.
    await expect(opportunities.get({ ...actor, userId: randomUUID() }, oppId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
