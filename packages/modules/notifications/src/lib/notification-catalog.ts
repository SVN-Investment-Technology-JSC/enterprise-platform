import type { NotificationPolicy } from './notification-policy.js';

type Payload = Readonly<Record<string, unknown>>;

const text = (payload: Payload, key: string, fallback: string): string => {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const id = (payload: Payload, key: string): string => text(payload, key, 'unknown');

function workspaceTargetLink(payload: Payload, kind: 'work-item' | 'calendar', key: string): string {
  const query = new URLSearchParams();
  if (typeof payload.projectId === 'string') query.set('project', payload.projectId);
  if (kind === 'calendar' && typeof payload.startAt === 'string') query.set('occurrence', payload.startAt);
  return `/modules/workspace${query.size ? `?${query}` : ''}#projects/${kind}/${encodeURIComponent(id(payload, key))}`;
}

const VIETNAM_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

function formatDue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : VIETNAM_TIME.format(date);
}

/**
 * Nội dung thông báo bảo trì: luôn nêu mã và tiêu đề phiếu để người nhận phân biệt
 * được nhiều phiếu, thay vì câu chung "có cập nhật mới".
 */
function maintenanceBody(eventType: string, payload: Payload): string {
  const code = typeof payload.code === 'string' && payload.code.trim() ? payload.code.trim() : undefined;
  const title = text(payload, 'title', 'Phiếu bảo trì');
  const subject = code ? `Phiếu ${code}: ${title}` : `Phiếu "${title}"`;
  const due = formatDue(payload.dueAt);
  switch (eventType) {
    case 'maintenance.occurrence.assigned':
      return `${subject} đã được giao cho bạn xử lý.`;
    case 'maintenance.occurrence.due-soon':
      return `${subject} sắp đến hạn${due ? ` (hạn ${due})` : ''}.`;
    case 'maintenance.occurrence.overdue':
      return `${subject} đã quá hạn${due ? ` (hạn ${due})` : ''}.`;
    case 'maintenance.occurrence.completed':
      return `${subject} đã được hoàn thành.`;
    case 'maintenance.dispatch.failed': {
      const reason = text(payload, 'summary', '');
      return `${subject} không thể điều phối${reason ? `: ${reason}` : '.'}`;
    }
    default:
      return text(payload, 'summary', `${subject} có cập nhật mới.`);
  }
}

function directPolicy(input: Omit<NotificationPolicy, 'version'>): NotificationPolicy {
  return { ...input, version: 1 };
}

// `identity.session.revoked` cố ý không có chính sách ở đây: sự kiện chỉ để realtime-api ngắt
// socket của phiên bị thu hồi (đăng xuất, xoá người dùng, đặt lại mật khẩu), không tạo thông báo.
export const DEFAULT_NOTIFICATION_POLICIES: readonly NotificationPolicy[] = [
  directPolicy({
    eventType: 'platform.entitlement.changed',
    module: 'identity',
    category: 'entitlement',
    priority: 'informational',
    recipients: { kind: 'permission', permission: 'tenant.manage' },
    template: ({ payload, event }) => ({
      title: 'Quyền sử dụng module đã thay đổi',
      body: `Module ${text(payload, 'moduleKey', 'hệ thống')} đã được ${payload.enabled ? 'bật' : 'tắt'}.`,
      deepLink: '/settings/modules',
      sourceType: 'tenant_entitlement',
      sourceId: `${id(payload, 'moduleKey')}:${event.id}`,
    }),
  }),
  directPolicy({
    eventType: 'procedure.assignment.created',
    module: 'procedure',
    category: 'assignment',
    priority: 'actionable',
    // Bước thường được giao cho đơn vị/chức danh chứ không phải cá nhân: payload mang theo các vai
    // đang đến lượt (`assignments`) để worker giải ra người xử lý thật sự.
    recipients: {
      kind: 'procedure-assignments',
      userFields: ['assigneeUserId', 'assigneeUserIds'],
      assignmentsField: 'assignments',
    },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: 'Bạn có bước quy trình mới',
      body: text(payload, 'title', 'Một bước quy trình đang chờ bạn xử lý.'),
      deepLink: `/procedures/instances/${id(payload, 'instanceId')}`,
      sourceType: 'procedure_instance',
      sourceId: `${id(payload, 'instanceId')}:${id(payload, 'stepInstanceId')}:${event.id}`,
    }),
  }),
  directPolicy({
    eventType: 'procedure.instance.completed',
    module: 'procedure',
    category: 'result',
    priority: 'informational',
    recipients: { kind: 'payload', fields: ['requesterUserId', 'recipientUserIds'] },
    actorField: 'actorId',
    template: ({ payload }) => ({
      title: 'Quy trình đã kết thúc',
      body: `Hồ sơ ${text(payload, 'instanceCode', '')} có trạng thái ${text(payload, 'status', 'hoàn tất')}.`,
      deepLink: `/procedures/instances/${id(payload, 'instanceId')}`,
      sourceType: 'procedure_instance',
      sourceId: id(payload, 'instanceId'),
    }),
  }),
  ...(['warning', 'breached'] as const).map((kind) =>
    directPolicy({
      eventType: `procedure.sla.${kind}`,
      module: 'procedure',
      category: 'sla',
      priority: kind === 'breached' ? 'required' : 'actionable',
      recipients: { kind: 'payload', fields: ['assigneeUserId', 'assigneeUserIds'] },
      template: ({ payload }) => ({
        title: kind === 'breached' ? 'Quy trình đã quá hạn' : 'Quy trình sắp quá hạn',
        body: text(payload, 'title', 'Một bước quy trình cần được xử lý.'),
        deepLink: `/procedures/instances/${id(payload, 'instanceId')}`,
        sourceType: 'procedure_sla',
        sourceId: `${id(payload, 'instanceId')}:${id(payload, 'stepInstanceId')}:${kind}`,
      }),
      aggregation: {
        windowMinutes: 15,
        key: ({ payload }) => `procedure:sla:${id(payload, 'instanceId')}`,
      },
    }),
  ),
  directPolicy({
    eventType: 'workspace.work-item.assigned',
    module: 'workspace',
    category: 'assignment',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['assigneeUserId'] },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: 'Bạn có công việc mới',
      body: text(payload, 'title', 'Một công việc đã được giao cho bạn.'),
      deepLink: workspaceTargetLink(payload, 'work-item', 'workItemId'),
      sourceType: 'workspace_work_item',
      sourceId: `${id(payload, 'workItemId')}:${event.id}`,
    }),
  }),
  directPolicy({
    eventType: 'workspace.mention.created',
    module: 'workspace',
    category: 'mention',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['mentionedUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Bạn được nhắc đến',
      body: text(payload, 'excerpt', 'Bạn được nhắc đến trong một trao đổi.'),
      deepLink: text(payload, 'deepLink', '/workspace'),
      sourceType: text(payload, 'sourceType', 'workspace_mention'),
      sourceId: id(payload, 'mentionId'),
    }),
    aggregation: {
      windowMinutes: 15,
      key: ({ payload }) => `workspace:mention:${id(payload, 'threadId')}`,
    },
  }),
  directPolicy({
    eventType: 'workspace.work-item.completed',
    module: 'workspace',
    category: 'result',
    priority: 'informational',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: 'Công việc đã hoàn thành',
      body: text(payload, 'title', 'Một công việc bạn giao hoặc thực hiện đã được hoàn thành.'),
      deepLink: workspaceTargetLink(payload, 'work-item', 'workItemId'),
      sourceType: 'workspace_work_item_completed',
      // Mở lại rồi đóng lần nữa là một lần hoàn thành mới (xem changeStatus), nên khoá theo từng sự kiện.
      sourceId: `${id(payload, 'workItemId')}:${event.id}`,
    }),
  }),
  ...(['due-soon', 'overdue'] as const).map((kind) =>
    directPolicy({
      eventType: `workspace.work-item.${kind}`,
      module: 'workspace',
      category: 'deadline',
      priority: kind === 'overdue' ? 'actionable' : 'informational',
      recipients: { kind: 'payload', fields: ['assigneeUserId'] },
      template: ({ payload }) => ({
        title: kind === 'overdue' ? 'Công việc đã quá hạn' : 'Công việc sắp đến hạn',
        body: text(payload, 'title', 'Một công việc cần được xử lý.'),
        deepLink: workspaceTargetLink(payload, 'work-item', 'workItemId'),
        sourceType: 'workspace_work_item_deadline',
        sourceId: `${id(payload, 'workItemId')}:${kind}`,
      }),
    }),
  ),
  directPolicy({
    eventType: 'workspace.calendar-event.scheduled',
    module: 'workspace',
    category: 'calendar',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['participantUserIds'] },
    actorField: 'organizerUserId',
    template: ({ payload }) => ({
      title: 'Bạn có lời mời lịch mới',
      body: text(payload, 'title', 'Một sự kiện đã được thêm vào lịch.'),
      deepLink: workspaceTargetLink(payload, 'calendar', 'eventId'),
      sourceType: 'workspace_calendar_event',
      sourceId: id(payload, 'eventId'),
    }),
  }),
  directPolicy({
    eventType: 'workspace.calendar-event.reminder',
    module: 'workspace',
    category: 'calendar-reminder',
    priority: 'informational',
    recipients: { kind: 'payload', fields: ['participantUserIds'] },
    template: ({ payload }) => ({
      title: 'Sự kiện sắp bắt đầu',
      body: text(payload, 'title', 'Bạn có một sự kiện trong 15 phút tới.'),
      deepLink: workspaceTargetLink(payload, 'calendar', 'eventId'),
      sourceType: 'workspace_calendar_reminder',
      sourceId: `${id(payload, 'eventId')}:${id(payload, 'startAt')}`,
    }),
  }),
  ...(['workspace.document.published', 'workspace.project.completed'] as const).map(
    (eventType) =>
      directPolicy({
        eventType,
        module: 'workspace',
        category: eventType.endsWith('published') ? 'document' : 'project',
        priority: 'informational',
        recipients: { kind: 'payload', fields: ['recipientUserIds'] },
        actorField: 'actorUserId',
        template: ({ payload, event }) => ({
          title: eventType.endsWith('published') ? 'Tài liệu đã được phát hành' : 'Dự án đã hoàn thành',
          body: text(payload, 'name', 'Có cập nhật mới trong Workspace.'),
          deepLink: eventType.endsWith('published')
            ? `/workspace/documents/${id(payload, 'documentId')}`
            : `/workspace/projects/${id(payload, 'projectId')}`,
          sourceType: eventType.endsWith('published') ? 'workspace_document' : 'workspace_project',
          // Mỗi phiên bản tài liệu / mỗi lần hoàn thành là một nguồn riêng: khoá chỉ theo
          // documentId/projectId sẽ đụng ràng buộc duy nhất ở lần thứ hai.
          sourceId: eventType.endsWith('published')
            ? `${id(payload, 'documentId')}:${id(payload, 'versionId')}`
            : `${id(payload, 'projectId')}:${event.id}`,
        }),
      }),
  ),
  directPolicy({
    eventType: 'hrm.request.status-changed',
    module: 'hrm',
    category: 'request-status',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['requesterUserId'] },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: 'Trạng thái yêu cầu đã thay đổi',
      body: text(payload, 'summary', `Yêu cầu hiện ở trạng thái ${text(payload, 'status', 'mới')}.`),
      deepLink: `/hrm/requests/${id(payload, 'requestId')}`,
      sourceType: 'hrm_request',
      // Trigger chỉ phát khi trạng thái thật sự đổi, nên mỗi sự kiện là một thông báo riêng. Khoá chỉ theo
      // requestId sẽ bị ràng buộc duy nhất nuốt mọi lần đổi sau lần đầu (duyệt rồi huỷ chẳng hạn).
      sourceId: `${id(payload, 'requestId')}:${event.id}`,
    }),
  }),
  directPolicy({
    eventType: 'hrm.approval.requested',
    module: 'hrm',
    category: 'approval',
    priority: 'actionable',
    // Người duyệt đổi theo loại đơn (hrm.leave.approve, hrm.ot.approve…), nên quyền đi cùng sự kiện.
    recipients: { kind: 'permissions-in-payload', field: 'approvalPermissions' },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: 'Có yêu cầu cần phê duyệt',
      body: text(payload, 'summary', 'Một yêu cầu nhân sự đang chờ bạn xử lý.'),
      deepLink: `/modules/hrm/approvals?request=${encodeURIComponent(id(payload, 'requestId'))}`,
      sourceType: 'hrm_approval',
      // Đơn nộp lại (bản sửa) cũng phải báo lại; khoá chỉ theo requestId sẽ bị ràng buộc duy nhất nuốt mất.
      sourceId: `${id(payload, 'requestId')}:${event.id}`,
    }),
  }),
  directPolicy({
    eventType: 'hrm.payslip.published',
    module: 'hrm',
    category: 'payslip',
    priority: 'required',
    recipients: { kind: 'payload', fields: ['userId'] },
    template: ({ payload }) => ({
      title: 'Phiếu lương đã được phát hành',
      body: text(payload, 'periodLabel', 'Phiếu lương mới đã sẵn sàng.'),
      deepLink: `/hrm/payslips/${id(payload, 'payslipId')}`,
      sourceType: 'hrm_payslip',
      sourceId: id(payload, 'payslipId'),
    }),
  }),
  ...[
    ['inventory.stock.low', 'low-stock', 'Tồn kho dưới ngưỡng', 'inventory.manage'],
    ['inventory.stocktake.pending', 'stocktake', 'Đợt kiểm kê đang chờ xử lý', 'inventory.manage'],
    ['inventory.stocktake.variance', 'stocktake', 'Kiểm kê có chênh lệch', 'inventory.manage'],
    ['inventory.reservation.expiring', 'reservation', 'Giữ chỗ vật tư sắp hết hạn', 'inventory.transaction.write'],
  ].map(([eventType, category, title, permission]) =>
    directPolicy({
      eventType,
      module: 'inventory',
      category,
      priority: eventType.endsWith('variance') ? 'required' : 'actionable',
      recipients: { kind: 'permission', permission },
      template: ({ payload }) => ({
        title,
        body: text(payload, 'summary', 'Kho vật tư có cập nhật cần xử lý.'),
        deepLink: text(payload, 'deepLink', '/inventory'),
        sourceType: text(payload, 'sourceType', 'inventory_alert'),
        sourceId: id(payload, 'sourceId'),
      }),
      aggregation: {
        windowMinutes: 15,
        key: ({ payload }) =>
          `inventory:${eventType}:${id(
            payload,
            eventType === 'inventory.stock.low' ? 'materialId' : 'sourceId',
          )}`,
      },
    }),
  ),
  ...[
    ['maintenance.occurrence.assigned', 'assignment', 'Bạn được giao phiếu bảo trì'],
    ['maintenance.occurrence.due-soon', 'deadline', 'Phiếu bảo trì sắp đến hạn'],
    ['maintenance.occurrence.overdue', 'deadline', 'Phiếu bảo trì đã quá hạn'],
    ['maintenance.dispatch.failed', 'dispatch', 'Không thể điều phối phiếu bảo trì'],
    ['maintenance.occurrence.completed', 'result', 'Phiếu bảo trì đã hoàn thành'],
  ].map(([eventType, category, title]) =>
    directPolicy({
      eventType,
      module: 'maintenance',
      category,
      priority: eventType.endsWith('overdue') || eventType.endsWith('failed') ? 'required' : 'actionable',
      recipients: { kind: 'payload', fields: ['assigneeUserId', 'recipientUserIds'] },
      actorField: 'actorUserId',
      template: ({ payload }) => ({
        title,
        body: maintenanceBody(eventType, payload),
        deepLink: `/maintenance/occurrences/${id(payload, 'occurrenceId')}`,
        sourceType: 'maintenance_occurrence',
        sourceId: `${id(payload, 'occurrenceId')}:${eventType}`,
      }),
    }),
  ),
];
