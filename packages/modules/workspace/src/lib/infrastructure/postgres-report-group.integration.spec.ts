import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { ProjectReportGroupService } from '../application/project-report-group.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { PostgresWorkspaceStore, reportGroupIdOf } from './postgres-workspace-store.js';

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

describe('reportGroupIdOf', () => {
  it('đọc metadata.reportGroupId; vắng, rỗng, sai kiểu là chưa phân nhóm', () => {
    expect(reportGroupIdOf({ reportGroupId: 'g1', other: 1 })).toBe('g1');
    expect(reportGroupIdOf({})).toBeNull();
    expect(reportGroupIdOf({ reportGroupId: '' })).toBeNull();
    expect(reportGroupIdOf({ reportGroupId: 5 })).toBeNull();
    expect(reportGroupIdOf(null)).toBeNull();
    expect(reportGroupIdOf(['g1'])).toBeNull();
  });
});

/** Nhóm báo cáo không cần migration: danh mục ở `workspace_settings`, nhóm của dự án ở `projects.metadata`. */
integration('Workspace: nhóm báo cáo (PostgreSQL)', () => {
  const databaseName = 'ws_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const adminUser = randomUUID();
  const outsider = randomUUID();
  const actor: WorkspaceActor = {
    tenantId,
    userId: adminUser,
    displayName: 'Quản trị',
    isTenantAdmin: true,
    canManage: true,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
  };
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let store: PostgresWorkspaceStore;
  let service: ProjectReportGroupService;
  let projectId: string;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    store = new PostgresWorkspaceStore(
      { require: () => ({}) } as never,
      { forTenant: async () => pool } as never,
    );
    service = new ProjectReportGroupService(store);
    projectId = (await store.project.create(tenantId, adminUser, { code: 'QA-RG', name: 'Dự án nhóm báo cáo' } as never))
      .id;
    // Khoá metadata khác (do nơi khác ghi) phải còn nguyên sau mọi lần gán / bỏ nhóm.
    await pool.query(
      `UPDATE workspace_schema.projects SET metadata = '{"legacy": {"a": 1}, "note": "giữ"}'::jsonb,
              updated_at = now() - interval '1 day'
        WHERE id = $1`,
      [projectId],
    );
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const metadataOf = async () =>
    (await pool.query(`SELECT metadata, updated_at FROM workspace_schema.projects WHERE id = $1`, [projectId]))
      .rows[0] as { metadata: Record<string, unknown>; updated_at: Date };

  it('danh mục lưu trong workspace_settings, giữ id khi sửa tên', async () => {
    const first = await service.save(actor, { items: [{ name: 'Dịch vụ' }, { name: 'Thí nghiệm' }] });
    expect(first.items.map((group) => group.name)).toEqual(['Dịch vụ', 'Thí nghiệm']);
    const [dv, tn] = first.items;
    const renamed = await service.save(actor, {
      items: [{ id: tn?.id, name: 'Thí nghiệm điện' }, { id: dv?.id, name: 'Dịch vụ' }, { name: 'O&M' }],
    });
    expect(renamed.items.slice(0, 2).map((group) => group.id)).toEqual([tn?.id, dv?.id]);
    const stored = await pool.query(
      `SELECT value FROM workspace_schema.workspace_settings WHERE key = 'project_report_groups'`,
    );
    expect(stored.rows[0]?.value).toEqual(renamed.items);
    expect((await service.list(actor)).items).toEqual(renamed.items);
  });

  it('gán và bỏ nhóm chỉ chạm metadata.reportGroupId, giữ các khoá khác, cập nhật updated_at', async () => {
    const [group] = (await service.list(actor)).items;
    const before = await metadataOf();
    const saved = await service.setForProject(actor, projectId, { reportGroupId: group?.id ?? null });
    expect(saved.reportGroupId).toBe(group?.id);
    const after = await metadataOf();
    expect(after.metadata).toEqual({ legacy: { a: 1 }, note: 'giữ', reportGroupId: group?.id });
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect((await store.project.findById(tenantId, projectId))?.reportGroupId).toBe(group?.id);
    const listed = await store.project.list(tenantId, { page: 1, pageSize: 10 });
    expect(listed.items.find((project) => project.id === projectId)?.reportGroupId).toBe(group?.id);

    const cleared = await service.setForProject(actor, projectId, { reportGroupId: null });
    expect(cleared.reportGroupId).toBeNull();
    expect((await metadataOf()).metadata).toEqual({ legacy: { a: 1 }, note: 'giữ' });
  });

  it('xoá nhóm khỏi danh mục thì dự án đang gán nhóm đó về chưa phân nhóm, khoá khác còn nguyên', async () => {
    const items = (await service.list(actor)).items;
    const target = items[1];
    await service.setForProject(actor, projectId, { reportGroupId: target?.id ?? null });
    await service.save(actor, { items: items.filter((group) => group.id !== target?.id) });
    expect((await metadataOf()).metadata).toEqual({ legacy: { a: 1 }, note: 'giữ' });
  });

  it('người ngoài dự án bị 403; dự án không có bị 404', async () => {
    const [group] = (await service.list(actor)).items;
    const stranger = { ...actor, userId: outsider, isTenantAdmin: false, canManage: false };
    await expect(service.setForProject(stranger, projectId, { reportGroupId: group?.id ?? null })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.setForProject(actor, randomUUID(), { reportGroupId: null })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('project-options và project-refs: một câu SQL, đúng phạm vi thành viên, bỏ dự án đã đóng', async () => {
    const member = randomUUID();
    expect((await store.project.openOptions(tenantId, member, true)).map((row) => row.id)).not.toContain(projectId);
    await store.member.replaceAll(tenantId, projectId, adminUser, [{ userId: member, role: 'member' }]);
    expect(await store.project.openOptions(tenantId, member, true)).toEqual(
      expect.arrayContaining([{ id: projectId, code: 'QA-RG', name: 'Dự án nhóm báo cáo', role: 'member' }]),
    );
    // Không lọc thành viên (quản trị): dự án vẫn có, vai của người không thuộc dự án thì vắng.
    const outsider = (await store.project.openOptions(tenantId, randomUUID(), false)).find((row) => row.id === projectId);
    expect(outsider).toEqual({ id: projectId, code: 'QA-RG', name: 'Dự án nhóm báo cáo' });

    expect(await store.project.refs(tenantId, [projectId], [])).toEqual({
      projects: [{ id: projectId, code: 'QA-RG', name: 'Dự án nhóm báo cáo' }],
      workItems: [],
    });

    await pool.query(`UPDATE workspace_schema.projects SET archived_at = now() WHERE id = $1`, [projectId]);
    expect((await store.project.openOptions(tenantId, member, true)).map((row) => row.id)).not.toContain(projectId);
    await pool.query(`UPDATE workspace_schema.projects SET archived_at = NULL WHERE id = $1`, [projectId]);
  });
});
