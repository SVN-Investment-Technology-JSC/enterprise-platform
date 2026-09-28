import {
  buildFlowIndex,
  countRemainingSteps,
  dominatorStepIds,
  evaluateConditionRule,
  findBranchOverlaps,
  hasFlowCycle,
  possibleNextStepIds,
  type ProcedureConditionRule,
  type ProcedureGatewayDefinition,
} from '@enterprise-platform/contracts-procedure-engine';

const ref = { scope: 'step' as const, stepId: 'A', code: 'x' };
const rule = (partial: Partial<ProcedureConditionRule>): ProcedureConditionRule => ({
  id: 'r',
  attribute: ref,
  operator: 'eq',
  ...partial,
});

describe('evaluateConditionRule', () => {
  const money = (value: number) => ({ type: 'money' as const, value });

  it('khoảng nửa mở: gồm cận dưới, không gồm cận trên', () => {
    const between = rule({ operator: 'between', value: 100, valueTo: 200 });
    expect(evaluateConditionRule(between, money(100))).toBe(true);
    expect(evaluateConditionRule(between, money(199))).toBe(true);
    expect(evaluateConditionRule(between, money(200))).toBe(false);
  });

  it('giá trị trống chỉ thoả "trống"', () => {
    expect(evaluateConditionRule(rule({ operator: 'lt', value: 10 }), undefined)).toBe(false);
    expect(evaluateConditionRule(rule({ operator: 'empty' }), undefined)).toBe(true);
    expect(evaluateConditionRule(rule({ operator: 'not_empty' }), money(0))).toBe(true);
  });

  it('danh sách và ngày', () => {
    const select = (value: string) => ({ type: 'select' as const, value });
    expect(evaluateConditionRule(rule({ operator: 'in', value: ['a', 'b'] }), select('b'))).toBe(true);
    expect(evaluateConditionRule(rule({ operator: 'is_not', value: 'a' }), select('a'))).toBe(false);
    const date = (value: string) => ({ type: 'date' as const, value });
    expect(evaluateConditionRule(rule({ operator: 'before', value: '2026-10-01' }), date('2026-09-30'))).toBe(true);
    expect(
      evaluateConditionRule(rule({ operator: 'date_between', value: '2026-10-01', valueTo: '2026-10-31' }), date('2026-10-31')),
    ).toBe(true);
  });
});

function gateway(branches: ProcedureGatewayDefinition['branches']): ProcedureGatewayDefinition {
  return { id: 'g', key: 'G', name: 'G', type: 'exclusive', afterStepId: 'A', branches };
}

describe('findBranchOverlaps', () => {
  it('khoảng liền kề không chồng lấn', () => {
    const result = findBranchOverlaps(
      gateway([
        { id: 'b1', key: 'B1', label: 'b1', isDefault: false, stepIds: [], condition: { combinator: 'and', rules: [rule({ operator: 'lt', value: 100 })] } },
        { id: 'b2', key: 'B2', label: 'b2', isDefault: false, stepIds: [], condition: { combinator: 'and', rules: [rule({ operator: 'between', value: 100, valueTo: 200 })] } },
      ]),
    );
    expect(result).toEqual([]);
  });

  it('phát hiện nhánh bị che hoàn toàn', () => {
    const result = findBranchOverlaps(
      gateway([
        { id: 'b1', key: 'B1', label: 'b1', isDefault: false, stepIds: [], condition: { combinator: 'and', rules: [rule({ operator: 'lt', value: 1000 })] } },
        { id: 'b2', key: 'B2', label: 'b2', isDefault: false, stepIds: [], condition: { combinator: 'and', rules: [rule({ operator: 'between', value: 100, valueTo: 200 })] } },
      ]),
    );
    expect(result).toEqual([{ branchId: 'b2', overlapsBranchId: 'b1', shadowed: true }]);
  });
});

describe('cấu trúc luồng', () => {
  const steps = [
    { id: 'A', order: 1 },
    { id: 'B1', order: 2 },
    { id: 'B2', order: 3 },
    { id: 'C', order: 4 },
    { id: 'D', order: 5 },
  ];
  const flow = buildFlowIndex(steps, [
    gateway([
      { id: 'x', key: 'X', label: 'x', isDefault: false, stepIds: ['B1'], condition: { combinator: 'and', rules: [rule({})] } },
      { id: 'y', key: 'Y', label: 'y', isDefault: false, stepIds: ['B2'], condition: { combinator: 'and', rules: [rule({})] } },
      { id: 'z', key: 'Z', label: 'z', isDefault: true, stepIds: [] },
    ]),
  ]);

  it('trục chính bỏ qua bước trong nhánh; điểm hợp là bước trục chính kế tiếp', () => {
    expect(flow.trunk).toEqual(['A', 'C', 'D']);
    expect(possibleNextStepIds(flow, 'A').sort()).toEqual(['B1', 'B2', 'C']);
    expect(possibleNextStepIds(flow, 'B1')).toEqual(['C']);
    expect(hasFlowCycle(flow)).toBe(false);
  });

  it('bước ở điểm hợp chỉ chắc chắn đã qua bước trục chính', () => {
    expect([...dominatorStepIds(flow, 'C')]).toEqual(['A']);
    expect([...dominatorStepIds(flow, 'D')].sort()).toEqual(['A', 'C']);
    expect([...dominatorStepIds(flow, 'B1')]).toEqual(['A']);
  });

  it('đếm bước còn lại: chưa quyết thì ước lượng theo trục chính', () => {
    expect(countRemainingSteps(flow, 'A', () => undefined)).toEqual({ remaining: 2, isEstimate: true });
    const chosen = flow.gateways[0]?.branches[0];
    expect(countRemainingSteps(flow, 'A', () => chosen)).toEqual({ remaining: 3, isEstimate: false });
  });
});
