import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import {
  deriveProcedureAuthorization,
  matchesByEscalation,
  matchesProcedureAssignment,
  resolveEscalatedUnitId,
} from './procedure-authorization.js';

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
      canDesign: false,
      isOverride: false,
      membershipId: '20000000-0000-4000-8000-000000000001',
      organizationUnitIds: [],
      positionIds: [],
    });
    expect(authorization.availableActions).toEqual(expected);
  });
});

describe('escalation lên đơn vị cha khi đơn vị không có trưởng', () => {
  // to-ky-thuat (không head) → phong-ky-thuat (không head) → khoi-van-hanh (có head)
  const units = new Map([
    ['to-ky-thuat', { parentId: 'phong-ky-thuat', hasHead: false }],
    ['phong-ky-thuat', { parentId: 'khoi-van-hanh', hasHead: false }],
    ['khoi-van-hanh', { parentId: undefined, hasHead: true }],
    ['phong-kinh-doanh', { parentId: undefined, hasHead: true }],
  ]);

  it('trả về chính nó khi đơn vị đã có trưởng', () => {
    expect(resolveEscalatedUnitId('khoi-van-hanh', units)).toBe('khoi-van-hanh');
  });

  it('nhảy qua nhiều cấp không có trưởng', () => {
    expect(resolveEscalatedUnitId('to-ky-thuat', units)).toBe('khoi-van-hanh');
  });

  it('dừng ở gốc khi không cấp nào có trưởng', () => {
    const headless = new Map([
      ['a', { parentId: 'b', hasHead: false }],
      ['b', { parentId: undefined, hasHead: false }],
    ]);
    expect(resolveEscalatedUnitId('a', headless)).toBe('b');
  });

  it('không lặp vô hạn khi cây bị vòng', () => {
    const cyclic = new Map([
      ['a', { parentId: 'b', hasHead: false }],
      ['b', { parentId: 'a', hasHead: false }],
    ]);
    expect(resolveEscalatedUnitId('a', cyclic)).toBe('b');
  });

  const actorIn = (unitIds: string[]) => ({
    tenantId: 't',
    userId: 'u',
    displayName: 'U',
    canDesign: false,
    isOverride: false,
    membershipId: 'm',
    organizationUnitIds: unitIds,
    positionIds: [],
    orgUnits: units,
  });
  const assignment = {
    id: 'a1',
    role: 'R' as const,
    subjectType: 'organization_unit' as const,
    subjectId: 'to-ky-thuat',
  };

  it('trưởng khối nhận việc của tổ không có trưởng', () => {
    expect(matchesProcedureAssignment(assignment, actorIn(['khoi-van-hanh']))).toBe(true);
    expect(matchesByEscalation(assignment, actorIn(['khoi-van-hanh']))).toBe(true);
  });

  it('người trong chính tổ đó khớp trực tiếp, không tính escalation', () => {
    expect(matchesProcedureAssignment(assignment, actorIn(['to-ky-thuat']))).toBe(true);
    expect(matchesByEscalation(assignment, actorIn(['to-ky-thuat']))).toBe(false);
  });

  it('đơn vị không liên quan vẫn không có quyền', () => {
    expect(matchesProcedureAssignment(assignment, actorIn(['phong-kinh-doanh']))).toBe(false);
  });

  it('không escalation khi thiếu bản đồ đơn vị', () => {
    const noMap = { ...actorIn(['khoi-van-hanh']), orgUnits: undefined };
    expect(matchesProcedureAssignment(assignment, noMap)).toBe(false);
  });
});
