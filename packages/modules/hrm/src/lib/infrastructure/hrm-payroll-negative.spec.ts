import { negativePayrollMessage } from './hrm-payroll-calculation.js';

describe('negativePayrollMessage', () => {
  it('names the employee, component and advance hint', () => {
    const msg = negativePayrollMessage(
      { employee_code: 'TEST-NVC', full_name: 'Nguyen Van C' },
      'id-1',
      [{ code: 'NET', name: 'Thực lĩnh', type: 'NET_PAY', amount: -1500000 }],
      3000000,
    );
    expect(msg).toContain('Nguyen Van C (TEST-NVC)');
    expect(msg).toContain('Thực lĩnh');
    expect(msg).toContain('tạm ứng');
  });
  it('falls back to the employee id', () => {
    expect(
      negativePayrollMessage(undefined, 'id-9', [{ code: 'X', name: '', type: 'NET_PAY', amount: -1 }], 0),
    ).toContain('id-9');
  });
});
