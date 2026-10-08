import type { ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import type {
  DocumentFolder,
  DocumentFolderRef,
  DocumentSummary,
  ProjectRole,
  WorkspaceDocument,
} from '@enterprise-platform/contracts-workspace';
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

/**
 * Store giả cho thư mục chung và tham chiếu. Thư mục:
 * - `u0` kho đơn vị (gốc), `pa` gốc dự án `p1`, `pa1` con của `pa`, `pa2` con của `pa1`;
 * - `pb` gốc dự án `p2`.
 * Tài liệu `doc1` thuộc `p1`, gốc ở `pa`; `docB` thuộc `p2`, gốc ở `pb`.
 */
function makeFolderStore(roles: Record<string, ProjectRole> = { p1: 'member', p2: 'member' }) {
  const folders: Record<string, DocumentFolder> = {
    u0: folder('u0', undefined, undefined, 0),
    pa: folder('pa', 'p1', undefined, 0),
    pa1: folder('pa1', 'p1', 'pa', 1),
    pa2: folder('pa2', 'p1', 'pa1', 2),
    pb: folder('pb', 'p2', undefined, 0),
  };
  const documents: Record<string, Partial<DocumentSummary>> = {
    doc1: { id: 'doc1', projectId: 'p1', folderId: 'pa', status: 'active' },
    docB: { id: 'docB', projectId: 'p2', folderId: 'pb', status: 'active' },
  };
  const refs: DocumentFolderRef[] = [];
  const calls: { op: string; args: unknown }[] = [];
  const store = {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' || id === 'p2' ? ({ id } as never) : undefined,
    },
    member: {
      roleOf: async (_tenant: string, projectId: string) => roles[projectId],
    },
    document: {
      findById: async (_tenant: string, id: string) => documents[id] as WorkspaceDocument,
      findFolder: async (_tenant: string, id: string) => folders[id],
      listFolders: async (_tenant: string, projectId?: string) =>
        Object.values(folders).filter(
          (item) => !projectId || !item.projectId || item.projectId === projectId,
        ),
      updateFolder: async (_tenant: string, id: string, input: unknown) => {
        calls.push({ op: 'updateFolder', args: { id, ...(input as object) } });
        return folders[id];
      },
      deactivateFolder: async (_tenant: string, id: string) => {
        calls.push({ op: 'deactivateFolder', args: id });
      },
      countActiveDocuments: async () => 0,
      listFolderRefs: async (_tenant: string, documentId: string) =>
        refs.filter((ref) => ref.documentId === documentId),
      addFolderRef: async (_tenant: string, _actor: string, input: { documentId: string; folderId: string }) => {
        const ref = { id: `r${refs.length + 1}`, createdBy: 'u1', createdAt: '', ...input };
        refs.push(ref);
        return ref;
      },
      removeFolderRef: async (_tenant: string, id: string) => {
        calls.push({ op: 'removeFolderRef', args: id });
      },
      list: async () => Object.values(documents) as DocumentSummary[],
    },
  };
  return { store: store as unknown as WorkspaceStore, refs, calls };
}

function folder(id: string, projectId: string | undefined, parentId: string | undefined, depth: number) {
  return { id, projectId, parentId, depth, name: id, isActive: true, createdBy: 'u1', createdAt: '' } as DocumentFolder;
}

/** Người dùng thường: không quản trị Workspace, không có quyền xoá riêng. */
const member: WorkspaceActor = { ...me, canManage: false, canDeleteDocuments: false };

describe('DocumentService — thư mục chung của dự án', () => {
  it('thành viên dự án đổi tên được thư mục của dự án', async () => {
    const { store, calls } = makeFolderStore();
    await serviceFor(store).updateFolder(member, 'pa1', { name: 'Bản vẽ' });
    expect(calls).toEqual([
      { op: 'updateFolder', args: { id: 'pa1', name: 'Bản vẽ', parentId: 'pa', depthDelta: 0 } },
    ]);
  });

  it('người chỉ xem không đổi được thư mục', async () => {
    const { store } = makeFolderStore({ p1: 'viewer' });
    await expect(
      serviceFor(store).updateFolder(member, 'pa1', { name: 'X' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
  });

  it('kho cấp đơn vị cần quyền quản trị Workspace', async () => {
    const { store } = makeFolderStore();
    await expect(
      serviceFor(store).updateFolder(member, 'u0', { name: 'X' }),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
  });

  it('chuyển về gốc thì cả nhánh dịch lên đúng số cấp', async () => {
    const { store, calls } = makeFolderStore();
    await serviceFor(store).updateFolder(member, 'pa1', { parentId: null });
    expect(calls[0]?.args).toMatchObject({ id: 'pa1', parentId: null, depthDelta: -1 });
  });

  it('không chuyển được vào thư mục con của chính nó', async () => {
    const { store } = makeFolderStore();
    await expect(
      serviceFor(store).updateFolder(member, 'pa', { parentId: 'pa2' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('không chuyển thư mục dự án này sang dự án khác', async () => {
    const { store } = makeFolderStore();
    await expect(
      serviceFor(store).updateFolder(member, 'pa1', { parentId: 'pb' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('thư mục dự án được đặt vào kho cấp đơn vị', async () => {
    const { store, calls } = makeFolderStore();
    await serviceFor(store).updateFolder(member, 'pa1', { parentId: 'u0' });
    expect(calls[0]?.args).toMatchObject({ parentId: 'u0', depthDelta: 0 });
  });

  it('thành viên xoá được thư mục rỗng của dự án dù không có quyền xoá riêng', async () => {
    const { store, calls } = makeFolderStore();
    await serviceFor(store).removeFolder(member, 'pa2');
    expect(calls).toEqual([{ op: 'deactivateFolder', args: 'pa2' }]);
  });

  it('kho cấp đơn vị vẫn cần quyền xoá riêng', async () => {
    const { store } = makeFolderStore();
    await expect(serviceFor(store).removeFolder(member, 'u0')).rejects.toMatchObject({
      code: 'PROJECT_FORBIDDEN',
    });
  });
});

describe('DocumentService — tham chiếu tài liệu vào thư mục', () => {
  it('thêm tham chiếu vào thư mục khác của dự án', async () => {
    const { store, refs } = makeFolderStore();
    await serviceFor(store).addFolderRef(member, 'doc1', { folderId: 'pa2' });
    expect(refs.map((ref) => ref.folderId)).toEqual(['pa2']);
  });

  it('không tham chiếu vào chính thư mục gốc', async () => {
    const { store } = makeFolderStore();
    await expect(
      serviceFor(store).addFolderRef(member, 'doc1', { folderId: 'pa' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('phải ghi được ở thư mục đích', async () => {
    const { store, refs } = makeFolderStore({ p1: 'member', p2: 'viewer' });
    await expect(
      serviceFor(store).addFolderRef(member, 'doc1', { folderId: 'pb' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });
    expect(refs).toHaveLength(0);
  });

  it('gỡ tham chiếu không thuộc tài liệu thì 404', async () => {
    const { store, calls } = makeFolderStore();
    await expect(
      serviceFor(store).removeFolderRef(member, 'doc1', 'ghost'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });

  it('danh sách theo dự án bỏ tài liệu tham chiếu từ dự án mình không tham gia', async () => {
    const { store } = makeFolderStore({ p1: 'member' });
    const items = await serviceFor(store).list(member, { projectId: 'p1' });
    expect(items.map((item) => item.id)).toEqual(['doc1']);
  });
});

describe('DocumentService — tải xuống và xem trước', () => {
  /** Store giả có một tài liệu `doc1` (dự án p1) với hai bản: PDF và ZIP. */
  function setup() {
    const logged: string[] = [];
    const signed: { key: string; options?: unknown }[] = [];
    const versions: Record<string, object> = {
      vpdf: { id: 'vpdf', documentId: 'doc1', fileName: 'Bien-ban.pdf', contentType: 'application/pdf', sizeBytes: 10 },
      vzip: { id: 'vzip', documentId: 'doc1', fileName: 'Goi.zip', contentType: 'application/zip', sizeBytes: 10 },
    };
    const store = {
      project: { findById: async () => ({ id: 'p1' }) },
      member: { roleOf: async () => 'member' },
      document: {
        findById: async () => ({ id: 'doc1', projectId: 'p1', folderId: 'f1', currentVersionId: 'vpdf' }),
        findVersion: async (_tenant: string, id: string) => versions[id],
        storageKeyOf: async (_tenant: string, id: string) => `key/${id}`,
        log: async (_tenant: string, _actor: string, input: { action: string }) => {
          logged.push(input.action);
        },
      },
    } as unknown as WorkspaceStore;
    const storage = {
      createDownloadUrl: async (key: string, _ttl?: number, options?: unknown) => {
        signed.push({ key, options });
        return `https://s3.test/${key}`;
      },
    } as unknown as ObjectStoragePort;
    const service = new DocumentService(store, new ProjectService(store), storage);
    return { service, logged, signed };
  }

  it('tải xuống giữ nguyên cách cũ và ghi nhật ký "download"', async () => {
    const { service, logged, signed } = setup();
    const ticket = await service.download(me, 'doc1');
    expect(ticket).toMatchObject({ fileName: 'Bien-ban.pdf', contentType: 'application/pdf' });
    expect(signed).toEqual([{ key: 'key/vpdf', options: undefined }]);
    expect(logged).toEqual(['download']);
  });

  it('xem trước PDF ký URL mở tại chỗ và ghi nhật ký "view"', async () => {
    const { service, logged, signed } = setup();
    await service.download(me, 'doc1', 'vpdf', 'preview');
    expect(signed).toEqual([
      {
        key: 'key/vpdf',
        options: { inline: true, contentType: 'application/pdf', fileName: 'Bien-ban.pdf' },
      },
    ]);
    expect(logged).toEqual(['view']);
  });

  it('loại tệp không xem trước được thì 400, không ký URL', async () => {
    const { service, logged, signed } = setup();
    await expect(service.download(me, 'doc1', 'vzip', 'preview')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(signed).toHaveLength(0);
    expect(logged).toHaveLength(0);
  });
});
