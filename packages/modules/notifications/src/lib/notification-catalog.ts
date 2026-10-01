import type { NotificationPolicy } from './notification-policy.js';

type Payload = Readonly<Record<string, unknown>>;

const text = (payload: Payload, key: string, fallback: string): string => {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const id = (payload: Payload, key: string): string => text(payload, key, 'unknown');

function directPolicy(input: Omit<NotificationPolicy, 'version'>): NotificationPolicy {
  return { ...input, version: 1 };
}

export const DEFAULT_NOTIFICATION_POLICIES: readonly NotificationPolicy[] = [
  directPolicy({
    eventType: 'identity.session.revoked',
    module: 'identity',
    category: 'security',
    priority: 'required',
    recipients: { kind: 'payload', fields: ['userId'] },
    template: ({ payload }) => ({
      title: 'Phiên đăng nhập đã kết thúc',
      body: text(payload, 'reason', 'Phiên đăng nhập của bạn đã bị thu hồi.'),
      deepLink: '/account/security',
      sourceType: 'identity_session',
      sourceId: id(payload, 'sessionId'),
    }),
  }),
  directPolicy({
    eventType: 'platform.entitlement.changed',
    module: 'identity',
    category: 'entitlement',
    priority: 'informational',
    recipients: { kind: 'permission', permission: 'tenant.manage' },
    template: ({ payload }) => ({
      title: 'Quyền sử dụng module đã thay đổi',
      body: `Module ${text(payload, 'moduleKey', 'hệ thống')} đã được ${payload.enabled ? 'bật' : 'tắt'}.`,
      deepLink: '/settings/modules',
      sourceType: 'tenant_entitlement',
      sourceId: id(payload, 'moduleKey'),
    }),
  }),
  directPolicy({
    eventType: 'procedure.assignment.created',
    module: 'procedure',
    category: 'assignment',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['assigneeUserId', 'assigneeUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Bạn có bước quy trình mới',
      body: text(payload, 'title', 'Một bước quy trình đang chờ bạn xử lý.'),
      deepLink: `/procedures/instances/${id(payload, 'instanceId')}`,
      sourceType: 'procedure_instance',
      sourceId: id(payload, 'instanceId'),
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
    template: ({ payload }) => ({
      title: 'Bạn có công việc mới',
      body: text(payload, 'title', 'Một công việc đã được giao cho bạn.'),
      deepLink: `/workspace/work-items/${id(payload, 'workItemId')}`,
      sourceType: 'workspace_work_item',
      sourceId: id(payload, 'workItemId'),
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
        deepLink: `/workspace/work-items/${id(payload, 'workItemId')}`,
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
      deepLink: `/workspace/calendar/${id(payload, 'eventId')}`,
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
      deepLink: `/workspace/calendar/${id(payload, 'eventId')}`,
      sourceType: 'workspace_calendar_reminder',
      sourceId: id(payload, 'eventId'),
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
        template: ({ payload }) => ({
          title: eventType.endsWith('published') ? 'Tài liệu đã được phát hành' : 'Dự án đã hoàn thành',
          body: text(payload, eventType.endsWith('published') ? 'name' : 'name', 'Có cập nhật mới trong Workspace.'),
          deepLink: eventType.endsWith('published')
            ? `/workspace/documents/${id(payload, 'documentId')}`
            : `/workspace/projects/${id(payload, 'projectId')}`,
          sourceType: eventType.endsWith('published') ? 'workspace_document' : 'workspace_project',
          sourceId: id(payload, eventType.endsWith('published') ? 'documentId' : 'projectId'),
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
    template: ({ payload }) => ({
      title: 'Trạng thái yêu cầu đã thay đổi',
      body: text(payload, 'summary', `Yêu cầu hiện ở trạng thái ${text(payload, 'status', 'mới')}.`),
      deepLink: `/hrm/requests/${id(payload, 'requestId')}`,
      sourceType: 'hrm_request',
      sourceId: id(payload, 'requestId'),
    }),
  }),
  directPolicy({
    eventType: 'hrm.approval.requested',
    module: 'hrm',
    category: 'approval',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['approverUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Có yêu cầu cần phê duyệt',
      body: text(payload, 'summary', 'Một yêu cầu nhân sự đang chờ bạn xử lý.'),
      deepLink: `/hrm/requests/${id(payload, 'requestId')}`,
      sourceType: 'hrm_approval',
      sourceId: id(payload, 'requestId'),
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
        key: ({ payload }) => `inventory:${eventType}:${id(payload, 'sourceId')}`,
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
        body: text(payload, 'summary', 'Phiếu bảo trì có cập nhật mới.'),
        deepLink: `/maintenance/occurrences/${id(payload, 'occurrenceId')}`,
        sourceType: 'maintenance_occurrence',
        sourceId: `${id(payload, 'occurrenceId')}:${eventType}`,
      }),
    }),
  ),
];
