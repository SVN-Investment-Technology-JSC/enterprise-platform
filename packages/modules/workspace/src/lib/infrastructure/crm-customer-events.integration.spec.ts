import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { CRM_CUSTOMER_CREATED, CRM_CUSTOMER_UPDATED } from '@enterprise-platform/contracts-integration';
import { CrmCustomerLinkService } from '../application/crm-customer-link.service.js';
import type { CrmCustomerDirectory } from '../application/crm-customer.port.js';
import { PostgresCrmCustomerCopies } from './crm-customer-events.js';

const adminUrl = process.env.WORKSPACE_TEST_ADMIN_URL;
const integration = adminUrl ? describe : describe.skip;

/** Migration của tenant theo thứ tự đăng ký: core, integration, rồi workspace (như khi bật phân hệ). */
async function registeredMigrations(): Promise<string[]> {
  const source = await readFile(
    resolve(process.cwd(), '../../../packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const pathsBetween = (from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    return [...source.slice(start, end === -1 ? undefined : end).matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  };
  return [
    ...pathsBetween('export const TENANT_CORE_MIGRATIONS', 'export const TENANT_MODULE_MIGRATIONS'),
    'tenant/0001-integration.sql',
    ...pathsBetween('  workspace: [', '  shared: ['),
  ];
}

/** T2-13 (D1): bản sao khách Bán hàng trong Workspace — idempotent, bỏ qua phiên bản cũ (TC-INT-11, 12, 15). */
integration('Workspace: consumer crm.customer.* (PostgreSQL)', () => {
  const databaseName = 'ws_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const actor = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let copies: PostgresCrmCustomerCopies;
  let service: CrmCustomerLinkService;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    copies = new PostgresCrmCustomerCopies(async () => pool);
    const directory: CrmCustomerDirectory = { enabled: async () => true, lookup: async () => [] };
    service = new CrmCustomerLinkService(directory, copies);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const payload = (crmId: string, version: number, over: Record<string, unknown> = {}) => ({
    customerId: crmId,
    code: 'QA-CRM-KH01',
    name: 'Công ty Bản Sao',
    taxCode: '0101234567',
    version,
    actorUserId: actor,
    ...over,
  });
  const copiesOf = async (crmId: string) =>
    (
      await pool.query<{ id: string; code: string; name: string; crm_version: number }>(
        `SELECT id, code, name, crm_version FROM workspace_schema.customers WHERE crm_customer_id = $1`,
        [crmId],
      )
    ).rows;

  it('migration 0031 đã thêm cột liên kết', async () => {
    await expect(copies.ready(tenantId)).resolves.toBe(true);
  });

  it('TC-INT-11: crm.customer.created tạo bản sao cùng mã, tên; nhận lặp 3 lần vẫn một bản', async () => {
    const crmId = randomUUID();
    const results = [];
    for (let attempt = 0; attempt < 3; attempt += 1)
      results.push(await service.handleEvent(tenantId, CRM_CUSTOMER_CREATED, payload(crmId, 1)));
    expect(results.map((result) => result?.action)).toEqual(['created', 'ignored', 'ignored']);
    expect(await copiesOf(crmId)).toEqual([
      expect.objectContaining({ code: 'QA-CRM-KH01', name: 'Công ty Bản Sao', crm_version: 1 }),
    ]);
  });

  it('TC-INT-12: sửa tên cập nhật bản sao; sự kiện cũ đến sau không ghi đè', async () => {
    const crmId = randomUUID();
    const code = 'QA-CRM-KH02';
    await service.handleEvent(tenantId, CRM_CUSTOMER_CREATED, payload(crmId, 1, { code, name: 'Tên 1' }));
    await service.handleEvent(tenantId, CRM_CUSTOMER_UPDATED, payload(crmId, 3, { code: 'QA-CRM-KH02B', name: 'Tên 3' }));
    const late = await service.handleEvent(tenantId, CRM_CUSTOMER_UPDATED, payload(crmId, 2, { code, name: 'Tên 2' }));
    expect(late?.action).toBe('ignored');
    expect(await copiesOf(crmId)).toEqual([expect.objectContaining({ code: 'QA-CRM-KH02B', name: 'Tên 3', crm_version: 3 })]);
  });

  it('sự kiện đến sai thứ tự: updated tới trước created vẫn ra đúng bản mới nhất', async () => {
    const crmId = randomUUID();
    await service.handleEvent(tenantId, CRM_CUSTOMER_UPDATED, payload(crmId, 2, { code: 'QA-CRM-KH03', name: 'Mới' }));
    const created = await service.handleEvent(tenantId, CRM_CUSTOMER_CREATED, payload(crmId, 1, { code: 'QA-CRM-KH03', name: 'Cũ' }));
    expect(created?.action).toBe('ignored');
    expect(await copiesOf(crmId)).toEqual([expect.objectContaining({ name: 'Mới', crm_version: 2 })]);
  });

  it('nhiều sự kiện cùng khách chạy đồng thời: một bản sao, giữ phiên bản lớn nhất', async () => {
    const crmId = randomUUID();
    await Promise.all(
      [1, 2, 3, 4, 5, 3, 1].map((version) =>
        service.handleEvent(tenantId, version === 1 ? CRM_CUSTOMER_CREATED : CRM_CUSTOMER_UPDATED, payload(crmId, version, {
          code: 'QA-CRM-KH04',
          name: `Tên ${version}`,
        })),
      ),
    );
    expect(await copiesOf(crmId)).toEqual([expect.objectContaining({ name: 'Tên 5', crm_version: 5 })]);
  });

  it('khách Workspace cũ cùng mã, chưa gắn: gắn vào khách đó, dự án và hợp đồng vẫn trỏ đúng (TC-MIG-05)', async () => {
    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO workspace_schema.customers (code, name, created_by) VALUES ('QA-CRM-WS01', 'Khách cũ', $1) RETURNING id`,
      [actor],
    );
    const legacyId = legacy.rows[0].id;
    await pool.query(
      `INSERT INTO workspace_schema.contracts (customer_id, code, name, created_by) VALUES ($1, 'QA-HD-01', 'Hợp đồng', $2)`,
      [legacyId, actor],
    );
    const crmId = randomUUID();
    const result = await service.handleEvent(
      tenantId,
      CRM_CUSTOMER_CREATED,
      payload(crmId, 1, { code: 'QA-CRM-WS01', name: 'Khách cũ (Bán hàng)' }),
    );
    expect(result).toMatchObject({ action: 'linked', customer: { id: legacyId, crmCustomerId: crmId } });
    const contract = await pool.query(`SELECT customer_id FROM workspace_schema.contracts WHERE code = 'QA-HD-01'`);
    expect(contract.rows[0].customer_id).toBe(legacyId);
  });

  it('khách Workspace cũ mã viết thường vẫn được gắn với mã viết hoa của Bán hàng', async () => {
    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO workspace_schema.customers (code, name, created_by) VALUES ('qa-crm-ws03', 'Khách thường', $1) RETURNING id`,
      [actor],
    );
    const crmId = randomUUID();
    const result = await service.handleEvent(tenantId, CRM_CUSTOMER_CREATED, payload(crmId, 1, { code: 'QA-CRM-WS03' }));
    expect(result).toMatchObject({ action: 'linked', customer: { id: legacy.rows[0].id, code: 'QA-CRM-WS03' } });
  });

  it('gắn đích danh (script chuyển khách khi mã khác nhau); gắn lại là không đổi; khách đã gắn nơi khác thì 409', async () => {
    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO workspace_schema.customers (code, name, created_by) VALUES ('qa ws 02', 'Khách mã thường', $1) RETURNING id`,
      [actor],
    );
    const crmId = randomUUID();
    const reference = { id: crmId, code: 'QA-WS-02', name: 'Khách mã thường', taxCode: null, version: 1 };
    const first = await copies.apply(tenantId, reference, { actorUserId: actor, targetCustomerId: legacy.rows[0].id });
    expect(first).toMatchObject({ action: 'linked', customer: { id: legacy.rows[0].id, code: 'QA-WS-02' } });
    const again = await copies.apply(tenantId, reference, { actorUserId: actor, targetCustomerId: legacy.rows[0].id });
    expect(again.action).toBe('ignored');
    await expect(
      copies.apply(tenantId, { ...reference, id: randomUUID() }, { actorUserId: actor, targetCustomerId: legacy.rows[0].id }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CRM_CUSTOMER_LINK_CONFLICT' });
  });

  it('mã đang thuộc bản sao của khách Bán hàng khác: 409, không ghi gì', async () => {
    const first = randomUUID();
    await service.handleEvent(tenantId, CRM_CUSTOMER_CREATED, payload(first, 1, { code: 'QA-CRM-KH05' }));
    const second = randomUUID();
    await expect(
      service.handleEvent(tenantId, CRM_CUSTOMER_CREATED, payload(second, 1, { code: 'QA-CRM-KH05' })),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await copiesOf(second)).toEqual([]);
  });
});
