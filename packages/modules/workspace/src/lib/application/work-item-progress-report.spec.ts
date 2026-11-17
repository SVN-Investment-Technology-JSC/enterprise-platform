import type {
  ProjectRole,
  WorkItem,
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

/**
 * Kho giả có trạng thái: `changeStatus` đổi trạng thái thật (mô phỏng luật tiến độ của store), `update` ghi số nhập tay,
 * để kiểm cả chuỗi bước mà `reportProgress` thực hiện chứ không chỉ lời gọi đầu tiên.
 */
function makeStore(options: {
  items: WorkItem[];
  roles?: Record<string, ProjectRole>;
  settings?: Record<string, unknown>;
  reports?: WorkItemProgressReport[];
  edges?: { predecessorId: string; dependencyType: string }[];
}) {
  const items = options.items.map((entry) => ({ ...entry }));
  const reports: WorkItemProgressReport[] = [...(options.reports ?? [])];
  const statusChanges: { id: string; next: WorkItemStatus; note?: string }[] = [];
  const manual: { id: string; percent: unknown }[] = [];
  const find = (id: string) => items.find((entry) => entry.id === id) as WorkItem;
  const store = {
    project: {
      findById: async () => ({ id: 'p1', code: 'DA-1', name: 'Dự án', status: 'active', progressMethod: 'avg_tasks' }),
      updateProgress: async () => undefined,
      update: async () => ({}),
    },
    member: { roleOf: async (_t: string, _p: string, userId: string) => options.roles?.[userId] ?? 'member' },
    settings: { get: async (_t: string, key: string) => options.settings?.[key] },
    workItem: {
      // Bản sao như dòng đọc từ CSDL: nơi gọi giữ `item` cũ thì nó không được đổi theo lần ghi sau.
      findById: async (_t: string, id: string) => {
        const found = items.find((entry) => entry.id === id);
        return found ? { ...found } : undefined;
      },
      listByProject: async () => items.map((entry) => ({ ...entry })),
      progressRows: async () => [],
      applyProgress: async () => undefined,
      openChildCount: async () => 0,
      changeStatus: async (_t: string, id: string, _a: string, next: WorkItemStatus, note?: string) => {
        statusChanges.push({ id, next, note });
        const current = find(id);
        const leavingClosed = current.status === 'done' || current.status === 'review';
        Object.assign(current, {
          status: next,
          // Cùng luật với SQL của store: done/review là 100%, về todo hoặc rời done/review là 0%.
          progressPercent:
            next === 'done' || next === 'review'
              ? 100
              : next === 'todo' || (leavingClosed && next !== 'cancelled')
                ? 0
                : current.progressPercent,
          autoProgressPercent: undefined,
        });
        return { ...current };
      },
      update: async (_t: string, id: string, input: Record<string, unknown>) => {
        if (input.manualProgressPercent !== undefined) {
          manual.push({ id, percent: input.manualProgressPercent });
          Object.assign(find(id), { progressPercent: input.manualProgressPercent as number });
        }
        return { ...find(id) };
      },
      listProgressReports: async () => [...reports].reverse(),
      addProgressReport: async (_t: string, input: Record<string, unknown>) => {
        const report = { id: `r${reports.length + 1}`, createdAt: '2026-11-15T00:00:00.000Z', ...input } as WorkItemProgressReport;
        reports.push(report);
        return report;
      },
    },
    dependency: { listBySuccessor: async () => options.edges ?? [] },
  } as unknown as WorkspaceStore;
  return { store, items, reports, statusChanges, manual };
}

const serviceFor = (store: WorkspaceStore) => new WorkItemService(store, new ProjectService(store));
const u1 = actorOf('u1');

describe('Báo cáo tiến độ công việc', () => {
  it('báo 40% cho việc Chưa làm: tự sang Đang làm, ghi số nhập tay và một dòng lịch sử', async () => {
    const { store, statusChanges, manual, reports } = makeStore({ items: [item({ id: 'w1' })] });
    await serviceFor(store).reportProgress(u1, 'w1', { percent: 40, description: 'đã xong nửa' });
    expect(statusChanges.map((change) => change.next)).toEqual(['in_progress']);
    expect(manual).toEqual([{ id: 'w1', percent: 40 }]);
    expect(reports).toEqual([
      expect.objectContaining({ workItemId: 'w1', percent: 40, description: 'đã xong nửa', reportedBy: 'u1' }),
    ]);
  });

  it('tắt "tự chuyển sang Đang làm" thì giữ nguyên Chưa làm', async () => {
    const { store, statusChanges } = makeStore({
      items: [item({ id: 'w1' })],
      settings: { progress_report: { startsWork: false } },
    });
    await serviceFor(store).reportProgress(u1, 'w1', { percent: 40 });
    expect(statusChanges).toEqual([]);
  });

  it('báo 0% chỉ đặt số, không đổi trạng thái', async () => {
    const { store, statusChanges, manual } = makeStore({ items: [item({ id: 'w1' })] });
    await serviceFor(store).reportProgress(u1, 'w1', { percent: 0 });
    expect(statusChanges).toEqual([]);
    expect(manual).toEqual([{ id: 'w1', percent: 0 }]);
  });

  it('báo 100% mặc định: đi qua Đang làm rồi Hoàn thành, không ghi số nhập tay', async () => {
    const { store, statusChanges, manual, reports } = makeStore({ items: [item({ id: 'w1' })] });
    const result = await serviceFor(store).reportProgress(u1, 'w1', { percent: 100, description: 'xong' });
    expect(statusChanges.map((change) => change.next)).toEqual(['in_progress', 'done']);
    expect(statusChanges[1]?.note).toBe('xong');
    expect(manual).toEqual([]);
    expect(result.status).toBe('done');
    expect(result.progressPercent).toBe(100);
    expect(reports).toHaveLength(1);
  });

  it('cài đặt "Chờ duyệt": báo 100% dừng ở Chờ duyệt', async () => {
    const { store, statusChanges } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress' })],
      settings: { progress_report: { completeStatus: 'review' } },
    });
    const result = await serviceFor(store).reportProgress(u1, 'w1', { percent: 100 });
    expect(statusChanges.map((change) => change.next)).toEqual(['review']);
    expect(result.status).toBe('review');
  });

  it('việc Vướng mắc báo 100% đi qua Đang làm trước', async () => {
    const { store, statusChanges } = makeStore({ items: [item({ id: 'w1', status: 'blocked' })] });
    await serviceFor(store).reportProgress(u1, 'w1', { percent: 100 });
    expect(statusChanges.map((change) => change.next)).toEqual(['in_progress', 'done']);
  });

  it('việc Chờ duyệt báo dưới 100% quay về Đang làm rồi ghi số mới', async () => {
    const { store, statusChanges, manual } = makeStore({ items: [item({ id: 'w1', status: 'review' })] });
    await serviceFor(store).reportProgress(u1, 'w1', { percent: 70 });
    expect(statusChanges.map((change) => change.next)).toEqual(['in_progress']);
    // Không khôi phục số cũ ở bước chuyển trạng thái: chỉ có đúng con số vừa báo.
    expect(manual).toEqual([{ id: 'w1', percent: 70 }]);
  });

  it('bắt buộc mô tả khi báo 100% theo cài đặt; báo dưới 100% thì không bắt buộc', async () => {
    const { store, statusChanges, reports } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress' })],
      settings: { progress_report: { requireDescription: true } },
    });
    await expect(serviceFor(store).reportProgress(u1, 'w1', { percent: 100, description: '  ' })).rejects.toMatchObject({
      message: expect.stringContaining('mô tả'),
    });
    expect(statusChanges).toEqual([]);
    expect(reports).toEqual([]);
    await serviceFor(store).reportProgress(u1, 'w1', { percent: 50 });
    expect(reports).toHaveLength(1);
  });

  it('công việc có điều kiện hoàn thành: báo 100% bị chặn trước khi ghi bất cứ gì', async () => {
    const withConditions = item({
      id: 'w1',
      status: 'in_progress',
      completion: { rule: 'all', conditions: [{ id: 'c1', label: 'Có biên bản' }] },
    } as Partial<WorkItem> & { id: string });
    const { store, statusChanges, reports } = makeStore({ items: [withConditions] });
    await expect(serviceFor(store).reportProgress(u1, 'w1', { percent: 100 })).rejects.toMatchObject({
      message: expect.stringContaining('điều kiện hoàn thành'),
    });
    expect(statusChanges).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('chặn: việc có việc con, việc đã hoàn thành, việc đã huỷ, người không phụ trách', async () => {
    const parent = item({ id: 'w1', status: 'in_progress' });
    const child = item({ id: 'w2', parentId: 'w1', depth: 1 });
    const { store } = makeStore({
      items: [parent, child, item({ id: 'w3', status: 'done' }), item({ id: 'w4', status: 'cancelled' })],
    });
    const service = serviceFor(store);
    await expect(service.reportProgress(u1, 'w1', { percent: 10 })).rejects.toMatchObject({
      message: expect.stringContaining('việc con'),
    });
    await expect(service.reportProgress(u1, 'w3', { percent: 10 })).rejects.toMatchObject({
      message: expect.stringContaining('mở lại'),
    });
    await expect(service.reportProgress(u1, 'w4', { percent: 10 })).rejects.toMatchObject({
      message: expect.stringContaining('mở lại'),
    });
    await expect(service.reportProgress(actorOf('u2'), 'w2', { percent: 10 })).rejects.toMatchObject({
      code: 'WORK_ITEM_ASSIGNEE_ONLY',
    });
  });

  it('từ chối số không hợp lệ và ngày báo cáo ở tương lai', async () => {
    const { store, reports } = makeStore({ items: [item({ id: 'w1' })] });
    const service = serviceFor(store);
    await expect(service.reportProgress(u1, 'w1', { percent: 101 })).rejects.toBeDefined();
    await expect(service.reportProgress(u1, 'w1', { percent: 12.5 })).rejects.toBeDefined();
    await expect(service.reportProgress(u1, 'w1', { percent: 10, reportedOn: '2999-01-01' })).rejects.toBeDefined();
    expect(reports).toEqual([]);
  });
});

describe('Mở lại việc đã báo cáo tiến độ', () => {
  const report = (percent: number, n: number): WorkItemProgressReport => ({
    id: `r${n}`,
    workItemId: 'w1',
    reportedOn: '2026-11-01',
    reportedBy: 'u1',
    percent,
    createdAt: `2026-11-0${n}T00:00:00.000Z`,
  });

  it('Hoàn thành → Đang làm: khôi phục số của báo cáo gần nhất chưa tới 100%', async () => {
    const { store, manual } = makeStore({
      items: [item({ id: 'w1', status: 'done', progressPercent: 100 })],
      reports: [report(30, 1), report(60, 2), report(100, 3)],
    });
    const result = await serviceFor(store).changeStatus(u1, 'w1', { status: 'in_progress' });
    expect(manual).toEqual([{ id: 'w1', percent: 60 }]);
    expect(result.progressPercent).toBe(60);
  });

  it('không có báo cáo nào thì về 0% như trước', async () => {
    const { store, manual } = makeStore({ items: [item({ id: 'w1', status: 'done', progressPercent: 100 })] });
    const result = await serviceFor(store).changeStatus(u1, 'w1', { status: 'in_progress' });
    expect(manual).toEqual([]);
    expect(result.progressPercent).toBe(0);
  });

  it('Chờ duyệt → Đang làm cũng khôi phục', async () => {
    const { store, manual } = makeStore({
      items: [item({ id: 'w1', status: 'review', progressPercent: 100 })],
      reports: [report(80, 1), report(100, 2)],
    });
    await serviceFor(store).changeStatus(u1, 'w1', { status: 'in_progress' });
    expect(manual).toEqual([{ id: 'w1', percent: 80 }]);
  });
});

describe('Chặn trước khi đổi gì', () => {
  it('tiền nhiệm FS chưa xong: báo 100% bị từ chối mà không đẩy việc sang Đang làm', async () => {
    const { store, statusChanges, reports } = makeStore({
      items: [item({ id: 'w1' }), item({ id: 'w9', code: 'CV009' })],
      edges: [{ predecessorId: 'w9', dependencyType: 'FS' }],
    });
    await expect(serviceFor(store).reportProgress(u1, 'w1', { percent: 100 })).rejects.toMatchObject({
      code: 'DEPENDENCY_BLOCKED',
    });
    expect(statusChanges).toEqual([]);
    expect(reports).toEqual([]);
  });
});

describe('Giữ số tiến độ khi vào Chờ duyệt / Hoàn thành', () => {
  it('số đặt tay chưa có báo cáo được ghi lại, nên mở lại khôi phục đúng số đó', async () => {
    const { store, reports, manual } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress', progressPercent: 70 })],
    });
    const service = serviceFor(store);
    await service.changeStatus(u1, 'w1', { status: 'review' });
    expect(reports).toEqual([expect.objectContaining({ percent: 70 })]);
    await service.changeStatus(u1, 'w1', { status: 'in_progress' });
    expect(manual).toEqual([{ id: 'w1', percent: 70 }]);
  });

  it('số đã nằm sẵn trong lịch sử thì không ghi trùng', async () => {
    const { store, reports } = makeStore({
      items: [item({ id: 'w1', status: 'in_progress', progressPercent: 40 })],
      reports: [
        { id: 'r1', workItemId: 'w1', reportedOn: '2026-11-01', reportedBy: 'u1', percent: 40, createdAt: '2026-11-01T00:00:00.000Z' },
      ],
    });
    await serviceFor(store).changeStatus(u1, 'w1', { status: 'review' });
    expect(reports).toHaveLength(1);
  });
});
