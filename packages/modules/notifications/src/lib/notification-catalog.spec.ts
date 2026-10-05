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
