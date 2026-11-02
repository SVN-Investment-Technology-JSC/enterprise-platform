import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { SalesOrderService } from './application/sales-order.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { PostgresSalesOrderStore } from './infrastructure/postgres-sales-order.store.js';
import { UnknownOrderBalanceReader } from './application/fulfillment.port.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const NV1 = randomUUID();
const NV2 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-nv1', reportsToPositionId: null },
    { id: 'p-nv2', reportsToPositionId: null },
  ],
  assignments: [
    { userId: NV1, positionId: 'p-nv1' },
    { userId: NV2, positionId: 'p-nv2' },
  ],
};

/** TC-CARE-06, TC-CARE-07, TC-CARE-08 trên PostgreSQL thật (P2F-03). */
integration('Bán hàng GĐ F: chân dung khách, đối thủ của dự án, ghi chú đơn hàng (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let customers: CustomerService;
  let opportunities: OpportunityService;
  let orders: SalesOrderService;
  let customerId: string;
  let oppId: string;
  let orderId: string;
  const tenantId = randomUUID();
  const base = { ...CRM_NO_CAPABILITIES, tenantId, displayName: 'NV' };
  const writer: CrmActor = { ...base, userId: NV1, canWriteOpportunity: true, canWriteOrder: true };
  const reader: CrmActor = { ...base, userId: NV1 };
  const outsider: CrmActor = { ...base, userId: NV2, canWriteOpportunity: true, canWriteOrder: true };
  const manager: CrmActor = { ...writer, canManage: true, canReadAll: true };
  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> => (await handle.pool.query(text, values)).rows as T[];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    customers = new CustomerService(customerStore, scopes);
    opportunities = new OpportunityService(new PostgresOpportunityStore(handle.database), customerStore, scopes, config);
    orders = new SalesOrderService(
      new PostgresSalesOrderStore(handle.database, new UnknownOrderBalanceReader()),
      undefined as never,
      customerStore,
      undefined as never,
      undefined as never,
      scopes,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    customerId = (await customers.create(manager, { name: 'Khách chân dung', ownerUserId: NV1 })).id;
    oppId = (await opportunities.create(writer, { customerId, name: 'Dự án đối thủ' })).id;
    orderId = (
      await query<{ id: string }>(
        `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, order_date)
         VALUES ('DH2600001', 'DIRECT', $1, $2, CURRENT_DATE) RETURNING id`,
        [customerId, NV1],
      )
    )[0].id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('migration 0027: cột mới có đúng kiểu, dòng cũ NULL, chạy lại được', async () => {
    const cols = await query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm_schema' AND column_name IN
          ('profile_note', 'competitor_name', 'competitor_price', 'info_note', 'info_noted_by', 'info_noted_at')
        ORDER BY table_name, column_name`,
    );
    expect(cols.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}:${c.is_nullable}`)).toEqual([
      'customers.profile_note:text:YES',
      'opportunities.competitor_name:character varying:YES',
      'opportunities.competitor_price:numeric:YES',
      'sales_orders.info_note:character varying:YES',
      'sales_orders.info_noted_at:timestamp with time zone:YES',
      'sales_orders.info_noted_by:uuid:YES',
    ]);
    const fresh = await customers.get(reader, customerId);
    expect(fresh.profileNote).toBeNull();
    const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm/0027-care-notes.sql'), 'utf8');
    await handle.pool.query(sql);
    await handle.pool.query(sql);
    expect((await customers.get(reader, customerId)).profileNote).toBeNull();
  });

  it('TC-CARE-06: lưu chân dung, tải lại giữ nguyên, ghi audit, tăng version', async () => {
    const before = await customers.get(writer, customerId);
    const saved = await customers.saveProfile(writer, customerId, { profileNote: '  Mua theo quý, người quyết định là giám đốc.  ', version: before.version });
    expect(saved.profileNote).toBe('Mua theo quý, người quyết định là giám đốc.');
    expect(saved.version).toBe(before.version + 1);
    expect((await customers.get(writer, customerId)).profileNote).toBe(saved.profileNote);
    const audit = await query(`SELECT 1 FROM crm_schema.audit_log WHERE entity_type = 'customer' AND entity_id = $1 AND action = 'update_profile_note'`, [customerId]);
    expect(audit).toHaveLength(1);
    const cleared = await customers.saveProfile(writer, customerId, { profileNote: '   ', version: saved.version });
    expect(cleared.profileNote).toBeNull();
  });

  it('TC-CARE-06: người chỉ đọc 403, quá 4000 ký tự 400, phiên bản cũ 409, ngoài phạm vi 404', async () => {
    const current = await customers.get(writer, customerId);
    await expect(customers.saveProfile(reader, customerId, { profileNote: 'x', version: current.version })).rejects.toMatchObject({ statusCode: 403 });
    await expect(customers.saveProfile(writer, customerId, { profileNote: 'x'.repeat(4001), version: current.version })).rejects.toMatchObject({ statusCode: 400 });
    await expect(customers.saveProfile(writer, customerId, { profileNote: 'x', version: current.version - 1 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(customers.saveProfile(outsider, customerId, { profileNote: 'x', version: current.version })).rejects.toMatchObject({ statusCode: 404 });
    expect((await customers.get(writer, customerId)).version).toBe(current.version);
  });

  it('TC-CARE-07: lưu đối thủ và giá, đọc lại đúng, ghi audit; sửa trường khác giữ nguyên; null xoá', async () => {
    const before = await opportunities.get(writer, oppId);
    expect(before.competitorName).toBeNull();
    expect(before.competitorPrice).toBeNull();
    const saved = await opportunities.update(writer, oppId, {
      name: before.name,
      version: before.version,
      competitorName: 'Công ty ABC',
      competitorPrice: 950_000_000,
    });
    expect(saved).toMatchObject({ competitorName: 'Công ty ABC', competitorPrice: 950_000_000, version: before.version + 1 });
    const audit = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM crm_schema.audit_log WHERE entity_id = $1 AND action = 'update_competitor'`,
      [oppId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ fromCompetitorName: null, toCompetitorName: 'Công ty ABC', toCompetitorPrice: 950_000_000 });
    const renamed = await opportunities.update(writer, oppId, { name: 'Dự án đối thủ 2', version: saved.version });
    expect(renamed.competitorName).toBe('Công ty ABC');
    expect(renamed.competitorPrice).toBe(950_000_000);
    expect((await query(`SELECT 1 FROM crm_schema.audit_log WHERE entity_id = $1 AND action = 'update_competitor'`, [oppId])).length).toBe(1);
    const cleared = await opportunities.update(writer, oppId, { name: renamed.name, version: renamed.version, competitorName: null, competitorPrice: null });
    expect(cleared.competitorName).toBeNull();
    expect(cleared.competitorPrice).toBeNull();
  });

  it('TC-CARE-07: giá âm 400 ở service và bị ràng buộc DB chặn; tên quá 300 ký tự 400; phiên bản cũ 409', async () => {
    const current = await opportunities.get(writer, oppId);
    await expect(opportunities.update(writer, oppId, { name: current.name, version: current.version, competitorPrice: -1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(opportunities.update(writer, oppId, { name: current.name, version: current.version, competitorName: 'x'.repeat(301) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(opportunities.update(writer, oppId, { name: current.name, version: current.version - 1, competitorName: 'A' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(query(`UPDATE crm_schema.opportunities SET competitor_price = -1 WHERE id = $1`, [oppId])).rejects.toThrow(/ck_crm_opportunities_competitor_price_nonneg/);
  });

  it('TC-CARE-08: thêm ghi chú đơn, hiển thị kèm người và thời điểm, ghi audit, tăng revision', async () => {
    const before = await orders.get(writer, orderId);
    expect(before.infoNote).toBeNull();
    expect(before.infoNotedBy).toBeNull();
    const saved = await orders.saveInfoNote(writer, orderId, { revision: before.revision, infoNote: ' Khách yêu cầu giao giờ hành chính ' });
    expect(saved.infoNote).toBe('Khách yêu cầu giao giờ hành chính');
    expect(saved.infoNotedBy).toBe(NV1);
    expect(Date.now() - new Date(saved.infoNotedAt ?? 0).getTime()).toBeLessThan(60_000);
    expect(saved.revision).toBe(before.revision + 1);
    expect(saved.note).toBeNull();
    const audit = await query(`SELECT 1 FROM crm_schema.audit_log WHERE entity_type = 'sales_order' AND entity_id = $1 AND action = 'update_info_note'`, [orderId]);
    expect(audit).toHaveLength(1);
  });

  it('TC-CARE-08: sửa được khi đơn đã xác nhận; đơn huỷ 409; quyền, độ dài, revision cũ', async () => {
    await query(`UPDATE crm_schema.sales_orders SET status = 'CONFIRMED' WHERE id = $1`, [orderId]);
    const current = await orders.get(writer, orderId);
    const edited = await orders.saveInfoNote(writer, orderId, { revision: current.revision, infoNote: 'Đổi ghi chú' });
    expect(edited.infoNote).toBe('Đổi ghi chú');
    await expect(orders.saveInfoNote(reader, orderId, { revision: edited.revision, infoNote: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(orders.saveInfoNote(writer, orderId, { revision: edited.revision, infoNote: 'x'.repeat(4001) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(orders.saveInfoNote(writer, orderId, { revision: edited.revision - 1, infoNote: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await query(`UPDATE crm_schema.sales_orders SET status = 'CANCELLED' WHERE id = $1`, [orderId]);
    const cancelled = await orders.get(writer, orderId);
    await expect(orders.saveInfoNote(writer, orderId, { revision: cancelled.revision, infoNote: 'x' })).rejects.toMatchObject({ statusCode: 409 });
  });
});
