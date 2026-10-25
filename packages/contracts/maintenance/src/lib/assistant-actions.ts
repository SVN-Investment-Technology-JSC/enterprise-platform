import { defineAssistantActions, draftOf } from '@enterprise-platform/contracts-assistant';
import type { CreateMaintenanceIncidentRequest } from './contracts-maintenance.js';

/** Thao tác Trợ lý của Bảo trì: mở đúng form "Tạo sự cố" của màn Phiếu phát sinh, điền sẵn bản nháp. */
export const MAINTENANCE_ASSISTANT_ACTIONS = defineAssistantActions('maintenance', {
  createIncident: {
    key: 'maintenance.incident.create',
    title: 'Tạo sự cố bảo trì',
    hints: ['báo hỏng thiết bị', 'ghi nhận sự cố', 'thiết bị bị lỗi', 'tạo phiếu sự cố'],
    permission: 'maintenance.occurrence.manage',
    page: '/modules/maintenance#occurrences',
    draft: draftOf<CreateMaintenanceIncidentRequest>({
      assetCode: {
        describe: 'Mã thiết bị gặp sự cố (rows[].asset.code; tên ở rows[].asset.name)',
        lookup: '/api/maintenance/v1/matrix',
        required: true,
      },
      title: { describe: 'Tiêu đề ngắn của sự cố', required: true },
      description:
        'Mô tả đầy đủ theo lời người dùng: hiện tượng, vị trí và thời điểm phát hiện. Tiêu đề chỉ là tóm tắt nên hiện tượng vẫn ghi lại ở đây. Bỏ trống nếu người dùng không nói gì ngoài tên thiết bị.',
      priority: 'Mức ưu tiên: High (Cao), Normal (Thường) hoặc Low (Thấp)',
      procedureDefinitionId: {
        describe:
          'Quy trình xử lý khi người dùng nêu quy trình, để mở phiếu ngay (procedureCatalog[].definitionId). Không nêu thì bỏ trống: phiếu chỉ ghi nhận sự cố.',
        lookup: '/api/maintenance/v1/matrix',
      },
      assigneeId: {
        describe: 'Người phụ trách (members[].userId; tên ở members[].displayName)',
        lookup: '/api/maintenance/v1/organization-context',
      },
    }),
  },
});
