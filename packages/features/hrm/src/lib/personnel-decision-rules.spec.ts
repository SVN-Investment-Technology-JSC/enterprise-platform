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

import {
  NO_UNIT_LABEL,
  decisionStats,
  decisionUnitOf,
  groupDecisionsByUnit,
} from './personnel-decision-rules';

describe('nhóm quyết định theo phòng ban', () => {
  const d = (over: Record<string, unknown>) =>
    ({
      id: String(over.decisionNo),
      decisionNo: 'QD-1',
      decisionType: 'TRANSFER',
      status: 'APPLIED',
      effectiveDate: '2026-10-01',
      ...over,
    }) as never;

  it('đơn vị lấy đơn vị sau quyết định, không có thì đơn vị trước, không có nữa thì "Chưa xác định"', () => {
    expect(decisionUnitOf({ toUnitName: 'Phòng A', fromUnitName: 'Phòng B' })).toBe('Phòng A');
    expect(decisionUnitOf({ toUnitName: null, fromUnitName: 'Phòng B' })).toBe('Phòng B');
    expect(decisionUnitOf({ toUnitName: ' ', fromUnitName: undefined })).toBe(NO_UNIT_LABEL);
  });

  it('nhóm sắp theo tên tiếng Việt, "Chưa xác định" cuối cùng; quyết định mới lên trước trong nhóm', () => {
    const groups = groupDecisionsByUnit([
      d({ decisionNo: 'QD-1', toUnitName: 'Phòng Kỹ thuật', effectiveDate: '2026-01-01' }),
      d({ decisionNo: 'QD-2', toUnitName: 'Ban Tổng Giám đốc', effectiveDate: '2026-03-01', status: 'DRAFT' }),
      d({ decisionNo: 'QD-3', toUnitName: 'Phòng Kỹ thuật', effectiveDate: '2026-09-01', status: 'APPLY_PENDING' }),
      d({ decisionNo: 'QD-4', effectiveDate: '2026-02-01', status: 'REJECTED' }),
    ]);
    expect(groups.map((g) => g.unit)).toEqual(['Ban Tổng Giám đốc', 'Phòng Kỹ thuật', NO_UNIT_LABEL]);
    const tech = groups[1];
    expect(tech.rows.map((r) => r.decisionNo)).toEqual(['QD-3', 'QD-1']);
    expect(tech.open).toBe(1);
    expect(tech.applied).toBe(1);
  });

  it('số liệu tổng quan', () => {
    const stats = decisionStats([
      d({ decisionNo: 'a', status: 'DRAFT', toUnitName: 'X' }),
      d({ decisionNo: 'b', status: 'APPROVED', toUnitName: 'X' }),
      d({ decisionNo: 'c', status: 'APPLIED', toUnitName: 'Y' }),
      d({ decisionNo: 'd', status: 'REJECTED', toUnitName: 'Y' }),
      d({ decisionNo: 'e', status: 'CANCELLED', toUnitName: 'Z' }),
    ]);
    expect(stats).toEqual({ total: 5, open: 2, applied: 1, closed: 2, units: 3 });
  });
});
