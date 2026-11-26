import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { PostgresRelatedObjectStore } from './postgres-related-object-store.js';

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

integration('Workspace: đối tượng liên quan (PostgreSQL)', () => {
  const databaseName = 'ws_test_' + randomUUID().replace(/-/g, '');
  const userId = randomUUID();
  const projectId = randomUUID();
  const workItemId = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let store: PostgresRelatedObjectStore;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    // Chạy hai lần: migration phải chạy lại được (migrator có thể chạy lại khi deploy).
    for (let round = 0; round < 2; round += 1) {
      for (const path of await registeredMigrations())
        await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    }
    await pool.query(
      `INSERT INTO workspace_schema.projects (id, code, name, owner_user_id, created_by) VALUES ($1, 'DA-RO-01', 'Dự án thử', $2, $2)`,
      [projectId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_schema.work_items (id, project_id, code, title, created_by)
       VALUES ($1, $2, 'CV-01', 'Lắp đặt', $3)`,
      [workItemId, projectId, userId],
    );
    store = new PostgresRelatedObjectStore(async () => pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const base = {
    projectId,
    kind: 'crm.contract',
    moduleKey: 'crm',
    kindLabel: 'Hợp đồng bán',
    moduleLabel: 'Bán hàng',
    label: 'HD-001 — Tủ điện',
    launchUrl: '/modules/crm#contracts/c-1',
    createdBy: userId,
    createdByName: 'Người A',
  };

  it('lưu, gắn lại không trùng, đọc kèm tên công việc', async () => {
    const first = await store.upsert('t', { ...base, entityType: 'project', entityId: projectId, objectId: 'c-1' });
    const again = await store.upsert('t', {
      ...base,
      entityType: 'project',
      entityId: projectId,
      objectId: 'c-1',
      label: 'HD-001 — Tủ điện (sửa)',
    });
    expect(again.id).toBe(first.id);
    expect(again.label).toBe('HD-001 — Tủ điện (sửa)');
    await store.upsert('t', { ...base, entityType: 'work_item', entityId: workItemId, objectId: 'c-2' });

    const all = await store.listByProject('t', projectId);
    expect(all.map((row) => [row.entityType, row.objectId, row.entityLabel])).toEqual([
      ['project', 'c-1', undefined],
      ['work_item', 'c-2', 'CV-01 — Lắp đặt'],
    ]);
    expect(all[0]).toMatchObject({ kindLabel: 'Hợp đồng bán', moduleLabel: 'Bán hàng', createdByName: 'Người A' });
  });

  it('làm mới nhãn theo lô', async () => {
    const [row] = await store.listByEntity('t', 'project', projectId);
    await store.refreshSnapshots('t', [
      { id: row!.id, code: 'HD-001', label: 'HD-001 — Mới', status: 'Hiệu lực', launchUrl: row!.launchUrl },
    ]);
    expect(await store.findById('t', row!.id)).toMatchObject({ label: 'HD-001 — Mới', status: 'Hiệu lực', code: 'HD-001' });
  });

  it('xoá công việc thì liên kết của nó đi theo (trigger); gỡ liên kết là xoá dòng', async () => {
    await pool.query(`DELETE FROM workspace_schema.work_items WHERE id = $1`, [workItemId]);
    const left = await store.listByProject('t', projectId);
    expect(left.map((row) => row.entityType)).toEqual(['project']);
    const raw = await pool.query(`SELECT count(*)::int AS n FROM workspace_schema.related_objects WHERE entity_type = 'work_item'`);
    expect(raw.rows[0].n).toBe(0);
    await store.remove('t', left[0]!.id);
    expect(await store.listByProject('t', projectId)).toEqual([]);
  });

  it('xoá dự án thì liên kết đi theo (khoá ngoại)', async () => {
    await store.upsert('t', { ...base, entityType: 'project', entityId: projectId, objectId: 'c-3' });
    await pool.query(`DELETE FROM workspace_schema.projects WHERE id = $1`, [projectId]);
    const raw = await pool.query(`SELECT count(*)::int AS n FROM workspace_schema.related_objects`);
    expect(raw.rows[0].n).toBe(0);
  });
});
