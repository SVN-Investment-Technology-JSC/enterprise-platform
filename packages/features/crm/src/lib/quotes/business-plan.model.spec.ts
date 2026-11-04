import { buildPlanLines, copySourceVersion, draftTotal, planActions, planConflictMessage, planDirty, planReasons } from './business-plan.model';

const draft = (amount: string, kind: 'DISCOUNT' | 'OTHER' = 'OTHER', description = '') => ({ key: amount, kind, description, amount });
const admin = { isTenantAdmin: false, canWriteQuote: true, canApproveQuote: false };

describe('business-plan.model', () => {
  it('buildPlanLines kiểm số tiền và bỏ mô tả rỗng', () => {
    expect(buildPlanLines([draft('1.000.000', 'DISCOUNT', ' tặng ')])).toEqual({
      ok: true,
      lines: [{ kind: 'DISCOUNT', description: 'tặng', amount: 1000000 }],
    });
    expect(buildPlanLines([draft('')])).toEqual({ ok: false, message: 'Dòng 1: nhập số tiền hợp lệ.' });
    expect(buildPlanLines([draft('-5')])).toEqual({ ok: false, message: 'Dòng 1: số tiền không được âm.' });
    expect(buildPlanLines([draft('1e20')]).ok).toBe(false);
  });

  it('draftTotal bỏ dòng không hợp lệ', () => {
    expect(draftTotal([draft('100'), draft('x'), draft('50')])).toBe(150);
  });

  it('planDirty nhận ra thay đổi', () => {
    const plan = { note: null, lines: [{ id: 'a', lineNo: 1, kind: 'OTHER' as const, description: null, amount: 100 }] };
    expect(planDirty(plan, [draft('100')], '')).toBe(false);
    expect(planDirty(plan, [draft('200')], '')).toBe(true);
    expect(planDirty(plan, [draft('100')], 'ghi chú')).toBe(true);
  });

  it('planActions theo quyền, trạng thái và người trình', () => {
    expect(planActions({ status: 'DRAFT', editable: true, submittedBy: null }, admin)).toEqual(['save', 'submit']);
    expect(planActions({ status: 'APPROVED', editable: false, submittedBy: 'u1' }, admin)).toEqual([]);
    const approver = { isTenantAdmin: false, canWriteQuote: false, canApproveQuote: true };
    expect(planActions({ status: 'PENDING', editable: false, submittedBy: 'u1' }, approver, 'u2')).toEqual(['approve', 'reject']);
    expect(planActions({ status: 'PENDING', editable: false, submittedBy: 'u1' }, approver, 'u1')).toEqual([]);
  });

  it('planReasons chỉ giữ lý do PAKD', () => {
    const list = [
      { code: 'MARGIN', message: 'a' },
      { code: 'PLAN_DEVIATION', message: 'b' },
      { code: 'BUSINESS_PLAN', message: 'c' },
    ];
    expect(planReasons(list).map((r) => r.code)).toEqual(['PLAN_DEVIATION', 'BUSINESS_PLAN']);
    expect(planReasons(null)).toEqual([]);
  });

  it('copySourceVersion lấy phiên bản trước gần nhất', () => {
    expect(copySourceVersion([1, 2, 3], 3)).toBe(2);
    expect(copySourceVersion([1], 1)).toBeUndefined();
  });

  it('planConflictMessage báo tiếng Việt khi 409', () => {
    expect(planConflictMessage({ statusCode: 409, message: 'x' }, 'f')).toContain('vừa được người khác thay đổi');
    expect(planConflictMessage({ statusCode: 400, message: 'Sai' }, 'f')).toBe('Sai');
    expect(planConflictMessage({}, 'f')).toBe('f');
  });
});
