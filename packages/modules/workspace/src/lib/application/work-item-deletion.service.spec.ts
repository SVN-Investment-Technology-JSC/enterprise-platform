import type { ProjectRole, WorkItem } from '@enterprise-platform/contracts-workspace';
import { ProjectRoleService } from './project-role.service.js';
import { ProjectService } from './project.service.js';
import { WorkItemDeletionService } from './work-item-deletion.service.js';
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
    createdBy: 'u-owner',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Store giả: chỉ những nhánh mà luật xoá hẳn chạm tới. */
function makeStore(items: WorkItem[], roles: Record<string, ProjectRole>) {
  const removed: string[] = [];
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const store = {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' ? ({ id: 'p1', code: 'DA-1', name: 'Dự án' } as never) : undefined,
      updateProgress: async () => undefined,
    },
    member: {
      roleOf: async (_tenant: string, _projectId: string, userId: string) => roles[userId],
    },
    workItem: {
      findById: async (_tenant: string, id: string) => byId.get(id),
      progressRows: async () => [],
      applyProgress: async () => undefined,
      remove: async (_tenant: string, id: string) => {
        removed.push(id);
        byId.delete(id);
      },
    },
  } as unknown as WorkspaceStore;
  return { store, removed };
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

const service = (store: WorkspaceStore) =>
  new WorkItemDeletionService(store, new ProjectService(store));

describe('WorkItemDeletionService.delete (WS-U5)', () => {
  it('chủ nhiệm dự án xoá được công việc', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' });
    await service(store).delete(actorOf('u-owner'), 'w1');
    expect(removed).toEqual(['w1']);
  });

  it('quản lý KHÔNG xoá được (chỉ chủ nhiệm)', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], { 'u-mgr': 'manager' });
    await expect(service(store).delete(actorOf('u-mgr'), 'w1')).rejects.toMatchObject({
      code: 'PROJECT_PERMISSION_FORBIDDEN',
    });
    expect(removed).toHaveLength(0);
  });

  it('thành viên thường KHÔNG xoá được', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], { 'u-mem': 'member' });
    await expect(service(store).delete(actorOf('u-mem'), 'w1')).rejects.toMatchObject({
      code: 'PROJECT_PERMISSION_FORBIDDEN',
    });
    expect(removed).toHaveLength(0);
  });

  it('quản trị tenant KHÔNG xoá được nếu không phải chủ nhiệm dự án', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], {});
    await expect(service(store).delete(actorOf('admin', true), 'w1')).rejects.toMatchObject({
      code: 'PROJECT_PERMISSION_FORBIDDEN',
    });
    expect(removed).toHaveLength(0);
  });

  it('ghi vết "đã xoá" vào nhật ký khi chủ nhiệm xoá', async () => {
    const { store } = makeStore([item({ id: 'w1', code: 'CV009', title: 'Việc X' })], {
      'u-owner': 'owner',
    });
    let logged: unknown;
    (store as unknown as { workItem: { remove: unknown } }).workItem.remove = async (
      _tenant: string,
      _id: string,
      deletionLog?: unknown,
    ) => {
      logged = deletionLog;
    };
    await service(store).delete(actorOf('u-owner'), 'w1');
    expect(logged).toMatchObject({
      projectId: 'p1',
      fromStatus: 'todo',
      note: 'Đã xoá công việc: CV009 — Việc X',
      createdBy: 'u-owner',
    });
  });

  it('công việc không tồn tại thì báo lỗi, không xoá', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' });
    await expect(service(store).delete(actorOf('u-owner'), 'missing')).rejects.toMatchObject({
      code: 'WORK_ITEM_NOT_FOUND',
    });
    expect(removed).toHaveLength(0);
  });

  it('vai trò tự định nghĩa có quyền "Có thể xoá công việc" thì xoá được', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], { 'u-qa': 'custom_qa' });
    (store as unknown as { roleDefinition: unknown }).roleDefinition = {
      list: async () => [
        {
          key: 'custom_qa',
          name: 'Kiểm soát',
          permissions: ['project.view_all', 'work_item.delete'],
          isSystem: false,
          sortOrder: 9,
          memberCount: 1,
        },
      ],
    };
    const deletion = new WorkItemDeletionService(
      store,
      new ProjectService(store, undefined, new ProjectRoleService(store)),
    );
    await deletion.delete(actorOf('u-qa'), 'w1');
    expect(removed).toEqual(['w1']);
  });

  it('người ngoài dự án (không vai trò, không phải quản trị) bị chặn truy cập', async () => {
    const { store, removed } = makeStore([item({ id: 'w1' })], {});
    await expect(service(store).delete(actorOf('stranger'), 'w1')).rejects.toMatchObject({
      code: 'PROJECT_FORBIDDEN',
    });
    expect(removed).toHaveLength(0);
  });
});
