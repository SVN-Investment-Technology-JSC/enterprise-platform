import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { procedureNotificationEvents } from './procedure-notification-events.js';

function instance(
  patch: Partial<ProcedureInstance> = {},
): ProcedureInstance {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    code: 'QT-001',
    title: 'Đề nghị mua sắm',
    definitionId: '50000000-0000-4000-8000-000000000002',
    definitionCode: 'MUA-SAM',
    definitionName: 'Mua sắm',
    definitionVersion: 1,
    status: 'running',
    currentStepId: '50000000-0000-4000-8000-000000000003',
    initiatedBy: '50000000-0000-4000-8000-000000000004',
    startedAt: '2026-10-01T08:00:00.000Z',
    steps: [
      {
        id: '50000000-0000-4000-8000-000000000003',
        definitionStepId: '50000000-0000-4000-8000-000000000005',
        key: 'approve',
        order: 1,
        name: 'Phê duyệt',
        status: 'active',
        currentRoleStage: 'A',
        assignments: [
          {
            id: '50000000-0000-4000-8000-000000000006',
            role: 'A',
            subjectType: 'user',
            subjectId: '50000000-0000-4000-8000-000000000007',
          },
        ],
        startedAt: '2026-10-01T08:00:00.000Z',
        slaHours: 2,
        slaDueAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    activity: [],
    ...patch,
  };
}

describe('procedureNotificationEvents', () => {
  it('emits an assignment carrying organization roles when the step is held by a unit or position', () => {
    const base = instance();
    const orgInstance = instance({
      steps: [
        {
          ...base.steps[0],
          currentRoleStage: 'A',
          assignments: [
            { id: 'a1', role: 'A', subjectType: 'organization_unit', subjectId: 'unit-1' },
            { id: 'a2', role: 'A', subjectType: 'position', subjectId: 'position-1' },
            { id: 'a3', role: 'R', subjectType: 'organization_unit', subjectId: 'unit-2' },
            { id: 'a4', role: 'S', subjectType: 'organization_unit', subjectId: 'unit-3' },
          ],
        },
      ],
    });

    const [event] = procedureNotificationEvents([], [orgInstance]);

    expect(event.type).toBe('procedure.assignment.created');
    expect(event.payload).toEqual(
      expect.objectContaining({
        assigneeUserIds: [],
        // Chỉ các vai đang đến lượt (A); vai R chưa tới lượt, vai S (người khởi tạo) không cần báo.
        assignments: [
          { subjectType: 'organization_unit', subjectId: 'unit-1', role: 'A' },
          { subjectType: 'position', subjectId: 'position-1', role: 'A' },
        ],
      }),
    );
  });

  it('emits an assignment when a running instance enters a new current step', () => {
    const events = procedureNotificationEvents([], [instance()]);

    expect(events).toContainEqual({
      type: 'procedure.assignment.created',
      aggregateType: 'procedure-instance',
      aggregateId: '50000000-0000-4000-8000-000000000001',
      payload: expect.objectContaining({
        instanceId: '50000000-0000-4000-8000-000000000001',
        stepInstanceId: '50000000-0000-4000-8000-000000000003',
        assigneeUserIds: ['50000000-0000-4000-8000-000000000007'],
      }),
    });
  });

  it('routes a terminal result back to the initiator', () => {
    const before = instance();
    const after = instance({
      status: 'completed',
      currentStepId: undefined,
      completedAt: '2026-10-01T09:00:00.000Z',
    });

    expect(procedureNotificationEvents([before], [after])).toContainEqual({
      type: 'procedure.instance.completed',
      aggregateType: 'procedure-instance',
      aggregateId: after.id,
      payload: expect.objectContaining({
        requesterUserId: before.initiatedBy,
        status: 'completed',
      }),
    });
  });
});
