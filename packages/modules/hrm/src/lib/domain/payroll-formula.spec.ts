import { evaluateFormula, evaluatePayroll } from './payroll-formula';
describe('payroll formula', () => {
  it('rejects unknown inputs and cycles in an inactive IF branch', () => {
    expect(() =>
      evaluatePayroll(
        [{ code: 'A', name: 'A', type: 'EARNING', formula: 'IF(1, 10, TYPO)' }],
        {},
      ),
    ).toThrow('chưa được cấu hình');
    expect(() =>
      evaluatePayroll(
        [
          { code: 'A', name: 'A', type: 'EARNING', formula: 'IF(1, 10, B)' },
          { code: 'B', name: 'B', type: 'EARNING', formula: 'A' },
        ],
        {},
      ),
    ).toThrow('vòng');
  });
  it('evaluates only the selected IF branch while validating all syntax', () => {
    expect(evaluateFormula('IF(0 == 0, 10, 1 / 0)', () => 0)).toBe(10);
    expect(
      evaluateFormula('IF(1 == 0, 1 / 0, IF(2 > 1, 7, 0 / 0))', () => 0),
    ).toBe(7);
    expect(() => evaluateFormula('IF(1, 2, UNKNOWN(3))', () => 0)).toThrow(
      'Hàm',
    );
    expect(() => evaluateFormula('IF(0, 2, 1 / 0)', () => 0)).toThrow(
      'chia cho 0',
    );
  });
  it('uses deterministic decimal arithmetic and precedence', () => {
    expect(evaluateFormula('ROUND((0.1 + 0.2) * 100, 2)', () => 0)).toBe(30);
    expect(evaluateFormula('ROUND(10 / 3, 2)', () => 0)).toBe(3.33);
    expect(evaluateFormula('IF(3 >= 2, MAX(100, 200), 0)', () => 0)).toBe(200);
  });
  it('resolves component dependencies independent of ordering', () => {
    const result = evaluatePayroll(
      [
        { code: 'NET', type: 'NET_PAY', name: 'Net', formula: 'SALARY - BH' },
        {
          code: 'SALARY',
          type: 'EARNING',
          name: 'Salary',
          formula: 'BASE * PAID / STANDARD',
        },
        {
          code: 'BH',
          type: 'STATUTORY_DEDUCTION',
          name: 'BH',
          formula: 'SALARY * RATE',
        },
      ],
      { BASE: 12000000, PAID: 20, STANDARD: 24, RATE: 0.1 },
    );
    expect(result.map((r) => r.amount)).toEqual([9000000, 10000000, 1000000]);
  });
  it('rejects code execution, missing inputs, cycles and division by zero', () => {
    expect(() => evaluateFormula('process.exit()', () => 0)).toThrow();
    expect(() => evaluateFormula('1 / 0', () => 0)).toThrow('chia cho 0');
    expect(() =>
      evaluatePayroll(
        [
          { code: 'A', name: 'A', type: 'EARNING', formula: 'B' },
          { code: 'B', name: 'B', type: 'EARNING', formula: 'A' },
        ],
        {},
      ),
    ).toThrow('vòng');
    expect(() =>
      evaluatePayroll(
        [{ code: 'A', name: 'A', type: 'EARNING', formula: 'MISSING' }],
        {},
      ),
    ).toThrow('chưa được cấu hình');
  });
});
