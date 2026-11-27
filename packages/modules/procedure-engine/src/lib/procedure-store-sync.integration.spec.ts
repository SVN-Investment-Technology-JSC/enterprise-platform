/**
 * Ghi hồ sơ xuống PostgreSQL thật: mỗi lần lưu chỉ ghi lại phần ĐÃ ĐỔI (không xoá và ghi lại toàn bộ quy trình và hồ sơ).
 *
 * Chạy khi đặt `PROCEDURE_TEST_ADMIN_URL` (PostgreSQL cục bộ dùng xong bỏ, chỉ nhận localhost); không có thì bỏ qua cả file.
 * Cách dựng DB tạm giống `procedure-source-summary.integration.spec.ts`.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { CreateProcedureDefinitionRequest, ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
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
const [REQUESTER, CHECKER, CHIEF, MANAGER] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

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
const [requester, checker, chief, manager] = [REQUESTER, CHECKER, CHIEF, MANAGER].map((id) => person(id));

const definitionInput = (code: string): CreateProcedureDefinitionRequest => ({
  code,
  name: `Quy trình ${code}`,
  kind: 'process',
  category: 'finance',
  steps: [
    { key: 'TAO', order: 1, name: 'Tạo đơn', assignments: [{ role: 'S', subjectType: 'user', subjectId: REQUESTER }] },
    {
      key: 'KT',
      order: 2,
      name: 'Kiểm tra và duyệt',
      assignments: [
        { role: 'R', subjectType: 'user', subjectId: CHECKER },
        { role: 'A', subjectType: 'user', subjectId: CHIEF },
      ],
    },
    { key: 'QL', order: 3, name: 'Quản lý duyệt', assignments: [{ role: 'A', subjectType: 'user', subjectId: MANAGER }] },
  ],
});

integration('Ghi hồ sơ xuống PostgreSQL chỉ phần đã đổi', () => {
  let adminPool: Pool;
  let pool: Pool;
  let databaseName: string;
  let application: ProcedureEngineApplication;
  const definitionIds: string[] = [];
  let statements = 0;

  /** Đếm số câu lệnh gửi tới DB trong lúc chạy `run`. */
  const counting = async <T>(run: () => Promise<T>): Promise<{ value: T; statements: number }> => {
    statements = 0;
    const value = await run();
    return { value, statements };
  };

  beforeAll(async () => {
    const url = new URL(process.env[ADMIN_URL_ENV] ?? '');
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    databaseName = 'procedure_test_' + randomUUID().replace(/-/g, '');
    adminPool = createPostgresPool(url.toString());
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    // Đếm mọi câu lệnh đi qua các kết nối của pool (kể cả kết nối của giao dịch).
    pool.on('connect', (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
        statements += 1;
        return query(...args);
      };
    });
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
    // Nhiều quy trình, để thấy chi phí không tăng theo số quy trình khi chỉ một hồ sơ đổi.
    for (let index = 0; index < 8; index += 1) {
      const draft = await application.createDefinition(admin, definitionInput(`SYNC-${index}`));
      definitionIds.push((await application.publishDefinition(admin, draft.id)).id);
    }
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      if (/^procedure_test_[a-f0-9]{32}$/.test(databaseName ?? '')) {
        await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      }
      await adminPool.end();
    }
  }, 60_000);

  /** Mọi bảng chiếu của một hồ sơ phải khớp với bản chụp của nó. */
  const expectProjectionMatches = async (instance: ProcedureInstance) => {
    const row = (
      await pool.query('SELECT status, code, snapshot FROM procedure_schema.instances WHERE id=$1', [instance.id])
    ).rows[0];
    expect(row.status).toBe(instance.status);
    expect(row.snapshot.activity).toHaveLength(instance.activity.length);
    const steps = (
      await pool.query('SELECT id, status, current_role_stage FROM procedure_schema.step_instances WHERE instance_id=$1', [
        instance.id,
      ])
    ).rows;
    expect(steps).toHaveLength(instance.steps.length);
    for (const step of instance.steps) {
      expect(steps.find((candidate) => candidate.id === step.id)).toMatchObject({
        status: step.status,
        current_role_stage: step.currentRoleStage,
      });
    }
    const logs = (await pool.query('SELECT count(*)::int AS n FROM procedure_schema.activity_logs WHERE instance_id=$1', [instance.id])).rows[0];
    const actions = (await pool.query('SELECT count(*)::int AS n FROM procedure_schema.actions WHERE instance_id=$1', [instance.id])).rows[0];
    expect(logs.n).toBe(instance.activity.length);
    expect(actions.n).toBe(instance.activity.length);
  };

  it('một thao tác trên một hồ sơ chỉ ghi hồ sơ đó: số câu lệnh không tăng theo số hồ sơ khác và số quy trình', async () => {
    const instances: ProcedureInstance[] = [];
    for (let index = 0; index < 6; index += 1) {
      instances.push(
        await application.startInstance(requester, {
          workspaceLink: TEST_WORKSPACE_LINK,
          definitionId: definitionIds[index % definitionIds.length] as string,
          title: `Hồ sơ ${index}`,
          idempotencyKey: randomUUID(),
        }),
      );
    }
    const first = instances[0] as ProcedureInstance;
    const small = await counting(() =>
      application.applyAction(requester, first.id, { action: 'complete', idempotencyKey: randomUUID() }),
    );
    // Thêm hồ sơ rồi đo lại: chi phí thao tác không được tăng theo số hồ sơ không liên quan.
    for (let index = 0; index < 10; index += 1) {
      await application.startInstance(requester, {
        workspaceLink: TEST_WORKSPACE_LINK,
        definitionId: definitionIds[index % definitionIds.length] as string,
        title: `Hồ sơ thêm ${index}`,
        idempotencyKey: randomUUID(),
      });
    }
    const afterMany = await counting(() =>
      application.applyAction(checker, first.id, { action: 'complete', idempotencyKey: randomUUID() }),
    );
    console.log(`số câu lệnh: ${small.statements} (6 hồ sơ), ${afterMany.statements} (16 hồ sơ)`);
    // Lần đo sau là đổi pha trong cùng bước (R xong sang A) nên ghi thêm một thông báo "đến lượt" cho người giữ pha A
    // mà lần đầu (sang bước mới) cũng có; chênh tối đa 3 câu là do loại thao tác, không phải do số hồ sơ khác.
    expect(afterMany.statements).toBeLessThanOrEqual(small.statements + 3);
    // Một thao tác chỉ cần vài chục câu lệnh, không phải hàng trăm.
    expect(afterMany.statements).toBeLessThan(60);
    await expectProjectionMatches(afterMany.value);
    // Hồ sơ không liên quan vẫn nguyên vẹn.
    for (const other of instances.slice(1)) {
      await expectProjectionMatches(await application.getInstance(requester, other.id));
    }
  }, 120_000);

  it('chuỗi thao tác (duyệt, hoàn duyệt, trả lại, hoàn tất) giữ bảng chiếu khớp bản chụp', async () => {
    const created = await application.startInstance(requester, {
      workspaceLink: TEST_WORKSPACE_LINK,
      definitionId: definitionIds[0] as string,
      title: 'Chuỗi thao tác',
      idempotencyKey: randomUUID(),
    });
    const act = (actor: ProcedureActor, action: 'complete' | 'approve' | 'withdraw' | 'return') =>
      application.applyAction(actor, created.id, { action, idempotencyKey: randomUUID() });
    await expectProjectionMatches(await act(requester, 'complete'));
    await expectProjectionMatches(await act(requester, 'withdraw'));
    await expectProjectionMatches(await act(requester, 'complete'));
    await expectProjectionMatches(await act(checker, 'complete'));
    await expectProjectionMatches(await act(chief, 'approve'));
    // Quản lý trả hồ sơ về bước Kiểm tra và duyệt; làm lại từ pha đầu.
    await expectProjectionMatches(await act(manager, 'return'));
    await expectProjectionMatches(await act(checker, 'complete'));
    await expectProjectionMatches(await act(chief, 'approve'));
    const done = await act(manager, 'approve');
    expect(done.status).toBe('completed');
    await expectProjectionMatches(done);
    // Đọc lại từ DB ra đúng hồ sơ vừa ghi.
    expect((await application.getInstance(requester, created.id)).activity).toHaveLength(done.activity.length);
  }, 120_000);

  it('đổi định nghĩa (công bố quy trình mới) vẫn ghi lại đủ và hồ sơ cũ không mất', async () => {
    const before = await application.startInstance(requester, {
      workspaceLink: TEST_WORKSPACE_LINK,
      definitionId: definitionIds[1] as string,
      title: 'Trước khi công bố',
      idempotencyKey: randomUUID(),
    });
    const draft = await application.createDefinition(admin, definitionInput('SYNC-NEW'));
    await application.publishDefinition(admin, draft.id);
    await expectProjectionMatches(await application.getInstance(requester, before.id));
    const defs = (await pool.query('SELECT count(*)::int AS n FROM procedure_schema.definitions')).rows[0];
    expect(defs.n).toBe(definitionIds.length + 1);
  }, 120_000);
});
