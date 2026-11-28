import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { procedureDeskPart } from './procedure-desk';

function instance(
  id: string,
  authorization: Partial<NonNullable<ProcedureInstance['authorization']>>,
  status: ProcedureInstance['status'] = 'running',
): ProcedureInstance {
  return {
    id,
    status,
    currentStepId: 'step-3',
    steps: [
      {
        id: 'step-3',
        name: 'Kế toán kiểm tra, Kế toán trưởng duyệt',
        order: 3,
        status: 'ready',
        currentRoleStage: 'A',
        assignments: [
          { id: 'r', role: 'R', subjectType: 'position', subjectId: 'kt', subjectLabel: 'Kế toán' },
          { id: 'a', role: 'A', subjectType: 'position', subjectId: 'ktt', subjectLabel: 'Kế toán trưởng' },
        ],
      },
    ],
    authorization: {
      myRoles: [],
      currentRoleStage: 'A',
      availableActions: [],
      canManageSubtasks: false,
      isOverride: false,
      ...authorization,
    },
  } as unknown as ProcedureInstance;
}

describe('procedureDesk - danh sách "Hồ sơ cần bạn xử lý"', () => {
  it('tới lượt theo quyền thao tác; người cùng bước theo phần server tính; hồ sơ đã đóng thì không', () => {
    expect(procedureDeskPart(instance('a', { availableActions: ['comment', 'approve'] }))).toBe('act');
    expect(procedureDeskPart(instance('b', { currentStepPart: 'done' }))).toBe('done');
    expect(procedureDeskPart(instance('c', { currentStepPart: 'upcoming' }))).toBe('upcoming');
    // Chỉ được trao đổi thì không phải tới lượt.
    expect(procedureDeskPart(instance('d', { availableActions: ['comment'] }))).toBeUndefined();
    expect(procedureDeskPart(instance('e', { currentStepPart: 'done' }, 'completed'))).toBeUndefined();
  });
});
