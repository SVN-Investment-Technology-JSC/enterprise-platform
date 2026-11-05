import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { ProjectService } from '../application/project.service.js';
import { WorkItemService } from '../application/work-item.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { PostgresWorkspaceStore } from './postgres-workspace-store.js';

const adminUrl = process.env.WORKSPACE_TEST_ADMIN_URL;
const integration = adminUrl ? describe : describe.skip;
const MIGRATION = 'tenant/workspace/0035-blocked-reason.sql';

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

/** Lý do vướng mắc: migration 0035, cột và đường ghi/xoá lý do khi đổi trạng thái (PostgreSQL thật). */
integration('Workspace: lý do vướng mắc (PostgreSQL)', () => {
  const databaseName = 'ws_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const owner = randomUUID();
  const actor: WorkspaceActor = {
    tenantId,
    userId: owner,
    displayName: 'Chủ nhiệm',
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
  };
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let store: PostgresWorkspaceStore;
  let items: WorkItemService;
  let projectId: string;
  let migrationSql: string;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const paths = await registeredMigrations();
    expect(paths).toContain(MIGRATION);
    for (const path of paths) await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    migrationSql = await readFile(resolve(process.cwd(), '../../../migrations', MIGRATION), 'utf8');
    store = new PostgresWorkspaceStore(
      { require: () => ({}) } as never,
      { forTenant: async () => pool } as never,
    );
    items = new WorkItemService(store, new ProjectService(store));
    projectId = (await store.project.create(tenantId, owner, { code: 'QA-BR', name: 'Dự án vướng mắc' } as never)).id;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const newItem = (title: string) =>
    items.create(actor, { projectId, title, assigneeUserId: owner } as never);
  const reasonOf = async (table: 'work_items' | 'standalone_tasks', id: string) =>
    (await pool.query(`SELECT blocked_reason FROM workspace_schema.${table} WHERE id = $1`, [id])).rows[0]
      ?.blocked_reason as string | null;

  it('cột blocked_reason có ở cả hai bảng, cho phép rỗng', async () => {
    const columns = await pool.query(
      `SELECT table_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'workspace_schema' AND column_name = 'blocked_reason'
        ORDER BY table_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: 'standalone_tasks', is_nullable: 'YES', data_type: 'text' },
      { table_name: 'work_items', is_nullable: 'YES', data_type: 'text' },
    ]);
  });

  it('vào vướng mắc ghi lý do (kèm nhật ký), sửa lý do không thêm dòng nhật ký, rời đi thì xoá', async () => {
    const created = await newItem('Việc vướng');
    const blocked = await items.changeStatus(actor, created.id, { status: 'blocked', note: ' Chờ bản vẽ ' });
    expect(blocked.blockedReason).toBe('Chờ bản vẽ');
    expect(await reasonOf('work_items', created.id)).toBe('Chờ bản vẽ');

    const revised = await items.changeStatus(actor, created.id, { status: 'blocked', note: 'Chờ bản vẽ bản 2' });
    expect(revised.status).toBe('blocked');
    expect(revised.blockedReason).toBe('Chờ bản vẽ bản 2');
    const history = await pool.query(
      `SELECT to_status, note FROM workspace_schema.work_item_status_history
        WHERE work_item_id = $1 AND to_status = 'blocked'`,
      [created.id],
    );
    expect(history.rows).toEqual([{ to_status: 'blocked', note: 'Chờ bản vẽ' }]);

    const resumed = await items.changeStatus(actor, created.id, { status: 'in_progress' });
    expect(resumed.blockedReason).toBeUndefined();
    expect(await reasonOf('work_items', created.id)).toBeNull();
  });

  it('việc cũ đang vướng mắc được chép lý do từ nhật ký mới nhất; chạy lại không đè lý do đã sửa', async () => {
    const created = await newItem('Việc cũ vướng');
    // Dữ liệu trước migration: đang blocked, có nhật ký nhưng chưa có cột lý do.
    await pool.query(`UPDATE workspace_schema.work_items SET status = 'blocked', blocked_reason = NULL WHERE id = $1`, [
      created.id,
    ]);
    const log = (note: string | null, at: string) =>
      pool.query(
        `INSERT INTO workspace_schema.work_item_status_history
           (work_item_id, project_id, from_status, to_status, note, created_by, created_at)
         VALUES ($1, $2, 'in_progress', 'blocked', $3, $4, $5::timestamptz)`,
        [created.id, projectId, note, owner, at],
      );
    await log('Lý do lần đầu', '2026-01-01T00:00:00Z');
    await log('  Lý do mới nhất  ', '2026-02-01T00:00:00Z');
    await log('   ', '2026-03-01T00:00:00Z');

    const noReason = await newItem('Việc cũ vướng không ghi chú');
    await pool.query(`UPDATE workspace_schema.work_items SET status = 'blocked', blocked_reason = NULL WHERE id = $1`, [
      noReason.id,
    ]);
    const notBlocked = await newItem('Việc đã rời vướng mắc');
    await pool.query(
      `INSERT INTO workspace_schema.work_item_status_history
         (work_item_id, project_id, from_status, to_status, note, created_by)
       VALUES ($1, $2, 'in_progress', 'blocked', 'Cũ rồi', $3)`,
      [notBlocked.id, projectId, owner],
    );

    await pool.query(migrationSql);
    expect(await reasonOf('work_items', created.id)).toBe('Lý do mới nhất');
    expect(await reasonOf('work_items', noReason.id)).toBeNull();
    expect(await reasonOf('work_items', notBlocked.id)).toBeNull();

    // Người dùng sửa lý do rồi migration chạy lại (chạy lại được): không đè.
    await store.workItem.updateBlockedReason(tenantId, created.id, 'Lý do đã sửa');
    await pool.query(migrationSql);
    expect(await reasonOf('work_items', created.id)).toBe('Lý do đã sửa');
  });

  it('store: updateBlockedReason chỉ ghi khi việc vẫn đang vướng mắc', async () => {
    const created = await newItem('Việc không vướng');
    expect(await store.workItem.updateBlockedReason(tenantId, created.id, 'Không nên ghi')).toBeUndefined();
    expect(await reasonOf('work_items', created.id)).toBeNull();
  });

  it('việc giao lẻ: chép lý do cũ, ghi/sửa/xoá lý do khi đổi trạng thái', async () => {
    const insert = async (code: string, status: string) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO workspace_schema.standalone_tasks
           (id, root_id, code, title, status, assignee_user_id, created_by)
         VALUES ($1, $1, $2, $3, $4, $5, $5)`,
        [id, code, 'Việc ' + code, status, owner],
      );
      return id;
    };
    const legacy = await insert('GVX001', 'blocked');
    await pool.query(
      `INSERT INTO workspace_schema.standalone_task_history (task_id, from_status, to_status, note, created_by, created_at)
       VALUES ($1, 'in_progress', 'blocked', 'Chờ duyệt mẫu', $2, '2026-01-01T00:00:00Z'),
              ($1, 'blocked', 'in_progress', NULL, $2, '2026-01-02T00:00:00Z'),
              ($1, 'in_progress', 'blocked', ' Chờ khách trả lời ', $2, '2026-01-03T00:00:00Z')`,
      [legacy, owner],
    );
    await pool.query(migrationSql);
    expect(await reasonOf('standalone_tasks', legacy)).toBe('Chờ khách trả lời');

    const live = await insert('GVX002', 'in_progress');
    const today = '2026-10-01';
    const entered = await store.standaloneTask.changeStatus(tenantId, live, owner, 'in_progress', 'blocked', 'Thiếu số liệu', today);
    expect(entered?.blockedReason).toBe('Thiếu số liệu');

    const revised = await store.standaloneTask.updateBlockedReason(tenantId, live, 'Thiếu số liệu quý 3');
    expect(revised?.blockedReason).toBe('Thiếu số liệu quý 3');

    const resumed = await store.standaloneTask.changeStatus(tenantId, live, owner, 'blocked', 'in_progress', undefined, today);
    expect(resumed?.blockedReason).toBeUndefined();
    expect(await reasonOf('standalone_tasks', live)).toBeNull();
    expect(await store.standaloneTask.updateBlockedReason(tenantId, live, 'Không nên ghi')).toBeUndefined();
  });
});
