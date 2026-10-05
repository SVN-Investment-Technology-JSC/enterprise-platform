import { dryRunPayroll } from './payroll-dry-run.js';

const sys = ['BASE_SALARY', 'PRORATED_BASE_PAY', 'ADVANCE_DUE'];
const components = [
  { code: 'SALARY', name: 'Lương', type: 'EARNING', formula: 'PRORATED_BASE_PAY' },
  { code: 'OT', name: 'OT', type: 'OVERTIME', formula: 'ROUND(BASE_SALARY / 26 / 8 * OT_HOURS, 0)' },
  { code: 'BH', name: 'BH', type: 'STATUTORY_DEDUCTION', formula: 'ROUND(SALARY * BH_RATE, 0)' },
  { code: 'ADV', name: 'Ứng', type: 'ADVANCE_DEDUCTION', formula: 'ADVANCE_DUE' },
  { code: 'NET', name: 'Thực lĩnh', type: 'NET_PAY', formula: 'SALARY + OT - BH - ADV' },
];

describe('dryRunPayroll', () => {
  it('khớp tính tay: lương 10tr, OT 3 giờ, BH 10,5%, ứng 500k', () => {
    const r = dryRunPayroll(
      components,
      { BASE_SALARY: 10_400_000, PRORATED_BASE_PAY: 10_000_000, ADVANCE_DUE: 500_000, MANUAL_EARNINGS: 0, MANUAL_DEDUCTIONS: 0 },
      { OT_HOURS: 3, BH_RATE: 0.105 },
      sys,
    );
    // OT = 10.400.000 / 26 / 8 * 3 = 150.000; BH = 1.050.000
    expect(r.items.find((i) => i.code === 'OT')?.amount).toBe(150_000);
    expect(r.items.find((i) => i.code === 'BH')?.amount).toBe(1_050_000);
    expect(r.net).toBe(10_000_000 + 150_000 - 1_050_000 - 500_000);
    expect(r.gross).toBe(10_150_000);
    expect(r.deductions).toBe(1_550_000);
    expect(r.netMismatch).toBe(0);
    expect(r.warnings).toEqual([]);
  });
  it('cảnh báo khi NET lệch và khi ứng lương không khớp lịch', () => {
    const bad = components.map((c) => (c.code === 'NET' ? { ...c, formula: 'SALARY' } : c));
    const r = dryRunPayroll(
      bad,
      { BASE_SALARY: 1, PRORATED_BASE_PAY: 100, ADVANCE_DUE: 10, MANUAL_EARNINGS: 0, MANUAL_DEDUCTIONS: 0 },
      { OT_HOURS: 0, BH_RATE: 0 },
      sys,
    );
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.netMismatch).not.toBe(0);
  });
  it('từ chối tham số trùng biến hệ thống và công thức lỗi', () => {
    expect(() => dryRunPayroll(components, {}, { BASE_SALARY: 1 }, sys)).toThrow();
    expect(() =>
      dryRunPayroll(components, { PRORATED_BASE_PAY: 1, BASE_SALARY: 1, ADVANCE_DUE: 0 }, {}, sys),
    ).toThrow();
  });
});
