import type { WorkItem, WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import { statusPath } from '../domain/procedure-outcome.rules.js';
import { WorkspaceProcedureEvents } from './procedure-link-events.js';
import { ProjectService } from './project.service.js';
import { WorkItemService } from './work-item.service.js';
import type { WorkItemDeletionService } from './work-item-deletion.service.js';
import type { FinanceService } from './finance.service.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const T = 't1';

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: 'CV-001',
    title: 'Việc',
    itemType: 'task',
    executionType: 'procedure',
    status: 'in_progress',
    priority: 'normal',
    progressPercent: 40,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u-owner',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(items: WorkItem[], procedureLink: Record<string, string> = {}, deps: { predecessorId: string; successorId: string }[] = []) {
  const byId = new Map(items.map((entry) => [entry.id, { ...entry }]));
  const statusCalls: { id: string; next: WorkItemStatus; note?: string }[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const removedRefs: string[] = [];
  const store = {
    settings: { get: async (_t: string, key: string) => (key === 'procedure_link' ? procedureLink : undefined) },
    project: { findById: async () => ({ id: 'p1', code: 'DA' }), updateProgress: async () => undefined },
    workItem: {
      findById: async (_t: string, id: string) => byId.get(id),
      listByProject: async () => [...byId.values()],
      progressRows: async () => [],
      applyProgress: async () => undefined,
      openChildCount: async (_t: string, id: string) =>
        [...byId.values()].filter((n) => n.parentId === id && n.status !== 'done' && n.status !== 'cancelled').length,
      changeStatus: async (_t: string, id: string, _a: string, next: WorkItemStatus, note?: string) => {
        statusCalls.push({ id, next, note });
        const current = byId.get(id) as WorkItem;
        const updated = { ...current, status: next, progressPercent: next === 'done' || next === 'review' ? 100 : current.progressPercent };
        byId.set(id, updated);
        return updated;
      },
      update: async (_t: string, id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch });
        return byId.get(id) as WorkItem;
      },
      listProgressReports: async () => [],
      addProgressReport: async () => undefined,
    },
    dependency: {
      listBySuccessor: async (_t: string, successorId: string) =>
        deps.filter((edge) => edge.successorId === successorId).map((edge) => ({ ...edge, dependencyType: 'FS' })),
    },
    externalRef: {
      listByEntity: async () => [],
      refreshCache: async () => undefined,
      findByExternalId: async (_t: string, _m: string, externalId: string) =>
        externalId === 'inst-1'
          ? { id: 'ref-1', entityType: 'work_item', entityId: 'w1', projectId: 'p1', moduleKey: 'procedure-engine', externalId }
          : undefined,
      remove: async (_t: string, id: string) => {
        removedRefs.push(id);
      },
    },
    standaloneTask: {
      applyProcedureOutcome: jest.fn(async () => undefined),
      markProcedureStarted: jest.fn(async () => undefined),
      applyProcedureStarted: jest.fn(async () => undefined),
    },
    procedureRequest: { revertToManual: jest.fn(async () => undefined) },
  } as unknown as WorkspaceStore;
  const service = new WorkItemService(store, new ProjectService(store));
  return { store, service, statusCalls, updates, removedRefs, byId };
}

const apply = (s: ReturnType<typeof setup>, kind: 'started' | 'completed' | 'rejected' | 'cancelled' | 'deleted') =>
  s.service.applyProcedureOutcome(T, 'w1', kind, { instanceCode: 'PR-1' });

describe('statusPath', () => {
  it('đi thẳng khi hợp lệ, đi vòng qua Đang làm khi cần, không có đường thì undefined', () => {
    expect(statusPath('in_progress', 'review')).toEqual(['review']);
    expect(statusPath('review', 'todo')).toEqual(['in_progress', 'todo']);
    expect(statusPath('done', 'blocked')).toBeUndefined();
    expect(statusPath('todo', 'todo')).toEqual([]);
  });
});

describe('applyProcedureOutcome: hồ sơ hoàn tất (công việc trong dự án)', () => {
  it('mặc định (none): không đổi gì', async () => {
    const s = setup([item({ id: 'w1' })]);
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([]);
    expect(s.updates).toEqual([]);
  });

  it('progress100: chỉ đặt 100%, giữ trạng thái', async () => {
    const s = setup([item({ id: 'w1' })], { onCompletedWorkItem: 'progress100' });
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([]);
    expect(s.updates).toEqual([{ id: 'w1', patch: { manualProgressPercent: 100 } }]);
  });

  it('progress100: việc đã 100% thì gọi lại không ghi thêm', async () => {
    const s = setup([item({ id: 'w1', progressPercent: 100 })], { onCompletedWorkItem: 'progress100' });
    await apply(s, 'completed');
    expect(s.updates).toEqual([]);
  });

  it('review: chuyển Chờ duyệt kèm ghi chú tiếng Việt; gọi lại không đổi thêm', async () => {
    const s = setup([item({ id: 'w1' })], { onCompletedWorkItem: 'review' });
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([{ id: 'w1', next: 'review', note: 'Hồ sơ quy trình PR-1 đã hoàn tất.' }]);
    await apply(s, 'completed');
    expect(s.statusCalls).toHaveLength(1);
  });

  it('done: chuyển Hoàn thành; việc đã Hoàn thành thì bỏ qua', async () => {
    const s = setup([item({ id: 'w1' })], { onCompletedWorkItem: 'done' });
    await apply(s, 'completed');
    expect(s.statusCalls.map((call) => call.next)).toEqual(['done']);
    await apply(s, 'completed');
    expect(s.statusCalls).toHaveLength(1);
  });

  it('respect: tiền nhiệm FS chưa xong thì chỉ đặt 100%, không đổi trạng thái', async () => {
    const s = setup(
      [item({ id: 'w1' }), item({ id: 'pre', status: 'in_progress', code: 'CV-000' })],
      { onCompletedWorkItem: 'done', completedGuards: 'respect' },
      [{ predecessorId: 'pre', successorId: 'w1' }],
    );
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([]);
    expect(s.updates).toEqual([{ id: 'w1', patch: { manualProgressPercent: 100 } }]);
  });

  it('respect: điều kiện hoàn thành chưa xác nhận thì chỉ đặt 100%', async () => {
    const s = setup(
      [item({ id: 'w1', completion: { rule: 'all', conditions: [{ id: 'c1', label: 'Có biên bản' }] } as never })],
      { onCompletedWorkItem: 'done', completedGuards: 'respect' },
    );
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([]);
    expect(s.updates).toHaveLength(1);
  });

  it('force: bỏ qua tiền nhiệm FS và điều kiện hoàn thành', async () => {
    const s = setup(
      [
        item({ id: 'w1', completion: { rule: 'all', conditions: [{ id: 'c1', label: 'Có biên bản' }] } as never }),
        item({ id: 'pre', status: 'in_progress', code: 'CV-000' }),
      ],
      { onCompletedWorkItem: 'done', completedGuards: 'force' },
      [{ predecessorId: 'pre', successorId: 'w1' }],
    );
    await apply(s, 'completed');
    expect(s.statusCalls.map((call) => call.next)).toEqual(['done']);
  });

  it('force: vẫn không đóng việc còn việc con chưa đóng', async () => {
    const s = setup(
      [item({ id: 'w1' }), item({ id: 'child', parentId: 'w1', status: 'in_progress', code: 'CV-002' })],
      { onCompletedWorkItem: 'done', completedGuards: 'force' },
    );
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([]);
    expect(s.updates).toEqual([]);
  });

  it('việc đã huỷ hiệu lực hoặc đã huỷ thì bỏ qua', async () => {
    const s = setup([item({ id: 'w1', status: 'cancelled' })], { onCompletedWorkItem: 'done' });
    await apply(s, 'completed');
    expect(s.statusCalls).toEqual([]);
  });
});

describe('applyProcedureOutcome: hồ sơ bị từ chối / huỷ', () => {
  it('none (mặc định): không đổi gì', async () => {
    const s = setup([item({ id: 'w1' })]);
    await apply(s, 'rejected');
    await apply(s, 'cancelled');
    expect(s.statusCalls).toEqual([]);
  });

  it('rejected -> blocked kèm lý do chứa mã hồ sơ', async () => {
    const s = setup([item({ id: 'w1' })], { onRejected: 'blocked' });
    await apply(s, 'rejected');
    expect(s.statusCalls).toEqual([{ id: 'w1', next: 'blocked', note: expect.stringContaining('PR-1') }]);
    expect(s.statusCalls[0]?.note).toContain('bị từ chối');
    await apply(s, 'rejected');
    expect(s.statusCalls).toHaveLength(1);
  });

  it('rejected -> todo, rejected -> cancelled', async () => {
    const todo = setup([item({ id: 'w1' })], { onRejected: 'todo' });
    await apply(todo, 'rejected');
    expect(todo.statusCalls.map((call) => call.next)).toEqual(['todo']);
    const cancelled = setup([item({ id: 'w1' })], { onRejected: 'cancelled' });
    await apply(cancelled, 'rejected');
    expect(cancelled.statusCalls.map((call) => call.next)).toEqual(['cancelled']);
  });

  it('cancelled dùng cài đặt riêng onCancelled, không lẫn với onRejected', async () => {
    const s = setup([item({ id: 'w1' })], { onRejected: 'todo', onCancelled: 'blocked' });
    await apply(s, 'cancelled');
    expect(s.statusCalls).toEqual([{ id: 'w1', next: 'blocked', note: expect.stringContaining('đã bị huỷ') }]);
  });

  it('Chờ duyệt -> Chưa làm đi vòng qua Đang làm', async () => {
    const s = setup([item({ id: 'w1', status: 'review' })], { onRejected: 'todo' });
    await apply(s, 'rejected');
    expect(s.statusCalls.map((call) => call.next)).toEqual(['in_progress', 'todo']);
  });

  it('việc đã Hoàn thành thì giữ nguyên; huỷ việc còn việc con mở thì bỏ qua', async () => {
    const done = setup([item({ id: 'w1', status: 'done' })], { onRejected: 'blocked' });
    await apply(done, 'rejected');
    expect(done.statusCalls).toEqual([]);
    const parent = setup(
      [item({ id: 'w1' }), item({ id: 'c', parentId: 'w1', status: 'todo', code: 'CV-2' })],
      { onCancelled: 'cancelled' },
    );
    await apply(parent, 'cancelled');
    expect(parent.statusCalls).toEqual([]);
  });
});

describe('applyProcedureOutcome: hồ sơ bắt đầu / bị xoá', () => {
  it('started: none giữ nguyên; in_progress chỉ đổi việc Chưa làm', async () => {
    const none = setup([item({ id: 'w1', status: 'todo' })]);
    await apply(none, 'started');
    expect(none.statusCalls).toEqual([]);
    const on = setup([item({ id: 'w1', status: 'todo' })], { onStarted: 'in_progress' });
    await apply(on, 'started');
    expect(on.statusCalls.map((call) => call.next)).toEqual(['in_progress']);
    const blocked = setup([item({ id: 'w1', status: 'blocked' })], { onStarted: 'in_progress' });
    await apply(blocked, 'started');
    expect(blocked.statusCalls).toEqual([]);
  });

  it('deleted: chỉ cancel_item mới huỷ công việc', async () => {
    const keep = setup([item({ id: 'w1' })], { onInstanceDeleted: 'unlink_keep' });
    await apply(keep, 'deleted');
    expect(keep.statusCalls).toEqual([]);
    const cancel = setup([item({ id: 'w1' })], { onInstanceDeleted: 'cancel_item' });
    await apply(cancel, 'deleted');
    expect(cancel.statusCalls.map((call) => call.next)).toEqual(['cancelled']);
  });
});

describe('WorkspaceProcedureEvents: áp cài đặt liên kết hồ sơ', () => {
  function eventsFor(s: ReturnType<typeof setup>) {
    const removeForProcedure = jest.fn(async () => undefined);
    const events = new WorkspaceProcedureEvents(
      s.store,
      s.service,
      {} as FinanceService,
      undefined,
      { removeForProcedure } as unknown as WorkItemDeletionService,
    );
    return { events, removeForProcedure };
  }
  const completedPayload = { instanceId: 'inst-1', instanceCode: 'PR-1', status: 'completed' };

  it('hồ sơ hoàn tất tìm công việc qua liên kết ngoài rồi áp cài đặt', async () => {
    const s = setup([item({ id: 'w1' })], { onCompletedWorkItem: 'review' });
    await eventsFor(s).events.handle(T, 'procedure.instance.completed', completedPayload);
    expect(s.statusCalls.map((call) => call.next)).toEqual(['review']);
  });

  it('hồ sơ không gắn công việc nào thì bỏ qua, không lỗi', async () => {
    const s = setup([item({ id: 'w1' })], { onCompletedWorkItem: 'review' });
    await eventsFor(s).events.handle(T, 'procedure.instance.completed', { ...completedPayload, instanceId: 'khac' });
    expect(s.statusCalls).toEqual([]);
  });

  it('rejected và cancelled đi theo cài đặt tương ứng', async () => {
    const s = setup([item({ id: 'w1' })], { onRejected: 'blocked' });
    await eventsFor(s).events.handle(T, 'procedure.instance.completed', { ...completedPayload, status: 'rejected' });
    expect(s.statusCalls.map((call) => call.next)).toEqual(['blocked']);
  });

  it('việc ngoài dự án: truyền cài đặt xuống store', async () => {
    const s = setup([], { onCompletedStandalone: 'always_done', onRejected: 'todo', onCancelled: 'blocked' });
    await eventsFor(s).events.handle(T, 'procedure.instance.completed', {
      ...completedPayload,
      sourceType: 'workspace_standalone_task',
    });
    expect(s.store.standaloneTask.applyProcedureOutcome).toHaveBeenCalledWith(
      T,
      'inst-1',
      'completed',
      'PR-1',
      expect.any(String),
      expect.objectContaining({ onCompletedStandalone: 'always_done', onRejected: 'todo', onCancelled: 'blocked' }),
    );
  });

  it('onReversed: none thì không huỷ hiệu lực công việc', async () => {
    const reverse = jest.fn(async () => undefined);
    const store = { settings: { get: async () => ({ onReversed: 'none' }) } } as unknown as WorkspaceStore;
    const events = new WorkspaceProcedureEvents(store, { reverseForProcedure: reverse } as unknown as WorkItemService, {} as FinanceService);
    await events.handle(T, 'procedure.instance.reversed', {
      instanceId: 'inst-1',
      instanceCode: 'PR-1',
      workItemId: 'w1',
      reason: 'sai',
      reversedBy: 'u',
      adjustmentRequested: false,
    });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('onReversed: cascade (mặc định) vẫn huỷ hiệu lực công việc', async () => {
    const reverse = jest.fn(async () => undefined);
    const store = { settings: { get: async () => undefined } } as unknown as WorkspaceStore;
    const events = new WorkspaceProcedureEvents(store, { reverseForProcedure: reverse } as unknown as WorkItemService, {} as FinanceService);
    await events.handle(T, 'procedure.instance.reversed', {
      instanceId: 'inst-1',
      instanceCode: 'PR-1',
      workItemId: 'w1',
      reason: 'sai',
      reversedBy: 'u',
      adjustmentRequested: false,
    });
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  const deletedPayload = { instanceId: 'inst-1', instanceCode: 'PR-1', reason: 'nhập nhầm', deletedBy: 'u' };

  it('onInstanceDeleted: delete_item (mặc định) xoá công việc', async () => {
    const s = setup([item({ id: 'w1' })]);
    const { events, removeForProcedure } = eventsFor(s);
    await events.handle(T, 'procedure.instance.deleted', deletedPayload);
    expect(removeForProcedure).toHaveBeenCalledTimes(1);
    expect(s.removedRefs).toEqual([]);
  });

  it('onInstanceDeleted: unlink_keep gỡ liên kết, giữ công việc nguyên trạng', async () => {
    const s = setup([item({ id: 'w1' })], { onInstanceDeleted: 'unlink_keep' });
    const { events, removeForProcedure } = eventsFor(s);
    await events.handle(T, 'procedure.instance.deleted', deletedPayload);
    expect(removeForProcedure).not.toHaveBeenCalled();
    expect(s.removedRefs).toEqual(['ref-1']);
    expect(s.statusCalls).toEqual([]);
    // Không còn hồ sơ: việc trả về Thủ công để "Nhập tay tiến độ: chặn" không còn áp.
    expect(s.store.procedureRequest.revertToManual).toHaveBeenCalledWith(T, 'w1');
  });

  it('onInstanceDeleted: cancel_item gỡ liên kết rồi huỷ công việc', async () => {
    const s = setup([item({ id: 'w1' })], { onInstanceDeleted: 'cancel_item' });
    const { events, removeForProcedure } = eventsFor(s);
    await events.handle(T, 'procedure.instance.deleted', deletedPayload);
    expect(removeForProcedure).not.toHaveBeenCalled();
    expect(s.removedRefs).toEqual(['ref-1']);
    expect(s.statusCalls.map((call) => call.next)).toEqual(['cancelled']);
    expect(s.store.procedureRequest.revertToManual).toHaveBeenCalledWith(T, 'w1');
  });

  it('onInstanceDeleted: delete_item không cần trả về Thủ công (công việc bị xoá)', async () => {
    const s = setup([item({ id: 'w1' })]);
    await eventsFor(s).events.handle(T, 'procedure.instance.deleted', deletedPayload);
    expect(s.store.procedureRequest.revertToManual).not.toHaveBeenCalled();
  });

  it('onStarted: việc ngoài dự án cũng sang Đang làm khi cài đặt bật', async () => {
    const on = setup([], { onStarted: 'in_progress' });
    await eventsFor(on).events.handle(T, 'procedure.instance.started_for_standalone_task', {
      taskId: 'st1',
      instanceId: 'inst-1',
      instanceCode: 'PR-1',
    });
    expect(on.store.standaloneTask.markProcedureStarted).toHaveBeenCalledTimes(1);
    expect(on.store.standaloneTask.applyProcedureStarted).toHaveBeenCalledWith(T, 'st1', 'PR-1', expect.any(String));
    const off = setup([]);
    await eventsFor(off).events.handle(T, 'procedure.instance.started_for_standalone_task', {
      taskId: 'st1',
      instanceId: 'inst-1',
      instanceCode: 'PR-1',
    });
    expect(off.store.standaloneTask.applyProcedureStarted).not.toHaveBeenCalled();
  });

  it('onStarted: hồ sơ đã mở cho công việc đưa việc Chưa làm sang Đang làm', async () => {
    const s = setup([item({ id: 'w1', status: 'todo' })], { onStarted: 'in_progress' });
    const markStarted = jest.fn(async () => undefined);
    Object.assign(s.store, { procedureRequest: { markStarted } });
    await eventsFor(s).events.handle(T, 'procedure.instance.started_for_work_item', {
      workItemId: 'w1',
      instanceId: 'inst-1',
      instanceCode: 'PR-1',
      title: 'x',
      status: 'running',
    });
    expect(markStarted).toHaveBeenCalledTimes(1);
    expect(s.statusCalls.map((call) => call.next)).toEqual(['in_progress']);
  });
});
