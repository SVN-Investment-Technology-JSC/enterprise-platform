import type { NotificationPolicy, NotificationRecipientRule } from './notification-policy.js';

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
  if (Number.isNaN(date.getTime())) return undefined;
  // Hiển thị dd/mm/yyyy HH:mm theo giờ Việt Nam.
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    VIETNAM_TIME.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
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

const socialAuthor = (payload: Payload): string => text(payload, 'authorName', 'Một đồng nghiệp');

/** Liên kết tới bài viết Mạng nội bộ, kèm bình luận nếu có (giao diện tự cuộn tới bình luận đó). */
function socialLink(payload: Payload): string {
  const post = encodeURIComponent(id(payload, 'postId'));
  const comment = typeof payload.commentId === 'string' && payload.commentId.trim()
    ? `/comments/${encodeURIComponent(payload.commentId)}`
    : '';
  return `/modules/social/posts/${post}${comment}`;
}

/** Liên kết tới một nhóm Mạng nội bộ. */
function socialGroupLink(payload: Payload): string {
  return `/modules/social/groups/${encodeURIComponent(id(payload, 'groupId'))}`;
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
  directPolicy({
    eventType: 'procedure.instance.reversed',
    module: 'procedure',
    category: 'result',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['requesterUserId', 'recipientUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Hồ sơ đã bị huỷ hiệu lực',
      body: `Hồ sơ ${text(payload, 'instanceCode', '')} bị huỷ hiệu lực: ${text(payload, 'reason', 'không ghi lý do')}.`,
      deepLink: `/procedures/instances/${id(payload, 'instanceId')}`,
      sourceType: 'procedure_instance',
      sourceId: `${id(payload, 'instanceId')}:reversed`,
    }),
  }),
  directPolicy({
    eventType: 'procedure.instance.adjustment_requested',
    module: 'procedure',
    category: 'assignment',
    priority: 'actionable',
    // Người giữ vai S của quy trình: gán thẳng cho người hoặc cho đơn vị/chức danh
    // (worker giải ra người thật bằng sơ đồ tổ chức).
    recipients: {
      kind: 'procedure-assignments',
      userFields: ['assigneeUserIds'],
      assignmentsField: 'assignments',
    },
    // Không loại người huỷ: Quản trị viên cũng giữ vai S vẫn cần đường dẫn lập hồ sơ.
    template: ({ payload }) => ({
      title: 'Cần lập hồ sơ điều chỉnh',
      body: text(payload, 'title', 'Một hồ sơ đã bị huỷ hiệu lực và cần lập lại.'),
      deepLink: text(payload, 'launchUrl', `/modules/procedure#workspace`),
      sourceType: 'procedure_instance',
      sourceId: `${id(payload, 'instanceId')}:adjustment`,
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
    // Được nhắc tên trong chat nội bộ của core (không thuộc phân hệ nào). Nhiều lần nhắc trong cùng một cuộc trò
    // chuyện trong 15 phút gộp thành một thông báo.
    eventType: 'core.chat.mention',
    module: 'chat',
    category: 'mention',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['mentionedUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => {
      const conversation = typeof payload.conversationTitle === 'string' && payload.conversationTitle.trim()
        ? ` trong "${payload.conversationTitle.trim()}"`
        : '';
      return {
        title: `${text(payload, 'actorName', 'Một đồng nghiệp')} nhắc đến bạn${conversation}`,
        body: text(payload, 'excerpt', 'Bạn được nhắc đến trong chat nội bộ.'),
        deepLink: text(payload, 'deepLink', '/dashboard'),
        sourceType: 'core_chat_message',
        sourceId: id(payload, 'mentionId'),
      };
    },
    aggregation: {
      windowMinutes: 15,
      key: ({ payload }) => `chat:mention:${id(payload, 'conversationId')}`,
    },
  }),
  directPolicy({
    // Được nhắc tên trong trao đổi của hồ sơ quy trình. `mentionedUserIds` là id người dùng thật (giao diện
    // đã mở rộng chức danh/đơn vị thành từng người), nên nhận thẳng từ payload như Workspace.
    eventType: 'procedure.mention.created',
    module: 'procedure',
    category: 'mention',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['mentionedUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Bạn được nhắc đến trong hồ sơ quy trình',
      body: text(payload, 'excerpt', 'Bạn được nhắc đến trong một trao đổi của hồ sơ.'),
      deepLink: text(payload, 'deepLink', '/modules/procedure'),
      sourceType: text(payload, 'sourceType', 'procedure_comment'),
      sourceId: id(payload, 'mentionId'),
    }),
    aggregation: {
      windowMinutes: 15,
      key: ({ payload }) => `procedure:mention:${id(payload, 'threadId')}`,
    },
  }),
  directPolicy({
    // Được nhắc tên (@) trong bài viết hoặc bình luận. Payload cần `authorName` để nêu tên người nhắc.
    eventType: 'social.mention.created',
    module: 'social',
    category: 'mention',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['mentionedUserId'] },
    actorField: 'authorId',
    template: ({ payload }) => {
      const inComment = typeof payload.commentId === 'string' && payload.commentId.trim().length > 0;
      return {
        title: 'Bạn được nhắc đến',
        body: `${socialAuthor(payload)} đã nhắc bạn trong ${inComment ? 'một bình luận' : 'một bài viết'}.`,
        deepLink: socialLink(payload),
        sourceType: inComment ? 'social_comment' : 'social_post',
        sourceId: inComment ? id(payload, 'commentId') : id(payload, 'postId'),
      };
    },
    aggregation: {
      windowMinutes: 15,
      key: ({ payload }) => `social:mention:${typeof payload.commentId === 'string' && payload.commentId.trim() ? payload.commentId : id(payload, 'postId')}`,
    },
  }),
  directPolicy({
    // Báo tác giả bài viết và tác giả bình luận cha. Người vừa được nhắc tên trong chính bình luận này
    // (`mentionedUserIds`) đã có thông báo nhắc tên nên không báo thêm lần nữa.
    eventType: 'social.comment.created',
    module: 'social',
    category: 'comment',
    priority: 'informational',
    recipients: {
      kind: 'payload',
      fields: ['postAuthorId', 'parentAuthorId'],
      excludeFields: ['mentionedUserIds'],
    },
    actorField: 'authorId',
    template: ({ payload }) => {
      const reply = typeof payload.parentAuthorId === 'string' && payload.parentAuthorId.trim().length > 0;
      return {
        title: reply ? 'Có trả lời mới' : 'Có bình luận mới',
        body: `${socialAuthor(payload)} đã ${reply ? 'trả lời trong' : 'bình luận về'} bài viết${
          typeof payload.postTitle === 'string' && payload.postTitle.trim() ? ` "${payload.postTitle.trim()}"` : ''
        }.`,
        deepLink: socialLink(payload),
        sourceType: 'social_comment',
        sourceId: id(payload, 'commentId'),
      };
    },
    aggregation: {
      windowMinutes: 15,
      key: ({ payload }) => `social:comment:${id(payload, 'commentId')}`,
    },
  }),
  directPolicy({
    // Bài Tường công ty: báo toàn công ty khi là thông báo, nhắc @all hoặc cần xác nhận đã đọc.
    // Bài nhóm: chỉ báo `recipientUserIds` (thành viên) khi là thông báo của nhóm hoặc cần xác nhận đã đọc.
    // Bài thường không tạo thông báo.
    eventType: 'social.post.published',
    module: 'social',
    category: 'announcement',
    priority: 'actionable',
    recipients: {
      kind: 'conditional',
      select: (payload) => {
        // Bài quyền xem hẹp (phòng ban, chọn người, riêng tôi) không báo toàn công ty; người được thấy bài nhận
        // thông báo nhắc tên riêng.
        if (typeof payload.visibility === 'string' && payload.visibility !== 'company') return undefined;
        const needsConfirmation = payload.requiresReadConfirmation === true;
        if (typeof payload.groupId === 'string' && payload.groupId.trim()) {
          return payload.kind === 'announcement' || needsConfirmation
            ? { kind: 'payload', fields: ['recipientUserIds'] }
            : undefined;
        }
        return payload.kind === 'announcement' || payload.mentionsAll === true || needsConfirmation
          ? { kind: 'all-active-users' }
          : undefined;
      },
      excludeFields: ['mentionedUserIds'],
    },
    actorField: 'authorId',
    template: ({ payload }) => {
      const announcement = payload.kind === 'announcement';
      const needsConfirmation = payload.requiresReadConfirmation === true;
      const author = socialAuthor(payload);
      const groupName = typeof payload.groupName === 'string' && payload.groupName.trim() ? payload.groupName.trim() : '';
      const inGroup = groupName ? ` trong nhóm "${groupName}"` : '';
      const postTitle = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : '';
      const confirm = needsConfirmation ? ' Vui lòng xác nhận đã đọc.' : '';
      let title: string;
      let body: string;
      if (announcement) {
        title = 'Thông báo mới';
        body = `${author} đã đăng thông báo${inGroup}${postTitle ? `: ${postTitle}` : '.'}${confirm}`;
      } else if (needsConfirmation) {
        title = 'Bài viết cần xác nhận đã đọc';
        body = `${author} đã đăng bài viết${inGroup}${postTitle ? `: ${postTitle}.` : '.'}${confirm}`;
      } else {
        title = 'Bạn được nhắc trong bài viết mới';
        body = `${author} đã nhắc mọi người trong một bài viết${inGroup}.`;
      }
      return {
        title,
        body,
        deepLink: socialLink({ postId: payload.postId }),
        sourceType: 'social_post',
        sourceId: id(payload, 'postId'),
      };
    },
    aggregation: {
      windowMinutes: 15,
      key: ({ payload }) => `social:post:${id(payload, 'postId')}`,
    },
  }),
  directPolicy({
    // Báo cáo vi phạm mới. Báo cáo trong nhóm: `recipientUserIds` là admin nhóm, nhóm công khai báo thêm mọi
    // moderator; nhóm riêng tư chỉ admin nhóm. Báo cáo ngoài nhóm (Tường công ty): `recipientUserIds` rỗng,
    // báo mọi moderator.
    eventType: 'social.report.created',
    module: 'social',
    category: 'moderation',
    priority: 'actionable',
    recipients: {
      kind: 'conditional',
      select: (payload) => {
        const direct: NotificationRecipientRule = { kind: 'payload', fields: ['recipientUserIds'] };
        if (payload.groupPrivacy === 'private') return direct;
        return { kind: 'union', rules: [direct, { kind: 'permission', permission: 'social.post.moderate' }] };
      },
    },
    actorField: 'reporterId',
    template: ({ payload }) => {
      const groupId = typeof payload.groupId === 'string' && payload.groupId.trim() ? payload.groupId : undefined;
      const groupName = typeof payload.groupName === 'string' && payload.groupName.trim() ? payload.groupName.trim() : '';
      return {
        title: 'Có báo cáo vi phạm mới',
        body: `${text(payload, 'reporterName', 'Một đồng nghiệp')} đã gửi báo cáo${groupName ? ` trong nhóm "${groupName}"` : ''}.`,
        deepLink: groupId
          ? `/modules/social/groups/${encodeURIComponent(groupId)}/reports`
          : '/modules/social/pending?tab=reports',
        sourceType: 'social_report',
        sourceId: id(payload, 'reportId'),
      };
    },
  }),
  directPolicy({
    // Bài Tường công ty gửi chờ duyệt: báo người có quyền kiểm duyệt (quản trị tenant luôn được tính).
    eventType: 'social.post.pending',
    module: 'social',
    category: 'moderation',
    priority: 'actionable',
    recipients: { kind: 'permission', permission: 'social.post.moderate' },
    actorField: 'authorId',
    template: ({ payload, event }) => ({
      title: 'Có bài viết chờ duyệt',
      body: `${socialAuthor(payload)} gửi bài viết chờ duyệt${
        typeof payload.title === 'string' && payload.title.trim() ? `: ${payload.title.trim()}` : '.'
      }`,
      deepLink: '/modules/social/pending',
      sourceType: 'social_post_pending',
      // Bài bị từ chối rồi gửi lại phải báo lại; khoá chỉ theo postId sẽ bị ràng buộc duy nhất nuốt mất.
      sourceId: `${id(payload, 'postId')}:${event.id}`,
    }),
  }),
  directPolicy({
    // Kết quả duyệt báo cho tác giả. Duyệt xong bài còn phát `social.post.published` (origin `approved`).
    eventType: 'social.post.moderated',
    module: 'social',
    category: 'moderation',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['authorId'] },
    actorField: 'moderatorId',
    template: ({ payload, event }) => {
      const rejected = payload.decision === 'rejected';
      const subject =
        typeof payload.title === 'string' && payload.title.trim() ? `Bài viết "${payload.title.trim()}"` : 'Bài viết của bạn';
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
      return {
        title: rejected ? 'Bài viết bị từ chối' : 'Bài viết đã được duyệt',
        body: rejected
          ? `${subject} bị từ chối${reason ? `: ${reason}` : '.'}`
          : `${subject} đã được duyệt và hiển thị trên Tường công ty.`,
        deepLink: rejected
          ? '/modules/social/pending'
          : `/modules/social/posts/${encodeURIComponent(id(payload, 'postId'))}`,
        sourceType: 'social_post_moderated',
        sourceId: `${id(payload, 'postId')}:${event.id}`,
      };
    },
  }),
  directPolicy({
    // Được thêm vào nhóm. Yêu cầu được duyệt (`via: approved`) đã có thông báo `social.group.join.decided`
    // nên không báo lần nữa.
    eventType: 'social.group.member.added',
    module: 'social',
    category: 'group',
    priority: 'informational',
    recipients: {
      kind: 'conditional',
      select: (payload) => (payload.via === 'approved' ? undefined : { kind: 'payload', fields: ['userId'] }),
    },
    actorField: 'addedBy',
    template: ({ payload, event }) => ({
      title: 'Bạn đã được thêm vào nhóm',
      body: `${text(payload, 'addedByName', 'Một đồng nghiệp')} đã thêm bạn vào nhóm "${text(payload, 'groupName', 'Mạng nội bộ')}".`,
      deepLink: socialGroupLink(payload),
      sourceType: 'social_group_member',
      sourceId: `${id(payload, 'groupId')}:${id(payload, 'userId')}:${event.id}`,
    }),
  }),
  directPolicy({
    // Yêu cầu vào nhóm riêng tư: báo admin của nhóm (danh sách có sẵn trong payload).
    eventType: 'social.group.join.requested',
    module: 'social',
    category: 'group',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['adminUserIds'] },
    actorField: 'requesterId',
    template: ({ payload }) => ({
      title: 'Có yêu cầu tham gia nhóm',
      body: `${text(payload, 'requesterName', 'Một đồng nghiệp')} xin tham gia nhóm "${text(payload, 'groupName', 'Mạng nội bộ')}".`,
      deepLink: `${socialGroupLink(payload)}/requests`,
      sourceType: 'social_group_join_request',
      sourceId: id(payload, 'requestId'),
    }),
  }),
  directPolicy({
    // Kết quả duyệt yêu cầu vào nhóm báo cho người xin.
    eventType: 'social.group.join.decided',
    module: 'social',
    category: 'group',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['requesterId'] },
    actorField: 'decidedBy',
    template: ({ payload }) => {
      const group = text(payload, 'groupName', 'Mạng nội bộ');
      const approved = payload.decision === 'approved';
      return {
        title: approved ? 'Yêu cầu tham gia nhóm đã được duyệt' : 'Yêu cầu tham gia nhóm bị từ chối',
        body: approved
          ? `Bạn đã trở thành thành viên của nhóm "${group}".`
          : `Yêu cầu tham gia nhóm "${group}" chưa được chấp nhận.`,
        deepLink: socialGroupLink(payload),
        sourceType: 'social_group_join_decision',
        sourceId: id(payload, 'requestId'),
      };
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
  ...(
    [
      ['assigned', 'assignment', 'actionable', 'Bạn được giao việc ngoài dự án'],
      ['review-requested', 'approval', 'actionable', 'Công việc chờ bạn duyệt'],
      ['returned', 'assignment', 'actionable', 'Công việc bị trả lại'],
      ['completed', 'result', 'informational', 'Công việc đã được duyệt hoàn thành'],
      ['cancelled', 'result', 'informational', 'Công việc đã bị huỷ'],
      ['reversed', 'result', 'actionable', 'Công việc đã bị huỷ hiệu lực'],
      ['procedure-failed', 'result', 'actionable', 'Hồ sơ quy trình của công việc không thành'],
    ] as const
  ).map(([kind, category, priority, title]) =>
    directPolicy({
      eventType: `workspace.standalone-task.${kind}`,
      module: 'workspace',
      category,
      priority,
      recipients: { kind: 'payload', fields: ['recipientUserIds'] },
      actorField: 'actorUserId',
      template: ({ payload, event }) => {
        const subject = `${text(payload, 'code', '')} ${text(payload, 'title', 'Công việc')}`.trim();
        const note = typeof payload.note === 'string' && payload.note.trim() ? payload.note.trim() : '';
        return {
          title,
          // Trả lại và huỷ luôn có lý do; đưa thẳng vào thông báo để người nhận khỏi phải mở.
          body: note ? `${subject}: ${note}` : subject,
          deepLink: text(payload, 'deepLink', '/modules/workspace#tasks'),
          sourceType: 'workspace_standalone_task',
          sourceId: `${id(payload, 'taskId')}:${event.id}`,
        };
      },
    }),
  ),
  directPolicy({
    eventType: 'procedure.instance.reversal_failed',
    module: 'procedure',
    category: 'result',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    template: ({ payload }) => ({
      title: 'Không huỷ hiệu lực được hồ sơ',
      body: `Huỷ hiệu lực theo ${text(payload, 'originLabel', 'yêu cầu')} bị chặn: ${text(payload, 'reason', '').replace(/[.\s]+$/, '')}. Cần đối soát hai bên.`,
      deepLink: `/procedures/instances/${id(payload, 'instanceId')}`,
      sourceType: 'procedure_instance',
      sourceId: `${id(payload, 'instanceId')}:reversal-failed`,
    }),
  }),
  directPolicy({
    eventType: 'hrm.request.reversal_failed',
    module: 'hrm',
    category: 'result',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    template: ({ payload }) => ({
      title: 'Không huỷ hiệu lực được đơn HRM',
      body: `${text(payload, 'reason', 'Đơn không huỷ được').replace(/[.\s]+$/, '')}. Cần đối soát với module đã yêu cầu huỷ.`,
      deepLink: `/hrm/requests/${id(payload, 'requestId')}`,
      sourceType: 'hrm_request',
      sourceId: `${id(payload, 'requestId')}:reversal-failed`,
    }),
  }),
  directPolicy({
    eventType: 'hrm.request.adjustment_requested',
    module: 'hrm',
    category: 'assignment',
    priority: 'actionable',
    // Không loại người huỷ: người gửi đơn luôn cần đường dẫn lập đơn điều chỉnh.
    recipients: { kind: 'payload', fields: ['requesterUserId'] },
    template: ({ payload }) => ({
      title: 'Cần gửi đơn điều chỉnh',
      body: `${text(payload, 'title', 'Đơn của bạn đã bị huỷ hiệu lực')}. Lý do: ${text(payload, 'reason', '')}`,
      deepLink: text(payload, 'launchUrl', '/modules/hrm/requests'),
      sourceType: 'hrm_request',
      sourceId: `${id(payload, 'requestId')}:adjustment`,
    }),
  }),
  directPolicy({
    eventType: 'workspace.work_item.reversed',
    module: 'workspace',
    category: 'result',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Công việc đã bị huỷ hiệu lực',
      body: `${text(payload, 'workItemCode', '')} ${text(payload, 'title', '')}: ${text(payload, 'reason', 'không ghi lý do')}`.trim(),
      deepLink: workspaceTargetLink(payload, 'work-item', 'workItemId'),
      sourceType: 'workspace_work_item_reversed',
      sourceId: id(payload, 'workItemId'),
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
    // Quyền duyệt (hrm.request.approve) đi cùng sự kiện để người nhận được chọn đúng theo quyền.
    // Cộng thêm quản lý trực tiếp và người dự phòng được giao đơn (có thể không giữ quyền duyệt HRM), và cấp trên giữ quyền duyệt
    // thường (chỉ duyệt được đơn trong phạm vi cấp dưới nên chỉ báo khi đơn thuộc phạm vi đó).
    recipients: {
      kind: 'permissions-in-payload',
      field: 'approvalPermissions',
      userFields: ['recipientUserIds'],
      scopedPermissionsField: 'scopePermissions',
      scopedUserField: 'scopeUserIds',
    },
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
  // Trao đổi và ý kiến phê duyệt trên đơn từ HRM. Ba sự kiện cho ba nhóm người nhận (nhắc tên, chủ đơn, người duyệt);
  // mỗi bình luận là một nguồn riêng nên khoá theo commentId.
  directPolicy({
    eventType: 'hrm.request.comment.mentioned',
    module: 'hrm',
    category: 'request-comment',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['mentionedUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Bạn được nhắc đến trong một đơn từ',
      body: text(payload, 'summary', 'Bạn được nhắc đến trong trao đổi về một đơn nhân sự.'),
      deepLink: text(payload, 'deepLink', '/modules/hrm/approvals'),
      sourceType: 'hrm_request_comment_mention',
      sourceId: id(payload, 'commentId'),
    }),
  }),
  directPolicy({
    eventType: 'hrm.request.comment.to-requester',
    module: 'hrm',
    category: 'request-comment',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Có ý kiến mới về đơn của bạn',
      body: text(payload, 'summary', 'Đơn của bạn có ý kiến hoặc trao đổi mới.'),
      deepLink: text(payload, 'deepLink', '/modules/hrm/requests'),
      sourceType: 'hrm_request_comment',
      sourceId: id(payload, 'commentId'),
    }),
  }),
  directPolicy({
    eventType: 'hrm.request.created-on-behalf',
    module: 'hrm',
    category: 'request-comment',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Có đơn được tạo hộ bạn',
      body: text(payload, 'summary', 'Một đơn nhân sự đã được tạo hộ bạn.'),
      deepLink: text(payload, 'deepLink', '/modules/hrm/requests'),
      sourceType: 'hrm_request_on_behalf',
      sourceId: id(payload, 'requestId'),
    }),
  }),
  directPolicy({
    eventType: 'hrm.request.comment.to-approvers',
    module: 'hrm',
    category: 'request-comment',
    priority: 'actionable',
    recipients: {
      kind: 'permissions-in-payload',
      field: 'approvalPermissions',
      userFields: ['recipientUserIds'],
      scopedPermissionsField: 'scopePermissions',
      scopedUserField: 'scopeUserIds',
    },
    actorField: 'actorUserId',
    template: ({ payload }) => ({
      title: 'Người gửi đã phản hồi trên đơn chờ duyệt',
      body: text(payload, 'summary', 'Một đơn chờ bạn duyệt có phản hồi mới.'),
      deepLink: text(payload, 'deepLink', '/modules/hrm/approvals'),
      sourceType: 'hrm_request_comment_approver',
      sourceId: id(payload, 'commentId'),
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
  // Tài chính. Phiếu duyệt trực tiếp: báo người có quyền duyệt đúng loại phiếu (quyền đi cùng sự kiện, quản trị tenant luôn
  // được tính). Phiếu duyệt qua quy trình đã được báo bằng `procedure.assignment.created`, không phát sự kiện này.
  directPolicy({
    eventType: 'finance.approval.requested',
    module: 'finance',
    category: 'approval',
    priority: 'actionable',
    recipients: { kind: 'permissions-in-payload', field: 'approvalPermissions' },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: 'Có phiếu cần phê duyệt',
      body: text(payload, 'summary', 'Một phiếu tài chính đang chờ bạn xử lý.'),
      deepLink: text(payload, 'deepLink', '/modules/finance'),
      sourceType: 'finance_approval',
      // Phiếu bị từ chối rồi gửi lại phải báo lại; khoá chỉ theo voucherId sẽ bị ràng buộc duy nhất nuốt mất.
      sourceId: `${id(payload, 'voucherId')}:${event.id}`,
    }),
  }),
  // Kết quả xử lý phiếu (duyệt, từ chối, huỷ, đảo sổ) báo cho người lập; không báo chính người vừa thao tác.
  directPolicy({
    eventType: 'finance.voucher.status-changed',
    module: 'finance',
    category: 'voucher-status',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['requesterUserId'] },
    actorField: 'actorUserId',
    template: ({ payload, event }) => ({
      title: text(payload, 'title', 'Trạng thái phiếu đã thay đổi'),
      body: text(payload, 'summary', 'Phiếu của bạn đã được xử lý.'),
      deepLink: text(payload, 'deepLink', '/modules/finance'),
      sourceType: 'finance_voucher',
      // Mỗi lần đổi trạng thái là một thông báo riêng (duyệt rồi đảo sổ chẳng hạn).
      sourceId: `${id(payload, 'voucherId')}:${event.id}`,
    }),
  }),
  // Quy trình đã duyệt nhưng chưa ghi sổ được (thiếu số dư, kỳ đã khoá...): báo người lập và người duyệt để xử lý rồi "Áp lại".
  directPolicy({
    eventType: 'finance.voucher.needs-attention',
    module: 'finance',
    category: 'voucher-status',
    priority: 'required',
    recipients: { kind: 'payload', fields: ['recipientUserIds'] },
    template: ({ payload, event }) => ({
      title: 'Phiếu đã duyệt nhưng chưa ghi sổ được',
      body: text(payload, 'summary', 'Phiếu cần xử lý trước khi ghi sổ.'),
      deepLink: text(payload, 'deepLink', '/modules/finance'),
      sourceType: 'finance_voucher_attention',
      sourceId: `${id(payload, 'voucherId')}:${event.id}`,
    }),
  }),
  directPolicy({
    eventType: 'finance.voucher.needs-attention-approvers',
    module: 'finance',
    category: 'voucher-status',
    priority: 'required',
    recipients: { kind: 'permissions-in-payload', field: 'approvalPermissions' },
    template: ({ payload, event }) => ({
      title: 'Phiếu đã duyệt nhưng chưa ghi sổ được',
      body: text(payload, 'summary', 'Phiếu cần xử lý trước khi ghi sổ.'),
      deepLink: text(payload, 'deepLink', '/modules/finance'),
      sourceType: 'finance_voucher_attention',
      sourceId: `${id(payload, 'voucherId')}:${event.id}`,
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
  // Nhắc hoạt động Bán hàng (gọi điện, email, gặp mặt, công việc): notification-worker quét
  // `crm_schema.activities` đang mở, nhắc trước hạn theo cấu hình (mặc định 30 phút) và khi quá hạn.
  ...(['due-soon', 'overdue'] as const).map((kind) =>
    directPolicy({
      eventType: `crm.activity.${kind}`,
      module: 'crm',
      category: 'deadline',
      priority: kind === 'overdue' ? 'actionable' : 'informational',
      recipients: { kind: 'payload', fields: ['assigneeUserId'] },
      template: ({ payload }) => {
        const due = formatDue(payload.dueAt);
        const subject = text(payload, 'title', 'Hoạt động bán hàng');
        return {
          title: kind === 'overdue' ? 'Hoạt động bán hàng đã quá hạn' : 'Hoạt động bán hàng sắp đến hạn',
          body: `${subject}${due ? ` (hạn ${due})` : ''}`,
          deepLink: `/modules/crm#activities/${encodeURIComponent(id(payload, 'activityId'))}`,
          sourceType: 'crm_activity_deadline',
          // Gồm hạn để dời hạn thì là thông báo mới, không gộp vào thông báo theo hạn cũ.
          sourceId: `${id(payload, 'activityId')}:${kind}:${text(payload, 'dueAt', '')}`,
        };
      },
    }),
  ),
  // Báo giá Bán hàng: cần duyệt (báo cấp trên khi duyệt trực tiếp), kết quả duyệt (báo người gửi), hết hạn (báo người
  // phụ trách). Người nhận ghi sẵn trong payload (`recipientUserIds`).
  ...(
    [
      ['crm.quote.approval-requested', 'approval', 'actionable', 'Báo giá cần duyệt'],
      ['crm.quote.approval-decided', 'result', 'actionable', 'Kết quả duyệt báo giá'],
      ['crm.quote.expired', 'deadline', 'informational', 'Báo giá đã hết hạn'],
    ] as const
  ).map(([eventType, category, priority, title]) =>
    directPolicy({
      eventType,
      module: 'crm',
      category,
      priority,
      recipients: { kind: 'payload', fields: ['recipientUserIds'] },
      actorField: 'actorUserId',
      template: ({ payload }) => ({
        title,
        body: text(payload, 'summary', 'Báo giá có cập nhật mới.'),
        deepLink: text(payload, 'deepLink', '/modules/crm#quotes'),
        sourceType: 'crm_quote',
        sourceId: `${id(payload, 'quoteId')}:${String(payload.versionNo ?? '')}:${eventType}`,
      }),
    }),
  ),
  // Hợp đồng sắp hết hạn (nguồn lịch của notification-worker, trước N ngày theo cấu hình `contract.expiring`): báo
  // người phụ trách hợp đồng.
  directPolicy({
    eventType: 'crm.contract.expiring',
    module: 'crm',
    category: 'deadline',
    priority: 'actionable',
    recipients: { kind: 'payload', fields: ['ownerUserId'] },
    template: ({ payload }) => ({
      title: 'Hợp đồng sắp hết hạn',
      body: text(payload, 'summary', 'Hợp đồng bán hàng sắp hết hạn.'),
      deepLink: text(payload, 'deepLink', '/modules/crm#contracts'),
      sourceType: 'crm_contract',
      // Gồm ngày kết thúc để gia hạn rồi sắp hết hạn lần nữa là thông báo mới.
      sourceId: `${id(payload, 'contractId')}:expiring:${text(payload, 'endDate', '')}`,
    }),
  }),
  // Đơn bán: đợt giao trễ (job của Bán hàng), phần giữ hàng hết hạn ở Kho (đơn hoặc hợp đồng). Người nhận ghi sẵn
  // trong payload (`recipientUserIds`, người phụ trách).
  ...(
    [
      ['crm.delivery.late', 'deadline', 'Đợt giao hàng bị trễ', 'crm_delivery', 'deliveryId'],
      ['crm.order.reservation-lost', 'reservation', 'Đơn bán mất phần giữ hàng', 'crm_order', 'orderId'],
      ['crm.contract.reservation-lost', 'reservation', 'Hợp đồng mất phần giữ hàng', 'crm_contract', 'contractId'],
    ] as const
  ).map(([eventType, category, title, sourceType, idField]) =>
    directPolicy({
      eventType,
      module: 'crm',
      category,
      priority: 'actionable',
      recipients: { kind: 'payload', fields: ['recipientUserIds'] },
      actorField: 'actorUserId',
      template: ({ payload }) => ({
        title,
        body: text(payload, 'summary', 'Đơn bán có cập nhật cần xử lý.'),
        deepLink: text(payload, 'deepLink', '/modules/crm#orders'),
        sourceType,
        sourceId: `${id(payload, idField)}:${eventType}:${text(payload, eventType === 'crm.delivery.late' ? 'plannedDate' : 'reservationCode', '')}`,
      }),
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
