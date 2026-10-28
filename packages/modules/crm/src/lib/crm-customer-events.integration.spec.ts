import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { CRM_CUSTOMER_CREATED, CRM_CUSTOMER_UPDATED } from '@enterprise-platform/contracts-integration';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

/** T2-10 (D1): sự kiện khách hàng ghi vào outbox cùng transaction với thay đổi (TC-INT-11, TC-INT-12). */
integration('Bán hàng: sự kiện crm.customer.* qua outbox (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const seller: CrmActor = {
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId: randomUUID(),
    displayName: 'Nhân viên',
    canWriteOpportunity: true,
  };
  let customers: CustomerService;
  let leads: LeadService;
  let store: PostgresCustomerStore;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    store = new PostgresCustomerStore(handle.database);
    customers = new CustomerService(store, scopes);
    leads = new LeadService(new PostgresLeadStore(handle.database), scopes);
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const events = async (customerId: string) =>
    (
      await handle.pool.query<{ event_type: string; aggregate_type: string; envelope: Record<string, unknown> }>(
        `SELECT event_type, aggregate_type, payload AS envelope FROM integration_schema.outbox_events
          WHERE aggregate_id = $1 ORDER BY (payload->'payload'->>'version')::int, occurred_at`,
        [customerId],
      )
    ).rows;

  it('tạo khách ghi crm.customer.created kèm mã, tên, MST, phiên bản 1, người tạo', async () => {
    const created = await customers.create(seller, { code: 'QA-EV-01', name: 'Công ty Sự Kiện', taxCode: '0101111111' });
    const rows = await events(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: CRM_CUSTOMER_CREATED, aggregate_type: 'crm-customer' });
    expect(rows[0].envelope).toMatchObject({
      type: CRM_CUSTOMER_CREATED,
      tenantId,
      source: 'crm',
      correlationId: created.id,
      payload: {
        customerId: created.id,
        code: 'QA-EV-01',
        name: 'Công ty Sự Kiện',
        taxCode: '0101111111',
        version: 1,
        actorUserId: seller.userId,
      },
    });
  });

  it('sửa khách (cả đổi mã, tên) ghi crm.customer.updated với phiên bản tăng dần', async () => {
    const created = await customers.create(seller, { code: 'QA-EV-02', name: 'Tên cũ' });
    const renamed = await customers.update(seller, created.id, { code: 'QA-EV-02', name: 'Tên mới', version: created.version });
    await customers.update(seller, created.id, { code: 'QA-EV-02B', name: 'Tên mới', version: renamed.version });
    const rows = await events(created.id);
    expect(rows.map((row) => [row.event_type, (row.envelope['payload'] as { version: number }).version])).toEqual([
      [CRM_CUSTOMER_CREATED, 1],
      [CRM_CUSTOMER_UPDATED, 2],
      [CRM_CUSTOMER_UPDATED, 3],
    ]);
    expect(rows[2].envelope['payload']).toMatchObject({ code: 'QA-EV-02B', name: 'Tên mới' });
  });

  it('thao tác bị từ chối (sai phiên bản, trùng mã) không để lại sự kiện', async () => {
    const created = await customers.create(seller, { code: 'QA-EV-03', name: 'Khách 3' });
    await expect(customers.update(seller, created.id, { code: 'QA-EV-03', name: 'X', version: 99 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(customers.update(seller, created.id, { code: 'QA-EV-01', name: 'Khách 3', version: 1 })).rejects.toMatchObject({
      statusCode: 409,
    });
    const before = (await handle.pool.query(`SELECT count(*)::int AS n FROM integration_schema.outbox_events`)).rows[0].n;
    await expect(customers.create(seller, { code: 'QA-EV-03', name: 'Trùng mã' })).rejects.toMatchObject({ statusCode: 409 });
    const after = (await handle.pool.query(`SELECT count(*)::int AS n FROM integration_schema.outbox_events`)).rows[0].n;
    expect(after).toBe(before);
    expect((await events(created.id)).map((row) => row.event_type)).toEqual([CRM_CUSTOMER_CREATED]);
  });

  it('ghi outbox lỗi thì thay đổi khách cũng rollback (cùng transaction)', async () => {
    const created = await customers.create(seller, { code: 'QA-EV-04', name: 'Khách 4' });
    // Làm hỏng outbox tạm thời trong một transaction riêng của test để lời ghi sự kiện thất bại.
    await handle.pool.query(`ALTER TABLE integration_schema.outbox_events ADD CONSTRAINT qa_block CHECK (false) NOT VALID`);
    try {
      await expect(customers.update(seller, created.id, { code: 'QA-EV-04', name: 'Không được lưu', version: 1 })).rejects.toThrow();
      await expect(customers.create(seller, { code: 'QA-EV-05', name: 'Không được tạo' })).rejects.toThrow();
    } finally {
      await handle.pool.query(`ALTER TABLE integration_schema.outbox_events DROP CONSTRAINT qa_block`);
    }
    await expect(customers.get(seller, created.id)).resolves.toMatchObject({ name: 'Khách 4', version: 1 });
    const missing = await handle.pool.query(`SELECT 1 FROM crm_schema.customers WHERE code = 'QA-EV-05'`);
    expect(missing.rowCount).toBe(0);
  });

  it('chuyển lead thành khách mới cũng ghi crm.customer.created', async () => {
    const lead = await leads.create(seller, { name: 'Lead sự kiện', taxCode: '0102222222' });
    const result = await leads.convert(seller, lead.id, {});
    expect((await events(result.customerId)).map((row) => row.event_type)).toEqual([CRM_CUSTOMER_CREATED]);
  });

  it('tra khách cho Workspace theo id và chuỗi tìm, kèm phiên bản', async () => {
    const created = await customers.create(seller, { code: 'QA-EV-06', name: 'Công ty Tra Cứu', taxCode: '0103333333' });
    await expect(store.lookupCustomers(tenantId, { ids: [created.id], limit: 5 })).resolves.toEqual([
      { id: created.id, code: 'QA-EV-06', name: 'Công ty Tra Cứu', taxCode: '0103333333', version: 1 },
    ]);
    const byName = await store.lookupCustomers(tenantId, { q: 'Tra', limit: 5 });
    expect(byName.map((item) => item.code)).toContain('QA-EV-06');
    const byCode = await store.lookupCustomers(tenantId, { q: 'qa-ev-0', limit: 100 });
    expect(byCode.length).toBeGreaterThanOrEqual(4);
  });
});
