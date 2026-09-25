import type { ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import type { ProjectRole, WorkspaceDocument } from '@enterprise-platform/contracts-workspace';
import { DocumentService } from './document.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Store giả cho nhánh gắn tài liệu. Hai dự án `p1`, `p2`; người gọi là
 * `member` của cả hai trừ khi test nói khác.
 */
function makeStore(roles: Record<string, ProjectRole> = { p1: 'member', p2: 'member' }) {
  const added: { entityType: string; entityId: string }[] = [];
  const completed: { id: string; sizeBytes: number }[] = [];
  const documents: Record<string, Partial<WorkspaceDocument>> = {
    doc1: { id: 'doc1', projectId: 'p1', folderId: 'f1' },
    shared: { id: 'shared', projectId: undefined, folderId: 'f0' },
  };
  const store = {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' || id === 'p2' ? ({ id } as never) : undefined,
    },
    member: {
      roleOf: async (_tenant: string, projectId: string) => roles[projectId],
    },
    workItem: {
      findById: async (_tenant: string, id: string) =>
        ({ w1: { id: 'w1', projectId: 'p1' }, w2: { id: 'w2', projectId: 'p2' } })[id] as never,
    },
    calendar: {
      findEvent: async (_tenant: string, id: string) =>
        id === 'e1' ? ({ id: 'e1', projectId: 'p1' } as never) : undefined,
    },
    document: {
      findById: async (_tenant: string, id: string) => documents[id] as WorkspaceDocument,
      findVersion: async (_tenant: string, id: string) =>
        id === 'v1' ? { id: 'v1', documentId: 'doc1' } : undefined,
      completeVersion: async (_tenant: string, id: string, sizeBytes: number) => {
        completed.push({ id, sizeBytes });
        return { id, documentId: 'doc1', sizeBytes };
      },
      addLink: async (_tenant: string, _actor: string, input: { entityType: string; entityId: string }) => {
        added.push({ entityType: input.entityType, entityId: input.entityId });
        return { id: 'link-new', ...input };
      },
    },
  };
  return { store: store as unknown as WorkspaceStore, added, completed };
}

const me: WorkspaceActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

function serviceFor(store: WorkspaceStore) {
  return new DocumentService(store, new ProjectService(store), {} as ObjectStoragePort);
}

describe('DocumentService — gắn tài liệu', () => {
  it('gắn tài liệu dự án vào công việc cùng dự án', async () => {
    const { store, added } = makeStore();
    await serviceFor(store).link(me, 'doc1', { entityType: 'work_item', entityId: 'w1' });
    expect(added).toEqual([{ entityType: 'work_item', entityId: 'w1' }]);
  });

  it('từ chối gắn tài liệu dự án A vào công việc dự án B', async () => {
    const { store, added } = makeStore();
    await expect(
      serviceFor(store).link(me, 'doc1', { entityType: 'work_item', entityId: 'w2' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(added).toHaveLength(0);
  });

  it('từ chối loại đích không hỗ trợ bằng 400, không để rơi xuống CHECK thành 500', async () => {
    const { store } = makeStore();
    await expect(
      serviceFor(store).link(me, 'doc1', { entityType: 'invoice' as never, entityId: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('đích không tồn tại trả 404', async () => {
    const { store } = makeStore();
    await expect(
      serviceFor(store).link(me, 'doc1', { entityType: 'calendar_event', entityId: 'ghost' }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('tài liệu dùng chung gắn được vào mục của dự án người gọi tham gia', async () => {
    const { store, added } = makeStore();
    // Tài liệu dùng chung cần quyền quản trị để ghi.
    await serviceFor(store).link({ ...me, canManage: true }, 'shared', {
      entityType: 'work_item',
      entityId: 'w2',
    });
    expect(added).toEqual([{ entityType: 'work_item', entityId: 'w2' }]);
  });

  it('tài liệu dùng chung không gắn được vào dự án người gọi không tham gia', async () => {
    const { store } = makeStore({ p1: 'member' });
    await expect(
      serviceFor(store).link({ ...me, canManage: true }, 'shared', {
        entityType: 'work_item',
        entityId: 'w2',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
  });
});

describe('DocumentService — báo tải lên xong', () => {
  it('ghi dung lượng của đúng phiên bản', async () => {
    const { store, completed } = makeStore();
    await serviceFor(store).completeUpload(me, 'doc1', 'v1', 2048);
    expect(completed).toEqual([{ id: 'v1', sizeBytes: 2048 }]);
  });

  it('phiên bản không thuộc tài liệu thì 404', async () => {
    const { store, completed } = makeStore();
    await expect(serviceFor(store).completeUpload(me, 'doc1', 'v-other', 10)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_FOUND',
    });
    expect(completed).toHaveLength(0);
  });

  it('dung lượng âm, lẻ hoặc vượt 50 MB bị từ chối', async () => {
    const { store } = makeStore();
    for (const bad of [-1, 1.5, 'abc', 51 * 1024 * 1024]) {
      await expect(serviceFor(store).completeUpload(me, 'doc1', 'v1', bad)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
  });

  it('viewer không báo được', async () => {
    const { store } = makeStore({ p1: 'viewer', p2: 'member' });
    await expect(serviceFor(store).completeUpload(me, 'doc1', 'v1', 10)).rejects.toMatchObject({
      code: 'PROJECT_ROLE_FORBIDDEN',
    });
  });
});
