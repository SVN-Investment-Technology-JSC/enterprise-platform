import { PROCEDURE_SYSTEM_ACTOR_ID, type ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import {
  deriveProcedureAuthorization,
  isProcedureParticipant,
  canStartWithAssignment,
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
      canPublish: false,
      canCreateInstances: false,
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
    canPublish: false,
    canCreateInstances: false,
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

describe('gán vai ở cấp đơn vị', () => {
  /**
   * Người được bổ nhiệm vào node CHỨC DANH, không phải node đơn vị. Nên gán một
   * vai cho đơn vị chỉ khớp được nếu phân giải xuống chức danh phụ trách của nó.
   */
  const orgUnits = new Map([
    [
      'phong-vhbt',
      {
        hasHead: true,
        category: 'unit' as const,
        headPositionIds: ['truong-vhbt'],
        memberPositionIds: ['truong-vhbt', 'nv-vhbt'],
      },
    ],
    ['truong-vhbt', { parentId: 'phong-vhbt', hasHead: true, category: 'position' as const }],
    ['nv-vhbt', { parentId: 'phong-vhbt', hasHead: false, category: 'position' as const }],
    [
      'phong-trong',
      { hasHead: false, category: 'unit' as const, headPositionIds: [], memberPositionIds: [] },
    ],
  ]);

  const actorHolding = (positionIds: string[]) => ({
    tenantId: 't',
    userId: 'u',
    displayName: 'U',
    canDesign: false,
    canPublish: false,
    canCreateInstances: false,
    isOverride: false,
    membershipId: 'm',
    organizationUnitIds: positionIds,
    positionIds: [],
    orgUnits,
  });

  const eOnUnit = {
    id: 'e1',
    role: 'E' as const,
    subjectType: 'organization_unit' as const,
    subjectId: 'phong-vhbt',
  };

  it('trưởng đơn vị nhận vai gán cho đơn vị', () => {
    expect(matchesProcedureAssignment(eOnUnit, actorHolding(['truong-vhbt']))).toBe(true);
  });

  it('khớp qua trưởng đơn vị không tính là leo trách nhiệm', () => {
    expect(matchesByEscalation(eOnUnit, actorHolding(['truong-vhbt']))).toBe(false);
  });

  it('nhân viên thường trong đơn vị không nhận vai của đơn vị', () => {
    expect(matchesProcedureAssignment(eOnUnit, actorHolding(['nv-vhbt']))).toBe(false);
  });

  it('đơn vị không có chức danh phụ trách thì không ai khớp', () => {
    const onEmpty = { ...eOnUnit, subjectId: 'phong-trong' };
    expect(matchesProcedureAssignment(onEmpty, actorHolding(['truong-vhbt']))).toBe(false);
  });

  /** Vai S trải xuống cả đơn vị: ai trong đơn vị cũng khởi tạo được hồ sơ. */
  const sOnUnit = { ...eOnUnit, id: 's1', role: 'S' as const };

  it('vai S gán cho đơn vị thì mọi thành viên đều nhận', () => {
    expect(matchesProcedureAssignment(sOnUnit, actorHolding(['truong-vhbt']))).toBe(true);
    expect(matchesProcedureAssignment(sOnUnit, actorHolding(['nv-vhbt']))).toBe(true);
  });

  it('vai khác S vẫn chỉ về trưởng đơn vị', () => {
    expect(matchesProcedureAssignment(eOnUnit, actorHolding(['nv-vhbt']))).toBe(false);
    const rOnUnit = { ...eOnUnit, id: 'r1', role: 'R' as const };
    expect(matchesProcedureAssignment(rOnUnit, actorHolding(['nv-vhbt']))).toBe(false);
    expect(matchesProcedureAssignment(rOnUnit, actorHolding(['truong-vhbt']))).toBe(true);
  });

  it('người ngoài đơn vị không nhận vai S của đơn vị', () => {
    expect(matchesProcedureAssignment(sOnUnit, actorHolding(['chuc-danh-khac']))).toBe(false);
  });
});

describe('isProcedureParticipant với vai S', () => {
  const base = (initiatedBy: string, activityActor?: string): ProcedureInstance => ({
    ...instance('S'),
    initiatedBy,
    activity: activityActor
      ? [{ id: 'a1', action: 'comment', actorId: activityActor, actorName: 'x', summary: 's', createdAt: '2026-08-15T10:00:00.000Z' }]
      : [],
  });
  const actor = (userId: string) =>
    ({
      tenantId: 't',
      userId,
      membershipId: userId,
      displayName: userId,
      canDesign: false,
      canPublish: false,
      canCreateInstances: true,
      isOverride: false,
      organizationUnitIds: [],
      positionIds: [],
    }) as const;

  it('người giữ vai S không thấy hồ sơ do người khác khởi tạo', () => {
    expect(isProcedureParticipant(base('other'), actor('user-1'))).toBe(false);
  });

  it('người khởi tạo và người đã có hoạt động thì thấy', () => {
    expect(isProcedureParticipant(base('user-1'), actor('user-1'))).toBe(true);
    expect(isProcedureParticipant(base('other', 'user-1'), actor('user-1'))).toBe(true);
  });

  it('hồ sơ do hệ thống mở thì người giữ S ở bước đã tới lượt vẫn thấy', () => {
    expect(isProcedureParticipant(base(PROCEDURE_SYSTEM_ACTOR_ID), actor('user-1'))).toBe(true);
  });

  it('vai khác S vẫn thấy hồ sơ của người khác', () => {
    const r = { ...instance('R'), initiatedBy: 'other' };
    expect(isProcedureParticipant(r, actor('user-1'))).toBe(true);
  });
});

describe('chủ thể "Toàn bộ nhân viên"', () => {
  const everyone = { id: 'a', role: 'S', subjectType: 'everyone', subjectId: 'everyone' } as const;
  const actor = {
    tenantId: 't',
    userId: 'u',
    membershipId: 'm',
    displayName: 'u',
    canDesign: false,
    canPublish: false,
    canCreateInstances: true,
    isOverride: false,
    organizationUnitIds: [],
    positionIds: [],
  } as const;

  it('cho mọi thành viên khởi tạo (vai S)', () => {
    expect(canStartWithAssignment(everyone, actor)).toBe(true);
  });

  it('không cấp quyền đọc/hành động trên hồ sơ của người khác', () => {
    expect(matchesProcedureAssignment(everyone, actor)).toBe(false);
  });

  it('vai khác S không khởi tạo được qua "Toàn bộ nhân viên"', () => {
    expect(canStartWithAssignment({ ...everyone, role: 'A' }, actor)).toBe(false);
  });
});

describe('"Toàn bộ nhân viên" ở bước S của hồ sơ', () => {
  const baseActor = (userId: string) =>
    ({
      tenantId: 't',
      userId,
      membershipId: userId,
      displayName: userId,
      canDesign: false,
      canPublish: false,
      canCreateInstances: false,
      isOverride: false,
      organizationUnitIds: [],
      positionIds: [],
    }) as const;
  const withEveryone = (initiatedBy: string): ProcedureInstance => ({
    ...instance('S'),
    initiatedBy,
    steps: [
      {
        ...instance('S').steps[0],
        assignments: [{ id: 'a', role: 'S', subjectType: 'everyone', subjectId: 'everyone' }],
      },
    ],
  });

  it('người khởi tạo hoàn thành được bước S của chính mình', () => {
    const auth = deriveProcedureAuthorization(withEveryone('user-1'), baseActor('user-1'));
    expect(auth.availableActions).toContain('complete');
  });

  it('nhân viên khác không thao tác được trên hồ sơ của người khởi tạo', () => {
    const auth = deriveProcedureAuthorization(withEveryone('user-1'), baseActor('user-2'));
    expect(auth.availableActions).not.toContain('complete');
  });
});

describe('rút đơn HRM của chính mình', () => {
  const actor = (userId: string) =>
    ({
      tenantId: 't', userId, membershipId: userId, displayName: userId,
      canDesign: false, canPublish: false, canCreateInstances: false, isOverride: false,
      organizationUnitIds: [], positionIds: [],
    }) as const;
  const hrm = (initiatedBy: string): ProcedureInstance => ({
    ...instance('A'),
    initiatedBy,
    sourceType: 'hrm_request',
  });

  it('người nộp đơn HRM huỷ được hồ sơ đang chạy của mình', () => {
    expect(deriveProcedureAuthorization(hrm('user-9'), actor('user-9')).availableActions).toContain('cancel');
  });

  it('người khác không huỷ được', () => {
    expect(deriveProcedureAuthorization(hrm('user-9'), actor('user-2')).availableActions).not.toContain('cancel');
  });

  it('hồ sơ không phải từ đơn HRM thì người khởi tạo không tự huỷ', () => {
    const plain = { ...hrm('user-9'), sourceType: undefined };
    expect(deriveProcedureAuthorization(plain, actor('user-9')).availableActions).not.toContain('cancel');
  });
});
