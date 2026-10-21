import { defineAssistantActions, draftOf } from '@enterprise-platform/contracts-assistant';
import type {
  CreateEventRequest,
  CreateStandaloneTaskRequest,
  CreateWorkItemRequest,
} from './contracts-workspace.js';

/** Danh bạ cả tổ chức (`{ people: [{ userId, displayName, unitNames }] }`): đổi tên người thành `userId`. */
const PEOPLE_LOOKUP = '/api/workspace/v1/directory';
/** Dự án người dùng thấy được (`?search=` theo tên hoặc mã): đổi tên dự án thành `id`. */
const PROJECTS_LOOKUP = '/api/workspace/v1/projects';

/**
 * Thao tác Trợ lý của Không gian làm việc. Trang form nhúng của phân hệ (`/modules/workspace/assistant/form`, trong card
 * của khung chat) mở đúng form tạo sẵn có với bản nháp; mọi ô tạo đều cần quyền `workspace.task.write`, như guard của
 * API (`POST` ngoài tài liệu).
 */
export const WORKSPACE_ASSISTANT_ACTIONS = defineAssistantActions('workspace', {
  createEvent: {
    key: 'workspace.event.create',
    title: 'Tạo cuộc họp hoặc sự kiện',
    hints: ['tạo cuộc họp', 'đặt lịch họp', 'mời họp', 'tạo sự kiện', 'lịch sinh hoạt'],
    permission: 'workspace.task.write',
    page: '/modules/workspace#my-work',
    draft: draftOf<CreateEventRequest>({
      projectId: {
        describe:
          'Mã dự án nếu người dùng nói sự kiện thuộc một dự án. Bỏ trống khi là lịch cá nhân, không thuộc dự án.',
        lookup: PROJECTS_LOOKUP,
      },
      title: { describe: 'Tiêu đề ngắn, ví dụ "Họp giao ban tuần".', required: true },
      description: 'Nội dung, chương trình, tài liệu cần chuẩn bị. Bỏ trống nếu người dùng không nói.',
      location: 'Địa điểm hoặc link họp trực tuyến. Bỏ trống nếu người dùng không nói.',
      eventType: 'Một trong: meeting (họp, mặc định), activity (sinh hoạt), other (khác).',
      startAt:
        'Giờ bắt đầu, ISO 8601 kèm múi giờ, ví dụ 2026-10-20T14:00:00+07:00. Không nói ngày thì là hôm nay.',
      endAt:
        'Giờ kết thúc, ISO 8601 kèm múi giờ, cùng ngày với giờ bắt đầu. Không nói thì bằng giờ bắt đầu cộng 60 phút.',
      allDay: 'true khi sự kiện kéo dài cả ngày; mặc định false.',
      participantUserIds: {
        describe:
          'Danh sách userId người được mời. Người tạo là người tổ chức và luôn có mặt, không cần liệt kê. Sự kiện của dự án chỉ mời được thành viên dự án.',
        lookup: PEOPLE_LOOKUP,
      },
    }),
  },
  createWorkItem: {
    key: 'workspace.work-item.create',
    title: 'Tạo công việc trong dự án',
    hints: ['tạo công việc trong dự án', 'thêm việc vào dự án', 'giao việc trong dự án', 'thêm mốc dự án'],
    permission: 'workspace.task.write',
    page: '/modules/workspace#my-work',
    draft: draftOf<CreateWorkItemRequest>({
      projectId: {
        describe: 'Mã dự án chứa công việc. Tra theo tên hoặc mã dự án người dùng nói.',
        lookup: PROJECTS_LOOKUP,
        required: true,
      },
      title: { describe: 'Tên công việc ngắn gọn.', required: true },
      description: 'Yêu cầu, kết quả cần nộp. Bỏ trống nếu người dùng không nói.',
      itemType: 'Một trong: task (công việc, mặc định), milestone (mốc), phase (nhóm công việc).',
      priority: 'Một trong: low, normal (mặc định), high, urgent.',
      assigneeUserId: {
        describe:
          'userId người phụ trách, phải là thành viên dự án. Không nói thì bỏ trống: form chọn sẵn chính người dùng.',
        lookup: PEOPLE_LOOKUP,
      },
      participantUserIds: {
        describe: 'Danh sách userId người thực hiện cùng, là thành viên dự án, không gồm người phụ trách.',
        lookup: PEOPLE_LOOKUP,
      },
      plannedStart: 'Ngày bắt đầu dự kiến, dạng YYYY-MM-DD.',
      plannedEnd: 'Ngày kết thúc dự kiến (hạn), dạng YYYY-MM-DD, không trước ngày bắt đầu.',
      estimateHours: 'Số giờ ước lượng, số không âm.',
    }),
  },
  createStandaloneTask: {
    key: 'workspace.standalone-task.create',
    title: 'Giao việc ngoài dự án',
    hints: ['giao việc', 'tạo việc cá nhân', 'nhắc việc', 'việc ngoài dự án', 'tạo đầu việc'],
    permission: 'workspace.task.write',
    page: '/modules/workspace#tasks',
    draft: draftOf<CreateStandaloneTaskRequest>({
      title: { describe: 'Tên công việc ngắn gọn.', required: true },
      description: 'Yêu cầu, kết quả cần nộp. Bỏ trống nếu người dùng không nói.',
      priority: 'Một trong: low, normal (mặc định), high, urgent.',
      assigneeUserId: {
        describe:
          'userId người phụ trách, bất kỳ ai trong tổ chức. Không nói thì bỏ trống: form chọn sẵn chính người dùng.',
        lookup: PEOPLE_LOOKUP,
      },
      participantUserIds: {
        describe: 'Danh sách userId người cùng thực hiện, không gồm người phụ trách.',
        lookup: PEOPLE_LOOKUP,
      },
      followerUserIds: {
        describe: 'Danh sách userId người theo dõi (chỉ xem và nhận thông báo).',
        lookup: PEOPLE_LOOKUP,
      },
      plannedStart: 'Ngày bắt đầu, dạng YYYY-MM-DD.',
      dueDate: 'Hạn hoàn thành, dạng YYYY-MM-DD, không trước ngày bắt đầu.',
    }),
  },
});
