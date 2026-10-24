import { randomUUID } from 'node:crypto';
import type { StandaloneTask, WorkItemStatus } from '@enterprise-platform/contracts-workspace';
import type { DirectoryService } from './directory.service.js';
import { StandaloneTaskService } from './standalone-task.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type {
  StandaloneTaskCreateModel,
  StandaloneTaskWriteModel,
  WorkspaceStore,
} from './workspace-store.port.js';

const BOSS = '11111111-1111-4111-8111-111111111111';
const DOER = '22222222-2222-4222-8222-222222222222';
const HELPER = '33333333-3333-4333-8333-333333333333';
const WATCHER = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';

const actor = (userId: string, isTenantAdmin = false): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin,
  canManage: isTenantAdmin,
  canWriteTasks: true,
  canWriteDocuments: false,
  canDeleteDocuments: false,
});

/** Store trong bộ nhớ, đủ cho các luật của service. Số việc con tính lúc đọc. */
function makeStore() {
  const tasks = new Map<string, StandaloneTask>();
  const statusCalls: { from: WorkItemStatus; next: WorkItemStatus; note?: string }[] = [];
  const created: StandaloneTaskCreateModel[] = [];
  const reversals: { id: string; notifyProcedure: boolean; adjustmentRequested: boolean }[] = [];
  let removed: string | undefined;

  const withCounts = (task: StandaloneTask | undefined): StandaloneTask | undefined => {
    if (!task) return undefined;
    const kids = [...tasks.values()].filter((other) => other.parentId === task.id);
    return {
      ...task,
      childCount: kids.length,
      openChildCount: kids.filter((kid) => kid.status !== 'done' && kid.status !== 'cancelled')
        .length,
    };
  };
  const subtree = (id: string): StandaloneTask[] => {
    const self = withCounts(tasks.get(id));
    if (!self) return [];
    const kids = [...tasks.values()].filter((other) => other.parentId === id);
    return [self, ...kids.flatMap((kid) => subtree(kid.id))];
  };
  const people = (task: StandaloneTask) => [
    task.createdBy,
    task.assigneeUserId,
    ...task.participantUserIds,
    ...task.followerUserIds,
  ];

  const store = {
    standaloneTask: {
      findById: async (_tenant: string, id: string) => withCounts(tasks.get(id)),
      adjustments: async (_tenant: string, id: string) =>
        [...tasks.values()]
          .filter((task) => task.adjustmentOfId === id)
          .map(({ id: taskId, code, title, status }) => ({ id: taskId, code, title, status })),
      history: async () => [],
      children: async (_tenant: string, id: string) =>
        [...tasks.values()].filter((task) => task.parentId === id).map((t) => withCounts(t)),
      subtree: async (_tenant: string, id: string) => subtree(id),
      ancestors: async (_tenant: string, id: string) => {
        const chain = [];
        let current = tasks.get(id)?.parentId;
        while (current) {
          const parent = tasks.get(current) as StandaloneTask;
          chain.unshift({ id: parent.id, code: parent.code, title: parent.title });
          current = parent.parentId;
        }
        return chain;
      },
      isTreeMember: async (_tenant: string, rootId: string, userId: string) =>
        [...tasks.values()].some((task) => task.rootId === rootId && people(task).includes(userId)),
      create: async (_tenant: string, actorUserId: string, input: StandaloneTaskCreateModel) => {
        created.push(input);
        const id = randomUUID();
        const parent = input.parentId ? tasks.get(input.parentId) : undefined;
        const task: StandaloneTask = {
          id,
          code: `GV00${tasks.size + 1}`,
          title: input.title,
          description: input.description ?? undefined,
          status: 'todo',
          priority: input.priority,
          parentId: input.parentId ?? undefined,
          rootId: parent ? parent.rootId : id,
          depth: parent ? parent.depth + 1 : 0,
          childCount: 0,
          openChildCount: 0,
          executionType: input.executionType,
          procedure: input.procedureDefinitionId
            ? { definitionId: input.procedureDefinitionId, status: 'pending' }
            : undefined,
          adjustmentOfId: input.adjustmentOfId ?? undefined,
          assigneeUserId: input.assigneeUserId,
          participantUserIds: input.participantUserIds,
          followerUserIds: input.followerUserIds,
          plannedStart: input.plannedStart ?? undefined,
          dueDate: input.dueDate ?? undefined,
          progressPercent: 0,
          createdBy: actorUserId,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          statusChangedAt: '2026-10-01T00:00:00.000Z',
        };
        tasks.set(task.id, task);
        return withCounts(task);
      },
      update: async (
        _tenant: string,
        id: string,
        _actor: string,
        input: Partial<StandaloneTaskWriteModel> & { progressPercent?: number },
      ) => {
        const current = tasks.get(id) as StandaloneTask;
        const next = { ...current, ...input } as StandaloneTask;
        tasks.set(id, next);
        return withCounts(next);
      },
      changeStatus: async (
        _tenant: string,
        id: string,
        _actor: string,
        from: WorkItemStatus,
        next: WorkItemStatus,
        note?: string,
      ) => {
        statusCalls.push({ from, next, note });
        const current = tasks.get(id) as StandaloneTask;
        if (current.status !== from) return undefined;
        const updated = { ...current, status: next };
        tasks.set(id, updated);
        return withCounts(updated);
      },
      remove: async (_tenant: string, id: string) => {
        removed = id;
        tasks.delete(id);
      },
      reverse: async (
        _tenant: string,
        id: string,
        input: { reversedBy: string; reason: string; notifyProcedure: boolean; adjustmentRequested: boolean },
      ) => {
        reversals.push({ id, notifyProcedure: input.notifyProcedure, adjustmentRequested: input.adjustmentRequested });
        const current = tasks.get(id) as StandaloneTask;
        const next: StandaloneTask = {
          ...current,
          status: 'cancelled',
          reversal: {
            reversedAt: '2026-10-14T00:00:00.000Z',
            reversedBy: input.reversedBy,
            reason: input.reason,
            adjustmentRequested: input.adjustmentRequested,
          },
        };
        tasks.set(id, next);
        return withCounts(next);
      },
    },
  } as unknown as WorkspaceStore;

  return {
    store,
    tasks,
    statusCalls,
    created,
    reversals,
    removed: () => removed,
  };
}

function makeDirectory(known: readonly string[] = [BOSS, DOER, HELPER, WATCHER]) {
  return {
    unknownUserIds: async (_tenant: string, ids: readonly string[]) =>
      ids.filter((id) => !known.includes(id)),
  } as unknown as DirectoryService;
}

async function seeded(status: WorkItemStatus = 'todo') {
  const fixture = makeStore();
  const service = new StandaloneTaskService(fixture.store, makeDirectory());
  const created = await service.create(actor(BOSS), {
    title: '  Soạn báo giá  ',
    assigneeUserId: DOER,
    participantUserIds: [HELPER, DOER],
    followerUserIds: [WATCHER, HELPER],
    dueDate: '2026-10-20',
  });
  const id = created.task.id;
  fixture.tasks.set(id, { ...(fixture.tasks.get(id) as StandaloneTask), status });
  return { ...fixture, service, id };
}

describe('StandaloneTaskService.create', () => {
  it('chuẩn hoá đầu vào và mỗi người chỉ giữ một vai', async () => {
    const { service, id, tasks } = await seeded();
    const task = tasks.get(id) as StandaloneTask;
    expect(task.title).toBe('Soạn báo giá');
    expect(task.participantUserIds).toEqual([HELPER]);
    expect(task.followerUserIds).toEqual([WATCHER]);
    const detail = await service.detail(actor(BOSS), id);
    expect(detail.myRole).toBe('assigner');
  });

  it('từ chối người không có trong tổ chức', async () => {
    const { store } = makeStore();
    const service = new StandaloneTaskService(store, makeDirectory());
    await expect(
      service.create(actor(BOSS), { title: 'X', assigneeUserId: STRANGER }),
    ).rejects.toThrow(/không thuộc tổ chức/);
  });

  it('bắt buộc chọn người phụ trách', async () => {
    const { store } = makeStore();
    const service = new StandaloneTaskService(store, makeDirectory());
    await expect(
      service.create(actor(BOSS), { title: 'X', assigneeUserId: '' }),
    ).rejects.toThrow(/người phụ trách/);
  });

  it('hạn phải sau ngày bắt đầu', async () => {
    const { store } = makeStore();
    const service = new StandaloneTaskService(store, makeDirectory());
    await expect(
      service.create(actor(BOSS), {
        title: 'X',
        assigneeUserId: DOER,
        plannedStart: '2026-10-10',
        dueDate: '2026-10-01',
      }),
    ).rejects.toThrow(/Hạn hoàn thành phải sau/);
  });
});

describe('StandaloneTaskService quyền xem', () => {
  it('người không liên quan nhận 404, kể cả quản trị tenant', async () => {
    const { service, id } = await seeded();
    await expect(service.detail(actor(STRANGER), id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.detail(actor(STRANGER, true), id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('StandaloneTaskService.changeStatus', () => {
  it('người thực hiện gửi duyệt, người giao duyệt hoàn thành', async () => {
    const { service, id } = await seeded('in_progress');
    const sent = await service.changeStatus(actor(DOER), id, { status: 'review' });
    expect(sent.task.status).toBe('review');
    await expect(
      service.changeStatus(actor(DOER), id, { status: 'done' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const approved = await service.changeStatus(actor(BOSS), id, { status: 'done' });
    expect(approved.task.status).toBe('done');
  });

  it('người cùng thực hiện cũng gửi duyệt được', async () => {
    const { service, id } = await seeded('in_progress');
    const sent = await service.changeStatus(actor(HELPER), id, { status: 'review' });
    expect(sent.task.status).toBe('review');
  });

  it('người theo dõi không đổi được trạng thái', async () => {
    const { service, id } = await seeded('todo');
    await expect(
      service.changeStatus(actor(WATCHER), id, { status: 'in_progress' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('trả lại cần lý do và ghi lý do vào nhật ký', async () => {
    const { service, id, statusCalls } = await seeded('review');
    await expect(
      service.changeStatus(actor(BOSS), id, { status: 'in_progress' }),
    ).rejects.toThrow(/lý do trả lại/);
    await service.changeStatus(actor(BOSS), id, { status: 'in_progress', note: ' Thiếu số liệu ' });
    expect(statusCalls.at(-1)).toEqual({
      from: 'review',
      next: 'in_progress',
      note: 'Thiếu số liệu',
    });
  });

  it('trạng thái bị người khác đổi trước thì báo xung đột', async () => {
    const { service, id, store, tasks } = await seeded('in_progress');
    const original = store.standaloneTask.findById;
    // Đọc thấy `in_progress`, nhưng lúc ghi thì việc đã sang `blocked`.
    (store.standaloneTask as { findById: typeof original }).findById = async (tenant, taskId) => {
      const value = await original(tenant, taskId);
      tasks.set(taskId, { ...(value as StandaloneTask), status: 'blocked' });
      return value;
    };
    await expect(
      service.changeStatus(actor(DOER), id, { status: 'review' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('StandaloneTaskService.update', () => {
  it('người thực hiện chỉ cập nhật được tiến độ', async () => {
    const { service, id } = await seeded('in_progress');
    const updated = await service.update(actor(DOER), id, { progressPercent: 40 });
    expect(updated.task.progressPercent).toBe(40);
    await expect(service.update(actor(DOER), id, { title: 'Khác' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('người giao đổi người phụ trách thì người cũ không còn giữ vai trùng', async () => {
    const { service, id } = await seeded('todo');
    const updated = await service.update(actor(BOSS), id, { assigneeUserId: HELPER });
    expect(updated.task.assigneeUserId).toBe(HELPER);
    expect(updated.task.participantUserIds).toEqual([]);
  });

  it('tiến độ ngoài 0–100 bị từ chối', async () => {
    const { service, id } = await seeded('in_progress');
    await expect(service.update(actor(DOER), id, { progressPercent: 120 })).rejects.toThrow(
      /0 đến 100/,
    );
  });
});

describe('StandaloneTaskService.remove', () => {
  it('chỉ người giao xoá được, và chỉ khi chưa làm hoặc đã huỷ', async () => {
    const todo = await seeded('todo');
    await expect(todo.service.remove(actor(DOER), todo.id)).rejects.toMatchObject({
      statusCode: 403,
    });
    await todo.service.remove(actor(BOSS), todo.id);
    expect(todo.removed()).toBe(todo.id);

    const running = await seeded('in_progress');
    await expect(running.service.remove(actor(BOSS), running.id)).rejects.toThrow(
      /chưa bắt đầu hoặc đã huỷ/,
    );
  });
});

describe('StandaloneTaskService việc con', () => {
  it('người phụ trách chia việc con; người tạo là người giao của việc con', async () => {
    const { service, id } = await seeded('in_progress');
    const child = await service.create(actor(DOER), {
      title: 'Lấy báo giá nhà cung cấp',
      assigneeUserId: HELPER,
      parentId: id,
    });
    expect(child.task.parentId).toBe(id);
    expect(child.task.depth).toBe(1);
    expect(child.myRole).toBe('assigner');
    const parent = await service.detail(actor(BOSS), id);
    expect(parent.children.map((task) => task.id)).toEqual([child.task.id]);
  });

  it('người cùng thực hiện và người theo dõi không tạo được việc con', async () => {
    const { service, id } = await seeded('in_progress');
    await expect(
      service.create(actor(HELPER), { title: 'X', assigneeUserId: HELPER, parentId: id }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.create(actor(WATCHER), { title: 'X', assigneeUserId: HELPER, parentId: id }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('không thêm việc con vào việc đã đóng', async () => {
    const { service, id } = await seeded('done');
    await expect(
      service.create(actor(BOSS), { title: 'X', assigneeUserId: HELPER, parentId: id }),
    ).rejects.toThrow(/đã đóng/);
  });

  it('người làm việc con được xem việc cha (viewer) để nắm bối cảnh', async () => {
    const { service, id } = await seeded('in_progress');
    const child = await service.create(actor(DOER), {
      title: 'Việc con',
      assigneeUserId: BOSS,
      parentId: id,
    });
    // BOSS là người giao việc gốc nên đã có vai; thử với người chỉ có ở việc con.
    const fixture = makeStore();
    const other = new StandaloneTaskService(fixture.store, makeDirectory());
    const root = await other.create(actor(BOSS), { title: 'Gốc', assigneeUserId: DOER });
    const leaf = await other.create(actor(DOER), {
      title: 'Lá',
      assigneeUserId: HELPER,
      parentId: root.task.id,
    });
    const view = await other.detail(actor(HELPER), root.task.id);
    expect(view.myRole).toBe('viewer');
    expect(view.allowedStatuses).toEqual([]);
    expect(view.canAddChild).toBe(false);
    await expect(
      other.changeStatus(actor(HELPER), root.task.id, { status: 'in_progress' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(leaf.task.rootId).toBe(root.task.id);
    expect(child.task.rootId).toBe(id);
  });

  it('việc gốc không gửi duyệt được khi còn việc con mở', async () => {
    const { service, id } = await seeded('in_progress');
    await service.create(actor(BOSS), { title: 'Con', assigneeUserId: HELPER, parentId: id });
    await expect(service.changeStatus(actor(DOER), id, { status: 'review' })).rejects.toThrow(
      /việc con chưa xong/,
    );
  });

  it('việc con: người thực hiện tự hoàn thành', async () => {
    const { service, id } = await seeded('in_progress');
    const child = await service.create(actor(BOSS), {
      title: 'Con',
      assigneeUserId: HELPER,
      parentId: id,
    });
    await service.changeStatus(actor(HELPER), child.task.id, { status: 'in_progress' });
    const done = await service.changeStatus(actor(HELPER), child.task.id, { status: 'done' });
    expect(done.task.status).toBe('done');
    const sent = await service.changeStatus(actor(DOER), id, { status: 'review' });
    expect(sent.task.status).toBe('review');
  });

  it('tiến độ việc cha không sửa tay được', async () => {
    const { service, id } = await seeded('in_progress');
    await service.create(actor(BOSS), { title: 'Con', assigneeUserId: HELPER, parentId: id });
    await expect(service.update(actor(DOER), id, { progressPercent: 50 })).rejects.toThrow(
      /tính tự động/,
    );
  });

  it('việc cha nhận tiến độ nhập tay (ưu tiên hơn tự tính); null quay về tự tính', async () => {
    const { service, id } = await seeded('in_progress');
    await service.create(actor(BOSS), { title: 'Con', assigneeUserId: HELPER, parentId: id });
    const manual = await service.update(actor(DOER), id, { manualProgressPercent: 70 });
    expect((manual.task as unknown as { manualProgressPercent: number }).manualProgressPercent).toBe(70);
    const cleared = await service.update(actor(DOER), id, { manualProgressPercent: null });
    expect((cleared.task as unknown as { manualProgressPercent: null }).manualProgressPercent).toBeNull();
    await expect(service.update(actor(DOER), id, { manualProgressPercent: 101 })).rejects.toThrow(
      /0 đến 100/,
    );
  });

  it('không xoá được việc cha khi có việc con đang làm', async () => {
    const { service, id, tasks } = await seeded('todo');
    const child = await service.create(actor(BOSS), {
      title: 'Con',
      assigneeUserId: HELPER,
      parentId: id,
    });
    tasks.set(child.task.id, { ...(tasks.get(child.task.id) as StandaloneTask), status: 'in_progress' });
    await expect(service.remove(actor(BOSS), id)).rejects.toThrow(/mọi việc con/);
  });
});

describe('StandaloneTaskService theo quy trình', () => {
  it('bắt buộc chọn quy trình và chuyển thông tin người yêu cầu xuống store', async () => {
    const { store, created } = makeStore();
    const service = new StandaloneTaskService(store, makeDirectory());
    await expect(
      service.create(actor(BOSS), { title: 'X', assigneeUserId: DOER, executionType: 'procedure' }),
    ).rejects.toThrow(/quy trình/);
    const detail = await service.create(actor(BOSS, true), {
      title: 'Mua vật tư',
      assigneeUserId: DOER,
      executionType: 'procedure',
      procedureDefinitionId: '66666666-6666-4666-8666-666666666666',
    });
    expect(detail.task.executionType).toBe('procedure');
    expect(created.at(-1)?.requester).toEqual({ displayName: BOSS, isTenantAdmin: true });
  });

  it('hồ sơ còn chạy: người thực hiện không gửi duyệt bằng tay', async () => {
    const { store } = makeStore();
    const service = new StandaloneTaskService(store, makeDirectory());
    const detail = await service.create(actor(BOSS), {
      title: 'Mua vật tư',
      assigneeUserId: DOER,
      executionType: 'procedure',
      procedureDefinitionId: '66666666-6666-4666-8666-666666666666',
    });
    await service.changeStatus(actor(DOER), detail.task.id, { status: 'in_progress' });
    await expect(
      service.changeStatus(actor(DOER), detail.task.id, { status: 'review' }),
    ).rejects.toThrow(/chờ hồ sơ quy trình/);
  });
});

describe('StandaloneTaskService.reverse (huỷ hiệu lực)', () => {
  it('người giao huỷ hiệu lực việc đã hoàn thành; sau đó không mở lại, không xoá được', async () => {
    const { service, id, reversals } = await seeded('done');
    const reversed = await service.reverse(actor(BOSS), id, { reason: 'Khách huỷ hợp đồng' });
    expect(reversed.task.status).toBe('cancelled');
    expect(reversed.task.reversal?.reason).toBe('Khách huỷ hợp đồng');
    expect(reversed.allowedStatuses).toEqual([]);
    expect(reversed.canReverse).toBe(false);
    expect(reversals).toEqual([{ id, notifyProcedure: true, adjustmentRequested: false }]);
    await expect(service.changeStatus(actor(BOSS), id, { status: 'todo' })).rejects.toThrow();
    await expect(service.remove(actor(BOSS), id)).rejects.toThrow(/giữ lại làm vết/);
  });

  it('chỉ người giao, chỉ việc đã hoàn thành, bắt buộc lý do', async () => {
    const done = await seeded('done');
    await expect(done.service.reverse(actor(DOER), done.id, { reason: 'abc' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(done.service.reverse(actor(BOSS), done.id, { reason: ' ' })).rejects.toThrow(
      /không được để trống/,
    );
    const running = await seeded('in_progress');
    await expect(
      running.service.reverse(actor(BOSS), running.id, { reason: 'abc' }),
    ).rejects.toThrow(/đã hoàn thành/);
  });

  it('còn việc con chưa huỷ thì phải huỷ hiệu lực việc con trước', async () => {
    const { service, id, tasks } = await seeded('in_progress');
    const child = await service.create(actor(BOSS), { title: 'Con', assigneeUserId: HELPER, parentId: id });
    tasks.set(child.task.id, { ...(tasks.get(child.task.id) as StandaloneTask), status: 'done' });
    tasks.set(id, { ...(tasks.get(id) as StandaloneTask), status: 'done' });
    await expect(service.reverse(actor(BOSS), id, { reason: 'abc' })).rejects.toThrow(
      /huỷ hiệu lực từng việc con trước/,
    );
    await service.reverse(actor(BOSS), child.task.id, { reason: 'abc' });
    const parent = await service.reverse(actor(BOSS), id, { reason: 'abc' });
    expect(parent.task.reversal).toBeDefined();
  });

  it('việc có hồ sơ đã hoàn tất: hỏi Quy trình trước, Quy trình từ chối thì không huỷ', async () => {
    const fixture = makeStore();
    const checker = { check: jest.fn().mockResolvedValue({ allowed: false, reason: 'Đã sinh phiếu vật tư' }) };
    const service = new StandaloneTaskService(fixture.store, makeDirectory(), checker);
    const detail = await service.create(actor(BOSS), { title: 'X', assigneeUserId: DOER });
    fixture.tasks.set(detail.task.id, {
      ...(fixture.tasks.get(detail.task.id) as StandaloneTask),
      status: 'done',
      executionType: 'procedure',
      procedure: { definitionId: 'd', status: 'completed', instanceId: 'inst-1' },
    });
    await expect(service.reverse(actor(BOSS), detail.task.id, { reason: 'abc' })).rejects.toThrow(
      /Đã sinh phiếu vật tư/,
    );
    expect(checker.check).toHaveBeenCalledWith('t1', 'inst-1');
    expect(fixture.reversals).toEqual([]);
  });
});

describe('StandaloneTaskService công việc điều chỉnh', () => {
  async function reversedTask() {
    const fixture = await seeded('done');
    await fixture.service.reverse(actor(BOSS), fixture.id, { reason: 'Sai số liệu', createAdjustment: true });
    return fixture;
  }

  it('ghi nhận yêu cầu điều chỉnh lúc huỷ và cho phép lập việc điều chỉnh', async () => {
    const { service, id, reversals } = await reversedTask();
    expect(reversals.at(-1)?.adjustmentRequested).toBe(true);
    const original = await service.detail(actor(BOSS), id);
    expect(original.canCreateAdjustment).toBe(true);

    const adjustment = await service.create(actor(BOSS), {
      title: 'Điều chỉnh: Soạn báo giá',
      assigneeUserId: DOER,
      adjustmentOfId: id,
    });
    expect(adjustment.task.adjustmentOfId).toBe(id);
    expect(adjustment.adjustmentOf?.id).toBe(id);
    const after = await service.detail(actor(BOSS), id);
    expect(after.adjustments.map((a) => a.id)).toEqual([adjustment.task.id]);
    expect(after.canCreateAdjustment).toBe(false);
  });

  it('chỉ một việc điều chỉnh còn hiệu lực cho mỗi việc gốc', async () => {
    const { service, id } = await reversedTask();
    await service.create(actor(BOSS), { title: 'Điều chỉnh 1', assigneeUserId: DOER, adjustmentOfId: id });
    await expect(
      service.create(actor(BOSS), { title: 'Điều chỉnh 2', assigneeUserId: DOER, adjustmentOfId: id }),
    ).rejects.toThrow(/còn hiệu lực/);
  });

  it('việc điều chỉnh cũ đã huỷ thì lập được việc mới', async () => {
    const { service, id, tasks } = await reversedTask();
    const first = await service.create(actor(BOSS), { title: 'Điều chỉnh 1', assigneeUserId: DOER, adjustmentOfId: id });
    tasks.set(first.task.id, { ...(tasks.get(first.task.id) as StandaloneTask), status: 'cancelled' });
    const second = await service.create(actor(BOSS), { title: 'Điều chỉnh 2', assigneeUserId: DOER, adjustmentOfId: id });
    expect(second.task.adjustmentOfId).toBe(id);
  });

  it('chỉ người giao, chỉ việc đã huỷ hiệu lực, không đi cùng việc cha', async () => {
    const { service, id } = await reversedTask();
    await expect(
      service.create(actor(DOER), { title: 'X', assigneeUserId: DOER, adjustmentOfId: id }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const running = await seeded('done');
    await expect(
      running.service.create(actor(BOSS), { title: 'X', assigneeUserId: DOER, adjustmentOfId: running.id }),
    ).rejects.toThrow(/đã huỷ hiệu lực/);
    await expect(
      service.create(actor(BOSS), { title: 'X', assigneeUserId: DOER, adjustmentOfId: id, parentId: id }),
    ).rejects.toThrow();
  });
});
