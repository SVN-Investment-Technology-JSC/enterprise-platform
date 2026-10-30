import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { createProjectWithInitialTasks } from '../application/project-initial-tasks.js';
import { ProjectService } from '../application/project.service.js';
import { WorkItemService } from '../application/work-item.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { PostgresWorkspaceStore } from './postgres-workspace-store.js';

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

/** Điều kiện hoàn thành công việc: SQL thật và luồng hoàn thành qua WorkItemService (PostgreSQL). */
integration('Workspace: điều kiện hoàn thành công việc (PostgreSQL)', () => {
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
  let service: WorkItemService;
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
    service = new WorkItemService(store, new ProjectService(store));
    const project = await store.project.create(tenantId, owner, { code: 'QA-DK', name: 'Dự án điều kiện' } as never);
    projectId = project.id;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const create = (title: string, extra: Record<string, unknown> = {}) =>
    service.create(actor, { projectId, title, assigneeUserId: owner, ...extra } as never);
  const start = (id: string) => service.changeStatus(actor, id, { status: 'in_progress' });

  it('tạo việc kèm điều kiện: đọc lại đủ quy tắc và thứ tự', async () => {
    const created = await create('Nghiệm thu', {
      completion: {
        rule: 'at_least',
        minRequired: 1,
        conditions: [{ label: 'Biên bản' }, { label: '  Hoá đơn ' }, { label: '' }],
      },
    });
    expect(created.completion?.rule).toBe('at_least');
    expect(created.completion?.minRequired).toBe(1);
    expect(created.completion?.conditions.map((condition) => condition.label)).toEqual(['Biên bản', 'Hoá đơn']);
    const reread = await store.workItem.findById(tenantId, created.id);
    expect(reread?.completion?.conditions).toHaveLength(2);
  });

  it('việc không đặt điều kiện không có completion và hoàn thành chỉ cần xác nhận', async () => {
    const plain = await create('Việc thường');
    expect(plain.completion).toBeUndefined();
    await start(plain.id);
    const done = await service.changeStatus(actor, plain.id, { status: 'done' });
    expect(done.status).toBe('done');
  });

  it('all: thiếu điều kiện bị chặn, đủ thì hoàn thành và nhật ký giữ bằng chứng', async () => {
    const created = await create('Đủ cả hai', {
      completion: { rule: 'all', conditions: [{ label: 'Biên bản' }, { label: 'Hoá đơn' }] },
    });
    await start(created.id);
    const [first, second] = created.completion?.conditions ?? [];
    await expect(
      service.changeStatus(actor, created.id, { status: 'done', confirmedConditionIds: [first?.id as string] }),
    ).rejects.toMatchObject({ code: 'COMPLETION_CONDITIONS_UNMET' });
    expect((await store.workItem.findById(tenantId, created.id))?.status).toBe('in_progress');

    const done = await service.changeStatus(actor, created.id, {
      status: 'done',
      confirmedConditionIds: [first?.id as string, second?.id as string],
    });
    expect(done.status).toBe('done');
    const history = await store.history.listByWorkItem(tenantId, created.id, 20);
    const entry = history.find((row) => row.toStatus === 'done');
    expect(entry?.completionEvidence?.conditions.map((condition) => condition.confirmed)).toEqual([true, true]);
  });

  it('at_least 1: một điều kiện là đủ; none: không tích gì vẫn hoàn thành', async () => {
    const one = await create('Một là đủ', {
      completion: { rule: 'at_least', minRequired: 1, conditions: [{ label: 'A' }, { label: 'B' }] },
    });
    await start(one.id);
    await service.changeStatus(actor, one.id, {
      status: 'done',
      confirmedConditionIds: [one.completion?.conditions[1]?.id as string],
    });

    const none = await create('Không bắt buộc', {
      completion: { rule: 'none', conditions: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] },
    });
    await start(none.id);
    const done = await service.changeStatus(actor, none.id, { status: 'done' });
    expect(done.status).toBe('done');
    const entry = (await store.history.listByWorkItem(tenantId, none.id, 20)).find((row) => row.toStatus === 'done');
    expect(entry?.completionEvidence?.conditions.every((condition) => !condition.confirmed)).toBe(true);
  });

  it('sửa điều kiện: giữ id điều kiện còn lại, xoá bớt, thêm mới; null thì bỏ hết', async () => {
    const created = await create('Sửa điều kiện', {
      completion: { rule: 'all', conditions: [{ label: 'A' }, { label: 'B' }] },
    });
    const [a] = created.completion?.conditions ?? [];
    const updated = await service.update(actor, created.id, {
      completion: {
        rule: 'at_least',
        minRequired: 1,
        conditions: [{ id: a?.id, label: 'A đã sửa' }, { label: 'C mới' }],
      },
    });
    expect(updated.completion?.rule).toBe('at_least');
    expect(updated.completion?.conditions[0]).toEqual({ id: a?.id, label: 'A đã sửa' });
    expect(updated.completion?.conditions.map((condition) => condition.label)).toEqual(['A đã sửa', 'C mới']);

    const cleared = await service.update(actor, created.id, { completion: null });
    expect(cleared.completion).toBeUndefined();
    const row = await pool.query(`SELECT completion_rule, completion_min_required FROM workspace_schema.work_items WHERE id = $1`, [
      created.id,
    ]);
    expect(row.rows[0]).toEqual({ completion_rule: 'all', completion_min_required: null });
  });

  it('id điều kiện của việc khác hay đã bị xoá không làm sai danh sách: coi là điều kiện mới', async () => {
    const created = await create('Id lạ', { completion: { rule: 'all', conditions: [{ label: 'A' }] } });
    const updated = await service.update(actor, created.id, {
      completion: { rule: 'all', conditions: [{ id: randomUUID(), label: 'A' }] },
    });
    expect(updated.completion?.conditions).toHaveLength(1);
  });

  it('không sửa được điều kiện khi việc đã hoàn thành', async () => {
    const created = await create('Đã xong', { completion: { rule: 'none', conditions: [{ label: 'A' }] } });
    await start(created.id);
    await service.changeStatus(actor, created.id, { status: 'done' });
    await expect(
      service.update(actor, created.id, { completion: { rule: 'all', conditions: [{ label: 'A' }] } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('ràng buộc CHECK: at_least phải có số tối thiểu, quy tắc khác thì không', async () => {
    const created = await create('Check');
    await expect(
      pool.query(`UPDATE workspace_schema.work_items SET completion_rule = 'at_least' WHERE id = $1`, [created.id]),
    ).rejects.toThrow(/chk_work_items_completion_rule/);
    await expect(
      pool.query(`UPDATE workspace_schema.work_items SET completion_min_required = 2 WHERE id = $1`, [created.id]),
    ).rejects.toThrow(/chk_work_items_completion_rule/);
  });

  it('cha có điều kiện bắt buộc không tự hoàn thành khi con xong; cha thường thì có', async () => {
    const gated = await create('Cha có điều kiện', { completion: { rule: 'all', conditions: [{ label: 'Nghiệm thu' }] } });
    const gatedChild = await create('Con của cha có điều kiện', { parentId: gated.id });
    const plain = await create('Cha thường');
    const plainChild = await create('Con của cha thường', { parentId: plain.id });

    for (const child of [gatedChild, plainChild]) {
      await start(child.id);
      await service.changeStatus(actor, child.id, { status: 'done' });
    }
    expect((await store.workItem.findById(tenantId, plain.id))?.status).toBe('done');
    expect((await store.workItem.findById(tenantId, gated.id))?.status).not.toBe('done');

    const rows = await store.workItem.progressRows(tenantId, projectId);
    expect(rows.find((row) => row.id === gated.id)?.requiresConfirmation).toBe(true);
    expect(rows.find((row) => row.id === plain.id)?.requiresConfirmation).toBe(false);
  });

  it('quy định hoàn tác: lưu, đọc lại, sửa; mặc định assignee; CHECK chặn giá trị lạ', async () => {
    const plain = await create('Mặc định');
    expect(plain.reopenPolicy).toBe('assignee');
    const locked = await create('Khoá', { reopenPolicy: 'none' });
    expect((await store.workItem.findById(tenantId, locked.id))?.reopenPolicy).toBe('none');
    const changed = await service.update(actor, locked.id, { reopenPolicy: 'manager' });
    expect(changed.reopenPolicy).toBe('manager');
    await expect(
      pool.query(`UPDATE workspace_schema.work_items SET reopen_policy = 'bậy' WHERE id = $1`, [locked.id]),
    ).rejects.toThrow(/chk_work_items_reopen_policy/);
  });

  it('hoàn tác: "none" chặn, mặc định cho phép và đưa dự án Hoàn thành về Đang chạy', async () => {
    const locked = await create('Không hoàn tác', { reopenPolicy: 'none' });
    await start(locked.id);
    await service.changeStatus(actor, locked.id, { status: 'done' });
    await expect(service.changeStatus(actor, locked.id, { status: 'in_progress' })).rejects.toMatchObject({
      code: 'REOPEN_NOT_ALLOWED',
    });

    const open = await create('Hoàn tác được');
    await start(open.id);
    await service.changeStatus(actor, open.id, { status: 'done' });
    // Dự án chỉ chốt sổ được khi hết việc mở: tạm ép trạng thái để kiểm nhánh "dự án đã Hoàn thành" (chưa lưu trữ, vì
    // dự án đã lưu trữ chỉ xem và không cho hoàn tác việc).
    await pool.query(`UPDATE workspace_schema.projects SET status = 'completed', archived_at = NULL WHERE id = $1`, [
      projectId,
    ]);
    await service.changeStatus(actor, open.id, { status: 'in_progress' });
    const project = await pool.query(`SELECT status, archived_at FROM workspace_schema.projects WHERE id = $1`, [projectId]);
    expect(project.rows[0]).toEqual({ status: 'active', archived_at: null });
  });

  it('thêm việc con dưới cha đã xong: từ chối, rồi mở lại cha khi chọn reopenParent', async () => {
    const parent = await create('Cha đã xong');
    await start(parent.id);
    await service.changeStatus(actor, parent.id, { status: 'done' });
    await expect(create('Con', { parentId: parent.id })).rejects.toMatchObject({ code: 'PARENT_ITEM_DONE' });
    const child = await create('Con', { parentId: parent.id, reopenParent: true });
    expect(child.parentId).toBe(parent.id);
    expect((await store.workItem.findById(tenantId, parent.id))?.status).toBe('in_progress');
  });

  it('dự án đã lưu trữ chỉ xem: không tạo việc, không đổi trạng thái dự án; mở lưu trữ thì ghi lại được', async () => {
    const projects = new ProjectService(store);
    const own = { ...actor, isTenantAdmin: true };
    const other = await store.project.create(tenantId, owner, { code: 'QA-LT', name: 'Dự án lưu trữ' } as never);
    await projects.archive(own, other.id);
    await expect(
      service.create(own, { projectId: other.id, title: 'Việc mới' } as never),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(projects.update(own, other.id, { status: 'active' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    const still = await pool.query(`SELECT archived_at IS NOT NULL AS archived FROM workspace_schema.projects WHERE id = $1`, [
      other.id,
    ]);
    expect(still.rows[0]).toEqual({ archived: true });

    await projects.unarchive(own, other.id);
    const created = await service.create(own, { projectId: other.id, title: 'Việc mới' } as never);
    expect(created.projectId).toBe(other.id);
  });

  it('tạo dự án kèm công việc tạo sẵn: đúng thứ tự, mã tăng dần, cấp gốc, chưa giao ai', async () => {
    const result = await createProjectWithInitialTasks(new ProjectService(store), service, actor, {
      code: 'QA-MAU',
      name: 'Dự án có mẫu',
      initialTasks: ['Hợp đồng', 'Triển khai', 'Chi phí thực hiện', 'Nghiệm thu hoàn thành'],
    });
    expect(result.initialTasks).toEqual({ created: 4, failed: 0 });
    const items = await store.workItem.listByProject(tenantId, result.id);
    expect(items.map((entry) => entry.title)).toEqual([
      'Hợp đồng',
      'Triển khai',
      'Chi phí thực hiện',
      'Nghiệm thu hoàn thành',
    ]);
    expect(items.map((entry) => entry.code)).toEqual(['CV001', 'CV002', 'CV003', 'CV004']);
    expect(items.every((entry) => !entry.parentId && !entry.assigneeUserId && entry.status === 'todo')).toBe(true);
    expect(items.map((entry) => entry.sortOrder)).toEqual([...items.map((entry) => entry.sortOrder)].sort((a, b) => a - b));

    const empty = await createProjectWithInitialTasks(new ProjectService(store), service, actor, {
      code: 'QA-TRONG',
      name: 'Dự án trống',
      initialTasks: [],
    });
    expect(await store.workItem.listByProject(tenantId, empty.id)).toHaveLength(0);
  });

  it('hoàn thành thì tiến độ 100%, hoàn tác thì về 0% (việc lá và việc có con)', async () => {
    const progressOf = async (id: string) => (await store.workItem.findById(tenantId, id))?.progressPercent;

    const leaf = await create('Tiến độ việc lá');
    await start(leaf.id);
    await service.changeStatus(actor, leaf.id, { status: 'done' });
    expect(await progressOf(leaf.id)).toBe(100);
    await service.changeStatus(actor, leaf.id, { status: 'in_progress' });
    expect(await progressOf(leaf.id)).toBe(0);

    const parent = await create('Cha tiến độ');
    const child = await create('Con tiến độ', { parentId: parent.id });
    await start(child.id);
    await service.changeStatus(actor, child.id, { status: 'done' });
    expect(await progressOf(parent.id)).toBe(100);
    await service.changeStatus(actor, child.id, { status: 'in_progress' });
    expect(await progressOf(child.id)).toBe(0);
    expect(await progressOf(parent.id)).toBe(0);
    expect((await store.workItem.findById(tenantId, parent.id))?.status).toBe('in_progress');
  });

  it('xoá việc kéo theo xoá điều kiện (ON DELETE CASCADE)', async () => {
    const created = await create('Xoá', { completion: { rule: 'all', conditions: [{ label: 'A' }] } });
    await pool.query(`DELETE FROM workspace_schema.work_items WHERE id = $1`, [created.id]);
    const left = await pool.query(
      `SELECT 1 FROM workspace_schema.work_item_completion_conditions WHERE work_item_id = $1`,
      [created.id],
    );
    expect(left.rowCount).toBe(0);
  });
});
