import { defineAssistantActions, draftOf } from '@enterprise-platform/contracts-assistant';
import type { StartProcedureInstanceRequest } from './procedure-engine.contracts.js';

/**
 * Bản nháp mở hồ sơ mà Trợ lý được điền: các ô có trên form "Tạo đơn / yêu cầu". Quy trình đi qua `variant`
 * (`definitionId`). Hai ô gắn dự án nằm trong `workspaceLink` của request nên đặt phẳng ở đây.
 */
export type ProcedureStartAssistantDraft = Pick<
  StartProcedureInstanceRequest,
  'title' | 'startDueAt' | 'endDueAt'
> & {
  /** `workspaceLink.projectId`: dự án Workspace mà đơn trở thành một công việc mới. */
  readonly projectId?: string;
  /** `workspaceLink.workItem.description`: mô tả công việc, chỉ dùng khi gắn dự án. */
  readonly description?: string;
};

/** Thao tác Trợ lý của Quy trình: mở form tạo đơn của màn Hồ sơ xử lý, điền sẵn bản nháp. */
export const PROCEDURE_ASSISTANT_ACTIONS = defineAssistantActions('procedure-engine', {
  startInstance: {
    key: 'procedure.instance.create',
    title: 'Tạo đơn / yêu cầu theo quy trình',
    hints: ['mở hồ sơ', 'tạo đơn', 'gửi yêu cầu', 'lập phiếu theo quy trình'],
    permission: 'procedure.instance.create',
    page: '/modules/procedure#workspace',
    variants: {
      describe:
        'Quy trình áp dụng: id của quy trình người dùng khởi tạo được, khớp việc họ muốn làm theo tên, mã hay mô tả.',
      lookup: '/api/procedure/v1/definitions/startable',
    },
    draft: draftOf<ProcedureStartAssistantDraft>({
      title: {
        describe:
          'Tiêu đề hồ sơ, tối đa 255 ký tự: tự đặt ngắn gọn từ lời người dùng, gồm việc cần làm và các chi tiết họ nói (đối tác, số tiền, nơi đến, thời hạn…).',
        required: true,
      },
      startDueAt:
        'Thời gian bắt đầu dự kiến, ISO 8601 kèm múi giờ. Người dùng chưa nói thì bỏ trống.',
      endDueAt:
        'Thời gian kết thúc dự kiến (hạn hoàn thành), ISO 8601 kèm múi giờ, sau thời gian bắt đầu. Người dùng chưa nói thì bỏ trống.',
      projectId: {
        describe:
          'Dự án liên quan khi người dùng nêu dự án (items[].id); chỉ dự án người dùng tham gia. Không nêu thì bỏ trống.',
        lookup: '/api/workspace/v1/projects',
      },
      description:
        'Mô tả công việc trong dự án, chỉ dùng khi có projectId: yêu cầu, chi tiết người dùng nói, ghi gần nguyên lời họ.',
    }),
  },
});
