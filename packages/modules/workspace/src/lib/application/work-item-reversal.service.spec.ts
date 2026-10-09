import type { ProjectRole, WorkItem } from '@enterprise-platform/contracts-workspace';
import type { ProcedureReversalChecker } from './procedure-reversal-check.port.js';
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
    status: 'done',
    priority: 'normal',
    progressPercent: 100,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u-owner',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Store giả: chỉ những nhánh mà luật huỷ hiệu lực chạm tới. */
function makeStore(items: WorkItem[], roles: Record<string, ProjectRole>, instanceId?: string) {
  const reversals: { id: string; input: Record<string, unknown> }[] = [];
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
    externalRef: {
      listByEntity: async () =>
        instanceId ? [{ moduleKey: 'procedure-engine', externalId: instanceId }] : [],
    },
    workItem: {
      findById: async (_tenant: string, id: string) => byId.get(id),
      listByProject: async () => [...byId.values()],
      progressRows: async () => [],
      applyProgress: async () => undefined,
      reverse: async (_tenant: string, id: string, input: Record<string, unknown>) => {
        reversals.push({ id, input });
        const reversed = {
          ...(byId.get(id) as WorkItem),
          status: 'cancelled' as const,
          reversal: {
            reversedAt: '2026-10-09T00:00:00.000Z',
            reason: String(input.reason),
            adjustmentRequested: input.adjustmentRequested === true,
          },
        };
        byId.set(id, reversed);
        return reversed;
      },
      create: async (_tenant: string, _actor: string, input: Record<string, unknown>) =>
        item({ id: 'new', status: 'todo', adjustmentOfId: input.adjustmentOfId as string }),
    },
  } as unknown as WorkspaceStore;
  return { store, reversals };
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

const service = (store: WorkspaceStore, checker?: ProcedureReversalChecker) =>
  new WorkItemService(store, new ProjectService(store), checker);

describe('WorkItemService.reverse', () => {
  it('chủ nhiệm huỷ hiệu lực việc đã xong; quản lý thì không', async () => {
    const { store, reversals } = makeStore([item({ id: 'w1' })], {
      'u-owner': 'owner',
      'u-mgr': 'manager',
    });
    await expect(
      service(store).reverse(actorOf('u-mgr'), 'w1', { reason: 'Sai khối lượng', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'PROJECT_ROLE_FORBIDDEN' });

    const reversed = await service(store).reverse(actorOf('u-owner'), 'w1', {
      reason: 'Sai khối lượng',
      createAdjustment: true,
    });
    expect(reversed.reversal?.reason).toBe('Sai khối lượng');
    expect(reversals).toEqual([
      { id: 'w1', input: expect.objectContaining({ adjustmentRequested: true, instanceId: undefined }) },
    ]);
  });

  it('quản trị tenant huỷ được dù không là thành viên; chỉ việc đã hoàn thành', async () => {
    const { store } = makeStore([item({ id: 'w1', status: 'in_progress' })], {});
    await expect(
      service(store).reverse(actorOf('admin', true), 'w1', { reason: 'Sai', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      service(store).reverse(actorOf('admin', true), 'w1', { reason: 'Không còn đúng', createAdjustment: false }),
    ).rejects.toThrow('Chỉ huỷ hiệu lực được công việc đã hoàn thành.');
  });

  it('chặn hẳn khi Quy trình không cho huỷ hồ sơ gắn công việc', async () => {
    const { store, reversals } = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' }, 'inst-1');
    const checker = { check: jest.fn().mockResolvedValue({ allowed: false, reason: 'vật tư đã xuất kho' }) };
    await expect(
      service(store, checker).reverse(actorOf('u-owner'), 'w1', { reason: 'Sai', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      service(store, checker).reverse(actorOf('u-owner'), 'w1', { reason: 'Không đúng', createAdjustment: false }),
    ).rejects.toThrow('vật tư đã xuất kho');
    expect(reversals).toHaveLength(0);

    checker.check.mockResolvedValue({ allowed: true });
    await service(store, checker).reverse(actorOf('u-owner'), 'w1', { reason: 'Không đúng', createAdjustment: false });
    expect(checker.check).toHaveBeenCalledWith('t1', 'inst-1');
    expect(reversals[0]?.input).toEqual(expect.objectContaining({ instanceId: 'inst-1' }));
  });

  it('việc đã huỷ hiệu lực không mở lại được, chỉ lập việc điều chỉnh', async () => {
    const { store } = makeStore([item({ id: 'w1' })], { 'u-owner': 'owner' });
    await service(store).reverse(actorOf('u-owner'), 'w1', { reason: 'Sai', createAdjustment: true }).catch(() => undefined);
    await service(store).reverse(actorOf('u-owner'), 'w1', { reason: 'Sai số liệu', createAdjustment: true });
    await expect(
      service(store).changeStatus(actorOf('u-owner'), 'w1', { status: 'todo' }),
    ).rejects.toThrow('không mở lại được');

    const adjustment = await service(store).create(actorOf('u-owner'), {
      projectId: 'p1',
      title: 'Điều chỉnh CV001',
      adjustmentOfId: 'w1',
    });
    expect(adjustment.adjustmentOfId).toBe('w1');
  });
});
