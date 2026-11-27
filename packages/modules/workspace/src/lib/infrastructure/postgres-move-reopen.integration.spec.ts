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

/** Chuyển việc chưa xong vào cha đã hoàn thành: mở lại cha, tính lại tiến độ, báo người thực hiện (PostgreSQL thật). */
integration('Workspace: di chuyển công việc vào cha đã hoàn thành (PostgreSQL)', () => {
  const databaseName = 'ws_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const [owner, alice, bob, member] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const actorOf = (userId: string, displayName: string): WorkspaceActor => ({
    tenantId,
    userId,
    displayName,
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
  });
  const manager = actorOf(owner, 'Chủ nhiệm');
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
    projectId = (await store.project.create(tenantId, owner, { code: 'QA-MV', name: 'Dự án di chuyển' } as never)).id;
    await store.member.replaceAll(tenantId, projectId, owner, [
      { userId: owner, role: 'owner' },
      { userId: alice, role: 'member' },
      { userId: bob, role: 'member' },
      { userId: member, role: 'member' },
    ]);
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
    service.create(manager, { projectId, title, ...extra } as never);
  const status = async (id: string) => (await store.workItem.findById(tenantId, id))?.status;
  const get = async (id: string) => (await store.workItem.findById(tenantId, id)) as NonNullable<Awaited<ReturnType<typeof store.workItem.findById>>>;
  /** Tạo việc rồi đưa về Hoàn thành (qua Đang làm, như người dùng làm). */
  const finished = async (title: string, extra: Record<string, unknown> = {}) => {
    const created = await create(title, extra);
    await service.changeStatus(manager, created.id, { status: 'in_progress' });
    await service.changeStatus(manager, created.id, { status: 'done' });
    return created;
  };
  const reopenedEvents = async (workItemId: string) =>
    (
      await pool.query(
        `SELECT payload->'payload' AS payload FROM integration_schema.outbox_events
          WHERE event_type = 'workspace.work-item.reopened' AND aggregate_id = $1
          ORDER BY occurred_at`,
        [workItemId],
      )
    ).rows.map((row) => row.payload as Record<string, unknown>);

  it('chưa đồng ý mở lại: bị từ chối, cha và việc chuyển đều giữ nguyên, không phát thông báo', async () => {
    const parent = await finished('Cha A', { assigneeUserId: alice });
    const child = await create('Con A');
    await expect(service.move(manager, child.id, { parentId: parent.id })).rejects.toMatchObject({
      code: 'PARENT_ITEM_DONE',
    });
    expect(await status(parent.id)).toBe('done');
    expect((await get(child.id)).parentId).toBeUndefined();
    expect(await reopenedEvents(parent.id)).toEqual([]);
  });

  it('đồng ý mở lại: việc vào dưới cha, cha về Đang làm, tiến độ tính lại, nhật ký có lý do, người thực hiện nhận thông báo', async () => {
    const parent = await create('Cha B', { assigneeUserId: alice, participantUserIds: [bob] });
    const doneChild = await finished('Con đã xong B', { parentId: parent.id, assigneeUserId: alice });
    await service.changeStatus(manager, parent.id, { status: 'in_progress' }).catch(() => undefined);
    await service.changeStatus(manager, parent.id, { status: 'done' });
    expect(await status(parent.id)).toBe('done');
    expect((await get(parent.id)).progressPercent).toBe(100);

    const incoming = await create('Con mới B', { assigneeUserId: bob });
    expect(doneChild.id).toBeDefined();
    await service.move(manager, incoming.id, { parentId: parent.id, reopenParent: true });

    const reopened = await get(parent.id);
    expect(reopened.status).toBe('in_progress');
    // 1 việc con đã xong + 1 việc con mới chưa làm: tiến độ cha không còn 100%.
    expect(reopened.progressPercent).toBeLessThan(100);
    expect(reopened.progressPercent).toBeGreaterThan(0);
    expect((await get(incoming.id)).parentId).toBe(parent.id);

    const history = await store.history.listByWorkItem(tenantId, parent.id, 20);
    const entry = history.find((row) => row.toStatus === 'in_progress' && row.fromStatus === 'done');
    expect(entry?.note).toContain(incoming.code);

    const events = await reopenedEvents(parent.id);
    expect(events).toHaveLength(1);
    const payload = events[0] as { recipientUserIds: string[]; reason: string; trigger: string; actorUserId: string };
    // Người giao (chủ nhiệm), người phụ trách và người cùng thực hiện đều được báo; không trùng.
    expect([...payload.recipientUserIds].sort()).toEqual([owner, alice, bob].sort());
    expect(payload.trigger).toBe('child-moved');
    expect(payload.actorUserId).toBe(owner);
    expect(payload.reason).toContain('Chủ nhiệm');
    expect(payload.reason).toContain(incoming.code);
    expect(payload.reason).toContain('Đang làm');
  });

  it('chuỗi cha đã xong: mở lại từng cấp từ ngoài vào trong, mỗi cấp một thông báo', async () => {
    const top = await create('Ông C', { assigneeUserId: alice });
    const mid = await create('Cha C', { parentId: top.id, assigneeUserId: bob });
    const leaf = await create('Lá C', { parentId: mid.id, assigneeUserId: bob });
    for (const node of [leaf, mid, top]) {
      await service.changeStatus(manager, node.id, { status: 'in_progress' }).catch(() => undefined);
      await service.changeStatus(manager, node.id, { status: 'done' });
    }
    expect([await status(top.id), await status(mid.id)]).toEqual(['done', 'done']);

    const incoming = await create('Con mới C');
    await service.move(manager, incoming.id, { parentId: mid.id, reopenParent: true });

    expect([await status(top.id), await status(mid.id)]).toEqual(['in_progress', 'in_progress']);
    expect(await reopenedEvents(top.id)).toHaveLength(1);
    expect(await reopenedEvents(mid.id)).toHaveLength(1);
    const topAt = (await store.history.listByWorkItem(tenantId, top.id, 20)).find((row) => row.fromStatus === 'done');
    const midAt = (await store.history.listByWorkItem(tenantId, mid.id, 20)).find((row) => row.fromStatus === 'done');
    expect(new Date(topAt?.createdAt as string).getTime()).toBeLessThanOrEqual(new Date(midAt?.createdAt as string).getTime());
  });

  it('cha cấm hoàn tác: từ chối trọn vẹn, không chuyển và không mở lại cấp nào', async () => {
    const top = await create('Ông D', { reopenPolicy: 'none' });
    const mid = await create('Cha D', { parentId: top.id });
    for (const node of [mid, top]) {
      await service.changeStatus(manager, node.id, { status: 'in_progress' }).catch(() => undefined);
      await service.changeStatus(manager, node.id, { status: 'done' });
    }
    const incoming = await create('Con mới D');
    await expect(service.move(manager, incoming.id, { parentId: mid.id, reopenParent: true })).rejects.toMatchObject({
      code: 'REOPEN_NOT_ALLOWED',
    });
    expect([await status(top.id), await status(mid.id)]).toEqual(['done', 'done']);
    expect((await get(incoming.id)).parentId).toBeUndefined();
    expect(await reopenedEvents(mid.id)).toEqual([]);
  });

  it('không cần mở lại: việc đã xong, việc đã huỷ, đích chưa xong và đưa lên gốc đều im lặng', async () => {
    const doneParent = await finished('Cha E');
    const doneChild = await finished('Con xong E');
    await service.move(manager, doneChild.id, { parentId: doneParent.id, reopenParent: true });
    const cancelled = await create('Con huỷ E');
    await service.changeStatus(manager, cancelled.id, { status: 'cancelled' });
    await service.move(manager, cancelled.id, { parentId: doneParent.id, reopenParent: true });
    expect(await status(doneParent.id)).toBe('done');

    const openParent = await create('Cha mở E');
    const incoming = await create('Con mới E');
    await service.move(manager, incoming.id, { parentId: openParent.id, reopenParent: true });
    await service.move(manager, incoming.id, { parentId: null, reopenParent: true });

    for (const id of [doneParent.id, openParent.id]) expect(await reopenedEvents(id)).toEqual([]);
    expect((await get(incoming.id)).parentId).toBeUndefined();
  });

  it('chỉ quản lý dự án mới chuyển được; thành viên thường bị chặn dù gửi reopenParent', async () => {
    const parent = await finished('Cha F');
    const incoming = await create('Con mới F');
    await expect(
      service.move(actorOf(member, 'Thành viên'), incoming.id, { parentId: parent.id, reopenParent: true }),
    ).rejects.toBeDefined();
    expect(await status(parent.id)).toBe('done');
    expect(await reopenedEvents(parent.id)).toEqual([]);
  });

  it('thêm việc con mới vào cha đã xong cũng báo người thực hiện (child-added)', async () => {
    const parent = await finished('Cha G', { assigneeUserId: alice });
    const child = await create('Con thêm G', { parentId: parent.id, reopenParent: true });
    expect(await status(parent.id)).toBe('in_progress');
    const events = await reopenedEvents(parent.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ trigger: 'child-added', childCode: child.code });
    expect((events[0] as { recipientUserIds: string[] }).recipientUserIds).toEqual(expect.arrayContaining([owner, alice]));
  });

  it('mở lại cha hai lần là hai thông báo riêng', async () => {
    const parent = await finished('Cha H', { assigneeUserId: alice });
    const first = await create('Con 1 H');
    await service.move(manager, first.id, { parentId: parent.id, reopenParent: true });
    await service.changeStatus(manager, first.id, { status: 'in_progress' }).catch(() => undefined);
    await service.changeStatus(manager, first.id, { status: 'done' });
    await service.changeStatus(manager, parent.id, { status: 'done' });
    const second = await create('Con 2 H');
    await service.move(manager, second.id, { parentId: parent.id, reopenParent: true });
    expect(await reopenedEvents(parent.id)).toHaveLength(2);
  });
});
