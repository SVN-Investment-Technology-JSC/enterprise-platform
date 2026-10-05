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
      permission === 'hrm.leave.approve' ? ['approver-1', 'requester'] : ['hr-manager', 'approver-1'],
    );
    const resolved = await registry.resolve(
      event('hrm.approval.requested', {
        requestId: 'request-1',
        approvalPermissions: ['hrm.leave.approve', 'hrm.manage'],
        summary: 'Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.',
        actorUserId: 'requester',
      }),
      directory({ usersWithPermission }),
    );
    expect(usersWithPermission).toHaveBeenCalledWith('hrm.leave.approve');
    expect(usersWithPermission).toHaveBeenCalledWith('hrm.manage');
    expect([...(resolved?.recipients ?? [])].sort()).toEqual(['approver-1', 'hr-manager']);
    expect(resolved?.template.body).toBe('Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.');
    expect(resolved?.template.deepLink).toBe('/modules/hrm/approvals?request=request-1');
  });

  it('notifies again when the same request is resubmitted', async () => {
    const make = (eventId: string) =>
      registry.resolve(
        { ...event('hrm.approval.requested', { requestId: 'request-1', approvalPermissions: ['hrm.ot.approve'] }), id: eventId },
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
