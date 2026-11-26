import type { StandaloneTask } from '@enterprise-platform/contracts-workspace';
import type { ProcedureStepsReader, ProcedureStepsSnapshot } from './procedure-steps.port.js';
import { StandaloneTaskService } from './standalone-task.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const BOSS = '11111111-1111-4111-8111-111111111111';
const DOER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '55555555-5555-4555-8555-555555555555';

const actor = (userId: string): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: false,
  canDeleteDocuments: false,
});

function makeStore(procedure?: StandaloneTask['procedure']) {
  const task = {
    id: 'task-1',
    rootId: 'task-1',
    createdBy: BOSS,
    assigneeUserId: DOER,
    participantUserIds: [],
    followerUserIds: [],
    executionType: 'procedure',
    procedure,
  } as unknown as StandaloneTask;
  return {
    standaloneTask: {
      findById: async (_tenant: string, id: string) => (id === task.id ? task : undefined),
      isTreeMember: async () => false,
    },
  } as unknown as WorkspaceStore;
}

const snapshot = (instanceId: string): ProcedureStepsSnapshot => ({
  instanceId,
  instanceCode: 'HS-9',
  status: 'running',
  steps: [{ id: 's1', name: 'Duyệt', order: 1, status: 'active', assigneeLabel: 'B' }],
  events: [],
});

const make = (store: WorkspaceStore, reader?: ProcedureStepsReader) =>
  new StandaloneTaskService(store, {} as never, undefined, reader);

describe('StandaloneTaskService.procedureSteps', () => {
  it('việc không có hồ sơ thì linked=false và không gọi Quy trình', async () => {
    const reader = { read: jest.fn() };
    await expect(make(makeStore(), reader).procedureSteps(actor(BOSS), 'task-1')).resolves.toEqual({
      linked: false,
      available: true,
      steps: [],
      events: [],
    });
    // Hồ sơ đang chờ mở (chưa có instanceId) cũng chưa gắn.
    const pending = makeStore({ definitionId: 'd', status: 'pending' });
    await expect(make(pending, reader).procedureSteps(actor(BOSS), 'task-1')).resolves.toMatchObject({
      linked: false,
    });
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('đọc theo instanceId của việc và trả các bước', async () => {
    const reader = { read: jest.fn().mockResolvedValue(snapshot('inst-1')) };
    const store = makeStore({ definitionId: 'd', status: 'completed', instanceId: 'inst-1' });
    const result = await make(store, reader).procedureSteps(actor(DOER), 'task-1');
    expect(reader.read).toHaveBeenCalledWith('t1', 'inst-1');
    expect(result).toMatchObject({ linked: true, available: true, instanceId: 'inst-1', instanceCode: 'HS-9' });
  });

  it('người không liên quan tới việc thì bị báo không tìm thấy', async () => {
    const reader = { read: jest.fn() };
    const store = makeStore({ definitionId: 'd', status: 'completed', instanceId: 'inst-1' });
    await expect(make(store, reader).procedureSteps(actor(STRANGER), 'task-1')).rejects.toMatchObject({
      code: 'STANDALONE_TASK_NOT_FOUND',
    });
    await expect(make(store, reader).procedureSteps(actor(BOSS), 'khong-co')).rejects.toMatchObject({
      code: 'STANDALONE_TASK_NOT_FOUND',
    });
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('không đọc được thì available=false; hồ sơ lệch mã bị từ chối', async () => {
    const store = makeStore({ definitionId: 'd', status: 'completed', instanceId: 'inst-1' });
    const down = { read: jest.fn().mockResolvedValue('unavailable') };
    await expect(make(store, down).procedureSteps(actor(BOSS), 'task-1')).resolves.toMatchObject({
      linked: true,
      available: false,
      instanceId: 'inst-1',
      steps: [],
    });
    const wrong = { read: jest.fn().mockResolvedValue(snapshot('inst-khac')) };
    await expect(make(store, wrong).procedureSteps(actor(BOSS), 'task-1')).resolves.toMatchObject({
      linked: true,
      available: false,
      steps: [],
    });
  });
});
