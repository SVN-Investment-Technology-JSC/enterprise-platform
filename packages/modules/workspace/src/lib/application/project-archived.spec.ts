import type { WorkItem, WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import { ChatService } from './chat.service.js';
import { ProjectService } from './project.service.js';
import { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Dự án đã lưu trữ chỉ xem: mọi đường ghi bị chặn bằng `PROJECT_ARCHIVED`, trừ nhắn tin khi tenant chọn "vẫn cho nhắn".
 */
function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: 'CV001',
    title: 'Việc',
    itemType: 'task',
    executionType: 'manual',
    status: 'in_progress',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u1',
    assigneeUserId: 'u1',
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

function makeStore(options: { archivedAt?: string; chatPolicy?: 'block' | 'allow' }) {
  const writes: string[] = [];
  const items = [item({ id: 'w1' })];
  const store = {
    project: {
      findById: async () => ({ id: 'p1', code: 'DA-1', name: 'Dự án', status: 'active', archivedAt: options.archivedAt }),
      update: async (_t: string, _id: string, patch: unknown) => {
        writes.push(`project.update:${JSON.stringify(patch)}`);
        return {};
      },
      updateProgress: async () => undefined,
    },
    member: {
      roleOf: async (_t: string, _p: string, userId: string) => (userId === 'u1' ? 'owner' : undefined),
      list: async () => [],
    },
    settings: {
      get: async (_t: string, key: string) =>
        key === 'project_chat_on_archived' && options.chatPolicy ? { policy: options.chatPolicy } : undefined,
    },
    procedureRequest: { listByProject: async () => [] },
    workItem: {
      findById: async (_t: string, id: string) => items.find((entry) => entry.id === id),
      listByProject: async () => items,
      progressRows: async () => [],
      applyProgress: async () => undefined,
      openChildCount: async () => 0,
      create: async () => {
        writes.push('workItem.create');
        return { id: 'w-new', code: 'CV002' };
      },
      update: async () => {
        writes.push('workItem.update');
        return { id: 'w1' };
      },
      changeStatus: async (_t: string, id: string, _a: string, next: WorkItemStatus) => {
        writes.push(`workItem.changeStatus:${next}`);
        return { ...items[0], id, status: next };
      },
    },
    dependency: { listBySuccessor: async () => [] },
    chat: {
      ensureChannel: async () => ({ id: 'c1' }),
      sendMessage: async () => {
        writes.push('chat.send');
        return { id: 'm1' };
      },
      markRead: async () => undefined,
    },
  } as unknown as WorkspaceStore;
  return { store, writes };
}

const ARCHIVED = '2026-10-20T00:00:00.000Z';

describe('Dự án đã lưu trữ chỉ xem', () => {
  it('không tạo, sửa hay đổi trạng thái công việc', async () => {
    const { store, writes } = makeStore({ archivedAt: ARCHIVED });
    const service = new WorkItemService(store, new ProjectService(store));
    const actor = actorOf('u1');
    await expect(service.create(actor, { projectId: 'p1', title: 'Mới' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    await expect(service.update(actor, 'w1', { title: 'Đổi tên' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    await expect(service.changeStatus(actor, 'w1', { status: 'done' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    expect(writes).toEqual([]);
  });

  it('không sửa dự án, kể cả đổi trạng thái (không tự mở lưu trữ ngầm)', async () => {
    const { store, writes } = makeStore({ archivedAt: ARCHIVED });
    const projects = new ProjectService(store);
    await expect(projects.update(actorOf('u1'), 'p1', { status: 'active' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    await expect(projects.update(actorOf('u1'), 'p1', { name: 'Tên mới' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    expect(writes).toEqual([]);
  });

  it('dự án chưa lưu trữ thì ghi bình thường', async () => {
    const { store, writes } = makeStore({});
    const service = new WorkItemService(store, new ProjectService(store));
    await service.changeStatus(actorOf('u1'), 'w1', { status: 'review' });
    expect(writes).toEqual(['workItem.changeStatus:review']);
  });

  describe('trao đổi (chat)', () => {
    const send = (store: WorkspaceStore) =>
      new ChatService(store, new ProjectService(store)).send(actorOf('u1'), {
        entityType: 'project',
        entityId: 'p1',
        body: 'Xin chào',
      });

    it('mặc định chặn nhắn trong dự án đã lưu trữ', async () => {
      const { store, writes } = makeStore({ archivedAt: ARCHIVED });
      await expect(send(store)).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
      expect(writes).toEqual([]);
    });

    it('cài đặt "vẫn cho nhắn" thì nhắn được', async () => {
      const { store, writes } = makeStore({ archivedAt: ARCHIVED, chatPolicy: 'allow' });
      await send(store);
      expect(writes).toEqual(['chat.send']);
    });

    it('dự án chưa lưu trữ luôn nhắn được, dù cài đặt là chặn', async () => {
      const { store, writes } = makeStore({ chatPolicy: 'block' });
      await send(store);
      expect(writes).toEqual(['chat.send']);
    });
  });
});

describe('Cài đặt chung của dự án lưu trữ', () => {
  it('lưu từng phần, đọc lại, và từ chối giá trị lạ', async () => {
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
    const admin = { ...actorOf('adm'), isTenantAdmin: true };
    expect((await projects.archiveSettings(admin)).chatOnArchived).toBe('block');
    expect((await projects.saveArchiveSettings(admin, { chatOnArchived: 'allow' })).chatOnArchived).toBe('allow');
    await expect(
      projects.saveArchiveSettings(admin, { chatOnArchived: 'bậy' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
