import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { CalendarService } from './calendar.service.js';
import { DocumentService } from './document.service.js';
import { ExternalReferenceService } from './external-reference.service.js';
import { FinanceService } from './finance.service.js';
import { ProjectService } from './project.service.js';
import { WorkItemDeletionService } from './work-item-deletion.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Dự án đã lưu trữ chỉ xem: mỗi dịch vụ ghi vào dự án phải từ chối bằng `PROJECT_ARCHIVED` TRƯỚC khi ghi gì. Mỗi ca
 * dùng một dự án đã lưu trữ và người gọi là chủ nhiệm (đủ quyền), để chỉ còn trạng thái lưu trữ là lý do từ chối.
 */
const actor: WorkspaceActor = {
  tenantId: 't1',
  userId: 'owner',
  displayName: 'owner',
  isTenantAdmin: true,
  canManage: true,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

const item = {
  id: 'w1',
  projectId: 'p1',
  code: 'CV001',
  title: 'Việc',
  itemType: 'task',
  status: 'todo',
} as unknown as WorkItem;

function archivedStore() {
  const writes: string[] = [];
  const record = (name: string) => async () => {
    writes.push(name);
    return {};
  };
  const store = {
    project: {
      findById: async () => ({
        id: 'p1',
        code: 'DA-1',
        name: 'Dự án',
        status: 'active',
        archivedAt: '2026-10-20T00:00:00.000Z',
      }),
    },
    member: { roleOf: async () => 'owner', list: async () => [] },
    settings: { get: async () => undefined },
    workItem: {
      findById: async () => item,
      listByProject: async () => [item],
      remove: record('workItem.remove'),
    },
    document: {
      findById: async () => ({ id: 'd1', projectId: undefined, name: 'Tài liệu dùng chung' }),
      addLink: record('document.addLink'),
    },
    calendar: {
      createEvent: record('calendar.createEvent'),
      findEvent: async () => ({
        id: 'e1',
        projectId: 'p1',
        organizerUserId: 'owner',
        title: 'Họp',
        startAt: '2026-10-21T01:00:00.000Z',
        endAt: '2026-10-21T02:00:00.000Z',
      }),
      listParticipants: async () => [],
      updateEvent: record('calendar.updateEvent'),
      cancelEvent: record('calendar.cancelEvent'),
    },
    finance: { updateProject: record('finance.updateProject'), updateItem: record('finance.updateItem'), addCostEntry: record('finance.addCostEntry') },
    externalRef: { findByExternal: async () => undefined, create: record('externalRef.create') },
  } as unknown as WorkspaceStore;
  return { store, writes };
}

const storage = {} as never;

describe('Mọi đường ghi vào dự án đã lưu trữ bị từ chối', () => {
  it('xoá công việc', async () => {
    const { store, writes } = archivedStore();
    const service = new WorkItemDeletionService(store, new ProjectService(store));
    await expect(service.delete(actor, 'w1')).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(writes).toEqual([]);
  });

  it('đổi thành viên và huỷ dự án', async () => {
    const { store, writes } = archivedStore();
    const projects = new ProjectService(store);
    await expect(
      projects.setMembers(actor, 'p1', { members: [{ userId: 'owner', role: 'owner' }] }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(projects.cancel(actor, 'p1')).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(writes).toEqual([]);
  });

  it('sửa tài chính dự án và chi phí công việc', async () => {
    const { store, writes } = archivedStore();
    const finance = new FinanceService(store, new ProjectService(store));
    await expect(finance.updateProject(actor, 'p1', { budget: 1000 })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    await expect(finance.updateItemCost(actor, 'w1', { estimatedCost: 10 })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    await expect(finance.addCostEntry(actor, 'w1', { amount: 10, note: 'Chi phí' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    expect(writes).toEqual([]);
  });

  it('tạo, sửa và huỷ sự kiện lịch của dự án', async () => {
    const { store, writes } = archivedStore();
    const calendar = new CalendarService(store, new ProjectService(store));
    await expect(
      calendar.create(actor, {
        projectId: 'p1',
        title: 'Họp',
        startAt: '2026-10-21T01:00:00.000Z',
        endAt: '2026-10-21T02:00:00.000Z',
      } as never),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(calendar.update(actor, 'e1', { title: 'Họp mới' })).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
    await expect(calendar.cancel(actor, 'e1', 'all')).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(writes).toEqual([]);
  });

  it('gắn liên kết ngoài vào công việc', async () => {
    const { store, writes } = archivedStore();
    const service = new ExternalReferenceService(store, new ProjectService(store), {} as never);
    await expect(
      service.link(actor, 'w1', { moduleKey: 'procedure-engine', externalId: 'x1' } as never),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(writes).toEqual([]);
  });

  it('gắn tài liệu dùng chung vào công việc của dự án đã lưu trữ', async () => {
    const { store, writes } = archivedStore();
    const documents = new DocumentService(store, new ProjectService(store), storage);
    await expect(
      documents.link(actor, 'd1', { entityType: 'work_item', entityId: 'w1' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(writes).toEqual([]);
  });

  it('tạo thư mục trong dự án', async () => {
    const { store, writes } = archivedStore();
    const documents = new DocumentService(store, new ProjectService(store), storage);
    await expect(
      documents.createFolder(actor, { projectId: 'p1', name: 'Thư mục mới' } as never),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(writes).toEqual([]);
  });
});
