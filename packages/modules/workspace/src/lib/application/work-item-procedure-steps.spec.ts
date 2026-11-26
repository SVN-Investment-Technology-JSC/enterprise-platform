import type { ProjectRole, WorkItem } from '@enterprise-platform/contracts-workspace';
import type { ProcedureStepsReader, ProcedureStepsSnapshot } from './procedure-steps.port.js';
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
    executionType: 'procedure',
    status: 'in_progress',
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

function makeStore(items: WorkItem[], roles: Record<string, ProjectRole>, instanceId?: string) {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  return {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' ? ({ id: 'p1', code: 'DA-1', name: 'Dự án' } as never) : undefined,
    },
    member: {
      roleOf: async (_tenant: string, _projectId: string, userId: string) => roles[userId],
    },
    externalRef: {
      listByEntity: async () =>
        instanceId ? [{ moduleKey: 'procedure-engine', externalId: instanceId }] : [],
    },
    workItem: {
      findById: async (_tenant: string, id: string) => byId.get(id),
      listByProject: async () => [...byId.values()],
    },
  } as unknown as WorkspaceStore;
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

const snapshot = (instanceId: string): ProcedureStepsSnapshot => ({
  instanceId,
  instanceCode: 'HS-1',
  status: 'running',
  currentStepId: 's2',
  progress: { completed: 1, total: 2 },
  steps: [
    { id: 's1', name: 'Soạn', order: 1, status: 'completed', assigneeLabel: 'A' },
    { id: 's2', name: 'Duyệt', order: 2, status: 'active', assigneeLabel: 'B' },
  ],
  events: [],
});

const service = (store: WorkspaceStore, reader?: ProcedureStepsReader) =>
  new WorkItemService(store, new ProjectService(store), undefined, undefined, undefined, reader);

describe('WorkItemService.procedureSteps', () => {
  it('công việc không gắn hồ sơ thì linked=false và không gọi Quy trình', async () => {
    const reader = { read: jest.fn() };
    const store = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' });
    await expect(service(store, reader).procedureSteps(actorOf('u-owner'), 'w1')).resolves.toEqual({
      linked: false,
      available: true,
      steps: [],
      events: [],
    });
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('mã hồ sơ lấy từ liên kết của Workspace và trả các bước', async () => {
    const reader = { read: jest.fn().mockResolvedValue(snapshot('inst-1')) };
    const store = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' }, 'inst-1');
    const result = await service(store, reader).procedureSteps(actorOf('u-owner'), 'w1');
    expect(reader.read).toHaveBeenCalledWith('t1', 'inst-1');
    expect(result).toMatchObject({ linked: true, available: true, instanceId: 'inst-1', instanceCode: 'HS-1' });
    expect(result.steps).toHaveLength(2);
  });

  it('người không xem được công việc thì bị báo không tìm thấy, không gọi Quy trình', async () => {
    const reader = { read: jest.fn() };
    const store = makeStore(
      [item({ id: 'w1', assigneeUserId: 'u-other' })],
      { 'u-owner': 'owner', 'u-limited': 'chi-xem-viec-lien-quan' },
      'inst-1',
    );
    await expect(service(store, reader).procedureSteps(actorOf('u-limited'), 'w1')).rejects.toMatchObject({
      code: 'WORK_ITEM_NOT_FOUND',
    });
    await expect(service(store, reader).procedureSteps(actorOf('u-stranger'), 'w1')).rejects.toBeDefined();
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('không đọc được Quy trình thì available=false nhưng vẫn linked', async () => {
    const reader = { read: jest.fn().mockResolvedValue('unavailable') };
    const store = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' }, 'inst-1');
    await expect(service(store, reader).procedureSteps(actorOf('u-owner'), 'w1')).resolves.toEqual({
      linked: true,
      available: false,
      instanceId: 'inst-1',
      steps: [],
      events: [],
    });
    // Chưa cấu hình bộ đọc cũng coi như không đọc được.
    await expect(service(store).procedureSteps(actorOf('u-owner'), 'w1')).resolves.toMatchObject({
      linked: true,
      available: false,
    });
  });

  it('Quy trình trả hồ sơ khác với hồ sơ đã yêu cầu thì bị từ chối', async () => {
    const reader = { read: jest.fn().mockResolvedValue(snapshot('inst-khac')) };
    const store = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' }, 'inst-1');
    const result = await service(store, reader).procedureSteps(actorOf('u-owner'), 'w1');
    expect(result).toMatchObject({ linked: true, available: false, instanceId: 'inst-1', steps: [] });
  });

  it('Quy trình báo không có hồ sơ (404) thì coi như không gắn', async () => {
    const reader = { read: jest.fn().mockResolvedValue(undefined) };
    const store = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' }, 'inst-1');
    await expect(service(store, reader).procedureSteps(actorOf('u-owner'), 'w1')).resolves.toMatchObject({
      linked: false,
      available: true,
    });
  });
});
