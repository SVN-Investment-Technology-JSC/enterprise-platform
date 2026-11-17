/**
 * Thông tin nguồn của hồ sơ trên PostgreSQL thật (CRM phase 3, D3-31; TC-TSK-02, TC-TSK-03).
 *
 * Chạy khi đặt `PROCEDURE_TEST_ADMIN_URL`: URL quản trị của một PostgreSQL cục bộ dùng xong bỏ (chỉ nhận localhost).
 * Test tạo DB tạm `procedure_test_<uuid>`, chạy `tenant/0001-integration.sql`, các file nền của `tenant/core` mà
 * migration Quy trình cần (sơ đồ tổ chức), rồi mọi file `tenant/procedure` theo thứ tự tên, và xoá DB khi xong.
 * Không có biến này thì cả file được bỏ qua.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { CreateProcedureDefinitionRequest, ProcedureSourceSummary } from '@enterprise-platform/contracts-procedure-engine';
import type { Pool } from 'pg';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import type { ProcedureActor } from './domain/procedure-authorization.js';
import { PostgresProcedureStore } from './infrastructure/postgres-procedure-store.js';

const ADMIN_URL_ENV = 'PROCEDURE_TEST_ADMIN_URL';
const integration = process.env[ADMIN_URL_ENV] ? describe : describe.skip;

/** Jest chạy với cwd là thư mục project (`packages/modules/procedure-engine`). */
const MIGRATIONS = resolve(process.cwd(), '../../../migrations');
const SOURCE_SUMMARY_MIGRATION = resolve(MIGRATIONS, 'tenant/procedure/0015-instance-source-summary.sql');
/** Migration Quy trình 0010 đọc `core_schema.organization_nodes` (cột đơn vị, chức danh, xoá mềm). */
const CORE_PREREQUISITES = [
  'tenant/core/0001-core-schema.sql',
  'tenant/core/0002-organization-soft-delete.sql',
  'tenant/core/0003-organization-tree-layout.sql',
  'tenant/core/0004-organization-category.sql',
  'tenant/core/0005-organization-head-position.sql',
];

const TENANT = randomUUID();
const SELLER = randomUUID();
const APPROVER = randomUUID();

const person = (userId: string, overrides: Partial<ProcedureActor> = {}): ProcedureActor => ({
  tenantId: TENANT,
  userId,
  displayName: `Người ${userId.slice(0, 4)}`,
  membershipId: userId,
  canDesign: false,
  canPublish: false,
  canCreateInstances: true,
  isOverride: false,
  organizationUnitIds: [],
  positionIds: [],
  ...overrides,
});
const admin = person(randomUUID(), { canDesign: true, canPublish: true, isOverride: true });
const seller = person(SELLER);
const approver = person(APPROVER);

const definitionInput = (): CreateProcedureDefinitionRequest => ({
  code: 'IT-BG',
  name: 'Duyệt báo giá',
  kind: 'process',
  category: 'technical',
  steps: [
    { key: 'SUBMIT', order: 1, name: 'Trình duyệt', assignments: [{ role: 'S', subjectType: 'user', subjectId: SELLER }] },
    { key: 'APPROVE', order: 2, name: 'Duyệt', assignments: [{ role: 'A', subjectType: 'user', subjectId: APPROVER }] },
  ],
});

const SUMMARY: ProcedureSourceSummary = {
  title: 'Báo giá BG2600401 v2',
  items: [
    { label: 'Khách hàng', value: 'Công ty <b>An Phát</b>' },
    { label: 'Tổng tiền', value: '120.000.000 đ' },
  ],
  url: '/modules/crm#quotes/q-1',
  urlLabel: 'Mở báo giá trong Bán hàng',
};

integration('Thông tin nguồn của hồ sơ (PostgreSQL)', () => {
  let adminPool: Pool;
  let pool: Pool;
  let databaseName: string;
  let application: ProcedureEngineApplication;
  let definitionId: string;

  const column = async (instanceId: string) =>
    (
      await pool.query<{ source_summary: unknown }>(
        'SELECT source_summary FROM procedure_schema.instances WHERE id = $1',
        [instanceId],
      )
    ).rows[0]?.source_summary;

  beforeAll(async () => {
    const url = new URL(process.env[ADMIN_URL_ENV] ?? '');
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    databaseName = 'procedure_test_' + randomUUID().replace(/-/g, '');
    adminPool = createPostgresPool(url.toString());
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    await pool.query(await readFile(resolve(MIGRATIONS, 'tenant/0001-integration.sql'), 'utf8'));
    for (const file of CORE_PREREQUISITES) await pool.query(await readFile(resolve(MIGRATIONS, file), 'utf8'));
    const directory = resolve(MIGRATIONS, 'tenant/procedure');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query(await readFile(resolve(directory, file), 'utf8'));
    }

    const store = new PostgresProcedureStore(
      { require: () => ({ tenantId: TENANT }) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    );
    application = new ProcedureEngineApplication(store, { now: () => new Date() }, { next: () => randomUUID() });
    const draft = await application.createDefinition(admin, definitionInput());
    definitionId = (await application.publishDefinition(admin, draft.id)).id;
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      if (/^procedure_test_[a-f0-9]{32}$/.test(databaseName ?? '')) {
        await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      }
      await adminPool.end();
    }
    // Xoá DB tạm có thể quá 5 giây khi nhiều suite chạy song song (như afterAll của các integration CRM).
  }, 60_000);

  it('TC-TSK-02: cột source_summary là jsonb cho phép rỗng; hồ sơ không có nguồn để rỗng; chạy lại migration không lỗi', async () => {
    const info = await pool.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'procedure_schema' AND table_name = 'instances' AND column_name = 'source_summary'`,
    );
    expect(info.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);

    const plain = await application.startInstance(seller, { definitionId, title: 'Hồ sơ thường', idempotencyKey: randomUUID() });
    const withSource = await application.createInstance(TENANT, {
      definitionId,
      title: 'Có nguồn',
      sourceType: 'crm_quote',
      sourceId: randomUUID(),
      idempotencyKey: randomUUID(),
      initiatedBy: SELLER,
      sourceSummary: SUMMARY,
    });

    const sql = await readFile(SOURCE_SUMMARY_MIGRATION, 'utf8');
    const client = await pool.connect();
    try {
      // Migrator bọc mỗi file trong một transaction; `SET LOCAL` chỉ có hiệu lực trong transaction.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await column(plain.id)).toBeNull();
    expect(await column(withSource.id)).toEqual(SUMMARY);
  });

  it('TC-TSK-03: tạo hồ sơ có thông tin nguồn, PUT cập nhật, PUT khi hồ sơ đã kết thúc, null là xoá', async () => {
    const created = await application.createInstance(TENANT, {
      definitionId,
      title: 'Duyệt báo giá BG2600401',
      sourceType: 'crm_quote',
      sourceId: randomUUID(),
      idempotencyKey: randomUUID(),
      initiatedBy: SELLER,
      sourceSummary: { ...SUMMARY, title: `  ${SUMMARY.title}  ` },
    });
    expect(await column(created.id)).toEqual(SUMMARY);
    expect((await application.getInstance(approver, created.id)).sourceSummary).toEqual(SUMMARY);

    const next: ProcedureSourceSummary = { ...SUMMARY, items: [...SUMMARY.items, { label: 'Chiết khấu', value: '3%' }] };
    await application.updateSourceSummaryForService(TENANT, created.id, next);
    expect(await column(created.id)).toEqual(next);

    await application.applyAction(seller, created.id, { action: 'complete', idempotencyKey: randomUUID() });
    const done = await application.applyAction(approver, created.id, { action: 'approve', idempotencyKey: randomUUID() });
    expect(done.status).toBe('completed');
    const actionsBefore = (
      await pool.query('SELECT id FROM procedure_schema.actions WHERE instance_id = $1 ORDER BY id', [created.id])
    ).rows;

    const finished: ProcedureSourceSummary = { ...next, title: 'Báo giá BG2600401 v3' };
    await expect(application.updateSourceSummaryForService(TENANT, created.id, finished)).resolves.toEqual({
      id: created.id,
      sourceSummary: finished,
    });
    const reread = await application.getInstance(approver, created.id);
    expect(reread.status).toBe('completed');
    expect(reread.sourceSummary).toEqual(finished);
    expect(
      (await pool.query('SELECT id FROM procedure_schema.actions WHERE instance_id = $1 ORDER BY id', [created.id])).rows,
    ).toEqual(actionsBefore);

    await application.updateSourceSummaryForService(TENANT, created.id, null);
    expect(await column(created.id)).toBeNull();
    expect((await application.getInstance(approver, created.id)).sourceSummary).toBeNull();

    await expect(application.updateSourceSummaryForService(TENANT, randomUUID(), SUMMARY)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
