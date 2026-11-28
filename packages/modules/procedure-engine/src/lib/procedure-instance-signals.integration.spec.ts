/**
 * Tín hiệu thời gian thực "hồ sơ vừa đổi" trên PostgreSQL thật: duyệt, trả về... ghi `procedure.instance.changed`
 * vào outbox cùng transaction; trao đổi chỉ ghi `procedure.comment.posted`.
 *
 * Chạy khi đặt `PROCEDURE_TEST_ADMIN_URL` (PostgreSQL cục bộ dùng xong bỏ, chỉ nhận localhost); không có thì bỏ qua cả
 * file. Test tạo DB tạm `procedure_test_<uuid>`, chạy migration như `procedure-source-summary.integration.spec.ts`.
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

integration('Tín hiệu hồ sơ vừa đổi (PostgreSQL)', () => {
  let adminPool: Pool;
  let pool: Pool;
  let databaseName: string;
  let application: ProcedureEngineApplication;
  let definitionId: string;

  const signals = async (instanceId: string) =>
    (
      await pool.query<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
        `SELECT event_type, payload FROM integration_schema.outbox_events
          WHERE aggregate_id = $1 AND event_type IN ('procedure.instance.changed', 'procedure.comment.posted')
          ORDER BY occurred_at, event_type`,
        [instanceId],
      )
    ).rows.map((row) => [row.event_type, row.payload.payload] as const);

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
      code: 'IT-SIG',
      name: 'Duyệt đề nghị',
      kind: 'process',
      category: 'technical',
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

  it('mở hồ sơ không phát; trao đổi chỉ phát tín hiệu trao đổi; hoàn thành và duyệt mỗi lần một tín hiệu hồ sơ', async () => {
    const created = await application.startInstance(seller, {
      workspaceLink: TEST_WORKSPACE_LINK,
      definitionId,
      title: 'Đề nghị bí mật',
      idempotencyKey: randomUUID(),
    });
    expect(await signals(created.id)).toEqual([]);

    await application.postComment(seller, created.id, { body: 'Nhờ anh duyệt', idempotencyKey: randomUUID() });
    const afterComment = await signals(created.id);
    expect(afterComment.map(([type]) => type)).toEqual(['procedure.comment.posted']);

    await application.applyAction(seller, created.id, { action: 'complete', idempotencyKey: randomUUID() });
    const done = await application.applyAction(approver, created.id, { action: 'approve', idempotencyKey: randomUUID() });
    expect(done.status).toBe('completed');

    const changed = (await signals(created.id)).filter(([type]) => type === 'procedure.instance.changed');
    expect(changed.map(([, payload]) => payload)).toEqual([
      { instanceId: created.id, actorUserId: SELLER },
      { instanceId: created.id, actorUserId: APPROVER },
    ]);
    expect(JSON.stringify(changed)).not.toContain('bí mật');
  }, 30_000);
});
