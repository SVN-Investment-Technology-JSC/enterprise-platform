import type {
  ProjectRole,
  ProjectStatus,
  WorkItem,
  WorkItemReopenPolicy,
  WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
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

function makeStore(options: {
  items: WorkItem[];
  roles: Record<string, ProjectRole>;
  projectStatus?: ProjectStatus;
  /** Giá trị `workspace_settings` theo khoá. */
  settings?: Record<string, unknown>;
}) {
  const statusChanges: { id: string; next: WorkItemStatus; note?: string }[] = [];
  const projectUpdates: unknown[] = [];
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const store = {
    project: {
      findById: async () => ({
        id: 'p1',
        code: 'DA-1',
        name: 'Dự án',
        status: options.projectStatus ?? 'active',
      }),
      update: async (_tenant: string, _id: string, patch: unknown) => {
        projectUpdates.push(patch);
        return {};
      },
      updateProgress: async () => undefined,
    },
    member: { roleOf: async (_t: string, _p: string, userId: string) => options.roles[userId] },
    settings: { get: async (_t: string, key: string) => options.settings?.[key] },
    workItem: {
      findById: async (_t: string, id: string) => options.items.find((entry) => entry.id === id),
      listByProject: async () => options.items,
      progressRows: async () => [],
      applyProgress: async () => undefined,
      openChildCount: async () => 0,
      changeStatus: async (_t: string, id: string, _a: string, next: WorkItemStatus, note?: string) => {
        statusChanges.push({ id, next, note });
        return { ...(options.items.find((entry) => entry.id === id) as WorkItem), status: next };
      },
      create: async (_t: string, _a: string, input: Record<string, unknown>) => {
        created.push(input);
        return { id: 'w-new', code: 'CV099' };
      },
      update: async (_t: string, _id: string, input: Record<string, unknown>) => {
        updated.push(input);
        return { id: 'w1' };
      },
    },
    dependency: { listBySuccessor: async () => [] },
  } as unknown as WorkspaceStore;
  return { store, statusChanges, projectUpdates, created, updated };
}

const serviceFor = (store: WorkspaceStore) => new WorkItemService(store, new ProjectService(store));

describe('Hoàn tác công việc đã hoàn thành', () => {
  const done = (policy?: WorkItemReopenPolicy) =>
    item({ id: 'w1', status: 'done', assigneeUserId: 'u1', reopenPolicy: policy });

  it('mặc định người phụ trách hoàn tác được', async () => {
    const { store, statusChanges } = makeStore({ items: [done()], roles: { u1: 'member' } });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'in_progress' });
    expect(statusChanges).toEqual([expect.objectContaining({ id: 'w1', next: 'in_progress' })]);
  });

  it('"none": không ai hoàn tác được, kể cả quản lý', async () => {
    const { store, statusChanges } = makeStore({
      items: [done('none')],
      roles: { u1: 'member', mgr: 'manager' },
    });
    for (const userId of ['u1', 'mgr']) {
      await expect(
        serviceFor(store).changeStatus(actorOf(userId), 'w1', { status: 'in_progress' }),
      ).rejects.toMatchObject({ code: 'REOPEN_NOT_ALLOWED' });
    }
    expect(statusChanges).toEqual([]);
  });

  it('"manager": người phụ trách bị chặn, quản lý được', async () => {
    const { store, statusChanges } = makeStore({
      items: [done('manager')],
      roles: { u1: 'member', mgr: 'manager' },
    });
    await expect(
      serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'in_progress' }),
    ).rejects.toMatchObject({ code: 'REOPEN_NOT_ALLOWED' });
    await serviceFor(store).changeStatus(actorOf('mgr'), 'w1', { status: 'in_progress' });
    expect(statusChanges).toHaveLength(1);
  });

  it('dự án Hoàn thành: mặc định về Đang chạy', async () => {
    const { store, projectUpdates } = makeStore({
      items: [done()],
      roles: { u1: 'member' },
      projectStatus: 'completed',
    });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'in_progress' });
    expect(projectUpdates).toEqual([{ status: 'active' }]);
  });

  it('dự án Hoàn thành: cài đặt "giữ nguyên" thì không đổi trạng thái dự án', async () => {
    const { store, projectUpdates } = makeStore({
      items: [done()],
      roles: { u1: 'member' },
      projectStatus: 'completed',
      settings: { project_reopen_policy: { policy: 'keep' } },
    });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'in_progress' });
    expect(projectUpdates).toEqual([]);
  });

  it('dự án đang chạy thì không bị đụng tới', async () => {
    const { store, projectUpdates } = makeStore({ items: [done()], roles: { u1: 'member' } });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'in_progress' });
    expect(projectUpdates).toEqual([]);
  });

  it('người tạo đặt quy định khi tạo; giá trị lạ về mặc định', async () => {
    const { store, created } = makeStore({ items: [], roles: { u1: 'member' } });
    await serviceFor(store).create(actorOf('u1'), { projectId: 'p1', title: 'A', reopenPolicy: 'none' });
    await serviceFor(store).create(actorOf('u1'), {
      projectId: 'p1',
      title: 'B',
      reopenPolicy: 'bậy' as never,
    });
    expect(created.map((input) => input.reopenPolicy)).toEqual(['none', 'assignee']);
  });

  it('người phụ trách (không phải người tạo) không đổi được quy định; người tạo đổi được', async () => {
    const todo = item({ id: 'w1', assigneeUserId: 'u1', createdBy: 'u-creator' });
    const { store, updated } = makeStore({
      items: [todo],
      roles: { u1: 'member', 'u-creator': 'member' },
    });
    await expect(
      serviceFor(store).update(actorOf('u1'), 'w1', { reopenPolicy: 'assignee' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
    // Người tạo là member nhưng không phụ trách: bị chặn ở luật sửa việc, nên dùng quản lý.
    const mgr = makeStore({ items: [todo], roles: { mgr: 'manager' } });
    await serviceFor(mgr.store).update(actorOf('mgr'), 'w1', { reopenPolicy: 'none' });
    expect(mgr.updated).toEqual([expect.objectContaining({ reopenPolicy: 'none' })]);
    expect(updated).toEqual([]);
  });

  it('việc đã hoàn thành không đổi được quy định hoàn tác', async () => {
    const { store } = makeStore({ items: [done('none')], roles: { mgr: 'manager' } });
    await expect(
      serviceFor(store).update(actorOf('mgr'), 'w1', { reopenPolicy: 'assignee' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('Tạo việc con dưới công việc đã hoàn thành', () => {
  const parent = (overrides: Partial<WorkItem> = {}) =>
    item({ id: 'w1', code: 'CV001', status: 'done', assigneeUserId: 'u1', ...overrides });

  it('không chọn mở lại cha thì bị từ chối và không ghi gì', async () => {
    const { store, created, statusChanges } = makeStore({ items: [parent()], roles: { u1: 'member' } });
    await expect(
      serviceFor(store).create(actorOf('u1'), { projectId: 'p1', parentId: 'w1', title: 'Con' }),
    ).rejects.toMatchObject({ code: 'PARENT_ITEM_DONE' });
    expect(created).toEqual([]);
    expect(statusChanges).toEqual([]);
  });

  it('chọn mở lại cha: tạo việc con rồi đưa cha về Đang làm', async () => {
    const { store, created, statusChanges } = makeStore({ items: [parent()], roles: { u1: 'member' } });
    await serviceFor(store).create(actorOf('u1'), {
      projectId: 'p1',
      parentId: 'w1',
      title: 'Con',
      reopenParent: true,
    });
    expect(created).toHaveLength(1);
    expect(statusChanges).toEqual([expect.objectContaining({ id: 'w1', next: 'in_progress' })]);
  });

  it('mở lại cả chuỗi cha đã xong, từ ngoài vào trong', async () => {
    const { store, statusChanges } = makeStore({
      items: [
        parent({ id: 'w0', code: 'CV000', assigneeUserId: 'u1' }),
        parent({ id: 'w1', parentId: 'w0', depth: 1 }),
      ],
      roles: { u1: 'member' },
    });
    await serviceFor(store).create(actorOf('u1'), {
      projectId: 'p1',
      parentId: 'w1',
      title: 'Con',
      reopenParent: true,
    });
    expect(statusChanges.map((change) => change.id)).toEqual(['w0', 'w1']);
  });

  it('cha cấm hoàn tác thì không tạo được việc con', async () => {
    const { store, created, statusChanges } = makeStore({
      items: [parent({ reopenPolicy: 'none' })],
      roles: { u1: 'member' },
    });
    await expect(
      serviceFor(store).create(actorOf('u1'), {
        projectId: 'p1',
        parentId: 'w1',
        title: 'Con',
        reopenParent: true,
      }),
    ).rejects.toMatchObject({ code: 'REOPEN_NOT_ALLOWED' });
    expect(created).toEqual([]);
    expect(statusChanges).toEqual([]);
  });

  it('member không phụ trách cha thì không mở lại được cha để thêm con', async () => {
    const { store, created } = makeStore({
      items: [parent({ assigneeUserId: 'u-khac' })],
      roles: { u1: 'member', 'u-khac': 'member' },
    });
    await expect(
      serviceFor(store).create(actorOf('u1'), {
        projectId: 'p1',
        parentId: 'w1',
        title: 'Con',
        reopenParent: true,
      }),
    ).rejects.toMatchObject({ code: 'WORK_ITEM_ASSIGNEE_ONLY' });
    expect(created).toEqual([]);
  });

  it('dự án Hoàn thành cũng về Đang chạy khi mở lại cha', async () => {
    const { store, projectUpdates } = makeStore({
      items: [parent()],
      roles: { u1: 'member' },
      projectStatus: 'completed',
    });
    await serviceFor(store).create(actorOf('u1'), {
      projectId: 'p1',
      parentId: 'w1',
      title: 'Con',
      reopenParent: true,
    });
    expect(projectUpdates).toEqual([{ status: 'active' }]);
  });

  it('cha chưa xong thì tạo bình thường, không đụng tới cha', async () => {
    const { store, statusChanges } = makeStore({
      items: [parent({ status: 'in_progress' })],
      roles: { u1: 'member' },
    });
    await serviceFor(store).create(actorOf('u1'), { projectId: 'p1', parentId: 'w1', title: 'Con' });
    expect(statusChanges).toEqual([]);
  });
});

describe('Cài đặt dự án khi hoàn tác', () => {
  const admin = { ...actorOf('adm'), isTenantAdmin: true };

  it('lưu từng phần và đọc lại, mặc định là reactivate', async () => {
    const saved: Record<string, unknown> = {};
    const store = {
      settings: {
        get: async (_t: string, key: string) => saved[key],
        set: async (_t: string, key: string, value: unknown) => {
          saved[key] = value;
        },
      },
    } as unknown as WorkspaceStore;
    const projects = new ProjectService(store);
    expect((await projects.archiveSettings(admin)).reopenProject).toBe('reactivate');
    const next = await projects.saveArchiveSettings(admin, { reopenProject: 'keep' });
    expect(next.reopenProject).toBe('keep');
    expect(saved['project_auto_archive']).toBeUndefined();
  });

  it('giá trị lạ và người không có quyền bị từ chối', async () => {
    const store = { settings: { get: async () => undefined, set: async () => undefined } } as unknown as WorkspaceStore;
    const projects = new ProjectService(store);
    await expect(projects.saveArchiveSettings(admin, { reopenProject: 'bậy' as never })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(projects.saveArchiveSettings(actorOf('u1'), { reopenProject: 'keep' })).rejects.toMatchObject({
      code: 'PROJECT_FORBIDDEN',
    });
  });
});
