import type { WorkItem, WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import { PROCEDURE_INSTANCE_COMPLETED } from '../domain/workspace-procedure-link.js';
import { WorkspaceProcedureEvents } from './procedure-link-events.js';
import { ProjectService } from './project.service.js';
import { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const item = (id: string, status: WorkItemStatus, parentId?: string): WorkItem => ({
  id,
  parentId,
  projectId: 'p1',
  code: id,
  title: id,
  itemType: 'task',
  executionType: 'manual',
  status,
  priority: 'normal',
  progressPercent: status === 'done' ? 100 : 0,
  sortOrder: 0,
  depth: parentId ? 1 : 0,
  createdBy: 'u1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const actor: WorkspaceActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin: true,
  canManage: true,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

/** Cha `parent` có một việc con đã xong; `linked` là cha có hồ sơ Quy trình gắn (chưa hoàn tất). */
function setup(settings: Record<string, string>, options: { linked: boolean; requiresConfirmation?: boolean }) {
  const items = [item('parent', 'in_progress'), item('child', 'done', 'parent')];
  const reference = {
    id: 'ref1',
    entityType: 'work_item',
    entityId: 'parent',
    projectId: 'p1',
    cachedStatus: 'running' as string | undefined,
  };
  const changes: { id: string; next: WorkItemStatus }[] = [];
  const store = {
    settings: { get: async () => settings },
    project: {
      findById: async () => ({ id: 'p1', progressMethod: 'weighted_hours' }),
      updateProgress: async () => undefined,
    },
    procedureRequest: { listByProject: async () => [] },
    externalRef: {
      findByExternalId: async () => reference,
      refreshCache: async (_t: string, updates: { cachedStatus?: string }[]) => {
        reference.cachedStatus = updates[0].cachedStatus;
      },
    },
    workItem: {
      findById: async (_t: string, id: string) => items.find((entry) => entry.id === id),
      progressRows: async () =>
        items.map((entry) => ({
          id: entry.id,
          parentId: entry.parentId ?? null,
          status: entry.status,
          progressPercent: entry.progressPercent,
          estimateHours: null,
          requiresConfirmation: entry.id === 'parent' && options.requiresConfirmation === true,
          procedureState:
            entry.id !== 'parent' || !options.linked
              ? 'none'
              : reference.cachedStatus === 'completed'
                ? 'completed'
                : reference.cachedStatus === 'rejected' || reference.cachedStatus === 'cancelled'
                  ? 'failed'
                  : 'running',
        })),
      applyProgress: async () => undefined,
      openChildCount: async () => 0,
      changeStatus: async (_t: string, id: string, _a: string, next: WorkItemStatus) => {
        changes.push({ id, next });
        const target = items.find((entry) => entry.id === id) as WorkItem;
        (target as { status: WorkItemStatus }).status = next;
        return target;
      },
    },
    dependency: { listBySuccessor: async () => [] },
  } as unknown as WorkspaceStore;
  const workItems = new WorkItemService(store, new ProjectService(store));
  const events = new WorkspaceProcedureEvents(store, workItems, {} as never);
  const completed = (status: string) =>
    events.handle('t1', PROCEDURE_INSTANCE_COMPLETED, { instanceId: 'i1', instanceCode: 'HS-1', status });
  return { workItems, changes, completed, reference };
}

const recalc = (workItems: WorkItemService) =>
  (workItems as unknown as { recalculate(a: WorkspaceActor, p: string): Promise<void> }).recalculate(actor, 'p1');

describe('Cha tự đóng khi việc con xong, theo cài đặt liên kết Quy trình', () => {
  it('mặc định: cha chuyển Hoàn thành, gọi lại không đổi thêm', async () => {
    const { workItems, changes } = setup({}, { linked: false });
    await recalc(workItems);
    await recalc(workItems);
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
  });

  it('onAllChildrenDone = review: cha chuyển Chờ duyệt, không lặp', async () => {
    const { workItems, changes } = setup({ onAllChildrenDone: 'review' }, { linked: false });
    await recalc(workItems);
    await recalc(workItems);
    expect(changes).toEqual([{ id: 'parent', next: 'review' }]);
  });

  it('onAllChildrenDone = none: không bao giờ tự đóng, kể cả khi hồ sơ cha hoàn tất', async () => {
    const { workItems, changes, completed } = setup(
      { onAllChildrenDone: 'none', parentWaitsForProcedure: 'wait' },
      { linked: true },
    );
    await recalc(workItems);
    await completed('completed');
    expect(changes).toEqual([]);
  });

  it('wait + cha có hồ sơ: chưa đóng; hồ sơ hoàn tất sau đó thì cha đóng', async () => {
    const { workItems, changes, completed } = setup({ parentWaitsForProcedure: 'wait' }, { linked: true });
    await recalc(workItems);
    expect(changes).toEqual([]);
    await completed('completed');
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
    await completed('completed');
    expect(changes).toHaveLength(1);
  });

  it('wait + hồ sơ bị từ chối: cha vẫn chờ', async () => {
    const { workItems, changes, completed, reference } = setup({ parentWaitsForProcedure: 'wait' }, { linked: true });
    await recalc(workItems);
    await completed('rejected');
    expect(reference.cachedStatus).toBe('rejected');
    expect(changes).toEqual([]);
  });

  it.each(['rejected', 'cancelled'])('wait + hồ sơ %s + keep_waiting (mặc định): cha vẫn chờ', async (status) => {
    const { workItems, changes, completed } = setup(
      { parentWaitsForProcedure: 'wait', parentProcedureEnded: 'keep_waiting' },
      { linked: true },
    );
    await recalc(workItems);
    await completed(status);
    expect(changes).toEqual([]);
  });

  it.each(['rejected', 'cancelled'])('wait + hồ sơ %s + stop_waiting: cha đóng, giao lại sự kiện không đổi thêm', async (status) => {
    const { workItems, changes, completed, reference } = setup(
      { parentWaitsForProcedure: 'wait', parentProcedureEnded: 'stop_waiting' },
      { linked: true },
    );
    await recalc(workItems);
    expect(changes).toEqual([]);
    await completed(status);
    expect(reference.cachedStatus).toBe(status);
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
    await completed(status);
    expect(changes).toHaveLength(1);
  });

  it('stop_waiting + onAllChildrenDone = review: hồ sơ bị từ chối thì cha sang Chờ duyệt', async () => {
    const { workItems, changes, completed } = setup(
      { onAllChildrenDone: 'review', parentWaitsForProcedure: 'wait', parentProcedureEnded: 'stop_waiting' },
      { linked: true },
    );
    await recalc(workItems);
    await completed('rejected');
    expect(changes).toEqual([{ id: 'parent', next: 'review' }]);
  });

  it('stop_waiting bị bỏ qua khi no_wait: cha đã đóng ngay từ đầu, không đổi thêm', async () => {
    const { workItems, changes, completed } = setup(
      { parentWaitsForProcedure: 'no_wait', parentProcedureEnded: 'stop_waiting' },
      { linked: true },
    );
    await recalc(workItems);
    await completed('rejected');
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
  });

  it('stop_waiting bị bỏ qua khi onAllChildrenDone = none: cha không tự đóng', async () => {
    const { workItems, changes, completed } = setup(
      { onAllChildrenDone: 'none', parentWaitsForProcedure: 'wait', parentProcedureEnded: 'stop_waiting' },
      { linked: true },
    );
    await recalc(workItems);
    await completed('cancelled');
    expect(changes).toEqual([]);
  });

  it('stop_waiting không ảnh hưởng cha không có hồ sơ', async () => {
    const { workItems, changes } = setup(
      { parentWaitsForProcedure: 'wait', parentProcedureEnded: 'stop_waiting' },
      { linked: false },
    );
    await recalc(workItems);
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
  });

  it('stop_waiting: hồ sơ hoàn tất vẫn đóng cha như trước', async () => {
    const { workItems, changes, completed } = setup(
      { parentWaitsForProcedure: 'wait', parentProcedureEnded: 'stop_waiting' },
      { linked: true },
    );
    await recalc(workItems);
    await completed('completed');
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
  });

  it('wait + cha không có hồ sơ: đóng như bình thường', async () => {
    const { workItems, changes } = setup({ parentWaitsForProcedure: 'wait' }, { linked: false });
    await recalc(workItems);
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
  });

  it('no_wait + cha có hồ sơ: việc con xong là cha đóng, không chờ hồ sơ', async () => {
    const { workItems, changes } = setup({ parentWaitsForProcedure: 'no_wait' }, { linked: true });
    await recalc(workItems);
    expect(changes).toEqual([{ id: 'parent', next: 'done' }]);
  });

  it('cha có điều kiện hoàn thành bắt buộc vẫn không tự đóng dù hồ sơ hoàn tất', async () => {
    const { workItems, changes, completed } = setup(
      { parentWaitsForProcedure: 'wait' },
      { linked: true, requiresConfirmation: true },
    );
    await recalc(workItems);
    await completed('completed');
    expect(changes).toEqual([]);
  });
});
