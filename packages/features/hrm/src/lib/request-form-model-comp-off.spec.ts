import { resolveLeavePolicy, validateLeaveDurationPolicy } from './request-form-model';

describe('resolveLeavePolicy: lý do nghỉ bù mặc định', () => {
  const compOff = { id: 'c', code: 'COMP', name: 'Nghỉ bù', paid: true, unit: 'DAYS', isCompOff: true };

  it('tính ngày như phép năm (bội số 0,5) nhưng trừ quỹ nghỉ bù, không trừ phép năm', () => {
    const policy = resolveLeavePolicy(compOff);
    expect(policy).toMatchObject({
      category: 'COMPENSATORY',
      isPaid: true,
      deductAnnualBalance: false,
      stepRule: 'HALF_DAY_STEP',
      badgeLabel: 'Có tính lương • Trừ quỹ nghỉ bù',
    });
    expect(validateLeaveDurationPolicy(1.5, policy).isValid).toBe(true);
    expect(validateLeaveDurationPolicy(1.2, policy).isValid).toBe(false);
  });

  it('nhận ra theo cờ, không theo mã hay tên', () => {
    expect(resolveLeavePolicy({ ...compOff, code: 'XYZ', name: 'Nghỉ trừ quỹ' }).badgeLabel).toBe('Có tính lương • Trừ quỹ nghỉ bù');
  });
});
