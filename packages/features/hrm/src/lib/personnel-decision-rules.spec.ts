import {
  buildDecisionPayload,
  decisionRowActions,
  emptyDecisionForm,
  isPositionChanging,
  showsImpactTable,
  validateDecisionForm,
} from './personnel-decision-rules';

const base = {
  ...emptyDecisionForm('e1'),
  effectiveDate: '2026-11-01',
  reason: 'Điều động',
};

describe('personnel decision rules', () => {
  it('requires a target position only for position-changing types', () => {
    expect(isPositionChanging('DISMISS')).toBe(false);
    expect(isPositionChanging('CHANGE_MANAGER')).toBe(false);
    expect(validateDecisionForm(base, { hasAccount: true })).toContain(
      'Chọn chức danh mới.',
    );
    expect(
      validateDecisionForm(
        { ...base, decisionType: 'DISMISS' },
        { hasAccount: true },
      ),
    ).toEqual([]);
  });

  it('blocks position changes when the employee has no linked account', () => {
    const errors = validateDecisionForm(
      { ...base, toPositionNodeId: 'p1' },
      { hasAccount: false },
    );
    expect(errors.some((e) => e.includes('tài khoản'))).toBe(true);
    expect(
      validateDecisionForm(
        { ...base, decisionType: 'DISMISS' },
        { hasAccount: false },
      ),
    ).toEqual([]);
  });

  it('requires salary fields when salary changes and manager when SET', () => {
    const errors = validateDecisionForm(
      {
        ...base,
        decisionType: 'CHANGE_MANAGER',
        managerMode: 'SET',
        salaryChanged: true,
      },
      { hasAccount: true },
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'Chọn quản lý trực tiếp mới.',
        'Chọn ngạch lương.',
        'Chọn bậc lương.',
        'Nhập lương cơ bản hợp lệ.',
      ]),
    );
  });

  it('shows the impact table only when there are subordinates', () => {
    expect(showsImpactTable('TRANSFER', 2)).toBe(true);
    expect(showsImpactTable('TRANSFER', 0)).toBe(false);
    expect(showsImpactTable('CONCURRENT', 3)).toBe(false);
  });

  it('builds a payload dropping irrelevant fields', () => {
    const payload = buildDecisionPayload(
      {
        ...base,
        decisionType: 'DISMISS',
        toPositionNodeId: 'stale',
        subordinateMode: 'REASSIGN',
        subordinateTargetEmployeeId: 'e2',
      },
      { subordinateCount: 2 },
    );
    expect(payload.toPositionNodeId).toBeNull();
    expect(payload.subordinateMode).toBe('REASSIGN');
    expect(payload.subordinateTargetEmployeeId).toBe('e2');
    expect(payload.toBaseSalary).toBeNull();
  });

  it('derives row actions from status and permissions', () => {
    const all = { manage: true, approve: true };
    expect(decisionRowActions('DRAFT', all)).toMatchObject({
      edit: true,
      approve: true,
      reject: true,
      cancel: true,
      retry: false,
    });
    expect(decisionRowActions('APPLY_PENDING', all).retry).toBe(true);
    expect(
      decisionRowActions('DRAFT', { manage: false, approve: false }),
    ).toMatchObject({ edit: false, approve: false });
    expect(decisionRowActions('APPLIED', all).approve).toBe(false);
  });
});
