import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { deriveProcedureAuthorization } from './procedure-authorization.js';

function instance(role: 'S' | 'R' | 'E' | 'C' | 'A' | 'I'): ProcedureInstance {
  return {
    id: 'instance',
    code: 'PR-001',
    title: 'Test',
    definitionId: 'definition',
    definitionCode: 'PROC',
    definitionName: 'Procedure',
    definitionVersion: 1,
    status: 'running',
    currentStepId: 'step',
    initiatedBy: 'starter',
    startedAt: '2026-08-15T10:00:00.000Z',
    activity: [],
    steps: [
      {
        id: 'step',
        definitionStepId: 'definition-step',
        key: 'STEP',
        order: 1,
        name: 'Step',
        status: role === 'C' || role === 'A' ? 'ready' : 'active',
        currentRoleStage: role,
        assignments: [
          {
            id: 'assignment',
            role,
            subjectType: 'user',
            subjectId: 'user-1',
          },
        ],
      },
    ],
  };
}

describe('deriveProcedureAuthorization', () => {
  it.each([
    ['S', ['comment', 'complete']],
    ['R', ['comment', 'complete']],
    ['E', ['comment', 'complete']],
    ['C', ['comment', 'approve']],
    ['A', ['comment', 'approve', 'reject']],
    ['I', []],
  ] as const)('maps role %s to its runtime actions', (role, expected) => {
    const authorization = deriveProcedureAuthorization(instance(role), {
      tenantId: 'tenant',
      userId: 'user-1',
      displayName: 'User',
      isOverride: false,
      membershipId: '20000000-0000-4000-8000-000000000001',
      organizationUnitIds: [],
      positionIds: [],
    });
    expect(authorization.availableActions).toEqual(expected);
  });
});
