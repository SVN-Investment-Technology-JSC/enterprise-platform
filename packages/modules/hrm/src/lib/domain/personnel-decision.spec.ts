import {
  type DecisionShape,
  decisionShapeErrors,
  isAssigningType,
  needsCoreAction,
  nextDecisionNumber,
  previousDay,
  replacesPrimaryPosition,
  wouldCreateCycle,
} from './personnel-decision.js';

const base: DecisionShape = {
  decisionType: 'APPOINT',
  employeeId: 'emp-1',
  toPositionNodeId: 'pos-1',
  managerMode: 'KEEP',
  subordinateMode: 'KEEP',
  salaryChanged: false,
};

describe('personnel-decision: loại quyết định', () => {
  it('chỉ bổ nhiệm, thăng chức, điều chuyển, kiêm nhiệm giao chức danh mới', () => {
    expect(isAssigningType('APPOINT')).toBe(true);
    expect(isAssigningType('CONCURRENT')).toBe(true);
    expect(isAssigningType('DISMISS')).toBe(false);
    expect(isAssigningType('CHANGE_MANAGER')).toBe(false);
  });

  it('miễn nhiệm gọi Core nhưng đổi người quản lý thì không', () => {
    expect(needsCoreAction('DISMISS')).toBe(true);
    expect(needsCoreAction('CHANGE_MANAGER')).toBe(false);
  });

  it('kiêm nhiệm không thay thế chức danh chính', () => {
    expect(replacesPrimaryPosition('TRANSFER')).toBe(true);
    expect(replacesPrimaryPosition('CONCURRENT')).toBe(false);
  });
});

describe('personnel-decision: decisionShapeErrors', () => {
  it('bổ nhiệm hợp lệ không có lỗi', () => {
    expect(decisionShapeErrors(base)).toEqual([]);
  });

  it('bổ nhiệm thiếu chức danh', () => {
    expect(
      decisionShapeErrors({ ...base, toPositionNodeId: null })[0],
    ).toMatch(/chức danh/i);
  });

  it('miễn nhiệm và đổi quản lý không được kèm chức danh mới', () => {
    expect(
      decisionShapeErrors({ ...base, decisionType: 'DISMISS' }),
    ).toContain('Loại quyết định này không đổi chức danh.');
  });

  it('đổi người quản lý phải chọn SET hoặc CLEAR và không đổi lương', () => {
    const change: DecisionShape = {
      ...base,
      decisionType: 'CHANGE_MANAGER',
      toPositionNodeId: null,
    };
    expect(decisionShapeErrors(change)[0]).toMatch(/người quản lý mới hoặc bỏ/);
    expect(
      decisionShapeErrors({ ...change, managerMode: 'CLEAR', salaryChanged: true }),
    ).toContain('Quyết định đổi người quản lý không thay đổi lương.');
  });

  it('không tự báo cáo cho chính mình', () => {
    expect(
      decisionShapeErrors({
        ...base,
        managerMode: 'SET',
        toManagerEmployeeId: 'emp-1',
      }),
    ).toContain('Nhân viên không thể là người quản lý của chính mình.');
  });

  it('SET bắt buộc có người quản lý, KEEP thì không được kèm người quản lý', () => {
    expect(decisionShapeErrors({ ...base, managerMode: 'SET' })[0]).toMatch(
      /người quản lý trực tiếp mới/,
    );
    expect(
      decisionShapeErrors({ ...base, toManagerEmployeeId: 'emp-2' })[0],
    ).toMatch(/gán người quản lý mới/);
  });

  it('chuyển cấp dưới cần người nhận khác nhân viên', () => {
    expect(
      decisionShapeErrors({ ...base, subordinateMode: 'REASSIGN' })[0],
    ).toMatch(/người nhận cấp dưới/i);
    expect(
      decisionShapeErrors({
        ...base,
        subordinateMode: 'REASSIGN',
        subordinateTargetEmployeeId: 'emp-1',
      })[0],
    ).toMatch(/khác nhân viên/);
  });

  it('thay đổi lương cần mức lương và loại lương hợp lệ', () => {
    const salary: DecisionShape = { ...base, salaryChanged: true };
    expect(decisionShapeErrors(salary)).toEqual([
      'Mức lương mới không hợp lệ.',
      'Cần chọn loại lương (GROSS hoặc NET).',
    ]);
    expect(
      decisionShapeErrors({ ...salary, toBaseSalary: 25_000_000, toSalaryType: 'GROSS' }),
    ).toEqual([]);
    expect(
      decisionShapeErrors({
        ...salary,
        toBaseSalary: -1,
        toSalaryType: 'NET',
      })[0],
    ).toBe('Mức lương mới không hợp lệ.');
  });

  it('bậc lương phải đi kèm ngạch; không nhập lương khi chưa bật thay đổi lương', () => {
    expect(
      decisionShapeErrors({
        ...base,
        salaryChanged: true,
        toBaseSalary: 1,
        toSalaryType: 'NET',
        toSalaryStepId: 'step',
      }),
    ).toContain('Chọn bậc lương thì phải chọn ngạch lương.');
    expect(decisionShapeErrors({ ...base, toBaseSalary: 5 })).toContain(
      'Cần bật "Thay đổi lương" để nhập thông tin lương mới.',
    );
  });
});

describe('personnel-decision: wouldCreateCycle', () => {
  // an -> binh -> chi -> (không ai)
  const managerOf = new Map<string, string | null>([
    ['an', 'binh'],
    ['binh', 'chi'],
    ['chi', null],
  ]);

  it('chặn tự báo cáo cho chính mình', () => {
    expect(wouldCreateCycle(managerOf, 'an', 'an')).toBe(true);
  });

  it('chặn gán cấp trên của mình làm cấp dưới (vòng gián tiếp)', () => {
    expect(wouldCreateCycle(managerOf, 'chi', 'an')).toBe(true);
    expect(wouldCreateCycle(managerOf, 'binh', 'an')).toBe(true);
  });

  it('cho phép gán sang nhánh khác', () => {
    expect(wouldCreateCycle(managerOf, 'an', 'chi')).toBe(false);
    expect(wouldCreateCycle(managerOf, 'dung', 'an')).toBe(false);
  });

  it('không treo khi dữ liệu có sẵn vòng không liên quan', () => {
    const broken = new Map<string, string | null>([
      ['x', 'y'],
      ['y', 'x'],
    ]);
    expect(wouldCreateCycle(broken, 'an', 'x')).toBe(false);
  });
});

describe('personnel-decision: số quyết định và ngày', () => {
  it('cấp số tiếp theo trong năm, bỏ qua năm khác và giá trị lạ', () => {
    expect(nextDecisionNumber(2026, [])).toBe('QDNS-2026-0001');
    expect(
      nextDecisionNumber(2026, [
        'QDNS-2026-0003',
        'QDNS-2026-0009',
        'QDNS-2025-0100',
        'QD-TAY-5',
      ]),
    ).toBe('QDNS-2026-0010');
  });

  it('previousDay lùi một ngày, qua cả ranh giới tháng và năm', () => {
    expect(previousDay('2026-10-05')).toBe('2026-10-04');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});
