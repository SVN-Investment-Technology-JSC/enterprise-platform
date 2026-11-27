/**
 * Duyệt hàng loạt trên PostgreSQL thật: cài đặt `bulkActions` đi trong bản chụp JSON của phiên bản quy trình (không
 * cần migration), và mỗi hồ sơ được duyệt hàng loạt ghi đúng các sự kiện outbox như duyệt từng hồ sơ.
 *
 * Chạy khi đặt `PROCEDURE_TEST_ADMIN_URL` (PostgreSQL cục bộ dùng xong bỏ, chỉ nhận localhost); không có thì bỏ qua cả
 * file. Dựng DB tạm như `procedure-instance-signals.integration.spec.ts`.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { Pool } from 'pg';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import type { ProcedureActor } from './domain/procedure-authorization.js';
import { PostgresProcedureStore } from './infrastructure/postgres-procedure-store.js';

/** Hồ sơ người dùng tự mở phải gắn dự án (luật bắt buộc chọn dự án). */
const TEST_WORKSPACE_LINK = { projectId: '0a0a0a0a-0000-4000-8000-00000000d001', projectCode: 'DA-TEST' };

const ADMIN_URL_ENV = 'PROCEDURE_TEST_ADMIN_URL';
const integration = process.env[ADMIN_URL_ENV] ? describe : describe.skip;

const MIGRATIONS = resolve(process.cwd(), '../../../migrations');
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

integration('Duyệt hàng loạt (PostgreSQL)', () => {
  let adminPool: Pool;
  let pool: Pool;
  let databaseName: string;
  let application: ProcedureEngineApplication;
  let definitionId: string;

  /** Loại sự kiện outbox của một hồ sơ (không tính id, thời điểm). */
  const eventTypes = async (instanceId: string) =>
    (
      await pool.query<{ event_type: string }>(
        `SELECT event_type FROM integration_schema.outbox_events WHERE aggregate_id = $1 ORDER BY event_type`,
        [instanceId],
      )
    ).rows
      .map((row) => row.event_type)
      // Các sự kiện cùng một transaction có cùng thời điểm: so theo tập, không theo thứ tự ghi.
      .sort();

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
    const draft = await application.createDefinition(admin, {
      code: 'IT-BULK',
      name: 'Duyệt đề nghị hàng loạt',
      kind: 'process',
      category: 'technical',
      bulkActions: { approve: true },
      steps: [
        { key: 'SUBMIT', order: 1, name: 'Trình duyệt', assignments: [{ role: 'S', subjectType: 'user', subjectId: SELLER }] },
        { key: 'APPROVE', order: 2, name: 'Duyệt', assignments: [{ role: 'A', subjectType: 'user', subjectId: APPROVER }] },
      ],
    });
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
  }, 60_000);

  it('cài đặt nằm trong bản chụp JSON của phiên bản quy trình, không cần cột mới', async () => {
    const stored = await pool.query<{ snapshot: { bulkActions?: unknown } }>(
      `SELECT v.snapshot FROM procedure_schema.definitions d JOIN procedure_schema.versions v ON v.id = d.current_version_id
        WHERE d.id = $1`,
      [definitionId],
    );
    expect(stored.rows[0]?.snapshot.bulkActions).toEqual({ approve: true });
    const workspace = await application.getWorkspace(approver);
    expect(workspace.definitions.find((item) => item.id === definitionId)?.bulkActions).toEqual({ approve: true });
  }, 30_000);

  it('mỗi hồ sơ một transaction, phát đúng các sự kiện như duyệt từng hồ sơ; gọi lại không phát thêm', async () => {
    const open = async (title: string) => {
      const created = await application.startInstance(seller, {
        workspaceLink: TEST_WORKSPACE_LINK,
        definitionId,
        title,
        idempotencyKey: randomUUID(),
      });
      await application.applyAction(seller, created.id, { action: 'complete', idempotencyKey: randomUUID() });
      return created;
    };
    const single = await open('Duyệt từng hồ sơ');
    const first = await open('Duyệt hàng loạt 1');
    const second = await open('Duyệt hàng loạt 2');

    await application.applyAction(approver, single.id, { action: 'approve', idempotencyKey: randomUUID() });
    const input = { action: 'approve' as const, instanceIds: [first.id, second.id], idempotencyKey: randomUUID() };
    const result = await application.bulkApplyAction(approver, input);
    expect(result.done.map((item) => item.id)).toEqual([first.id, second.id]);

    const expected = await eventTypes(single.id);
    expect(expected).toContain('procedure.instance.changed');
    expect(await eventTypes(first.id)).toEqual(expected);
    expect(await eventTypes(second.id)).toEqual(expected);

    const again = await application.bulkApplyAction(approver, input);
    expect(again.done.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(await eventTypes(first.id)).toEqual(expected);
  }, 60_000);
});
