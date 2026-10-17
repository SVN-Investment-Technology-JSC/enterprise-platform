import {
  type DecisionShape,
  decisionShapeErrors,
  isAssigningType,
  needsCoreAction,
  nextDecisionNumber,
  replacesPrimaryPosition,
} from './personnel-decision.js';

const base: DecisionShape = {
  decisionType: 'APPOINT',
  employeeId: 'emp-1',
  toPositionNodeId: 'pos-1',
  salaryChanged: false,
};

describe('personnel-decision: loại quyết định', () => {
  it('chỉ bổ nhiệm, thăng chức, điều chuyển, kiêm nhiệm giao chức danh mới', () => {
    expect(isAssigningType('APPOINT')).toBe(true);
    expect(isAssigningType('CONCURRENT')).toBe(true);
    expect(isAssigningType('DISMISS')).toBe(false);
    expect(isAssigningType('CHANGE_MANAGER')).toBe(false);
  });

  it('miễn nhiệm gọi Core nhưng loại đổi người quản lý cũ thì không', () => {
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

  it('miễn nhiệm không được kèm chức danh mới', () => {
    expect(
      decisionShapeErrors({ ...base, decisionType: 'DISMISS' }),
    ).toContain('Loại quyết định này không đổi chức danh.');
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

describe('personnel-decision: số quyết định', () => {
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
});
