import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { DEFAULT_NOTIFICATION_POLICIES } from './notification-catalog.js';
import { NotificationPolicyRegistry, type RecipientDirectory } from './notification-policy.js';

const registry = new NotificationPolicyRegistry(DEFAULT_NOTIFICATION_POLICIES);

function event(type: string, payload: Record<string, unknown>): IntegrationEventEnvelope {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    type,
    version: 1,
    occurredAt: '2026-10-05T08:00:00.000Z',
    tenantId: '10000000-0000-4000-8000-000000000002',
    source: 'test',
    correlationId: 'correlation-1',
    payload,
  };
}

function directory(overrides: Partial<RecipientDirectory> = {}): RecipientDirectory {
  return {
    usersWithPermission: jest.fn(async () => []),
    activeUsers: jest.fn(async (ids) => ids),
    ...overrides,
  };
}

describe('maintenance notification content', () => {
  const resolve = async (type: string, payload: Record<string, unknown>) => {
    const resolved = await registry.resolve(
      event(type, { occurrenceId: 'occ-1', assigneeUserId: 'user-b', ...payload }),
      directory(),
    );
    if (!resolved) throw new Error(`No policy for ${type}`);
    return resolved;
  };

  it('names the occurrence code and title so several tickets can be told apart', async () => {
    const assigned = await resolve('maintenance.occurrence.assigned', { code: 'INC-2026-0001', title: 'Máy biến áp rung' });
    expect(assigned.template.body).toBe('Phiếu INC-2026-0001: Máy biến áp rung đã được giao cho bạn xử lý.');

    const completed = await resolve('maintenance.occurrence.completed', { code: 'INC-2026-0001', title: 'Máy biến áp rung' });
    expect(completed.template.body).toBe('Phiếu INC-2026-0001: Máy biến áp rung đã được hoàn thành.');
  });

  it('adds the due time in Vietnam time for deadline reminders', async () => {
    const overdue = await resolve('maintenance.occurrence.overdue', {
      code: 'INC-2026-0001',
      title: 'Máy biến áp rung',
      dueAt: '2026-10-05T02:30:00.000Z',
    });
    expect(overdue.template.body).toContain('đã quá hạn');
    expect(overdue.template.body).toContain('09:30');
    expect(overdue.template.body).toContain('05/10/2026');
    expect(overdue.template.body).toContain('(hạn 05/10/2026 09:30)');
  });

  it('falls back to the title alone and carries the reason of a failed dispatch', async () => {
    const failed = await resolve('maintenance.dispatch.failed', { title: 'Bảo trì định kỳ', summary: 'Procedure API lỗi 502' });
    expect(failed.template.body).toBe('Phiếu "Bảo trì định kỳ" không thể điều phối: Procedure API lỗi 502');
  });
});

describe('workspace project and document notifications', () => {
  it('notifies every project member except the actor when a project is completed', async () => {
    const resolved = await registry.resolve(
      event('workspace.project.completed', {
        projectId: 'project-1',
        name: 'Dự án A',
        recipientUserIds: ['user-a', 'user-b', 'user-c'],
        actorUserId: 'user-a',
      }),
      directory(),
    );
    expect(resolved?.recipients).toEqual(['user-b', 'user-c']);
  });

  it('gives each document version its own source so a second version can notify again', async () => {
    const first = await registry.resolve(
      event('workspace.document.published', { documentId: 'doc-1', versionId: 'v1', name: 'Bản vẽ', recipientUserIds: ['user-b'] }),
      directory(),
    );
    const second = await registry.resolve(
      event('workspace.document.published', { documentId: 'doc-1', versionId: 'v2', name: 'Bản vẽ', recipientUserIds: ['user-b'] }),
      directory(),
    );
    expect(first?.template.sourceId).not.toBe(second?.template.sourceId);
  });
});

describe('procedure assignment recipients', () => {
  it('adds users resolved from unit and position roles to the directly assigned users', async () => {
    const usersForProcedureAssignments = jest.fn(async () => ['user-head']);
    const resolved = await registry.resolve(
      event('procedure.assignment.created', {
        instanceId: 'instance-1',
        stepInstanceId: 'step-1',
        title: 'Đơn nghỉ phép · Duyệt',
        assigneeUserIds: ['user-direct'],
        assignments: [{ subjectType: 'organization_unit', subjectId: 'unit-1', role: 'A' }],
        actorUserId: 'user-actor',
      }),
      directory({ usersForProcedureAssignments }),
    );
    expect(usersForProcedureAssignments).toHaveBeenCalledWith([
      { subjectType: 'organization_unit', subjectId: 'unit-1', role: 'A' },
    ]);
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['user-direct', 'user-head']);
  });

  it('does not ask the directory when the step only has direct users', async () => {
    const usersForProcedureAssignments = jest.fn(async () => []);
    const resolved = await registry.resolve(
      event('procedure.assignment.created', {
        instanceId: 'instance-1',
        stepInstanceId: 'step-1',
        title: 'Duyệt',
        assigneeUserIds: ['user-direct'],
        assignments: [],
      }),
      directory({ usersForProcedureAssignments }),
    );
    expect(usersForProcedureAssignments).not.toHaveBeenCalled();
    expect(resolved?.recipients).toEqual(['user-direct']);
  });
});

describe('core chat mentions', () => {
  it('notifies only the mentioned people, names the sender and the group, and opens the conversation', async () => {
    const resolved = await registry.resolve(
      event('core.chat.mention', {
        mentionId: 'mention-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        mentionedUserIds: ['user-b', 'user-a'],
        actorUserId: 'user-a',
        actorName: 'Nguyễn Văn An',
        conversationTitle: 'Dự án A',
        excerpt: '@Bình xem giúp',
        deepLink: '/chat/conv-1',
      }),
      directory(),
    );
    expect(resolved?.policy.module).toBe('chat');
    expect(resolved?.recipients).toEqual(['user-b']);
    expect(resolved?.template).toMatchObject({
      title: 'Nguyễn Văn An nhắc đến bạn trong "Dự án A"',
      body: '@Bình xem giúp',
      deepLink: '/dashboard#chat/conv-1',
      sourceType: 'core_chat_message',
    });
    expect(resolved?.aggregationKey).toBe('chat:mention:conv-1');
  });
});

describe('session revocation', () => {
  it('has no notification policy: it only disconnects sockets', async () => {
    expect(DEFAULT_NOTIFICATION_POLICIES.map((policy) => policy.eventType)).not.toContain('identity.session.revoked');
    await expect(
      registry.resolve(event('identity.session.revoked', { userId: 'user-a', sessionId: 's1', reason: 'user-deleted' }), directory()),
    ).resolves.toBeUndefined();
  });
});

describe('hrm approval requests', () => {
  it('notifies everyone holding the approval permission of that request kind, except the requester', async () => {
    const usersWithPermission = jest.fn(async (permission: string) =>
      permission === 'hrm.request.approve' ? ['approver-1', 'requester'] : ['hr-manager', 'approver-1'],
    );
    const resolved = await registry.resolve(
      event('hrm.approval.requested', {
        requestId: 'request-1',
        approvalPermissions: ['hrm.request.approve', 'hrm.manage'],
        summary: 'Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.',
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission }),
    );
    expect(usersWithPermission).toHaveBeenCalledWith('hrm.request.approve');
    expect(usersWithPermission).toHaveBeenCalledWith('hrm.manage');
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['approver-1', 'hr-manager']);
    expect(resolved?.template.body).toBe('Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.');
    expect(resolved?.template.deepLink).toBe('/modules/hrm/approvals?request=request-1');
  });

  it('also notifies the assigned manager and backup who hold no approval permission, once each', async () => {
    const resolved = await registry.resolve(
      event('hrm.approval.requested', {
        requestId: 'request-1',
        approvalPermissions: ['hrm.request.approve', 'hrm.manage'],
        recipientUserIds: ['manager-1', 'backup-1', 'approver-1'],
        summary: 'Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.',
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission: jest.fn(async () => ['approver-1', 'requester']) }),
    );
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['approver-1', 'backup-1', 'manager-1']);
  });

  it('notifies a superior with the approve permission only when the request is in their scope, never a holder outside it', async () => {
    const usersWithPermission = jest.fn(async (permission: string) =>
      permission === 'hrm.request.approve'
        ? ['boss-1', 'peer-with-permission']
        : permission === 'hrm.request.approve.all'
          ? ['hr-all']
          : [],
    );
    const resolved = await registry.resolve(
      event('hrm.approval.requested', {
        requestId: 'request-1',
        approvalPermissions: ['hrm.request.approve.all', 'hrm.manage'],
        scopePermissions: ['hrm.request.approve'],
        scopeUserIds: ['boss-1', 'boss-2'],
        recipientUserIds: ['manager-1'],
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission }),
    );
    // boss-2 là cấp trên nhưng không giữ quyền duyệt; peer-with-permission giữ quyền nhưng đơn ngoài phạm vi của họ.
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['boss-1', 'hr-all', 'manager-1']);
  });

  it('also notifies the assigned approvers when the requester replies on the thread', async () => {
    const resolved = await registry.resolve(
      event('hrm.request.comment.to-approvers', {
        requestId: 'request-1',
        commentId: 'comment-1',
        approvalPermissions: ['hrm.request.approve', 'hrm.manage'],
        recipientUserIds: ['backup-1'],
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission: jest.fn(async () => []) }),
    );
    expect([...(resolved?.recipients ?? [])]).toEqual(['backup-1']);
  });

  it('also notifies the assigned manager and backup even when they hold no approval permission', async () => {
    const usersWithPermission = jest.fn(async () => ['hr-manager']);
    const resolved = await registry.resolve(
      event('hrm.approval.requested', {
        requestId: 'request-1',
        approvalPermissions: ['hrm.request.approve', 'hrm.manage'],
        recipientUserIds: ['direct-manager', 'backup', 'requester'],
        summary: 'Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.',
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission }),
    );
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['backup', 'direct-manager', 'hr-manager']);
  });

  it('notifies the assigned approvers when the requester replies in the thread', async () => {
    const resolved = await registry.resolve(
      event('hrm.request.comment.to-approvers', {
        requestId: 'request-1',
        commentId: 'comment-1',
        approvalPermissions: ['hrm.request.approve', 'hrm.manage'],
        recipientUserIds: ['backup'],
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission: jest.fn(async () => []) }),
    );
    expect(resolved?.recipients).toEqual(['backup']);
  });

  it('notifies again when the same request is resubmitted', async () => {
    const make = (eventId: string) =>
      registry.resolve(
        { ...event('hrm.approval.requested', { requestId: 'request-1', approvalPermissions: ['hrm.request.approve'] }), id: eventId },
        directory({ usersWithPermission: jest.fn(async () => ['approver-1']) }),
      );
    const first = await make('10000000-0000-4000-8000-0000000000a1');
    const second = await make('10000000-0000-4000-8000-0000000000a2');
    expect(first?.template.sourceId).not.toBe(second?.template.sourceId);
  });
});

describe('workspace work item completion', () => {
  it('tells the assigner and the assignee, but not whoever closed it', async () => {
    const resolved = await registry.resolve(
      event('workspace.work-item.completed', {
        workItemId: 'item-1',
        projectId: 'project-1',
        title: 'Lập báo cáo',
        recipientUserIds: ['creator', 'assignee'],
        actorUserId: 'assignee',
      }),
      directory(),
    );
    expect(resolved?.recipients).toEqual(['creator']);
    expect(resolved?.template.title).toBe('Công việc đã hoàn thành');
    expect(resolved?.template.body).toBe('Lập báo cáo');
  });

  it('uses a new source each time the item is closed again', async () => {
    const make = (eventId: string) =>
      registry.resolve(
        { ...event('workspace.work-item.completed', { workItemId: 'item-1', recipientUserIds: ['creator'] }), id: eventId },
        directory(),
      );
    const first = await make('10000000-0000-4000-8000-0000000000b1');
    const second = await make('10000000-0000-4000-8000-0000000000b2');
    expect(first?.template.sourceId).not.toBe(second?.template.sourceId);
  });
});

describe('hrm request status changes', () => {
  const resolve = (eventId: string, status: string) =>
    registry.resolve(
      {
        ...event('hrm.request.status-changed', { requestId: 'request-1', requesterUserId: 'requester', status }),
        id: eventId,
      },
      directory(),
    );

  it('notifies the requester on every status change, not only the first one', async () => {
    const approved = await resolve('10000000-0000-4000-8000-0000000000c1', 'APPROVED');
    const cancelled = await resolve('10000000-0000-4000-8000-0000000000c2', 'CANCELLED');
    expect(approved?.recipients).toEqual(['requester']);
    expect(cancelled?.recipients).toEqual(['requester']);
    expect(approved?.template.sourceId).not.toBe(cancelled?.template.sourceId);
  });
});

describe('finance notifications', () => {
  const approvalPermissions = ['finance.payment.approve', 'finance.manage'];

  it('báo đúng người có quyền duyệt loại phiếu (kể cả quản trị Tài chính), không báo chính người lập', async () => {
    const usersWithPermission = jest.fn(async (permission: string) =>
      permission === 'finance.payment.approve' ? ['chief-accountant', 'creator'] : ['finance-admin', 'chief-accountant'],
    );
    const resolved = await registry.resolve(
      event('finance.approval.requested', {
        voucherId: 'voucher-1',
        approvalPermissions,
        summary: 'Phiếu chi PC_1_10_2026 (750.000 đ) do An lập đang chờ bạn phê duyệt: Mua bàn ghế',
        deepLink: '/modules/finance/payments/voucher-1',
        actorUserId: 'creator',
      }),
      directory({ usersWithPermission }),
    );
    expect(usersWithPermission).toHaveBeenCalledWith('finance.payment.approve');
    expect(usersWithPermission).toHaveBeenCalledWith('finance.manage');
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['chief-accountant', 'finance-admin']);
    expect(resolved?.policy.module).toBe('finance');
    expect(resolved?.policy.priority).toBe('actionable');
    expect(resolved?.template.title).toBe('Có phiếu cần phê duyệt');
    expect(resolved?.template.deepLink).toBe('/modules/finance/payments/voucher-1');
  });

  it('phiếu bị từ chối rồi gửi lại thì báo lại (mỗi lần gửi một nguồn riêng)', async () => {
    const make = (eventId: string) =>
      registry.resolve(
        { ...event('finance.approval.requested', { voucherId: 'voucher-1', approvalPermissions }), id: eventId },
        directory({ usersWithPermission: jest.fn(async () => ['chief-accountant']) }),
      );
    const first = await make('10000000-0000-4000-8000-0000000000b1');
    const second = await make('10000000-0000-4000-8000-0000000000b2');
    expect(first?.template.sourceId).not.toBe(second?.template.sourceId);
  });

  it('kết quả xử lý báo người lập, không báo người vừa thao tác, và nêu lý do', async () => {
    const payload = {
      voucherId: 'voucher-1',
      requesterUserId: 'creator',
      title: 'Phiếu bị từ chối',
      summary: 'Phiếu chi PC_1_10_2026 (750.000 đ) bị từ chối bởi Kế toán trưởng. Ghi chú: Thiếu hoá đơn',
      deepLink: '/modules/finance/payments/voucher-1',
    };
    const toCreator = await registry.resolve(event('finance.voucher.status-changed', { ...payload, actorUserId: 'chief-accountant' }), directory());
    expect(toCreator?.recipients).toEqual(['creator']);
    expect(toCreator?.template.title).toBe('Phiếu bị từ chối');
    expect(toCreator?.template.body).toContain('Thiếu hoá đơn');

    const selfCancel = await registry.resolve(event('finance.voucher.status-changed', { ...payload, actorUserId: 'creator' }), directory());
    expect(selfCancel?.recipients).toEqual([]);
  });

  it('phiếu đã duyệt nhưng chưa ghi sổ được: báo người lập và người duyệt, mức bắt buộc', async () => {
    const summary = 'Phiếu chi PC_1_10_2026 (9.000.000 đ) đã được quy trình duyệt nhưng chưa ghi sổ được: Số dư không đủ';
    const toCreator = await registry.resolve(event('finance.voucher.needs-attention', { voucherId: 'v', recipientUserIds: ['creator'], summary }), directory());
    expect(toCreator?.recipients).toEqual(['creator']);
    expect(toCreator?.policy.priority).toBe('required');
    const usersWithPermission = jest.fn(async () => ['chief-accountant']);
    const toApprovers = await registry.resolve(
      event('finance.voucher.needs-attention-approvers', { voucherId: 'v', approvalPermissions, summary }),
      directory({ usersWithPermission }),
    );
    expect(toApprovers?.recipients).toEqual(['chief-accountant']);
    expect(toApprovers?.template.body).toContain('Số dư không đủ');
  });

  it('thông báo tài chính được đăng ký để worker nhận sự kiện từ hàng đợi', () => {
    const types = new Set(DEFAULT_NOTIFICATION_POLICIES.map((policy) => policy.eventType));
    for (const type of ['finance.approval.requested', 'finance.voucher.status-changed', 'finance.voucher.needs-attention', 'finance.voucher.needs-attention-approvers'])
      expect(types.has(type)).toBe(true);
  });
});

describe('social notifications', () => {
  const author = 'user-author';
  const everyone = ['user-author', 'user-a', 'user-b', 'user-c'];
  const dir = () => directory({ allActiveUsers: jest.fn(async () => everyone) });
  const resolve = (type: string, payload: Record<string, unknown>) =>
    registry.resolve(event(type, payload), dir());

  it('tells the mentioned user who mentioned them and links to the post or comment', async () => {
    const inPost = await resolve('social.mention.created', {
      postId: 'p1', mentionedUserId: 'user-a', authorId: author, authorName: 'Lan',
    });
    expect(inPost?.recipients).toEqual(['user-a']);
    expect(inPost?.template.body).toBe('Lan đã nhắc bạn trong một bài viết.');
    expect(inPost?.template.deepLink).toBe('/modules/social/posts/p1');
    expect(inPost?.aggregationKey).toBe('social:mention:p1');

    const inComment = await resolve('social.mention.created', {
      postId: 'p1', commentId: 'c1', mentionedUserId: 'user-a', authorId: author, authorName: 'Lan',
    });
    expect(inComment?.template.body).toBe('Lan đã nhắc bạn trong một bình luận.');
    expect(inComment?.template.deepLink).toBe('/modules/social/posts/p1/comments/c1');
    expect(inComment?.aggregationKey).toBe('social:mention:c1');
  });

  it('does not notify users about their own mention', async () => {
    const resolved = await resolve('social.mention.created', {
      postId: 'p1', mentionedUserId: author, authorId: author,
    });
    expect(resolved?.recipients).toEqual([]);
  });

  it('notifies the post author and the parent comment author, never the commenter', async () => {
    const reply = await resolve('social.comment.created', {
      postId: 'p1', commentId: 'c2', postAuthorId: 'user-a', parentAuthorId: 'user-b', authorId: 'user-b', authorName: 'Bình',
    });
    expect(reply?.recipients).toEqual(['user-a']);
    expect(reply?.aggregationKey).toBe('social:comment:c2');
    expect(reply?.template.deepLink).toBe('/modules/social/posts/p1/comments/c2');

    const own = await resolve('social.comment.created', {
      postId: 'p1', commentId: 'c3', postAuthorId: author, authorId: author,
    });
    expect(own?.recipients).toEqual([]);

    const both = await resolve('social.comment.created', {
      postId: 'p1', commentId: 'c4', postAuthorId: 'user-a', parentAuthorId: 'user-a', authorId: 'user-c',
    });
    expect(both?.recipients).toEqual(['user-a']);
  });

  it('skips users already notified by a mention of the same comment', async () => {
    const resolved = await resolve('social.comment.created', {
      postId: 'p1', commentId: 'c5', postAuthorId: 'user-a', parentAuthorId: 'user-b', authorId: 'user-c',
      mentionedUserIds: ['user-a'],
    });
    expect(resolved?.recipients).toEqual(['user-b']);
  });

  it('notifies all active users except the author for announcements and @all posts only', async () => {
    const announcement = await resolve('social.post.published', {
      postId: 'p1', authorId: author, authorName: 'Lan', title: 'Lịch nghỉ lễ', kind: 'announcement', mentionsAll: false,
    });
    expect(announcement?.recipients).toEqual(['user-a', 'user-b', 'user-c']);
    expect(announcement?.template.body).toBe('Lan đã đăng thông báo: Lịch nghỉ lễ');
    expect(announcement?.aggregationKey).toBe('social:post:p1');

    const mentionAll = await resolve('social.post.published', {
      postId: 'p2', authorId: author, kind: 'post', mentionsAll: true,
    });
    expect(mentionAll?.recipients).toHaveLength(3);

    const plain = await resolve('social.post.published', {
      postId: 'p3', authorId: author, kind: 'post', mentionsAll: false,
    });
    expect(plain?.recipients).toEqual([]);
  });

  it('does not repeat the announcement for users mentioned in the post', async () => {
    const resolved = await resolve('social.post.published', {
      postId: 'p4', authorId: author, kind: 'announcement', mentionsAll: false, mentionedUserIds: ['user-b'],
    });
    expect(resolved?.recipients).toEqual(['user-a', 'user-c']);
  });
});

describe('social P2 notifications', () => {
  const everyone = ['user-author', 'user-a', 'user-b'];
  const dir = (overrides: Partial<RecipientDirectory> = {}) =>
    directory({ allActiveUsers: jest.fn(async () => everyone), ...overrides });
  const resolve = (type: string, payload: Record<string, unknown>, overrides: Partial<RecipientDirectory> = {}) =>
    registry.resolve(event(type, payload), dir(overrides));

  it('notifies the whole company about a wall post that needs a read confirmation', async () => {
    const resolved = await resolve('social.post.published', {
      postId: 'p1', authorId: 'user-author', authorName: 'Lan', kind: 'post', mentionsAll: false,
      title: 'Nội quy mới', requiresReadConfirmation: true,
    });
    expect(resolved?.recipients).toEqual(['user-a', 'user-b']);
    expect(resolved?.template.title).toBe('Bài viết cần xác nhận đã đọc');
    expect(resolved?.template.body).toBe('Lan đã đăng bài viết: Nội quy mới. Vui lòng xác nhận đã đọc.');
  });

  it('notifies only the listed members for a group announcement and never the whole company', async () => {
    const allActiveUsers = jest.fn(async () => everyone);
    const resolved = await resolve(
      'social.post.published',
      {
        postId: 'p2', authorId: 'user-author', authorName: 'Lan', kind: 'announcement', mentionsAll: false,
        groupId: 'g1', groupName: 'Dự án A', recipientUserIds: ['user-a'],
      },
      { allActiveUsers },
    );
    expect(resolved?.recipients).toEqual(['user-a']);
    expect(resolved?.template.body).toBe('Lan đã đăng thông báo trong nhóm "Dự án A".');
    expect(allActiveUsers).not.toHaveBeenCalled();
  });

  it('does not notify for a plain group post, even with @all', async () => {
    const resolved = await resolve('social.post.published', {
      postId: 'p3', authorId: 'user-author', kind: 'post', mentionsAll: true,
      groupId: 'g1', groupName: 'Dự án A', recipientUserIds: ['user-a'],
    });
    expect(resolved?.recipients).toEqual([]);
  });

  it('notifies moderators of a pending post with a repeatable source id', async () => {
    const usersWithPermission = jest.fn(async () => ['user-a', 'user-author']);
    const resolved = await resolve(
      'social.post.pending',
      { postId: 'p4', authorId: 'user-author', authorName: 'Lan', title: 'Báo cáo quý' },
      { usersWithPermission },
    );
    expect(usersWithPermission).toHaveBeenCalledWith('social.post.moderate');
    expect(resolved?.recipients).toEqual(['user-a']);
    expect(resolved?.template.deepLink).toBe('/modules/social/pending');
    expect(resolved?.template.sourceId).toBe('p4:10000000-0000-4000-8000-000000000001');
  });

  it('tells the author a post was approved or rejected with the reason', async () => {
    const approved = await resolve('social.post.moderated', {
      postId: 'p5', authorId: 'user-a', moderatorId: 'user-b', decision: 'approved', title: 'Báo cáo quý',
    });
    expect(approved?.recipients).toEqual(['user-a']);
    expect(approved?.template.title).toBe('Bài viết đã được duyệt');
    expect(approved?.template.deepLink).toBe('/modules/social/posts/p5');

    const rejected = await resolve('social.post.moderated', {
      postId: 'p5', authorId: 'user-a', moderatorId: 'user-b', decision: 'rejected', reason: 'Thiếu số liệu',
    });
    expect(rejected?.template.title).toBe('Bài viết bị từ chối');
    expect(rejected?.template.body).toBe('Bài viết của bạn bị từ chối: Thiếu số liệu');
    expect(rejected?.template.deepLink).toBe('/modules/social/pending');
  });

  it('notifies a user added to a group but leaves approved requests to the decision notification', async () => {
    const invited = await resolve('social.group.member.added', {
      groupId: 'g1', groupName: 'Dự án A', userId: 'user-a', addedBy: 'user-b', addedByName: 'Bình', via: 'invited',
    });
    expect(invited?.recipients).toEqual(['user-a']);
    expect(invited?.template.body).toBe('Bình đã thêm bạn vào nhóm "Dự án A".');
    expect(invited?.template.deepLink).toBe('/modules/social/groups/g1');

    const approved = await resolve('social.group.member.added', {
      groupId: 'g1', groupName: 'Dự án A', userId: 'user-a', addedBy: 'user-b', addedByName: 'Bình', via: 'approved',
    });
    expect(approved?.recipients).toEqual([]);
  });

  it('notifies group admins of a join request and the requester of the decision', async () => {
    const requested = await resolve('social.group.join.requested', {
      groupId: 'g1', groupName: 'Dự án A', requestId: 'r1', requesterId: 'user-a', requesterName: 'An',
      adminUserIds: ['user-b', 'user-a'],
    });
    expect(requested?.recipients).toEqual(['user-b']);
    expect(requested?.template.deepLink).toBe('/modules/social/groups/g1/requests');

    const approved = await resolve('social.group.join.decided', {
      groupId: 'g1', groupName: 'Dự án A', requestId: 'r1', requesterId: 'user-a', decision: 'approved', decidedBy: 'user-b',
    });
    expect(approved?.recipients).toEqual(['user-a']);
    expect(approved?.template.title).toBe('Yêu cầu tham gia nhóm đã được duyệt');

    const rejected = await resolve('social.group.join.decided', {
      groupId: 'g1', groupName: 'Dự án A', requestId: 'r2', requesterId: 'user-a', decision: 'rejected', decidedBy: 'user-b',
    });
    expect(rejected?.template.title).toBe('Yêu cầu tham gia nhóm bị từ chối');
  });
});

describe('social P2 visibility and report notifications', () => {
  const resolve = (type: string, payload: Record<string, unknown>, overrides: Partial<RecipientDirectory> = {}) =>
    registry.resolve(
      event(type, payload),
      directory({ allActiveUsers: jest.fn(async () => ['user-a', 'user-b']), ...overrides }),
    );

  it('does not announce a post whose visibility is narrower than the company', async () => {
    const narrow = await resolve('social.post.published', {
      postId: 'p1', authorId: 'user-author', kind: 'announcement', mentionsAll: true, visibility: 'unit',
    });
    expect(narrow?.recipients).toEqual([]);
    const company = await resolve('social.post.published', {
      postId: 'p2', authorId: 'user-author', kind: 'announcement', mentionsAll: false, visibility: 'company',
    });
    expect(company?.recipients).toEqual(['user-a', 'user-b']);
  });

  it('sends a report of a public group to its admins and to every moderator', async () => {
    const usersWithPermission = jest.fn(async () => ['user-m', 'user-r']);
    const resolved = await resolve(
      'social.report.created',
      {
        reportId: 'r1', targetType: 'post', targetId: 'p1', reporterId: 'user-r', reporterName: 'Rin',
        groupId: 'g1', groupName: 'Dự án A', groupPrivacy: 'public', recipientUserIds: ['user-g'],
      },
      { usersWithPermission },
    );
    expect(usersWithPermission).toHaveBeenCalledWith('social.post.moderate');
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['user-g', 'user-m']);
    expect(resolved?.template.deepLink).toBe('/modules/social/groups/g1/reports');
  });

  it('keeps a report of a private group away from moderators', async () => {
    const usersWithPermission = jest.fn(async () => ['user-m']);
    const resolved = await resolve(
      'social.report.created',
      {
        reportId: 'r2', targetType: 'comment', targetId: 'c1', reporterId: 'user-r', reporterName: 'Rin',
        groupId: 'g2', groupPrivacy: 'private', recipientUserIds: ['user-g'],
      },
      { usersWithPermission },
    );
    expect(usersWithPermission).not.toHaveBeenCalled();
    expect(resolved?.recipients).toEqual(['user-g']);
  });

  it('sends a company wall report to moderators and links to the pending reports tab', async () => {
    const resolved = await resolve(
      'social.report.created',
      { reportId: 'r3', targetType: 'post', targetId: 'p3', reporterId: 'user-r', reporterName: 'Rin' },
      { usersWithPermission: jest.fn(async () => ['user-m', 'user-r']) },
    );
    expect(resolved?.recipients).toEqual(['user-m']);
    expect(resolved?.template.deepLink).toBe('/modules/social/pending?tab=reports');
  });
});
