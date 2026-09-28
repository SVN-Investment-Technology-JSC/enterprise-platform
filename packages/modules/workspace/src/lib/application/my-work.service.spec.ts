import type { CalendarEvent, WorkItem } from '@enterprise-platform/contracts-workspace';
import { MyWorkService, bucketise } from './my-work.service.js';
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
