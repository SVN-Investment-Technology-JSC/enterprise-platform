import type {
  ProjectRole,
  WorkItem,
  WorkItemChecklistItem,
  WorkItemProgressReport,
  WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
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
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u-creator',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    assigneeUserId: 'u1',
    ...overrides,
  };
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

/** Kho giả có trạng thái cho đầu việc, khối lượng, trạng thái và tiến độ (luật tiến độ của store được mô phỏng). */
function makeStore(options: {
  items: WorkItem[];
  checklist?: WorkItemChecklistItem[];
  roles?: Record<string, ProjectRole>;
}) {
  const items = options.items.map((entry) => ({ ...entry }));
  const checklist: WorkItemChecklistItem[] = [...(options.checklist ?? [])];
  const reports: WorkItemProgressReport[] = [];
  const created: Record<string, unknown>[] = [];
  const statusChanges: WorkItemStatus[] = [];
  const find = (id: string) => items.find((entry) => entry.id === id) as WorkItem;
  const store = {
    project: {
      findById: async () => ({ id: 'p1', code: 'DA-1', name: 'Dự án', status: 'active', progressMethod: 'avg_tasks' }),
      updateProgress: async () => undefined,
    },
    member: { roleOf: async (_t: string, _p: string, userId: string) => options.roles?.[userId] ?? 'member' },
    settings: { get: async () => undefined },
    workItem: {
      findById: async (_t: string, id: string) => {
        const found = items.find((entry) => entry.id === id);
        return found ? { ...found } : undefined;
      },
      listByProject: async () => items.map((entry) => ({ ...entry })),
      progressRows: async () => [],
      applyProgress: async () => undefined,
      openChildCount: async () => 0,
      create: async (_t: string, _a: string, input: Record<string, unknown>) => {
        created.push(input);
        return { id: 'w-new', code: 'CV099', ...input };
      },
      changeStatus: async (_t: string, id: string, _a: string, next: WorkItemStatus) => {
        statusChanges.push(next);
        const current = find(id);
        Object.assign(current, {
          status: next,
          progressPercent: next === 'done' || next === 'review' ? 100 : next === 'todo' ? 0 : current.progressPercent,
        });
        return { ...current };
      },
      update: async (_t: string, id: string, input: Record<string, unknown>) => {
        const current = find(id);
        for (const [key, value] of Object.entries(input)) {
          if (key === 'manualProgressPercent') {
            Object.assign(current, { progressManual: value !== null, ...(value === null ? {} : { progressPercent: value as number }) });
          } else Object.assign(current, { [key]: value === null ? undefined : value });
        }
        return { ...current };
      },
      listProgressReports: async () => [...reports].reverse(),
      addProgressReport: async (_t: string, input: Record<string, unknown>) => {
        const report = { id: `r${reports.length + 1}`, createdAt: '2026-11-15T00:00:00.000Z', ...input } as WorkItemProgressReport;
        reports.push(report);
        return report;
      },
      listChecklist: async (_t: string, workItemId: string) => checklist.filter((entry) => entry.workItemId === workItemId),
      addChecklistItems: async (_t: string, workItemId: string, titles: string[]) => {
        for (const title of titles) {
          checklist.push({ id: `c${checklist.length + 1}`, workItemId, title, done: false, sortOrder: checklist.length });
        }
        return checklist;
      },
      updateChecklistItem: async (_t: string, workItemId: string, itemId: string, patch: { title?: string; done?: boolean }) => {
        const entry = checklist.find((candidate) => candidate.id === itemId && candidate.workItemId === workItemId);
        if (!entry) return undefined;
        Object.assign(entry, { ...(patch.title === undefined ? {} : { title: patch.title }), ...(patch.done === undefined ? {} : { done: patch.done }) });
        return entry;
      },
      removeChecklistItem: async (_t: string, workItemId: string, itemId: string) => {
        const index = checklist.findIndex((candidate) => candidate.id === itemId && candidate.workItemId === workItemId);
        if (index < 0) return false;
        checklist.splice(index, 1);
        return true;
      },
    },
    dependency: { listBySuccessor: async () => [] },
  } as unknown as WorkspaceStore;
  return { store, items, checklist, reports, created, statusChanges };
}

const serviceFor = (store: WorkspaceStore) => new WorkItemService(store, new ProjectService(store));
const u1 = actorOf('u1');
const row = (id: string, done: boolean, workItemId = 'w1'): WorkItemChecklistItem => ({
  id,
  workItemId,
  title: `Đầu việc ${id}`,
  done,
  sortOrder: 0,
});

describe('Tạo công việc theo cách tính tiến độ', () => {
  it('mặc định là manual và không mang khối lượng', async () => {
    const { store, created } = makeStore({ items: [] });
    await serviceFor(store).create(u1, { projectId: 'p1', title: 'A', quantityTarget: 5, quantityUnit: 'bộ' });
    expect(created[0]).toMatchObject({ progressMethod: 'manual', quantityTarget: undefined, quantityUnit: undefined, checklistTitles: [] });
  });

  it('theo khối lượng: bắt buộc mục tiêu lớn hơn 0 và đơn vị', async () => {
    const { store, created } = makeStore({ items: [] });
    const service = serviceFor(store);
    await expect(service.create(u1, { projectId: 'p1', title: 'A', progressMethod: 'quantity' })).rejects.toBeDefined();
    await expect(
      service.create(u1, { projectId: 'p1', title: 'A', progressMethod: 'quantity', quantityTarget: 0, quantityUnit: 'bộ' }),
    ).rejects.toBeDefined();
    await expect(
      service.create(u1, { projectId: 'p1', title: 'A', progressMethod: 'quantity', quantityTarget: 8 }),
    ).rejects.toBeDefined();
    await service.create(u1, { projectId: 'p1', title: 'A', progressMethod: 'quantity', quantityTarget: 8, quantityUnit: ' bộ ' });
    expect(created[0]).toMatchObject({ progressMethod: 'quantity', quantityTarget: 8, quantityUnit: 'bộ' });
  });

  it('theo đầu việc: nhận danh sách tạo sẵn đã làm sạch; cách khác thì bỏ danh sách', async () => {
    const { store, created } = makeStore({ items: [] });
    const service = serviceFor(store);
    await service.create(u1, { projectId: 'p1', title: 'A', progressMethod: 'checklist', checklistTitles: ['X', ' ', ' Y '] });
    await service.create(u1, { projectId: 'p1', title: 'B', checklistTitles: ['Z'] });
    expect(created.map((input) => input.checklistTitles)).toEqual([['X', 'Y'], []]);
  });

  it('từ chối cách tính lạ', async () => {
    const { store } = makeStore({ items: [] });
    await expect(
      serviceFor(store).create(u1, { projectId: 'p1', title: 'A', progressMethod: 'timeliness' as never }),
    ).rejects.toBeDefined();
  });
});

describe('Báo cáo tiến độ theo khối lượng', () => {
  const quantityItem = (overrides: Partial<WorkItem> = {}) =>
    item({ id: 'w1', progressMethod: 'quantity', quantityTarget: 8, quantityUnit: 'bộ', quantityDone: 0, ...overrides });

  it('báo khối lượng đã làm: server tính %, ghi số tự tính (không phải số nhập tay) và lưu khối lượng vào báo cáo', async () => {
    const { store, items, reports } = makeStore({ items: [quantityItem()] });
    await serviceFor(store).reportProgress(u1, 'w1', { quantityDone: 3, description: 'đợt 1' });
    const saved = items[0] as WorkItem;
    expect(saved.progressPercent).toBe(38);
    expect(saved.progressManual).toBe(false);
    expect(saved.quantityDone).toBe(3);
    expect(saved.status).toBe('in_progress');
    expect(reports).toEqual([expect.objectContaining({ percent: 38, quantityDone: 3 })]);
  });

  it('đủ khối lượng thì hoàn thành, và vẫn lưu khối lượng', async () => {
    const { store, items } = makeStore({ items: [quantityItem({ status: 'in_progress' })] });
    const result = await serviceFor(store).reportProgress(u1, 'w1', { quantityDone: 10 });
    expect(result.status).toBe('done');
    expect(items[0]?.quantityDone).toBe(10);
  });

  it('bỏ qua percent người gửi và từ chối khối lượng âm hay thiếu', async () => {
    const { store, items } = makeStore({ items: [quantityItem()] });
    const service = serviceFor(store);
    await service.reportProgress(u1, 'w1', { percent: 90, quantityDone: 2 });
    expect(items[0]?.progressPercent).toBe(25);
    await expect(service.reportProgress(u1, 'w1', { quantityDone: -1 })).rejects.toBeDefined();
    await expect(service.reportProgress(u1, 'w1', { percent: 50 })).rejects.toBeDefined();
  });

  it('việc cách manual từ chối khối lượng', async () => {
    const { store } = makeStore({ items: [item({ id: 'w1' })] });
    await expect(serviceFor(store).reportProgress(u1, 'w1', { percent: 10, quantityDone: 1 })).rejects.toBeDefined();
  });

  it('sửa tay số % của việc tính theo khối lượng bị chặn', async () => {
    const { store } = makeStore({ items: [quantityItem()] });
    await expect(serviceFor(store).update(u1, 'w1', { manualProgressPercent: 50 })).rejects.toMatchObject({
      message: expect.stringContaining('khối lượng'),
    });
  });

  it('đổi mục tiêu thì tính lại % theo khối lượng đã làm', async () => {
    const { store, items } = makeStore({ items: [quantityItem({ status: 'in_progress', quantityDone: 4, progressPercent: 50 })] });
    await serviceFor(store).update(u1, 'w1', { quantityTarget: 16 });
    expect(items[0]?.progressPercent).toBe(25);
  });

  it('mở lại từ Chờ duyệt về Đang làm: lấy lại % từ khối lượng, không qua lịch sử', async () => {
    const { store, items } = makeStore({
      items: [quantityItem({ status: 'review', progressPercent: 100, quantityDone: 6 })],
    });
    await serviceFor(store).changeStatus(u1, 'w1', { status: 'in_progress' });
    expect(items[0]?.progressPercent).toBe(75);
  });
});

describe('Tiến độ theo đầu việc', () => {
  const checklistItem = (overrides: Partial<WorkItem> = {}) => item({ id: 'w1', progressMethod: 'checklist', ...overrides });

  it('không báo phần trăm trực tiếp', async () => {
    const { store } = makeStore({ items: [checklistItem()], checklist: [row('c1', false)] });
    await expect(serviceFor(store).reportProgress(u1, 'w1', { percent: 50 })).rejects.toMatchObject({
      message: expect.stringContaining('đầu việc'),
    });
  });

  it('tích 1/2 đầu việc: 50%, việc sang Đang làm, một dòng báo cáo tự động', async () => {
    const { store, items, reports } = makeStore({ items: [checklistItem()], checklist: [row('c1', false), row('c2', false)] });
    await serviceFor(store).updateChecklistItem(u1, 'w1', 'c1', { done: true });
    expect(items[0]).toMatchObject({ progressPercent: 50, status: 'in_progress' });
    expect(reports).toEqual([expect.objectContaining({ percent: 50, description: 'Đầu việc đã xong: 1/2.' })]);
  });

  it('tích hết thì hoàn thành; bỏ tích một việc khi đang Chờ duyệt thì về Đang làm', async () => {
    const { store, items } = makeStore({
      items: [checklistItem({ status: 'in_progress', progressPercent: 50 })],
      checklist: [row('c1', true), row('c2', false)],
    });
    const service = serviceFor(store);
    await service.updateChecklistItem(u1, 'w1', 'c2', { done: true });
    expect(items[0]).toMatchObject({ status: 'done', progressPercent: 100 });
  });

  it('thêm đầu việc chưa tích làm tỷ lệ giảm; xoá đầu việc chưa tích làm tỷ lệ tăng', async () => {
    const { store, items } = makeStore({
      items: [checklistItem({ status: 'in_progress', progressPercent: 100 })],
      checklist: [row('c1', true)],
    });
    const service = serviceFor(store);
    await service.addChecklistItems(u1, 'w1', ['Việc mới']);
    expect(items[0]?.progressPercent).toBe(50);
    await service.removeChecklistItem(u1, 'w1', 'c2');
    expect(items[0]?.progressPercent).toBe(100);
  });

  it('chặn: việc không tính theo đầu việc, việc đã xong, đầu việc của việc khác, tên rỗng, quá 50', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1' }), checklistItem({ id: 'w2', status: 'done', progressPercent: 100 }), checklistItem({ id: 'w3' })],
      checklist: [row('c1', false, 'w3'), ...Array.from({ length: 49 }, (_, index) => row(`x${index}`, false, 'w3'))],
    });
    const service = serviceFor(store);
    await expect(service.updateChecklistItem(u1, 'w1', 'c1', { done: true })).rejects.toMatchObject({ message: expect.stringContaining('đổi cách tính') });
    await expect(service.addChecklistItems(u1, 'w2', ['A'])).rejects.toMatchObject({ message: expect.stringContaining('mở lại') });
    await expect(service.updateChecklistItem(u1, 'w3', 'khong-co', { done: true })).rejects.toBeDefined();
    await expect(service.addChecklistItems(u1, 'w3', [' '])).rejects.toBeDefined();
    await expect(service.addChecklistItems(u1, 'w3', ['một', 'hai'])).rejects.toMatchObject({ message: expect.stringContaining('tối đa') });
  });

  it('người không phụ trách không sửa được đầu việc', async () => {
    const { store } = makeStore({ items: [checklistItem()], checklist: [row('c1', false)] });
    await expect(serviceFor(store).updateChecklistItem(actorOf('u2'), 'w1', 'c1', { done: true })).rejects.toMatchObject({
      code: 'WORK_ITEM_ASSIGNEE_ONLY',
    });
  });

  it('người tạo việc (không phụ trách) thêm, tích, xoá được đầu việc', async () => {
    const { store, items, checklist } = makeStore({ items: [checklistItem()], checklist: [row('c1', false)] });
    const service = serviceFor(store);
    const creator = actorOf('u-creator');
    await service.addChecklistItems(creator, 'w1', ['Mới']);
    await service.updateChecklistItem(creator, 'w1', 'c1', { done: true });
    expect(items[0]?.progressPercent).toBe(50);
    await service.removeChecklistItem(creator, 'w1', 'c2');
    expect(checklist).toHaveLength(1);
    expect(items[0]?.progressPercent).toBe(100);
  });

  it('thành viên không liên quan bị chặn thêm đầu việc, thông báo đúng việc đầu việc', async () => {
    const { store } = makeStore({ items: [item({ id: 'w1' })] });
    await expect(serviceFor(store).addChecklistItems(actorOf('u2'), 'w1', ['A'])).rejects.toMatchObject({
      code: 'WORK_ITEM_ASSIGNEE_ONLY',
      message: expect.stringContaining('đầu việc'),
    });
  });

  it('việc đang manual: thêm đầu việc đầu tiên tự chuyển sang checklist và tính tiến độ theo đầu việc', async () => {
    const { store, items, checklist } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress', progressPercent: 40, progressManual: true })],
    });
    await serviceFor(store).addChecklistItems(actorOf('u-creator'), 'w1', ['A', 'B']);
    expect(checklist).toHaveLength(2);
    expect(items[0]).toMatchObject({ progressMethod: 'checklist', progressPercent: 0, progressManual: false });
  });

  it('chuyển manual sang checklist: ghi một báo cáo phản ánh số mới dù số tay cũ khác (40% -> 0%)', async () => {
    const { store, reports } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress', progressPercent: 40, progressManual: true })],
    });
    await serviceFor(store).addChecklistItems(u1, 'w1', ['A']);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ percent: 0 });
  });

  it('thêm hàng đầu việc lỗi thì việc không bị đổi cách tính và giữ số tay', async () => {
    const { store, items } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress', progressPercent: 40, progressManual: true })],
    });
    const failing = store as unknown as { workItem: { addChecklistItems: () => Promise<never> } };
    failing.workItem.addChecklistItems = async () => {
      throw new Error('mất kết nối');
    };
    await expect(serviceFor(store).addChecklistItems(u1, 'w1', ['A'])).rejects.toThrow('mất kết nối');
    expect(items[0]).toMatchObject({ progressPercent: 40, progressManual: true });
    expect(items[0]?.progressMethod).toBeUndefined();
  });

  it('manual đang Chờ duyệt: thêm đầu việc đầu tiên đưa việc về Đang làm (người phụ trách)', async () => {
    const { store, items } = makeStore({
      items: [item({ id: 'w1', status: 'review', progressPercent: 100, progressManual: true })],
    });
    await serviceFor(store).addChecklistItems(u1, 'w1', ['A']);
    expect(items[0]).toMatchObject({ status: 'in_progress', progressMethod: 'checklist', progressPercent: 0 });
  });

  it('người chỉ là người tạo việc: tích đầu việc cuối chỉ đổi phần trăm, không tự Hoàn thành / Chờ duyệt', async () => {
    const { store, items, statusChanges } = makeStore({
      items: [checklistItem({ status: 'in_progress', progressPercent: 50 })],
      checklist: [row('c1', true), row('c2', false)],
    });
    const creator = actorOf('u-creator');
    await serviceFor(store).updateChecklistItem(creator, 'w1', 'c2', { done: true });
    expect(items[0]).toMatchObject({ progressPercent: 100, status: 'in_progress' });
    expect(statusChanges).toEqual([]);
  });

  it('người chỉ là người tạo việc: bỏ tích không kéo Chờ duyệt về Đang làm; việc Chưa làm không tự sang Đang làm', async () => {
    const review = makeStore({
      items: [checklistItem({ status: 'review', progressPercent: 100 })],
      checklist: [row('c1', true), row('c2', true)],
    });
    await serviceFor(review.store).updateChecklistItem(actorOf('u-creator'), 'w1', 'c2', { done: false });
    expect(review.items[0]).toMatchObject({ status: 'review', progressPercent: 50 });
    const todo = makeStore({ items: [checklistItem()], checklist: [row('c1', false), row('c2', false)] });
    await serviceFor(todo.store).updateChecklistItem(actorOf('u-creator'), 'w1', 'c1', { done: true });
    expect(todo.items[0]).toMatchObject({ status: 'todo', progressPercent: 50 });
    expect(todo.statusChanges).toEqual([]);
  });

  it('giai đoạn và cột mốc không thêm được đầu việc', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1', itemType: 'phase' }), item({ id: 'w2', itemType: 'milestone' })],
    });
    await expect(serviceFor(store).addChecklistItems(u1, 'w1', ['A'])).rejects.toMatchObject({
      message: expect.stringContaining('Giai đoạn'),
    });
    await expect(serviceFor(store).addChecklistItems(u1, 'w2', ['A'])).rejects.toMatchObject({
      message: expect.stringContaining('Cột mốc'),
    });
  });

  it('việc theo khối lượng vẫn từ chối thêm đầu việc, hướng dẫn đổi cách tính', async () => {
    const { store } = makeStore({
      items: [item({ id: 'w1', progressMethod: 'quantity', quantityTarget: 5, quantityUnit: 'bộ' })],
    });
    await expect(serviceFor(store).addChecklistItems(u1, 'w1', ['A'])).rejects.toMatchObject({
      message: expect.stringContaining('khối lượng'),
    });
  });

  it('công việc có điều kiện hoàn thành: tích hết chỉ đặt 100%, vẫn chờ người bấm Hoàn thành', async () => {
    const { store, items } = makeStore({
      items: [
        checklistItem({
          status: 'in_progress',
          completion: { rule: 'all', conditions: [{ id: 'k1', label: 'Có biên bản' }] },
        } as Partial<WorkItem>),
      ],
      checklist: [row('c1', false)],
    });
    await serviceFor(store).updateChecklistItem(u1, 'w1', 'c1', { done: true });
    expect(items[0]).toMatchObject({ status: 'in_progress', progressPercent: 100 });
  });

  it('đổi sang cách theo đầu việc thì tính lại ngay từ đầu việc có sẵn', async () => {
    const { store, items } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress', progressPercent: 70, progressManual: true })],
      checklist: [row('c1', true), row('c2', false), row('c3', false), row('c4', false)],
    });
    await serviceFor(store).update(u1, 'w1', { progressMethod: 'checklist' });
    expect(items[0]).toMatchObject({ progressMethod: 'checklist', progressPercent: 25 });
  });
});

describe('Các ca biên sau rà soát', () => {
  it('tích đầu việc cuối khi tiền nhiệm FS chưa xong: không lỗi, đặt 100% và chờ bấm Hoàn thành', async () => {
    const fixture = makeStore({
      items: [item({ id: 'w1', progressMethod: 'checklist', status: 'in_progress' }), item({ id: 'w9', code: 'CV009' })],
      checklist: [row('c1', false)],
    });
    (fixture.store.dependency as unknown as { listBySuccessor: () => Promise<unknown[]> }).listBySuccessor = async () => [
      { predecessorId: 'w9', dependencyType: 'FS' },
    ];
    await serviceFor(fixture.store).updateChecklistItem(u1, 'w1', 'c1', { done: true });
    expect(fixture.items[0]).toMatchObject({ status: 'in_progress', progressPercent: 100 });
  });

  it('việc có việc con không dùng đầu việc hay khối lượng', async () => {
    const { store } = makeStore({
      items: [
        item({ id: 'w1', progressMethod: 'checklist', status: 'in_progress' }),
        item({ id: 'w2', parentId: 'w1', depth: 1 }),
        item({ id: 'w3', status: 'in_progress' }),
        item({ id: 'w4', parentId: 'w3', depth: 1 }),
      ],
      checklist: [row('c1', false)],
    });
    const service = serviceFor(store);
    await expect(service.updateChecklistItem(u1, 'w1', 'c1', { done: true })).rejects.toMatchObject({
      message: expect.stringContaining('việc con'),
    });
    await expect(
      service.update(u1, 'w3', { progressMethod: 'quantity', quantityTarget: 5, quantityUnit: 'bộ' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('việc con') });
  });

  it('đổi mục tiêu khối lượng của việc đang Chờ duyệt làm % giảm: việc về Đang làm', async () => {
    const { store, items } = makeStore({
      items: [item({ id: 'w1', progressMethod: 'quantity', quantityTarget: 100, quantityUnit: 'm', quantityDone: 100, status: 'review', progressPercent: 100 })],
    });
    await serviceFor(store).update(u1, 'w1', { quantityTarget: 200 });
    expect(items[0]).toMatchObject({ status: 'in_progress', progressPercent: 50 });
  });

  it('không nhập tay số % cho việc đang Chờ duyệt', async () => {
    const { store } = makeStore({ items: [item({ id: 'w1', status: 'review', progressPercent: 100 })] });
    await expect(serviceFor(store).update(u1, 'w1', { manualProgressPercent: 40 })).rejects.toMatchObject({
      message: expect.stringContaining('Chờ duyệt'),
    });
  });
});
