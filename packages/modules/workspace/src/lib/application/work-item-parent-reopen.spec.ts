import type { ProjectRole, WorkItem, WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import { ProjectService } from './project.service.js';
import { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: 'CV001',
    title: 'Việc',
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u-creator',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const actorOf = (userId: string): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

function makeStore(items: WorkItem[], roles: Record<string, ProjectRole>) {
  const statusChanges: { id: string; next: WorkItemStatus; notice?: Record<string, unknown> }[] = [];
  const moves: { id: string; parentId: string | null }[] = [];
  const created: Record<string, unknown>[] = [];
  const store = {
    project: {
      findById: async () => ({ id: 'p1', code: 'DA-1', name: 'Dự án', status: 'active' }),
      update: async () => ({}),
      updateProgress: async () => undefined,
    },
    member: { roleOf: async (_t: string, _p: string, userId: string) => roles[userId] },
    settings: { get: async () => undefined },
    procedureRequest: { listByProject: async () => [] },
    workItem: {
      findById: async (_t: string, id: string) => items.find((entry) => entry.id === id),
      listByProject: async () => items,
      progressRows: async () => [],
      applyProgress: async () => undefined,
      openChildCount: async () => 0,
      listProgressReports: async () => [],
      changeStatus: async (
        _t: string,
        id: string,
        _a: string,
        next: WorkItemStatus,
        _note?: string,
        _today?: string,
        _evidence?: unknown,
        notice?: Record<string, unknown>,
      ) => {
        statusChanges.push(notice ? { id, next, notice } : { id, next });
        return { ...(items.find((entry) => entry.id === id) as WorkItem), status: next };
      },
      move: async (_t: string, id: string, parentId: string | null) => {
        moves.push({ id, parentId });
        return items.find((entry) => entry.id === id) as WorkItem;
      },
      create: async (_t: string, _a: string, input: Record<string, unknown>) => {
        created.push(input);
        return { id: 'w-new', code: 'CV099' };
      },
    },
    dependency: { listBySuccessor: async () => [] },
  } as unknown as WorkspaceStore;
  return { store, statusChanges, moves, created };
}

const serviceFor = (store: WorkspaceStore) => new WorkItemService(store, new ProjectService(store));

describe('Hoàn tác việc con: mở lại các cha đã hoàn thành', () => {
  const tree = () => [
    item({ id: 'root', code: 'CV001', status: 'done' }),
    item({ id: 'mid', code: 'CV002', parentId: 'root', depth: 1, status: 'done' }),
    item({ id: 'leaf', code: 'CV003', parentId: 'mid', depth: 2, status: 'done', assigneeUserId: 'u1' }),
  ];

  it('hoàn tác việc lá thì các cha đã xong cũng về Đang làm, từ ngoài vào trong', async () => {
    const { store, statusChanges } = makeStore(tree(), { u1: 'member' });
    await serviceFor(store).changeStatus(actorOf('u1'), 'leaf', { status: 'in_progress' });
    expect(statusChanges).toEqual([
      { id: 'leaf', next: 'in_progress' },
      { id: 'root', next: 'in_progress' },
      { id: 'mid', next: 'in_progress' },
    ]);
  });

  it('dừng ở cha đầu tiên chưa xong', async () => {
    const items = tree();
    items[0] = item({ id: 'root', code: 'CV001', status: 'in_progress' });
    const { store, statusChanges } = makeStore(items, { u1: 'member' });
    await serviceFor(store).changeStatus(actorOf('u1'), 'leaf', { status: 'in_progress' });
    expect(statusChanges.map((change) => change.id)).toEqual(['leaf', 'mid']);
  });

  it('việc không có cha thì không đụng tới việc nào khác', async () => {
    const { store, statusChanges } = makeStore(
      [item({ id: 'solo', status: 'done', assigneeUserId: 'u1' })],
      { u1: 'member' },
    );
    await serviceFor(store).changeStatus(actorOf('u1'), 'solo', { status: 'in_progress' });
    expect(statusChanges).toEqual([{ id: 'solo', next: 'in_progress' }]);
  });
});

describe('Di chuyển công việc vào cha đã hoàn thành', () => {
  const items = () => [
    item({ id: 'parent', code: 'CV001', status: 'done' }),
    item({ id: 'open', code: 'CV002', status: 'in_progress' }),
    item({ id: 'finished', code: 'CV003', status: 'done' }),
  ];

  it('việc chưa xong bị từ chối, báo cần mở lại cha', async () => {
    const { store, moves } = makeStore(items(), { mgr: 'manager' });
    await expect(serviceFor(store).move(actorOf('mgr'), 'open', { parentId: 'parent' })).rejects.toMatchObject({
      code: 'PARENT_ITEM_DONE',
    });
    expect(moves).toEqual([]);
  });

  it('đồng ý mở lại: chuyển việc rồi đưa cha về Đang làm kèm thông báo nói rõ ai làm, vì sao', async () => {
    const { store, moves, statusChanges } = makeStore(items(), { mgr: 'manager' });
    await serviceFor(store).move(actorOf('mgr'), 'open', { parentId: 'parent', reopenParent: true });
    expect(moves).toEqual([{ id: 'open', parentId: 'parent' }]);
    expect(statusChanges).toEqual([
      {
        id: 'parent',
        next: 'in_progress',
        notice: expect.objectContaining({
          trigger: 'child-moved',
          childCode: 'CV002',
          reason: expect.stringContaining('mgr'),
        }),
      },
    ]);
  });

  it('chuỗi cha đã xong: mở từ ngoài vào trong, cha ngoài cùng cấm hoàn tác thì từ chối trước khi ghi', async () => {
    const chain = (policy?: 'none') => [
      item({ id: 'top', code: 'CV010', status: 'done', reopenPolicy: policy }),
      item({ id: 'mid', code: 'CV011', parentId: 'top', depth: 1, status: 'done' }),
      item({ id: 'open', code: 'CV012', status: 'todo' }),
    ];
    const ok = makeStore(chain(), { mgr: 'manager' });
    await serviceFor(ok.store).move(actorOf('mgr'), 'open', { parentId: 'mid', reopenParent: true });
    expect(ok.statusChanges.map((change) => change.id)).toEqual(['top', 'mid']);

    const blocked = makeStore(chain('none'), { mgr: 'manager' });
    await expect(
      serviceFor(blocked.store).move(actorOf('mgr'), 'open', { parentId: 'mid', reopenParent: true }),
    ).rejects.toMatchObject({ code: 'REOPEN_NOT_ALLOWED' });
    expect(blocked.moves).toEqual([]);
    expect(blocked.statusChanges).toEqual([]);
  });

  it('việc huỷ, đích chưa xong hoặc đưa lên gốc: không mở lại gì dù gửi reopenParent', async () => {
    const all = [
      item({ id: 'parent', code: 'CV001', status: 'done' }),
      item({ id: 'cancelled', code: 'CV004', status: 'cancelled' }),
      item({ id: 'live', code: 'CV005', status: 'in_progress' }),
      item({ id: 'open', code: 'CV002', status: 'todo' }),
    ];
    const { store, statusChanges, moves } = makeStore(all, { mgr: 'manager' });
    const service = serviceFor(store);
    await service.move(actorOf('mgr'), 'cancelled', { parentId: 'parent', reopenParent: true });
    await service.move(actorOf('mgr'), 'open', { parentId: 'live', reopenParent: true });
    await service.move(actorOf('mgr'), 'open', { parentId: null, reopenParent: true });
    expect(moves).toHaveLength(3);
    expect(statusChanges).toEqual([]);
  });

  it('thành viên thường không chuyển được dù đồng ý mở lại', async () => {
    const { store, moves, statusChanges } = makeStore(items(), { u1: 'member' });
    await expect(
      serviceFor(store).move(actorOf('u1'), 'open', { parentId: 'parent', reopenParent: true }),
    ).rejects.toBeDefined();
    expect(moves).toEqual([]);
    expect(statusChanges).toEqual([]);
  });

  it('việc đã xong chuyển vào cha đã xong thì được', async () => {
    const { store, moves } = makeStore(items(), { mgr: 'manager' });
    await serviceFor(store).move(actorOf('mgr'), 'finished', { parentId: 'parent' });
    expect(moves).toEqual([{ id: 'finished', parentId: 'parent' }]);
  });
});

describe('Việc do Quy trình nhờ tạo dưới cha đã hoàn thành', () => {
  it('vẫn tạo được như trước, không đòi mở lại cha', async () => {
    const { store, created, statusChanges } = makeStore(
      [item({ id: 'parent', code: 'CV001', status: 'done', assigneeUserId: 'u1' })],
      { u1: 'member' },
    );
    await serviceFor(store).create(
      actorOf('u1'),
      { projectId: 'p1', parentId: 'parent', title: 'Từ quy trình' },
      { instanceId: 'i1', instanceCode: 'HS-1', instanceStatus: 'open' },
    );
    expect(created).toHaveLength(1);
    expect(statusChanges).toEqual([]);
  });
});

describe('Quy định hoàn tác: người tạo việc', () => {
  it('người tạo (member, đồng thời phụ trách) đổi được quy định; người chỉ phụ trách thì không', async () => {
    const own = item({ id: 'w1', assigneeUserId: 'u1', createdBy: 'u1' });
    const store = makeStore([own], { u1: 'member' });
    const updated: Record<string, unknown>[] = [];
    (store.store.workItem as unknown as { update: unknown }).update = async (_t: string, _id: string, patch: Record<string, unknown>) => {
      updated.push(patch);
      return own;
    };
    await serviceFor(store.store).update(actorOf('u1'), 'w1', { reopenPolicy: 'none' });
    expect(updated).toEqual([expect.objectContaining({ reopenPolicy: 'none' })]);
  });

  it('quy định lạ bị từ chối', async () => {
    const { store } = makeStore([item({ id: 'w1', createdBy: 'mgr' })], { mgr: 'manager' });
    await expect(
      serviceFor(store).update(actorOf('mgr'), 'w1', { reopenPolicy: 'bậy' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
