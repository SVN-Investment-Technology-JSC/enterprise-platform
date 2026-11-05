import type { CalendarEvent, StandaloneTask, WorkItem } from '@enterprise-platform/contracts-workspace';
import { MyWorkService, bucketise } from './my-work.service.js';
import { WorkspaceValidationError } from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { EventException, MyWorkAssignedRow, WorkspaceStore } from './workspace-store.port.js';

const VN = 'Asia/Ho_Chi_Minh';
/** Thứ Năm 24/09/2026, 10:00 giờ Việt Nam. */
const NOW = new Date('2026-09-24T03:00:00Z');

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: overrides.id.toUpperCase(),
    title: `Việc ${overrides.id}`,
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const row = (entry: WorkItem): MyWorkAssignedRow => ({
  item: entry,
  projectCode: 'DA-1',
  projectName: 'Dự án 1',
});

describe('bucketise — chia nhóm theo hạn', () => {
  const run = (items: WorkItem[]) =>
    bucketise(items.map(row), '2026-09-24', '2026-09-21', VN, NOW);

  it('hạn đã qua là quá hạn', () => {
    expect(run([item({ id: 'a', plannedEnd: '2026-09-23' })])[0]?.bucket).toBe('overdue');
  });

  it('hạn đúng hôm nay là hôm nay, không phải quá hạn', () => {
    expect(run([item({ id: 'a', plannedEnd: '2026-09-24' })])[0]?.bucket).toBe('today');
  });

  it('hạn còn trong tuần là tuần này', () => {
    // Tuần chứa thứ Năm 24/09 kết thúc Chủ nhật 27/09.
    expect(run([item({ id: 'a', plannedEnd: '2026-09-27' })])[0]?.bucket).toBe('this_week');
  });

  it('hạn sang tuần sau là sau này', () => {
    expect(run([item({ id: 'a', plannedEnd: '2026-09-28' })])[0]?.bucket).toBe('later');
  });

  it('không có hạn thì vào nhóm riêng, không bị coi là quá hạn', () => {
    expect(run([item({ id: 'a' })])[0]?.bucket).toBe('no_due');
  });
});

describe('bucketise — thứ tự', () => {
  it('quá hạn luôn đứng trước, kể cả khi ưu tiên thấp hơn', () => {
    const result = bucketise(
      [
        row(item({ id: 'urgent-today', priority: 'urgent', plannedEnd: '2026-09-24' })),
        row(item({ id: 'low-overdue', priority: 'low', plannedEnd: '2026-09-20' })),
      ],
      '2026-09-24',
      '2026-09-21',
      VN,
      NOW,
    );
    expect(result.map((entry) => entry.item.id)).toEqual(['low-overdue', 'urgent-today']);
  });

  it('trong cùng nhóm, ưu tiên cao đứng trước hạn sớm', () => {
    // Nếu sắp theo hạn trước thì `soon-normal` sẽ đứng trên, và một việc khẩn
    // cấp bị đẩy xuống chỉ vì hạn muộn hơn một ngày.
    const result = bucketise(
      [
        row(item({ id: 'soon-normal', priority: 'normal', plannedEnd: '2026-09-25' })),
        row(item({ id: 'later-urgent', priority: 'urgent', plannedEnd: '2026-09-26' })),
      ],
      '2026-09-24',
      '2026-09-21',
      VN,
      NOW,
    );
    expect(result.map((entry) => entry.item.id)).toEqual(['later-urgent', 'soon-normal']);
  });

  it('cùng ưu tiên thì hạn gần hơn đứng trước', () => {
    const result = bucketise(
      [
        row(item({ id: 'b', plannedEnd: '2026-09-26' })),
        row(item({ id: 'a', plannedEnd: '2026-09-25' })),
      ],
      '2026-09-24',
      '2026-09-21',
      VN,
      NOW,
    );
    expect(result.map((entry) => entry.item.id)).toEqual(['a', 'b']);
  });
});

describe('MyWorkService.summary', () => {
  function makeStore(rows: MyWorkAssignedRow[]) {
    const seen: { assignedFor: string[]; mentionsFor: string[] } = {
      assignedFor: [],
      mentionsFor: [],
    };
    const store = {
      myWork: {
        assignedItems: async (_tenant: string, userId: string) => {
          seen.assignedFor.push(userId);
          return rows;
        },
        completedCount: async () => 3,
        eventsForUser: async () => [],
        pendingInvitations: async () => [],
        mentions: async (_tenant: string, userId: string) => {
          seen.mentionsFor.push(userId);
          return [];
        },
        externalCards: async () => [],
      },
      standaloneTask: { forMyWork: async () => [] },
    } as unknown as WorkspaceStore;
    return { store, seen };
  }

  const actor = (userId: string, isTenantAdmin = false): WorkspaceActor => ({
    tenantId: 't1',
    userId,
    displayName: userId,
    isTenantAdmin,
    canManage: isTenantAdmin,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
  });

  it('đếm đúng bốn con số đầu trang', async () => {
    const { store } = makeStore([
      row(item({ id: 'a', plannedEnd: '2026-09-20' })),
      row(item({ id: 'b', plannedEnd: '2026-09-24' })),
      row(item({ id: 'c' })),
    ]);
    const summary = await new MyWorkService(store).summary(actor('u1'), NOW);
    expect(summary.counters).toEqual({
      openItems: 3,
      overdueItems: 1,
      dueToday: 1,
      completedThisWeek: 3,
    });
  });

  it('luôn truy vấn theo danh tính của người gọi', async () => {
    const { store, seen } = makeStore([]);
    await new MyWorkService(store).summary(actor('u-me'), NOW);
    expect(seen.assignedFor).toEqual(['u-me']);
    expect(seen.mentionsFor).toEqual(['u-me']);
  });

  it('tenant-admin KHÔNG override: vẫn chỉ hỏi dữ liệu của chính mình', async () => {
    // Đây là ngoại lệ duy nhất của cơ chế override toàn tenant.
    const { store, seen } = makeStore([]);
    await new MyWorkService(store).summary(actor('u-admin', true), NOW);
    expect(seen.assignedFor).toEqual(['u-admin']);
  });

  it('trả kèm múi giờ và ngày hôm nay đã cắt theo múi giờ đó', async () => {
    const { store } = makeStore([]);
    const summary = await new MyWorkService(store).summary(actor('u1'), NOW);
    expect(summary.timezone).toBe(VN);
    expect(summary.today).toBe('2026-09-24');
  });
});

describe('MyWorkService — lịch hôm nay', () => {
  /** Họp giao ban 9 giờ sáng thứ Năm hằng tuần, bắt đầu từ ba tuần trước. */
  const weekly: CalendarEvent = {
    id: 'series-1',
    seriesId: 'series-1',
    title: 'Giao ban',
    eventType: 'meeting',
    startAt: '2026-09-03T02:00:00.000Z',
    endAt: '2026-09-03T03:00:00.000Z',
    allDay: false,
    timezone: VN,
    // Đúng dạng giao diện gửi lên: điểm dừng nằm trong chuỗi.
    recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;COUNT=10',
    status: 'scheduled',
    organizerUserId: 'u-boss',
    createdBy: 'u-boss',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as CalendarEvent;

  function storeWith(exceptions: EventException[]) {
    return {
      myWork: {
        assignedItems: async () => [],
        completedCount: async () => 0,
        eventsForUser: async () => [{ event: weekly, responseStatus: 'accepted' as const }],
        pendingInvitations: async () => [],
        mentions: async () => [],
        externalCards: async () => [],
      },
      standaloneTask: { forMyWork: async () => [] },
      calendar: { listExceptions: async () => exceptions },
    } as unknown as WorkspaceStore;
  }

  const me: WorkspaceActor = {
    tenantId: 't1',
    userId: 'u1',
    displayName: 'u1',
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
  };

  it('chuỗi lặp bắt đầu từ trước vẫn ra đúng buổi hôm nay', async () => {
    const summary = await new MyWorkService(storeWith([])).summary(me, NOW);
    expect(summary.todayEvents).toEqual([
      expect.objectContaining({
        eventId: 'series-1',
        startAt: '2026-09-24T02:00:00.000Z',
        responseStatus: 'accepted',
      }),
    ]);
  });

  it('buổi hôm nay bị huỷ riêng thì không hiện', async () => {
    const summary = await new MyWorkService(
      storeWith([
        {
          id: 'x1',
          seriesId: 'series-1',
          occurrenceDate: '2026-09-24',
          exceptionType: 'cancelled',
        },
      ]),
    ).summary(me, NOW);
    expect(summary.todayEvents).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
   Trang "Công việc của tôi" theo trang: overview, groupItems, standalonePage
   ------------------------------------------------------------------------- */

const ME: WorkspaceActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

const PROJECTS = {
  p1: { code: 'DA-1', name: 'Zeta' },
  p2: { code: 'DA-2', name: 'Alpha' },
  p3: { code: 'DA-10', name: 'Mid' },
  p9: { code: 'DA-9', name: 'Nhiều việc' },
  'p-other': { code: 'DA-77', name: 'Của người khác' },
} as const;

/** Một dòng việc được giao cho `owner`; store giả chỉ trả dòng của người được hỏi. */
function owned(
  owner: string,
  projectId: keyof typeof PROJECTS,
  overrides: Partial<WorkItem> & { id: string },
) {
  return {
    owner,
    row: {
      item: item({ projectId, ...overrides }),
      projectCode: PROJECTS[projectId].code,
      projectName: PROJECTS[projectId].name,
    } satisfies MyWorkAssignedRow,
  };
}

function task(overrides: Partial<StandaloneTask> & { id: string }): StandaloneTask {
  return {
    code: overrides.id.toUpperCase(),
    title: `Việc ${overrides.id}`,
    status: 'todo',
    priority: 'normal',
    rootId: overrides.id,
    depth: 0,
    childCount: 0,
    openChildCount: 0,
    executionType: 'manual',
    assigneeUserId: 'u1',
    participantUserIds: [],
    followerUserIds: [],
    progressPercent: 0,
    createdBy: 'boss',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    statusChangedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as StandaloneTask;
}

function pagedStore(
  rows: ReturnType<typeof owned>[],
  tasks: { owner: string; task: StandaloneTask }[] = [],
) {
  const asked: string[] = [];
  const store = {
    myWork: {
      assignedItems: async (_tenant: string, userId: string) => {
        asked.push(userId);
        return rows.filter((entry) => entry.owner === userId).map((entry) => entry.row);
      },
      completedCount: async () => 3,
      eventsForUser: async () => [],
      pendingInvitations: async () => [],
      mentions: async () => [],
      externalCards: async () => [],
    },
    standaloneTask: {
      forMyWork: async (_tenant: string, userId: string) =>
        tasks.filter((entry) => entry.owner === userId).map((entry) => entry.task),
    },
  } as unknown as WorkspaceStore;
  return { store, asked };
}

/** Ba dự án với đủ trạng thái, ưu tiên, hạn; xem phép tính tay ở từng ca. */
const MIXED = [
  // DA-1 "Zeta"
  owned('u1', 'p1', { id: 'a1', title: 'Z', status: 'todo', priority: 'high', plannedEnd: '2026-09-20', progressPercent: 0, updatedAt: '2026-09-10T00:00:00.000Z' }),
  owned('u1', 'p1', { id: 'a2', title: 'Y', status: 'in_progress', priority: 'urgent', plannedEnd: '2026-09-30', progressPercent: 50, updatedAt: '2026-09-12T00:00:00.000Z' }),
  owned('u1', 'p1', { id: 'a3', title: 'X', status: 'done', priority: 'urgent', plannedEnd: '2026-09-01', progressPercent: 100, updatedAt: '2026-09-05T00:00:00.000Z' }),
  owned('u1', 'p1', { id: 'a4', title: 'W', status: 'review', priority: 'low', progressPercent: 20, updatedAt: '2026-09-01T00:00:00.000Z' }),
  // DA-2 "Alpha"
  owned('u1', 'p2', { id: 'b1', status: 'todo', priority: 'normal', plannedEnd: '2026-09-25', progressPercent: 10, updatedAt: '2026-09-20T00:00:00.000Z' }),
  owned('u1', 'p2', { id: 'b2', status: 'blocked', priority: 'normal', plannedEnd: '2026-09-24', progressPercent: 30, updatedAt: '2026-09-21T00:00:00.000Z' }),
  // DA-10 "Mid": chỉ có một việc đã huỷ, quá hạn
  owned('u1', 'p3', { id: 'c1', status: 'cancelled', priority: 'low', plannedEnd: '2026-09-10', progressPercent: 0, updatedAt: '2026-09-22T00:00:00.000Z' }),
  // Việc của người khác, cùng dự án và dự án khác: không bao giờ lọt vào kết quả của u1.
  owned('u2', 'p1', { id: 'z1', status: 'todo', priority: 'urgent', plannedEnd: '2026-09-01' }),
  owned('u2', 'p-other', { id: 'z2', status: 'todo' }),
];

const TASKS = [
  { owner: 'u1', task: task({ id: 'gv001', code: 'GV001', title: 'B', status: 'todo', dueDate: '2026-09-20', updatedAt: '2026-09-01T00:00:00.000Z' }) },
  { owner: 'u1', task: task({ id: 'gv002', code: 'GV002', title: 'A', status: 'in_progress', priority: 'high', dueDate: '2026-09-30', updatedAt: '2026-09-05T00:00:00.000Z' }) },
  // Tôi giao, người khác làm, đang chờ tôi duyệt.
  { owner: 'u1', task: task({ id: 'gv010', code: 'GV010', title: 'C', status: 'review', assigneeUserId: 'u2', createdBy: 'u1', updatedAt: '2026-09-03T00:00:00.000Z' }) },
  { owner: 'u1', task: task({ id: 'gv003', code: 'GV003', title: 'D', status: 'done', priority: 'low', dueDate: '2026-09-24', updatedAt: '2026-09-04T00:00:00.000Z' }) },
  { owner: 'u2', task: task({ id: 'gv999', code: 'GV999', assigneeUserId: 'u2' }) },
];

describe('MyWorkService.overview', () => {
  const run = (filter: Record<string, unknown> = {}, sort?: string, actor = ME) =>
    new MyWorkService(pagedStore(MIXED, TASKS).store).overview(actor, filter, sort, NOW);
  const byId = (groups: readonly { projectId: string }[]) => groups.map((group) => group.projectId);

  it('gom theo dự án và đếm bốn loại trên toàn bộ việc của nhóm', async () => {
    const { groups } = await run();
    const zeta = groups.find((group) => group.projectId === 'p1');
    expect(zeta).toMatchObject({
      projectCode: 'DA-1',
      projectName: 'Zeta',
      total: 4,
      // a1 và a3 đều đã quá hạn (việc đã xong vẫn nằm nhóm hạn như trang cũ).
      counts: { overdue: 2, notStarted: 1, active: 2, finished: 1 },
    });
    expect(groups.find((group) => group.projectId === 'p2')?.counts).toEqual({
      overdue: 0,
      notStarted: 1,
      active: 1,
      finished: 0,
    });
  });

  it('mức ưu tiên cao nhất, số việc cùng mức và hạn gần nhất chỉ tính việc còn mở', async () => {
    const { groups } = await run();
    // a3 (urgent, đã xong) không được tính; mức cao nhất còn mở là urgent của a2.
    expect(groups.find((group) => group.projectId === 'p1')).toMatchObject({
      topPriority: 'urgent',
      topPriorityCount: 1,
      // a3 hạn 01/09 đã xong nên không kéo hạn gần nhất về quá khứ xa.
      nextDue: '2026-09-20',
    });
    expect(groups.find((group) => group.projectId === 'p2')).toMatchObject({
      topPriority: 'normal',
      topPriorityCount: 2,
      nextDue: '2026-09-24',
    });
  });

  it('nhóm không còn việc mở thì không có mức ưu tiên và hạn', async () => {
    const mid = (await run()).groups.find((group) => group.projectId === 'p3');
    expect(mid).toMatchObject({ total: 1, topPriorityCount: 0, progress: 0 });
    expect(mid?.topPriority).toBeUndefined();
    expect(mid?.nextDue).toBeUndefined();
  });

  it('tiến độ là trung bình mọi việc của nhóm, kể cả việc đã xong, làm tròn', async () => {
    const { groups } = await run();
    // (0 + 50 + 100 + 20) / 4 = 42,5 -> 43
    expect(groups.find((group) => group.projectId === 'p1')?.progress).toBe(43);
    expect(groups.find((group) => group.projectId === 'p2')?.progress).toBe(20);
  });

  it('không nhồi dòng việc vào kết quả', async () => {
    const result = (await run()) as unknown as Record<string, unknown>;
    expect(result['items']).toBeUndefined();
    expect(result['standaloneTasks']).toBeUndefined();
  });

  it('thứ tự nhóm theo hạn: nhóm có việc quá hạn lên trước, rồi theo mã', async () => {
    expect(byId((await run({}, 'due')).groups)).toEqual(['p1', 'p3', 'p2']);
    expect(byId((await run()).groups)).toEqual(['p1', 'p3', 'p2']);
  });

  it('thứ tự nhóm theo tên, mã (so số tự nhiên) và cập nhật gần nhất', async () => {
    expect(byId((await run({}, 'name')).groups)).toEqual(['p2', 'p3', 'p1']);
    // DA-2 đứng trước DA-10.
    expect(byId((await run({}, 'code')).groups)).toEqual(['p1', 'p2', 'p3']);
    expect(byId((await run({}, 'updated')).groups)).toEqual(['p3', 'p2', 'p1']);
  });

  it('bốn con số đầu trang gồm cả việc ngoài dự án, trừ việc chờ tôi duyệt', async () => {
    const { counters } = await run();
    // 7 việc dự án + 3 việc ngoài dự án (gv010 chờ duyệt không tính).
    expect(counters).toEqual({ openItems: 10, overdueItems: 4, dueToday: 2, completedThisWeek: 3 });
  });

  it('tóm tắt việc ngoài dự án gồm cả việc chờ tôi duyệt', async () => {
    const { standalone } = await run();
    expect(standalone).toEqual({
      total: 4,
      counts: { overdue: 1, notStarted: 1, active: 2, finished: 1 },
    });
  });

  it('lọc theo trạng thái', async () => {
    const { groups } = await run({ status: 'todo' });
    expect(byId(groups)).toEqual(['p1', 'p2']);
    expect(groups.map((group) => group.total)).toEqual([1, 1]);
  });

  it('lọc theo ưu tiên: tóm tắt tính trên việc đã lọc', async () => {
    const { groups } = await run({ priority: 'urgent' });
    expect(byId(groups)).toEqual(['p1']);
    expect(groups[0]).toMatchObject({ total: 2, counts: { overdue: 1, finished: 1, active: 1 } });
    expect(groups[0]?.progress).toBe(75);
  });

  it('lọc theo dự án và kết hợp nhiều bộ lọc', async () => {
    expect(byId((await run({ projectId: 'p2' })).groups)).toEqual(['p2']);
    expect(byId((await run({ projectId: 'p2', status: 'blocked' })).groups)).toEqual(['p2']);
    expect((await run({ projectId: 'p2', status: 'done' })).groups).toEqual([]);
  });

  it('ô lọc luôn rút từ mọi việc của tôi, không phụ thuộc bộ lọc đang bật', async () => {
    const unfiltered = (await run()).filterOptions;
    const filtered = (await run({ status: 'todo', projectId: 'p2' })).filterOptions;
    expect(filtered).toEqual(unfiltered);
    expect(unfiltered.statuses).toEqual(['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled']);
    expect(unfiltered.priorities).toEqual(['low', 'normal', 'high', 'urgent']);
    expect(unfiltered.projects.map((project) => project.code)).toEqual(['DA-1', 'DA-2', 'DA-10']);
  });

  it('chỉ dùng việc của người gọi; tenant-admin cũng vậy', async () => {
    const { store, asked } = pagedStore(MIXED, TASKS);
    const service = new MyWorkService(store);
    const asAdmin = await service.overview({ ...ME, userId: 'u2', isTenantAdmin: true }, {}, undefined, NOW);
    expect(asked).toEqual(['u2']);
    // u2 chỉ có z1 (DA-1) và z2 (DA-77), không thấy việc của u1.
    expect(asAdmin.groups.map((group) => group.projectId).sort()).toEqual(['p-other', 'p1']);
    expect(asAdmin.groups.find((group) => group.projectId === 'p1')?.total).toBe(1);
  });

  it('projectId của dự án mình không có việc thì trả rỗng, không lỗi', async () => {
    const result = await run({ projectId: 'khong-ton-tai' });
    expect(result.groups).toEqual([]);
    expect(result.counters.openItems).toBe(10);
  });

  it('chấp nhận mức ưu tiên tenant tự thêm nếu mình có việc mức đó', async () => {
    const rows = [owned('u1', 'p1', { id: 'k1', priority: 'khan-cap' })];
    const service = new MyWorkService(pagedStore(rows).store);
    const result = await service.overview(ME, { priority: 'khan-cap' }, undefined, NOW);
    expect(result.groups[0]?.total).toBe(1);
    expect(result.filterOptions.priorities).toEqual(['khan-cap']);
  });

  it('từ chối tham số sai bằng lỗi tiếng Việt', async () => {
    await expect(run({ status: 'abc' })).rejects.toBeInstanceOf(WorkspaceValidationError);
    // Mức ưu tiên lạ không phải lỗi: chỉ cho kết quả rỗng (bộ lọc cũ trong bộ nhớ đệm không được làm kẹt trang).
    await expect(run({ priority: 'khong-co' })).resolves.toMatchObject({ groups: [] });
    await expect(run({}, 'foo')).rejects.toBeInstanceOf(WorkspaceValidationError);
    await expect(run({ status: ['todo', 'done'] })).rejects.toBeInstanceOf(WorkspaceValidationError);
    await expect(run({ status: 'abc' })).rejects.toThrow('Trạng thái lọc không hợp lệ.');
    await expect(run({}, 'foo')).rejects.toThrow('Cách sắp xếp không hợp lệ.');
  });

  it('chuỗi rỗng nghĩa là không đặt', async () => {
    const result = await run({ status: '', priority: '', projectId: '' }, '');
    expect(result.groups).toHaveLength(3);
  });
});

describe('MyWorkService.groupItems', () => {
  const run = (
    projectId: string,
    filter: Record<string, unknown> = {},
    sort?: string,
    page?: unknown,
    pageSize?: unknown,
    actor = ME,
    store = pagedStore(MIXED, TASKS).store,
  ) => new MyWorkService(store).groupItems(actor, projectId, filter, sort, page, pageSize, NOW);
  const ids = (page: { items: readonly { item: { id: string } }[] }) =>
    page.items.map((entry) => entry.item.id);

  /** 25 việc cùng ưu tiên, cùng nhóm hạn: thứ tự `due` là thứ tự ban đầu. */
  const manyRows = Array.from({ length: 25 }, (_, index) =>
    owned('u1', 'p9', { id: `x${String(index + 1).padStart(2, '0')}` }),
  );
  const manyStore = () => pagedStore(manyRows).store;

  it('phân trang đúng: tổng, trang đầu, trang cuối', async () => {
    const first = await run('p9', {}, undefined, 1, 10, ME, manyStore());
    expect(first).toMatchObject({ total: 25, page: 1, pageSize: 10 });
    expect(ids(first)).toEqual(manyRows.slice(0, 10).map((entry) => entry.row.item.id));

    const last = await run('p9', {}, undefined, 3, 10, ME, manyStore());
    expect(last.total).toBe(25);
    expect(ids(last)).toEqual(['x21', 'x22', 'x23', 'x24', 'x25']);
  });

  it('trang vượt quá thì rỗng nhưng vẫn báo tổng', async () => {
    const result = await run('p9', {}, undefined, 4, 10, ME, manyStore());
    expect(result).toEqual({ items: [], total: 25, page: 4, pageSize: 10 });
  });

  it('kẹp trang và cỡ trang', async () => {
    const store = manyStore();
    expect((await run('p9', {}, undefined, 0, 10, ME, store)).page).toBe(1);
    expect((await run('p9', {}, undefined, -3, 10, ME, store)).page).toBe(1);
    expect((await run('p9', {}, undefined, 'abc', 10, ME, store)).page).toBe(1);
    expect((await run('p9', {}, undefined, '2', '10', ME, store)).page).toBe(2);

    const huge = await run('p9', {}, undefined, 1, 500, ME, store);
    expect(huge.pageSize).toBe(100);
    expect(huge.items).toHaveLength(25);
    // Nhỏ hơn 1, thiếu hoặc không phải số: cỡ mặc định của hợp đồng (không phải 1 dòng mỗi trang).
    expect((await run('p9', {}, undefined, 1, 0, ME, store)).pageSize).toBe(20);
    expect((await run('p9', {}, undefined, 1, -5, ME, store)).pageSize).toBe(20);
    expect((await run('p9', {}, undefined, 1, undefined, ME, store)).pageSize).toBe(20);
    expect((await run('p9', {}, undefined, 1, 'abc', ME, store)).pageSize).toBe(20);
  });

  it('thứ tự dòng theo từng cách xếp', async () => {
    // Quá hạn trước (urgent a3 trước high a1), rồi sau này, rồi không hạn.
    expect(ids(await run('p1', {}, 'due'))).toEqual(['a3', 'a1', 'a2', 'a4']);
    expect(ids(await run('p1'))).toEqual(['a3', 'a1', 'a2', 'a4']);
    expect(ids(await run('p1', {}, 'name'))).toEqual(['a4', 'a3', 'a2', 'a1']);
    expect(ids(await run('p1', {}, 'code'))).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(ids(await run('p1', {}, 'updated'))).toEqual(['a2', 'a1', 'a3', 'a4']);
  });

  it('sắp xếp áp lên toàn bộ nhóm trước khi cắt trang', async () => {
    const page1 = await run('p1', {}, 'name', 1, 3);
    const page2 = await run('p1', {}, 'name', 2, 3);
    expect(ids(page1)).toEqual(['a4', 'a3', 'a2']);
    expect(ids(page2)).toEqual(['a1']);
  });

  it('lọc theo trạng thái và ưu tiên, tổng tính trên việc đã lọc', async () => {
    const todo = await run('p1', { status: 'todo' });
    expect(ids(todo)).toEqual(['a1']);
    expect(todo.total).toBe(1);
    expect(ids(await run('p1', { priority: 'urgent' }))).toEqual(['a3', 'a2']);
    expect((await run('p1', { status: 'todo', priority: 'urgent' })).items).toEqual([]);
  });

  it('mỗi dòng mang nhóm hạn và nhãn dự án như trang cũ', async () => {
    const page = await run('p1');
    expect(page.items[0]).toMatchObject({ bucket: 'overdue', projectCode: 'DA-1', projectName: 'Zeta' });
  });

  it('chỉ trả việc của người gọi, đúng dự án', async () => {
    const mine = await run('p1');
    expect(ids(mine)).not.toContain('z1');
    const other = await run('p1', {}, undefined, 1, 20, { ...ME, userId: 'u2' });
    expect(ids(other)).toEqual(['z1']);
  });

  it('projectId của dự án mình không có việc thì trả rỗng, không lỗi', async () => {
    // `p-other` có việc của u2 nhưng u1 không có: không lộ gì.
    expect(await run('p-other')).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(await run('khong-ton-tai')).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('từ chối tham số sai', async () => {
    await expect(run('p1', { status: 'abc' })).rejects.toBeInstanceOf(WorkspaceValidationError);
    await expect(run('p1', { priority: 'khong-co' })).resolves.toMatchObject({ items: [], total: 0 });
    await expect(run('p1', {}, 'foo')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });
});

describe('MyWorkService.standalonePage', () => {
  const run = (sort?: string, page?: unknown, pageSize?: unknown, actor = ME) =>
    new MyWorkService(pagedStore(MIXED, TASKS).store).standalonePage(actor, sort, page, pageSize, NOW);
  const ids = (page: { items: readonly { task: { id: string } }[] }) =>
    page.items.map((entry) => entry.task.id);

  it('thứ tự theo hạn giữ cách xếp của nhóm hạn rồi chờ duyệt, ưu tiên, hạn', async () => {
    // quá hạn (gv001), hôm nay (gv003), sau này (gv002), không hạn (gv010).
    expect(ids(await run())).toEqual(['gv001', 'gv003', 'gv002', 'gv010']);
  });

  it('thứ tự theo tên, mã và cập nhật gần nhất', async () => {
    expect(ids(await run('name'))).toEqual(['gv002', 'gv001', 'gv010', 'gv003']);
    // GV010 sau GV003 vì so số tự nhiên.
    expect(ids(await run('code'))).toEqual(['gv001', 'gv002', 'gv003', 'gv010']);
    expect(ids(await run('updated'))).toEqual(['gv002', 'gv003', 'gv010', 'gv001']);
  });

  it('phân trang và kẹp tham số', async () => {
    expect(await run(undefined, 2, 2)).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(ids(await run(undefined, 2, 2))).toEqual(['gv002', 'gv010']);
    expect(await run(undefined, 3, 2)).toEqual({ items: [], total: 4, page: 3, pageSize: 2 });
    expect((await run(undefined, 0, 1000)).pageSize).toBe(100);
    expect((await run(undefined, 0, 1000)).page).toBe(1);
  });

  it('việc chờ tôi duyệt được đánh dấu', async () => {
    const page = await run();
    expect(page.items.find((entry) => entry.task.id === 'gv010')?.awaitingMyApproval).toBe(true);
    expect(page.items.find((entry) => entry.task.id === 'gv001')?.awaitingMyApproval).toBe(false);
  });

  it('chỉ trả việc của người gọi', async () => {
    const other = await run(undefined, 1, 20, { ...ME, userId: 'u2' });
    expect(ids(other)).toEqual(['gv999']);
  });

  it('từ chối cách xếp sai', async () => {
    await expect(run('foo')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });
});
