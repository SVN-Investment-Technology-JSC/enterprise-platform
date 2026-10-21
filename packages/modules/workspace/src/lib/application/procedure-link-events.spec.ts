import { NameConflictError } from '../domain/workspace.error.js';
import {
  PROCEDURE_ATTACHMENT_ADDED,
  PROCEDURE_INSTANCE_DELETED,
  PROCEDURE_WORKSPACE_RELINK_REQUESTED,
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
} from '../domain/workspace-procedure-link.js';
import type { DocumentService } from './document.service.js';
import type { FinanceService } from './finance.service.js';
import type { ProjectService } from './project.service.js';
import { WorkspaceProcedureEvents } from './procedure-link-events.js';
import type { WorkItemDeletionService } from './work-item-deletion.service.js';
import type { WorkItemService } from './work-item.service.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const T = 'tenant-a';
const INSTANCE = 'inst-1';

interface Ref {
  id: string;
  entityType: 'work_item';
  entityId: string;
  projectId: string;
  moduleKey: 'procedure-engine';
  externalId: string;
}

function harness(options: {
  refs?: Ref[];
  existingKeys?: string[];
  clashNames?: string[];
  members?: Record<string, string[]>;
  items?: Record<string, { id: string; projectId: string; code: string; title: string; assigneeUserId?: string; participantUserIds?: string[] }>;
} = {}) {
  const refs = [...(options.refs ?? [])];
  const items = { ...(options.items ?? {}) };
  const emitted: { type: string; payload: Record<string, unknown> }[] = [];
  const created: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  const moves: Record<string, unknown>[] = [];
  const store = {
    externalRef: {
      findByExternalId: async (_t: string, _m: string, externalId: string) =>
        [...refs].reverse().find((ref) => ref.externalId === externalId),
    },
    document: {
      findByStorageKey: async (_t: string, key: string) =>
        options.existingKeys?.includes(key) ? { documentId: 'doc-old' } : undefined,
      create: async (_t: string, _u: string, input: { name: string }) => {
        if (options.clashNames?.includes(input.name)) throw new NameConflictError('trùng');
        created.push(input);
        return { document: { id: `doc-${created.length}` }, version: {} };
      },
      addLink: async (_t: string, _u: string, input: Record<string, unknown>) => {
        links.push(input);
        return input;
      },
      idsForWorkItem: async () => ['doc-a', 'doc-b'],
      moveToWorkItem: async (_t: string, input: Record<string, unknown>) => {
        moves.push(input);
      },
      listFolders: async () => [],
      countActiveDocuments: async () => 0,
      deactivateFolder: async () => undefined,
    },
    project: {
      findById: async (_t: string, id: string) => ({ id, code: id === 'p-new' ? 'HN' : 'EVN', name: 'Dự án', status: 'active' }),
    },
    member: {
      roleOf: async (_t: string, projectId: string, userId: string) =>
        options.members?.[projectId]?.includes(userId) ? 'member' : undefined,
      list: async (_t: string, projectId: string) =>
        (options.members?.[projectId] ?? []).map((userId) => ({ userId, role: 'member' })),
    },
    workItem: {
      findById: async (_t: string, id: string) => items[id],
      listByProject: async () => Object.values(items),
    },
    integration: {
      emit: async (_t: string, event: { type: string; payload: Record<string, unknown> }) => {
        emitted.push(event);
      },
    },
  } as unknown as WorkspaceStore;

  const createdItems: Record<string, unknown>[] = [];
  const workItems = {
    create: async (_actor: unknown, input: Record<string, unknown>, linked: { instanceId: string }) => {
      createdItems.push(input);
      const item = { id: 'wi-new', projectId: String(input.projectId), code: 'CV009', title: String(input.title) };
      items[item.id] = item;
      refs.push({
        id: 'ref-new',
        entityType: 'work_item',
        entityId: item.id,
        projectId: item.projectId,
        moduleKey: 'procedure-engine',
        externalId: linked.instanceId,
      });
      return item;
    },
  } as unknown as WorkItemService;
  const removed: { workItemId: string; note: string }[] = [];
  const deletion = {
    removeForProcedure: async (_t: string, workItemId: string, input: { note: string }) => {
      removed.push({ workItemId, note: input.note });
      delete items[workItemId];
    },
  } as unknown as WorkItemDeletionService;
  const documents = {
    ensurePath: async (_actor: unknown, input: { projectId: string; workItemId: string }) => ({
      id: `folder-${input.workItemId}`,
    }),
  } as unknown as DocumentService;

  const memberChanges: { userId: string; role: string }[][] = [];
  const projects = {
    setMembers: async (_actor: unknown, _projectId: string, input: { members: { userId: string; role: string }[] }) => {
      memberChanges.push(input.members);
      return input.members;
    },
  } as unknown as ProjectService;
  const events = new WorkspaceProcedureEvents(
    store,
    workItems,
    {} as FinanceService,
    documents,
    deletion,
    projects,
  );
  return { events, emitted, created, links, moves, removed, createdItems, memberChanges };
}

const linkedRef: Ref = {
  id: 'ref-old',
  entityType: 'work_item',
  entityId: 'wi-old',
  projectId: 'p-old',
  moduleKey: 'procedure-engine',
  externalId: INSTANCE,
};

const file = {
  instanceId: INSTANCE,
  instanceCode: 'HS-001',
  attachmentId: 'abcdef12-0000-4000-8000-000000000000',
  objectKey: 'tenants/t/procedure/inst-1/x-bao-gia.pdf',
  fileName: 'Báo giá.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1200,
  uploadedBy: 'user-1',
  originLabel: 'Bước 2',
};

describe('Tệp của hồ sơ → tài liệu dự án', () => {
  it('tạo tài liệu trong thư mục công việc, trỏ đúng tệp gốc và gắn vào công việc', async () => {
    const { events, created, links } = harness({ refs: [linkedRef] });
    await events.handle(T, PROCEDURE_ATTACHMENT_ADDED, file);
    expect(created).toEqual([
      expect.objectContaining({
        folderId: 'folder-wi-old',
        projectId: 'p-old',
        name: 'Báo giá.pdf',
        storageKey: file.objectKey,
        description: 'Từ hồ sơ HS-001 · Bước 2',
      }),
    ]);
    expect(links).toEqual([
      expect.objectContaining({ documentId: 'doc-1', entityType: 'work_item', entityId: 'wi-old' }),
    ]);
  });

  it('trùng tên thì thêm mã hồ sơ; đã có tài liệu cho tệp này thì bỏ qua', async () => {
    const clash = harness({ refs: [linkedRef], clashNames: ['Báo giá.pdf'] });
    await clash.events.handle(T, PROCEDURE_ATTACHMENT_ADDED, file);
    expect(clash.created[0]).toMatchObject({ name: 'Báo giá (HS-001).pdf' });

    const again = harness({ refs: [linkedRef], existingKeys: [file.objectKey] });
    await again.events.handle(T, PROCEDURE_ATTACHMENT_ADDED, file);
    expect(again.created).toEqual([]);
  });

  it('hồ sơ chưa gắn xong công việc thì ném lỗi để worker thử lại', async () => {
    const { events } = harness();
    await expect(events.handle(T, PROCEDURE_ATTACHMENT_ADDED, file)).rejects.toThrow('chưa gắn công việc');
  });
});

describe('Xoá hồ sơ', () => {
  it('xoá công việc đang gắn hồ sơ', async () => {
    const { events, removed } = harness({ refs: [linkedRef] });
    await events.handle(T, PROCEDURE_INSTANCE_DELETED, {
      instanceId: INSTANCE,
      instanceCode: 'HS-001',
      reason: 'Nhập nhầm',
      deletedBy: 'user-a',
    });
    expect(removed).toEqual([{ workItemId: 'wi-old', note: expect.stringContaining('HS-001') }]);
  });
});

describe('Đổi công việc liên kết', () => {
  const request = {
    instanceId: INSTANCE,
    instanceCode: 'HS-001',
    instanceStatus: 'running',
    projectId: 'p-new',
    title: 'Mua cáp',
    requestedBy: 'user-a',
    requestedByIsTenantAdmin: false,
    workItem: { parentId: undefined },
    replacesWorkItemId: 'wi-old',
  };
  const oldItem = {
    id: 'wi-old',
    projectId: 'p-old',
    code: 'CV001',
    title: 'Mua cáp',
    assigneeUserId: 'user-out',
    participantUserIds: ['user-in', 'user-out'],
  };

  it('người yêu cầu không thuộc dự án mới thì từ chối, không đụng gì', async () => {
    const { events, emitted, createdItems, removed } = harness({
      refs: [linkedRef],
      items: { 'wi-old': oldItem },
      members: { 'p-new': ['someone-else'] },
    });
    await events.handle(T, PROCEDURE_WORKSPACE_RELINK_REQUESTED, request);
    expect(createdItems).toEqual([]);
    expect(removed).toEqual([]);
    expect(emitted).toEqual([
      expect.objectContaining({ type: WORK_ITEM_PROCEDURE_LINK_REJECTED }),
    ]);
  });

  it('tạo công việc mới, chuyển tài liệu, xoá công việc cũ rồi báo mã mới', async () => {
    const h = harness({
      refs: [linkedRef],
      items: { 'wi-old': oldItem },
      members: { 'p-new': ['user-a', 'user-in'] },
    });
    await h.events.handle(T, PROCEDURE_WORKSPACE_RELINK_REQUESTED, request);
    // Chỉ giữ người là thành viên dự án mới.
    expect(h.createdItems[0]).toMatchObject({
      projectId: 'p-new',
      title: 'Mua cáp',
      assigneeUserId: undefined,
      participantUserIds: ['user-in'],
      executionType: 'procedure',
    });
    expect(h.moves).toEqual([
      expect.objectContaining({
        documentIds: ['doc-a', 'doc-b'],
        fromWorkItemId: 'wi-old',
        toWorkItemId: 'wi-new',
        toProjectId: 'p-new',
        toFolderId: 'folder-wi-new',
      }),
    ]);
    expect(h.removed.map((entry) => entry.workItemId)).toEqual(['wi-old']);
    expect(h.emitted).toEqual([
      expect.objectContaining({
        type: WORK_ITEM_PROCEDURE_LINKED,
        payload: expect.objectContaining({ workItemId: 'wi-new', workItemCode: 'CV009', projectCode: 'HN' }),
      }),
    ]);

    // Worker chạy lại cùng sự kiện: không tạo thêm công việc, chỉ báo lại mã.
    await h.events.handle(T, PROCEDURE_WORKSPACE_RELINK_REQUESTED, request);
    expect(h.createdItems).toHaveLength(1);
    expect(h.emitted.filter((event) => event.type === WORK_ITEM_PROCEDURE_LINKED)).toHaveLength(2);
  });
});

describe('Đơn tạo hộ gắn dự án', () => {
  const link = {
    instanceId: INSTANCE,
    instanceCode: 'HS-002',
    instanceStatus: 'running',
    projectId: 'p-new',
    title: 'Tạm ứng',
    requestedBy: 'user-a',
    requestedByIsTenantAdmin: false,
    workItem: {},
  };

  it('người submit ngoài dự án được thêm vào dự án trước khi tạo công việc', async () => {
    const h = harness({ members: { 'p-new': ['user-a'] } });
    await h.events.handle(T, 'procedure.instance.workspace_link_requested', { ...link, submitterUserId: 'user-out' });
    expect(h.memberChanges).toEqual([
      [
        { userId: 'user-a', role: 'member' },
        { userId: 'user-out', role: 'member' },
      ],
    ]);
    expect(h.createdItems).toHaveLength(1);
  });

  it('người submit đã trong dự án thì không đổi danh sách thành viên', async () => {
    const h = harness({ members: { 'p-new': ['user-a', 'user-in'] } });
    await h.events.handle(T, 'procedure.instance.workspace_link_requested', { ...link, submitterUserId: 'user-in' });
    expect(h.memberChanges).toEqual([]);
    expect(h.createdItems).toHaveLength(1);
  });
});
