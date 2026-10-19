import {
  assistantUnavailableReason,
  eventDraftToForm,
  standaloneTaskDraftToForm,
  workItemDraftToForm,
  workspaceHref,
} from './assistant-drafts';

/** Mốc ISO của một giờ địa phương, để test không phụ thuộc múi giờ máy chạy. */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

describe('eventDraftToForm', () => {
  it('đổi giờ bắt đầu, kết thúc thành ngày và giờ của form', () => {
    expect(
      eventDraftToForm({
        title: '  Họp giao ban  ',
        eventType: 'meeting',
        location: 'Phòng 301',
        startAt: at(20, 14),
        endAt: at(20, 15, 30),
        allDay: false,
      }),
    ).toEqual({
      title: 'Họp giao ban',
      eventType: 'meeting',
      location: 'Phòng 301',
      date: '2026-10-20',
      startTime: '14:00',
      endTime: '15:30',
      allDay: false,
    });
  });

  it('thiếu giờ kết thúc thì lấy giờ bắt đầu cộng 60 phút, không qua nửa đêm', () => {
    expect(eventDraftToForm({ startAt: at(20, 9, 15) })).toMatchObject({ endTime: '10:15' });
    expect(eventDraftToForm({ startAt: at(20, 23, 30) })).toMatchObject({ endTime: '23:59' });
    // Kết thúc trước bắt đầu là sai: dùng mặc định.
    expect(eventDraftToForm({ startAt: at(20, 14), endAt: at(20, 13) })).toMatchObject({
      endTime: '15:00',
    });
  });

  it('bỏ người tổ chức và mã trùng khỏi người được mời', () => {
    expect(
      eventDraftToForm(
        { participantUserIds: ['me', 'binh', 'binh', '', 7] },
        { organizerUserId: 'me' },
      ),
    ).toEqual({ participantUserIds: ['binh'] });
  });

  it('bỏ qua giá trị sai, chỉ trả ô có trong bản nháp', () => {
    expect(
      eventDraftToForm({
        title: 42,
        eventType: 'party',
        startAt: 'chiều mai',
        allDay: 'yes',
        participantUserIds: 'binh',
      }),
    ).toEqual({});
  });
});

describe('workItemDraftToForm', () => {
  it('điền dự án, loại, ưu tiên, ngày và giờ ước lượng', () => {
    expect(
      workItemDraftToForm({
        projectId: 'p1',
        title: 'Khảo sát hiện trường',
        itemType: 'milestone',
        priority: 'high',
        assigneeUserId: 'binh',
        participantUserIds: ['binh', 'an'],
        plannedStart: '2026-10-20',
        plannedEnd: at(25, 10),
        estimateHours: 4.5,
      }),
    ).toEqual({
      projectId: 'p1',
      title: 'Khảo sát hiện trường',
      itemType: 'milestone',
      priority: 'high',
      assigneeUserId: 'binh',
      participantUserIds: ['an'],
      plannedStart: '2026-10-20',
      plannedEnd: '2026-10-25',
      estimateHours: '4.5',
    });
  });

  it('không nói người phụ trách thì dùng người mặc định', () => {
    expect(workItemDraftToForm({ title: 'Việc' }, { defaultAssigneeUserId: 'me' })).toEqual({
      title: 'Việc',
      assigneeUserId: 'me',
    });
    expect(
      workItemDraftToForm({ assigneeUserId: 'binh' }, { defaultAssigneeUserId: 'me' }),
    ).toEqual({ assigneeUserId: 'binh' });
  });

  it('bỏ qua loại, ngày và giờ ước lượng không hợp lệ', () => {
    expect(
      workItemDraftToForm({
        itemType: 'epic',
        priority: 'critical',
        plannedStart: '2026-13-45',
        estimateHours: -2,
      }),
    ).toEqual({});
  });
});

describe('standaloneTaskDraftToForm', () => {
  it('mỗi người giữ một vai: người phụ trách, cùng thực hiện, theo dõi', () => {
    expect(
      standaloneTaskDraftToForm({
        title: 'Soạn báo giá',
        assigneeUserId: 'binh',
        participantUserIds: ['binh', 'an'],
        followerUserIds: ['an', 'chi', 'binh'],
        dueDate: '2026-10-31',
        priority: 'urgent',
      }),
    ).toEqual({
      title: 'Soạn báo giá',
      assigneeUserId: 'binh',
      participantUserIds: ['an'],
      followerUserIds: ['chi'],
      dueDate: '2026-10-31',
      priority: 'urgent',
    });
  });

  it('không nói người phụ trách thì dùng người mặc định', () => {
    expect(standaloneTaskDraftToForm({}, { defaultAssigneeUserId: 'me' })).toEqual({
      assigneeUserId: 'me',
    });
  });
});

describe('assistantUnavailableReason', () => {
  const capabilities = {
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: false,
    canDeleteDocuments: false,
  };
  const status = { tenantId: 't1', schemaExists: true, tablesReady: true, capabilities };

  it('mở form khi có quyền ghi, hoặc chưa biết trạng thái', () => {
    expect(assistantUnavailableReason(status)).toBeUndefined();
    expect(assistantUnavailableReason(undefined)).toBeUndefined();
    // Server bản cũ chưa trả quyền: không tự chặn.
    expect(assistantUnavailableReason({ ...status, capabilities: undefined })).toBeUndefined();
    expect(
      assistantUnavailableReason({
        ...status,
        capabilities: { ...capabilities, canWriteTasks: false, isTenantAdmin: true },
      }),
    ).toBeUndefined();
  });

  it('báo lý do khi dữ liệu đang khởi tạo hoặc thiếu quyền ghi', () => {
    expect(assistantUnavailableReason({ ...status, tablesReady: false })).toMatch(/khởi tạo/);
    expect(
      assistantUnavailableReason({
        ...status,
        capabilities: { ...capabilities, canWriteTasks: false },
      }),
    ).toMatch(/không có quyền/);
  });
});

describe('workspaceHref', () => {
  it('mở đúng chỗ của bản ghi vừa tạo', () => {
    expect(workspaceHref.event('e1', 'p1')).toBe('/modules/workspace?project=p1#projects/calendar/e1');
    expect(workspaceHref.event('e1')).toBe('/modules/workspace#my-work');
    expect(workspaceHref.workItem('w1', 'p1')).toBe(
      '/modules/workspace?project=p1#projects/work-item/w1',
    );
    expect(workspaceHref.standaloneTask('t1')).toBe('/modules/workspace#tasks/t1');
  });
});
