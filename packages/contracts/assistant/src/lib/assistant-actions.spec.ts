import {
  assistantActionProblems,
  defineAssistantActions,
  draftOf,
  toCatalogItem,
} from './assistant-actions.js';

interface CreateMeetingRequest {
  title: string;
  startAt: string;
  attendeeUserIds: string[];
}

const WORKSPACE_ACTIONS = defineAssistantActions('workspace', {
  createMeeting: {
    key: 'workspace.event.create',
    title: 'Tạo cuộc họp',
    hints: ['đặt lịch họp'],
    permission: 'workspace.task.write',
    page: '/modules/workspace#calendar',
    draft: draftOf<CreateMeetingRequest>({
      title: 'Tiêu đề cuộc họp',
      startAt: 'Giờ bắt đầu, ISO 8601 theo giờ Việt Nam',
      attendeeUserIds: {
        describe: 'Người tham dự',
        lookup: '/api/workspace/v1/members',
      },
    }),
  },
});

describe('defineAssistantActions', () => {
  it('gắn phân hệ và khoá thao tác lại', () => {
    expect(WORKSPACE_ACTIONS.createMeeting.module).toBe('workspace');
    expect(Object.isFrozen(WORKSPACE_ACTIONS.createMeeting)).toBe(true);
  });

  it('báo lỗi typecheck khi bản nháp có trường không thuộc request', () => {
    draftOf<CreateMeetingRequest>({
      // @ts-expect-error `location` không phải trường của CreateMeetingRequest.
      location: 'Phòng họp',
    });
  });
});

describe('assistantActionProblems', () => {
  it('chấp nhận danh mục đúng chuẩn', () => {
    expect(assistantActionProblems(WORKSPACE_ACTIONS)).toEqual([]);
  });

  it('nhận tiền tố quyền khác mã phân hệ', () => {
    const actions = defineAssistantActions('procedure-engine', {
      startCase: {
        key: 'procedure.instance.create',
        title: 'Khởi tạo hồ sơ',
        permission: 'procedure.instance.create',
        page: '/modules/procedure-engine',
        draft: {},
      },
    });
    expect(assistantActionProblems(actions)).toEqual([]);
  });

  it('báo key sai dạng, sai tiền tố hoặc trùng', () => {
    const actions = defineAssistantActions('workspace', {
      shortKey: {
        key: 'workspace.create',
        title: 'Thiếu đối tượng',
        permission: 'workspace.task.write',
        page: '/modules/workspace',
        draft: {},
      },
      otherPrefix: {
        key: 'hrm.event.create',
        title: 'Sai tiền tố',
        permission: 'workspace.task.write',
        page: '/modules/workspace',
        draft: {},
      },
      first: {
        key: 'workspace.task.create',
        title: 'Tạo công việc',
        permission: 'workspace.task.write',
        page: '/modules/workspace',
        draft: {},
      },
      second: {
        key: 'workspace.task.create',
        title: 'Tạo công việc lần hai',
        permission: 'workspace.task.write',
        page: '/modules/workspace',
        draft: {},
      },
    });
    expect(assistantActionProblems(actions)).toEqual([
      'workspace/shortKey: key "workspace.create" phải có dạng <tiền tố>.<đối tượng>.<động từ>, chữ thường.',
      'workspace/otherPrefix: key "hrm.event.create" phải bắt đầu bằng "workspace.".',
      'workspace/second: key "workspace.task.create" bị trùng.',
    ]);
  });

  it('báo quyền không thuộc phân hệ, kể cả module.access ở phân hệ không nhận probe', () => {
    const actions = defineAssistantActions('maintenance', {
      foreign: {
        key: 'maintenance.occurrence.assign',
        title: 'Giao việc bảo trì',
        permission: 'workspace.task.write',
        page: '/modules/maintenance',
        draft: {},
      },
      admission: {
        key: 'maintenance.occurrence.view',
        title: 'Xem việc bảo trì',
        permission: 'module.access',
        page: '/modules/maintenance',
        draft: {},
      },
    });
    expect(assistantActionProblems(actions)).toEqual([
      'maintenance/foreign: quyền "workspace.task.write" không thuộc phân hệ "maintenance".',
      'maintenance/admission: quyền "module.access" không thuộc phân hệ "maintenance".',
    ]);
  });

  it('báo thiếu tên, trang sai và mô tả hoặc lookup không hợp lệ', () => {
    const actions = defineAssistantActions('workspace', {
      broken: {
        key: 'workspace.event.create',
        title: ' ',
        permission: 'workspace.task.write',
        page: 'modules/workspace',
        draft: draftOf<CreateMeetingRequest>({
          title: '',
          attendeeUserIds: {
            describe: 'Người tham dự',
            lookup: '/api/identity/v1/internal/users',
          },
        }),
      },
    });
    expect(assistantActionProblems(actions)).toEqual([
      'workspace/broken: thiếu title.',
      'workspace/broken: page "modules/workspace" phải là đường dẫn bắt đầu bằng "/".',
      'workspace/broken: ô "title" thiếu mô tả.',
      'workspace/broken: lookup của ô "attendeeUserIds" phải là /api/... và không dùng route nội bộ.',
    ]);
  });
});

describe('toCatalogItem', () => {
  it('đổi khai báo thành dạng Trợ lý đọc, kèm biến thể', () => {
    const [item] = Object.values(
      defineAssistantActions('hrm', {
        custom: {
          key: 'hrm.custom-request.create',
          title: 'Tạo đơn theo loại của công ty',
          permission: 'hrm.self.request',
          page: '/modules/hrm/requests',
          draft: { description: 'Nội dung đơn', approverId: { describe: 'Người duyệt', lookup: '/api/hrm/v1/x' } },
          variants: { describe: 'Loại đơn tuỳ chỉnh', lookup: '/api/hrm/v1/request-types' },
        },
      }),
    ).map(toCatalogItem);
    expect(item).toEqual({
      key: 'hrm.custom-request.create',
      module: 'hrm',
      title: 'Tạo đơn theo loại của công ty',
      hints: [],
      page: '/modules/hrm/requests',
      draft: {
        description: { describe: 'Nội dung đơn' },
        approverId: { describe: 'Người duyệt', lookup: '/api/hrm/v1/x' },
      },
      variants: { describe: 'Loại đơn tuỳ chỉnh', lookup: '/api/hrm/v1/request-types' },
    });
  });

  it('báo biến thể dùng route nội bộ', () => {
    const actions = defineAssistantActions('hrm', {
      custom: {
        key: 'hrm.custom-request.create',
        title: 'Tạo đơn',
        permission: 'hrm.self.request',
        page: '/modules/hrm/requests',
        draft: {},
        variants: { describe: 'Loại đơn', lookup: '/api/hrm/v1/internal/types' },
      },
    });
    expect(assistantActionProblems(actions)).toEqual([
      'hrm/custom: variants cần mô tả và lookup /api/... không dùng route nội bộ.',
    ]);
  });
});
