import {
  defineAssistantActions,
  draftOf,
} from '@enterprise-platform/contracts-assistant';
import type {
  CreateBusinessTripRequestPayload,
  CreateCustomRequestPayload,
  CreateLeaveRequestPayload,
  CreateOtRequestPayload,
} from './contracts-hrm.js';

/** Trang Đơn từ của tôi: popup tạo đơn của cả bốn thao tác nằm ở đây. */
const REQUESTS_PAGE = '/modules/hrm/requests';

const DESCRIPTION =
  'Mô tả thêm, văn bản tự do ngắn (tối đa 2000 ký tự). Bắt buộc khi lý do đã chọn yêu cầu mô tả.';

/**
 * Thao tác Trợ lý của HRM: mở popup tạo đơn của trang Đơn từ với bản nháp điền sẵn; người dùng xem lại và gửi như khi
 * tự nhập. Người nộp đơn luôn là chính người hỏi (`employeeId` không nằm trong bản nháp).
 */
export const HRM_ASSISTANT_ACTIONS = defineAssistantActions('hrm', {
  createLeaveRequest: {
    key: 'hrm.leave-request.create',
    title: 'Tạo đơn nghỉ phép',
    hints: ['xin nghỉ', 'nghỉ phép', 'nghỉ ốm', 'nghỉ nửa ngày', 'nghỉ việc riêng'],
    permission: 'hrm.self.request',
    page: REQUESTS_PAGE,
    draft: draftOf<CreateLeaveRequestPayload>({
      leaveTypeId: {
        describe:
          'Lý do nghỉ (loại nghỉ): id của loại có tên khớp lời người dùng (phép năm, nghỉ ốm, việc riêng...). Không rõ thì bỏ trống để người dùng chọn.',
        lookup: '/api/hrm/v1/leave-types?active=true',
      },
      fromDate:
        'Nghỉ cả ngày: ngày bắt đầu YYYY-MM-DD. Form tự lấy giờ theo ca của người dùng và máy chủ tự tính số ngày.',
      toDate: 'Nghỉ cả ngày: ngày kết thúc YYYY-MM-DD; nghỉ một ngày thì bỏ trống.',
      fromAt:
        'Chỉ khi nghỉ nửa ngày hoặc theo giờ: thời điểm bắt đầu YYYY-MM-DDTHH:mm giờ địa phương (ví dụ nghỉ chiều từ 13:00). Có fromAt thì không gửi fromDate, toDate.',
      toAt: 'Thời điểm kết thúc YYYY-MM-DDTHH:mm, đi cùng fromAt (ví dụ nghỉ sáng đến 12:00).',
      description: DESCRIPTION,
    }),
  },
  createOtRequest: {
    key: 'hrm.ot-request.create',
    title: 'Tạo đơn làm thêm giờ',
    hints: ['đăng ký OT', 'làm thêm giờ', 'tăng ca', 'làm thêm cuối tuần'],
    permission: 'hrm.self.request',
    page: REQUESTS_PAGE,
    draft: draftOf<CreateOtRequestPayload>({
      fromAt:
        'Bắt đầu làm thêm, YYYY-MM-DDTHH:mm giờ địa phương. Bỏ trống thì form để mặc định hôm nay 17:30 đến 20:30.',
      toAt:
        'Kết thúc làm thêm, YYYY-MM-DDTHH:mm, sau fromAt và dưới 24 giờ; qua đêm thì dùng ngày hôm sau. Người dùng nói số giờ (ví dụ 3 tiếng từ 18:00) thì tự cộng ra.',
      reasonId: {
        describe:
          'Lý do làm thêm: id trong danh mục lý do làm thêm giờ của công ty (có lương hoặc không lương). Không rõ thì bỏ trống.',
        lookup: '/api/hrm/v1/request-reasons?kind=OVERTIME&active=true',
      },
      description: DESCRIPTION,
    }),
  },
  createBusinessTripRequest: {
    key: 'hrm.business-trip-request.create',
    title: 'Tạo đơn đi công tác',
    hints: ['đi công tác', 'xin đi công tác', 'công tác tỉnh', 'công tác nước ngoài'],
    permission: 'hrm.self.request',
    page: REQUESTS_PAGE,
    draft: draftOf<CreateBusinessTripRequestPayload>({
      destination: 'Nơi đến công tác: đơn vị, tỉnh thành hoặc nước. Bắt buộc.',
      businessTripType:
        'Loại công tác: DOMESTIC (trong nước, mặc định), OVERSEAS (nước ngoài), INTERSITE (nội bộ giữa các chi nhánh của công ty).',
      fromDate: 'Ngày đi YYYY-MM-DD. Giờ mặc định 08:00.',
      toDate: 'Ngày về YYYY-MM-DD; đi trong ngày thì bỏ trống. Giờ mặc định 17:30.',
      fromAt:
        'Chỉ khi người dùng nói giờ đi cụ thể: YYYY-MM-DDTHH:mm giờ địa phương. Có fromAt thì không gửi fromDate, toDate.',
      toAt: 'Giờ về YYYY-MM-DDTHH:mm, đi cùng fromAt.',
      allowOt: 'true nếu được tính làm thêm giờ trong thời gian công tác; mặc định false.',
      projectId: {
        describe:
          'Dự án liên kết khi người dùng nhắc tới dự án: id dự án đang mở mà người dùng tham gia. Không nhắc thì bỏ trống.',
        lookup: '/api/workspace/v1/projects?pageSize=60',
      },
      reasonId: {
        describe:
          'Lý do công tác: id trong danh mục lý do công tác của công ty. Không rõ thì bỏ trống.',
        lookup: '/api/hrm/v1/request-reasons?kind=BUSINESS_TRIP&active=true',
      },
      description: DESCRIPTION,
    }),
  },
  createCustomRequest: {
    key: 'hrm.custom-request.create',
    title: 'Tạo đơn theo loại đơn của công ty',
    hints: ['làm đơn', 'tạo đơn khác', 'đơn đề nghị'],
    permission: 'hrm.self.request',
    page: REQUESTS_PAGE,
    variants: {
      describe:
        'Loại đơn do công ty tự cấu hình: chỉ chọn mục có engine "GENERIC" và gửi id của mục đó. Mỗi loại có timeMode (cách nhập thời gian) và fields (các trường riêng).',
      lookup: '/api/hrm/v1/request-types',
    },
    draft: draftOf<CreateCustomRequestPayload>({
      fromAt:
        'Theo timeMode của loại đơn: RANGE_DATETIME gửi YYYY-MM-DDTHH:mm; DATE_RANGE gửi ngày bắt đầu YYYY-MM-DD; SINGLE_DATE gửi ngày YYYY-MM-DD; NONE bỏ trống.',
      toAt: 'Kết thúc, cùng định dạng với fromAt (RANGE_DATETIME, DATE_RANGE); một ngày thì bỏ trống.',
      fields:
        'Đối tượng { key: giá trị } theo fields của loại đơn: text, textarea là chuỗi; number là số; date là YYYY-MM-DD; datetime là YYYY-MM-DDTHH:mm; select là đúng một giá trị trong options; checkbox là true hoặc false.',
      reasonId: {
        describe:
          'Lý do: id của lý do có kind bằng code của loại đơn đã chọn. Loại đơn không có lý do nào thì bỏ trống.',
        lookup: '/api/hrm/v1/request-reasons?active=true',
      },
      description: DESCRIPTION,
    }),
  },
});
