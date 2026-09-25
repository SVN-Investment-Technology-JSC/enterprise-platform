import type { ProjectRole, WorkItem, WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import { ProjectService } from './project.service.js';
import { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Store giả tối giản: chỉ hiện thực những nhánh mà các test dưới đây chạm
 * tới. Mục tiêu là kiểm luật nghiệp vụ, không kiểm SQL — phần SQL thuộc về
 * test tích hợp có cơ sở dữ liệu thật.
 */
function makeStore(options: {
  items: WorkItem[];
  roles: Record<string, ProjectRole>;
  dependencies?: { id: string; predecessorId: string; successorId: string; type: 'FS' | 'SS' }[];
}) {
  const calls: { changeStatus: { id: string; next: WorkItemStatus }[] } = { changeStatus: [] };
  const byId = new Map(options.items.map((item) => [item.id, item]));

  const store = {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' ? ({ id: 'p1', code: 'DA-1', name: 'Dự án' } as never) : undefined,
      rollup: async () => [],
      updateProgress: async () => undefined,
    },
    member: {
      roleOf: async (_tenant: string, _projectId: string, userId: string) =>
        options.roles[userId],
    },
    workItem: {
      findById: async (_tenant: string, id: string) => byId.get(id),
      listByProject: async () => options.items,
      progressRows: async () =>
        options.items.map((item) => ({
          id: item.id,
          parentId: item.parentId ?? null,
          status: item.status,
          progressPercent: item.progressPercent,
          estimateHours: item.estimateHours ?? null,
        })),
      openChildCount: async (_tenant: string, id: string) =>
        options.items.filter(
          (item) => item.parentId === id && item.status !== 'done' && item.status !== 'cancelled',
        ).length,
      applyProgress: async () => undefined,
      changeStatus: async (
        _tenant: string,
        id: string,
        _actor: string,
        next: WorkItemStatus,
      ) => {
        calls.changeStatus.push({ id, next });
        return { ...(byId.get(id) as WorkItem), status: next };
      },
    },
    dependency: {
      listBySuccessor: async (_tenant: string, successorId: string) =>
        (options.dependencies ?? [])
          .filter((edge) => edge.successorId === successorId)
          .map((edge) => ({ ...edge, dependencyType: edge.type, projectId: 'p1' })),
      listByProject: async () => options.dependencies ?? [],
    },
  } as unknown as WorkspaceStore;

  return { store, calls };
}

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: 'CV-001',
    title: 'Việc',
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u-owner',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const actorOf = (userId: string, isTenantAdmin = false): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

function serviceFor(store: WorkspaceStore) {
  return new WorkItemService(store, new ProjectService(store));
}

describe('WorkItemService.changeStatus', () => {
  it('member không đổi được trạng thái việc của người khác', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1', assigneeUserId: 'u-other' })],
      roles: { 'u-member': 'member' },
    });
    await expect(
      serviceFor(store).changeStatus(actorOf('u-member'), 'w1', { status: 'in_progress' }),
    ).rejects.toMatchObject({ code: 'WORK_ITEM_ASSIGNEE_ONLY' });
  });

  it('manager đổi được trạng thái việc của người khác', async () => {
    const { store, calls } = makeStore({
      items: [item({ id: 'w1', assigneeUserId: 'u-other' })],
      roles: { 'u-mgr': 'manager' },
    });
    await serviceFor(store).changeStatus(actorOf('u-mgr'), 'w1', { status: 'in_progress' });
    expect(calls.changeStatus).toEqual([{ id: 'w1', next: 'in_progress' }]);
  });

  it('viewer bị chặn kể cả với việc gán cho chính mình', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1', assigneeUserId: 'u-view' })],
      roles: { 'u-view': 'viewer' },
    });
    await expect(
      serviceFor(store).changeStatus(actorOf('u-view'), 'w1', { status: 'in_progress' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
  });

  it('không nhảy thẳng từ todo sang done', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1', assigneeUserId: 'u1' })],
      roles: { u1: 'member' },
    });
    await expect(
      serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'done' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('còn việc con chưa đóng thì không đóng được node cha', async () => {
    const { store } = makeStore({
      items: [
        item({ id: 'w1', status: 'in_progress', assigneeUserId: 'u1' }),
        item({ id: 'w2', parentId: 'w1', status: 'todo' }),
      ],
      roles: { u1: 'manager' },
    });
    await expect(
      serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'done' }),
    ).rejects.toMatchObject({ code: 'CHILD_INCOMPLETE' });
  });

  it('tiền nhiệm FS chưa xong thì chặn hoàn thành', async () => {
    const { store } = makeStore({
      items: [
        item({ id: 'w1', status: 'in_progress', assigneeUserId: 'u1' }),
        item({ id: 'w0', code: 'CV-000', status: 'in_progress' }),
      ],
      roles: { u1: 'manager' },
      dependencies: [{ id: 'd1', predecessorId: 'w0', successorId: 'w1', type: 'FS' }],
    });
    await expect(
      serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'done' }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_BLOCKED' });
  });

  it('tiền nhiệm kiểu SS chỉ cảnh báo lịch, không chặn', async () => {
    const { store, calls } = makeStore({
      items: [
        item({ id: 'w1', status: 'in_progress', assigneeUserId: 'u1' }),
        item({ id: 'w0', code: 'CV-000', status: 'in_progress' }),
      ],
      roles: { u1: 'manager' },
      dependencies: [{ id: 'd1', predecessorId: 'w0', successorId: 'w1', type: 'SS' }],
    });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'done' });
    expect(calls.changeStatus).toEqual([{ id: 'w1', next: 'done' }]);
  });

  it('mở lại việc đã done thì không kiểm việc con', async () => {
    const { store, calls } = makeStore({
      items: [
        item({ id: 'w1', status: 'done', assigneeUserId: 'u1' }),
        item({ id: 'w2', parentId: 'w1', status: 'todo' }),
      ],
      roles: { u1: 'manager' },
    });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'in_progress' });
    expect(calls.changeStatus).toEqual([{ id: 'w1', next: 'in_progress' }]);
  });

  it('đặt lại đúng trạng thái đang có thì không ghi gì', async () => {
    const { store, calls } = makeStore({
      items: [item({ id: 'w1', status: 'todo', assigneeUserId: 'u1' })],
      roles: { u1: 'member' },
    });
    await serviceFor(store).changeStatus(actorOf('u1'), 'w1', { status: 'todo' });
    expect(calls.changeStatus).toEqual([]);
  });
});

describe('WorkItemService — quyền truy cập dự án', () => {
  it('người ngoài dự án nhận 403 chứ không phải danh sách rỗng', async () => {
    const { store } = makeStore({ items: [], roles: {} });
    await expect(serviceFor(store).tree(actorOf('u-nguoi-la'), 'p1')).rejects.toMatchObject({
      code: 'PROJECT_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('tenant-admin xem được dự án mình không tham gia', async () => {
    const { store } = makeStore({ items: [item({ id: 'w1' })], roles: {} });
    await expect(serviceFor(store).tree(actorOf('u-admin', true), 'p1')).resolves.toMatchObject({
      items: [{ id: 'w1' }],
    });
  });

  it('dự án không tồn tại thì 404, không phải 403', async () => {
    const { store } = makeStore({ items: [], roles: {} });
    await expect(serviceFor(store).tree(actorOf('u1'), 'khong-co')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('WorkItemService.addDependency', () => {
  it('chặn cạnh tạo chu trình', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1' }), item({ id: 'w2', code: 'CV-002' })],
      roles: { u1: 'manager' },
      dependencies: [{ id: 'd1', predecessorId: 'w1', successorId: 'w2', type: 'FS' }],
    });
    await expect(
      serviceFor(store).addDependency(actorOf('u1'), 'w1', { predecessorId: 'w2' }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
  });

  it('member không đủ thẩm quyền thêm phụ thuộc', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1' }), item({ id: 'w2', code: 'CV-002' })],
      roles: { u1: 'member' },
    });
    await expect(
      serviceFor(store).addDependency(actorOf('u1'), 'w1', { predecessorId: 'w2' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
  });
});

describe('WorkItemService — giao việc', () => {
  function storeFor(roles: Record<string, ProjectRole>, items: WorkItem[] = []) {
    const created: unknown[] = [];
    const updated: unknown[] = [];
    const store = {
      project: {
        findById: async () => ({ id: 'p1', code: 'DA-1', name: 'Dự án' }),
        updateProgress: async () => undefined,
      },
      member: {
        roleOf: async (_tenant: string, _project: string, userId: string) => roles[userId],
      },
      workItem: {
        findById: async (_tenant: string, id: string) => items.find((entry) => entry.id === id),
        listByProject: async () => items,
        progressRows: async () => [],
        applyProgress: async () => undefined,
        create: async (_tenant: string, _actor: string, input: unknown) => {
          created.push(input);
          return { id: 'w-new' };
        },
        update: async (_tenant: string, _id: string, input: unknown) => {
          updated.push(input);
          return { id: 'w1' };
        },
      },
    } as unknown as WorkspaceStore;
    return { store, created, updated };
  }

  it('không giao được cho người ngoài dự án', async () => {
    const { store } = storeFor({ 'u-mgr': 'manager' });
    await expect(
      serviceFor(store).create(actorOf('u-mgr'), {
        projectId: 'p1',
        title: 'Việc',
        assigneeUserId: 'u-nguoi-ngoai',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('member tự nhận việc cho mình được', async () => {
    const { store, created } = storeFor({ 'u-mem': 'member' });
    await serviceFor(store).create(actorOf('u-mem'), {
      projectId: 'p1',
      title: 'Việc',
      assigneeUserId: 'u-mem',
    });
    expect(created).toHaveLength(1);
  });

  it('member không giao việc cho người khác', async () => {
    const { store } = storeFor({ 'u-mem': 'member', 'u-khac': 'member' });
    await expect(
      serviceFor(store).create(actorOf('u-mem'), {
        projectId: 'p1',
        title: 'Việc',
        assigneeUserId: 'u-khac',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
  });

  it('member sửa việc của mình nhưng không đẩy được nó sang người khác', async () => {
    const { store, updated } = storeFor(
      { 'u-mem': 'member', 'u-khac': 'member' },
      [item({ id: 'w1', assigneeUserId: 'u-mem' })],
    );
    await expect(
      serviceFor(store).update(actorOf('u-mem'), 'w1', { assigneeUserId: 'u-khac' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
    // Sửa tiêu đề thì vẫn được.
    await serviceFor(store).update(actorOf('u-mem'), 'w1', { title: 'Tên mới' });
    expect(updated).toHaveLength(1);
  });
});
