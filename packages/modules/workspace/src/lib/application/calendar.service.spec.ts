import type {
  CalendarEvent,
  EventParticipant,
  ProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { CalendarService, buildBusinessTripOccurrences } from './calendar.service.js';
import { DirectoryService } from './directory.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Store giả chỉ đủ cho nhánh đọc chi tiết sự kiện. Mục tiêu là kiểm hàng rào
 * ai được xem sự kiện cá nhân, không kiểm SQL.
 */
function makeStore(event: Partial<CalendarEvent>, participantIds: readonly string[]) {
  const store = {
    calendar: {
      findEvent: async (_tenant: string, id: string) =>
        id === 'e1' ? ({ id: 'e1', title: 'Họp riêng', ...event } as CalendarEvent) : undefined,
      listParticipants: async () =>
        participantIds.map((userId) => ({ userId }) as EventParticipant),
    },
    project: { findById: async () => undefined },
    member: { roleOf: async () => undefined },
  };
  return store as unknown as WorkspaceStore;
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

function serviceFor(store: WorkspaceStore) {
  return new CalendarService(store, new ProjectService(store));
}

describe('CalendarService — xem sự kiện cá nhân', () => {
  const personal = { projectId: undefined, organizerUserId: 'organizer' };

  it('người tổ chức xem được', async () => {
    const service = serviceFor(makeStore(personal, ['guest']));
    await expect(service.detail(actorOf('organizer'), 'e1')).resolves.toMatchObject({
      event: { id: 'e1' },
    });
  });

  it('người được mời xem được', async () => {
    const service = serviceFor(makeStore(personal, ['guest']));
    await expect(service.detail(actorOf('guest'), 'e1')).resolves.toMatchObject({
      event: { id: 'e1' },
    });
  });

  it('người ngoài nhận 404, không phải 403 — không dò được id nào có thật', async () => {
    const service = serviceFor(makeStore(personal, ['guest']));
    await expect(service.detail(actorOf('stranger'), 'e1')).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('người ngoài không phản hồi lời mời được', async () => {
    const service = serviceFor(makeStore(personal, ['guest']));
    await expect(service.respond(actorOf('stranger'), 'e1', 'accepted')).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
  });

  it('quản trị viên tenant vẫn xem được, cùng mức với sửa và huỷ', async () => {
    const service = serviceFor(makeStore(personal, []));
    await expect(service.detail(actorOf('admin', true), 'e1')).resolves.toMatchObject({
      event: { id: 'e1' },
    });
  });
});

describe('CalendarService — mời người trong tổ chức', () => {
  const projectEvent = {
    id: 'e1',
    projectId: 'p1',
    organizerUserId: 'organizer',
    title: 'Họp giao ban',
  } as CalendarEvent;

  function storeFor(participantIds: readonly string[]) {
    return {
      calendar: {
        findEvent: async () => projectEvent,
        listParticipants: async () =>
          participantIds.map((userId) => ({ userId }) as EventParticipant),
        createEvent: async () => ({ event: projectEvent, participants: [] }),
        busySlots: async () => [],
      },
      project: { findById: async () => ({ id: 'p1' }) as never },
      // Không ai là thành viên dự án, trừ người tổ chức.
      member: {
        roleOf: async (_tenant: string, _project: string, userId: string) =>
          userId === 'organizer' ? 'member' : undefined,
      },
    } as unknown as WorkspaceStore;
  }

  function directoryWith(known: readonly string[], degraded = false) {
    return new DirectoryService({
      list: async () => ({
        people: known.map((userId) => ({ userId, displayName: userId, unitNames: [] })),
        degraded,
      }),
    });
  }

  it('người được mời xem được sự kiện dự án dù không phải thành viên', async () => {
    const store = storeFor(['guest']);
    const service = new CalendarService(store, new ProjectService(store));
    await expect(service.detail(actorOf('guest'), 'e1')).resolves.toMatchObject({
      event: { id: 'e1' },
    });
  });

  it('người không được mời và không thuộc dự án vẫn bị chặn', async () => {
    const store = storeFor(['guest']);
    const service = new CalendarService(store, new ProjectService(store));
    await expect(service.detail(actorOf('stranger'), 'e1')).rejects.toMatchObject({
      code: 'PROJECT_FORBIDDEN',
    });
  });

  const draft = {
    projectId: 'p1',
    title: 'Sinh hoạt cuối tháng',
    eventType: 'activity' as const,
    startAt: '2026-09-25T09:00:00.000Z',
    endAt: '2026-09-25T10:00:00.000Z',
  };

  it('mời người ngoài dự án dù trong tổ chức: từ chối', async () => {
    const store = storeFor([]);
    const service = new CalendarService(
      store,
      new ProjectService(store),
      directoryWith(['organizer', 'ke-toan']),
    );
    await expect(
      service.create(actorOf('organizer'), { ...draft, participantUserIds: ['ke-toan'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('sự kiện cá nhân (không thuộc dự án) mời người trong tổ chức: được', async () => {
    const store = storeFor([]);
    const service = new CalendarService(
      store,
      new ProjectService(store),
      directoryWith(['organizer', 'ke-toan']),
    );
    await expect(
      service.create(actorOf('organizer'), {
        ...draft,
        projectId: undefined,
        participantUserIds: ['ke-toan'],
      }),
    ).resolves.toBeDefined();
  });

  it('mời id không có trong tổ chức: từ chối', async () => {
    const store = storeFor([]);
    const service = new CalendarService(store, new ProjectService(store), directoryWith(['organizer']));
    await expect(
      service.create(actorOf('organizer'), { ...draft, participantUserIds: ['nguoi-la'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('danh bạ không đọc được: không chặn', async () => {
    const store = storeFor([]);
    const service = new CalendarService(
      store,
      new ProjectService(store),
      directoryWith([], true),
    );
    // Sự kiện cá nhân: không vướng thêm điều kiện thành viên dự án.
    await expect(
      service.create(actorOf('organizer'), {
        ...draft,
        projectId: undefined,
        participantUserIds: ['nguoi-la'],
      }),
    ).resolves.toBeDefined();
  });
});

describe('CalendarService — sửa "từ buổi này trở đi"', () => {
  /** Giao ban 9 giờ sáng thứ Năm hằng tuần, 10 buổi, bắt đầu 03/09/2026. */
  const weekly = {
    id: 'series-1',
    seriesId: 'series-1',
    organizerUserId: 'organizer',
    title: 'Giao ban',
    eventType: 'meeting',
    startAt: '2026-09-03T02:00:00.000Z',
    endAt: '2026-09-03T03:00:00.000Z',
    allDay: false,
    timezone: 'Asia/Ho_Chi_Minh',
    recurrenceRule: 'FREQ=WEEKLY',
    recurrenceCount: 10,
  } as CalendarEvent;

  function storeWithCalls() {
    const updates: { id: string; input: Record<string, unknown> }[] = [];
    const creates: Record<string, unknown>[] = [];
    const store = {
      calendar: {
        findEvent: async () => weekly,
        listParticipants: async () => [{ userId: 'guest' } as EventParticipant],
        updateEvent: async (_t: string, _a: string, id: string, input: Record<string, unknown>) => {
          updates.push({ id, input });
          return { event: weekly, participants: [] };
        },
        createEvent: async (_t: string, _a: string, input: Record<string, unknown>) => {
          creates.push(input);
          return { event: { ...weekly, id: 'series-2' }, participants: [] };
        },
        busySlots: async () => [],
      },
      project: { findById: async () => undefined },
      member: { roleOf: async () => undefined },
    } as unknown as WorkspaceStore;
    return { store, updates, creates };
  }

  it('cắt chuỗi cũ ngay trước buổi được chọn và sinh chuỗi mới với số buổi còn lại', async () => {
    const { store, updates, creates } = storeWithCalls();
    const service = new CalendarService(store, new ProjectService(store));

    await service.update(actorOf('organizer'), 'series-1', {
      scope: 'following',
      occurrenceDate: '2026-09-17',
      title: 'Giao ban (giờ mới)',
    });

    expect(updates).toEqual([
      { id: 'series-1', input: { recurrenceUntil: new Date('2026-09-17T01:59:59.000Z') } },
    ]);
    expect(creates[0]).toMatchObject({
      title: 'Giao ban (giờ mới)',
      startAt: new Date('2026-09-17T02:00:00.000Z'),
      recurrenceRule: 'FREQ=WEEKLY',
      // Buổi thứ ba trong 10 buổi: còn lại 8.
      recurrenceCount: 8,
    });
  });

  it('chọn buổi đầu tiên thì sửa cả chuỗi, không tách', async () => {
    const { store, updates, creates } = storeWithCalls();
    const service = new CalendarService(store, new ProjectService(store));

    await service.update(actorOf('organizer'), 'series-1', {
      scope: 'following',
      occurrenceDate: '2026-09-03',
      title: 'Giao ban',
    });

    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });

  it('huỷ từ buổi này trở đi: chỉ cắt chuỗi, không huỷ các buổi trước', async () => {
    const { store, updates } = storeWithCalls();
    const service = new CalendarService(store, new ProjectService(store));

    await service.cancel(actorOf('organizer'), 'series-1', 'following', '2026-09-17');

    expect(updates).toEqual([
      { id: 'series-1', input: { recurrenceUntil: new Date('2026-09-17T01:59:59.000Z') } },
    ]);
  });

  it('ngày không có buổi nào: từ chối', async () => {
    const { store } = storeWithCalls();
    const service = new CalendarService(store, new ProjectService(store));
    await expect(
      service.update(actorOf('organizer'), 'series-1', {
        scope: 'following',
        occurrenceDate: '2026-09-18',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('chuỗi tạo từ giao diện (COUNT nằm trong RRULE): chuỗi mới không chép COUNT cũ', async () => {
    // Giao diện gửi `FREQ=WEEKLY;INTERVAL=1;COUNT=10` và để trống hai cột.
    // Chép nguyên chuỗi sang thì chuỗi mới sinh 10 buổi nữa, tổng thành 12.
    const fromUi = {
      ...weekly,
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;COUNT=10',
      recurrenceCount: undefined,
    } as CalendarEvent;
    const creates: Record<string, unknown>[] = [];
    const store = {
      calendar: {
        findEvent: async () => fromUi,
        listParticipants: async () => [],
        updateEvent: async () => ({ event: fromUi, participants: [] }),
        createEvent: async (_t: string, _a: string, input: Record<string, unknown>) => {
          creates.push(input);
          return { event: { ...fromUi, id: 'series-2' }, participants: [] };
        },
        busySlots: async () => [],
      },
      project: { findById: async () => undefined },
      member: { roleOf: async () => undefined },
    } as unknown as WorkspaceStore;
    const service = new CalendarService(store, new ProjectService(store));

    await service.update(actorOf('organizer'), 'series-1', {
      scope: 'following',
      occurrenceDate: '2026-09-17',
    });

    expect(creates[0]).toMatchObject({
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      recurrenceCount: 8,
    });
  });
});

describe('Lịch công tác từ đơn công tác gắn dự án', () => {
  const request = (patch: Partial<ProjectRequest>): ProjectRequest => ({
    id: 'r1',
    projectId: 'p1',
    code: 'DT001',
    sourceModule: 'hrm',
    sourceKind: 'business_trip',
    sourceId: 's1',
    requestTypeLabel: 'Đơn công tác',
    requesterUserId: 'u1',
    requesterName: 'Nguyễn An',
    fromDate: '2026-11-10',
    toDate: '2026-11-12',
    status: 'APPROVED',
    launchUrl: '/modules/hrm/requests?request=s1',
    details: [{ label: 'Địa điểm công tác', value: 'Kon Tum' }],
    submittedAt: '2026-11-01T00:00:00.000Z',
    ...patch,
  });
  const from = new Date('2026-11-01T00:00:00+07:00');
  const to = new Date('2026-11-30T23:59:59+07:00');

  it('đơn đã duyệt hiện thành mục cả ngày, kèm đường mở đơn gốc', () => {
    const [trip] = buildBusinessTripOccurrences([request({})], from, to);
    expect(trip).toMatchObject({
      eventId: 'trip:r1',
      title: 'Nguyễn An · công tác',
      allDay: true,
      startAt: '2026-11-09T17:00:00.000Z',
      businessTrip: {
        code: 'DT001',
        status: 'APPROVED',
        requestTypeLabel: 'Đơn công tác',
        fromDate: '2026-11-10',
        toDate: '2026-11-12',
        // Chi tiết HRM gửi kèm đi thẳng vào mục lịch để hộp chi tiết mở không phải gọi thêm.
        details: [{ label: 'Địa điểm công tác', value: 'Kon Tum' }],
      },
    });
    // Hết ngày 12/11 giờ Việt Nam: chạm tới ngày cuối của đơn.
    expect(new Date(trip?.endAt ?? '').getTime()).toBe(new Date('2026-11-12T23:59:59+07:00').getTime());
  });

  it('đơn chờ duyệt vẫn hiện nhưng ghi rõ "chờ duyệt"', () => {
    const [trip] = buildBusinessTripOccurrences([request({ status: 'PENDING' })], from, to);
    expect(trip?.title).toBe('Nguyễn An · công tác (chờ duyệt)');
    expect(trip?.businessTrip?.status).toBe('PENDING');
  });

  it.each(['REJECTED', 'CANCELLED', 'REVERSED'] as const)('đơn %s không hiện', (status) => {
    expect(buildBusinessTripOccurrences([request({ status })], from, to)).toHaveLength(0);
  });

  it('chỉ lấy đơn công tác: nghỉ phép tự gắn theo thời gian công tác không hiện', () => {
    const leave = request({ id: 'r2', sourceKind: 'leave', linkedViaKind: 'business_trip' });
    expect(buildBusinessTripOccurrences([leave], from, to)).toHaveLength(0);
  });

  it('đơn nằm ngoài khoảng đang xem thì bỏ; chạm biên thì giữ', () => {
    const before = request({ id: 'a', fromDate: '2026-10-20', toDate: '2026-10-25' });
    const edge = request({ id: 'b', fromDate: '2026-10-28', toDate: '2026-11-01' });
    const after = request({ id: 'c', fromDate: '2026-12-02', toDate: '2026-12-03' });
    const ids = buildBusinessTripOccurrences([before, edge, after], from, to).map((o) => o.eventId);
    expect(ids).toEqual(['trip:b']);
  });

  it('đơn một ngày (không có ngày kết thúc) hiện đúng ngày đó', () => {
    const [trip] = buildBusinessTripOccurrences([request({ toDate: undefined })], from, to);
    expect(trip?.endAt).toBe(new Date('2026-11-10T23:59:59+07:00').toISOString());
  });

  it('range của dự án gộp lịch công tác với sự kiện, xếp theo thời gian; không có projectId thì không có công tác', async () => {
    const meeting = {
      id: 'e1',
      title: 'Họp',
      eventType: 'meeting',
      startAt: '2026-11-11T02:00:00.000Z',
      endAt: '2026-11-11T03:00:00.000Z',
      allDay: false,
      timezone: 'Asia/Ho_Chi_Minh',
      organizerUserId: 'u1',
    } as CalendarEvent;
    const store = {
      calendar: { listCandidates: async () => [meeting], listExceptions: async () => [] },
      projectRequest: { listByProject: async () => [request({})] },
    } as unknown as WorkspaceStore;
    const projects = { access: async () => ({}) } as unknown as ProjectService;
    const service = new CalendarService(store, projects);
    const query = { from: from.toISOString(), to: to.toISOString() };

    const inProject = await service.range(actorOf('u1'), { ...query, projectId: 'p1' });
    expect(inProject.occurrences.map((o) => o.eventId)).toEqual(['trip:r1', 'e1']);

    const personal = await service.range(actorOf('u1'), query);
    expect(personal.occurrences.map((o) => o.eventId)).toEqual(['e1']);
  });
});
