import { DEFAULT_QUOTE_APPROVAL_SETTINGS } from '@enterprise-platform/contracts-crm';
import {
  evaluateQuoteApproval,
  normalizeQuoteApprovalSettings,
  quoteRoleTier,
  type ApprovalPolicyLine,
} from './quote-approval-policy.js';

const line = (discountPercent: number, extra: Partial<ApprovalPolicyLine> = {}): ApprovalPolicyLine => ({
  lineNo: 1,
  materialCode: 'QA-KHO-CAP',
  materialKind: 'STOCK',
  discountPercent,
  overridden: false,
  estUnitCost: 800_000,
  ...extra,
});

const evaluate = (lines: ApprovalPolicyLine[], tier: 'staff' | 'teamLead' | 'manager' = 'staff', marginPercent: number | null = 15) =>
  evaluateQuoteApproval({
    settings: DEFAULT_QUOTE_APPROVAL_SETTINGS,
    tier,
    lines,
    totalDiscountPercent: Math.max(0, ...lines.map((entry) => entry.discountPercent)),
    marginPercent,
  });

describe('ngưỡng phê duyệt báo giá', () => {
  it('TC-PRC-24: chiết khấu bằng đúng hạn mức 5% không cần duyệt', () => {
    expect(evaluate([line(5)])).toEqual([]);
  });

  it('TC-PRC-25: 5,01% vượt hạn mức nhân viên, lý do "Chiết khấu vượt hạn mức vai trò"', () => {
    const reasons = evaluate([line(5.01)]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].code).toBe('DISCOUNT_OVER_LIMIT');
    expect(reasons[0].message).toContain('Chiết khấu vượt hạn mức vai trò');
    expect(reasons[0].message).toContain('Dòng 1 (QA-KHO-CAP)');
  });

  it('TC-PRC-26: biên 9,99% cần duyệt, 10,00% thì không', () => {
    expect(evaluate([line(3)], 'staff', 9.99).map((reason) => reason.code)).toEqual(['MARGIN_BELOW_MIN']);
    expect(evaluate([line(3)], 'staff', 10)).toEqual([]);
  });

  it('TC-PRC-27: hạn mức theo vai trò người lập (TN 15% duyệt thẳng 12%, NV thì cần duyệt)', () => {
    expect(evaluate([line(12)], 'teamLead')).toEqual([]);
    expect(evaluate([line(12)], 'staff').map((reason) => reason.code)).toEqual(['DISCOUNT_OVER_LIMIT']);
    expect(evaluate([line(60)], 'manager')).toEqual([]);
  });

  it('TC-PRC-20: ghi đè giá kích hoạt duyệt kể cả khi không vượt hạn mức', () => {
    expect(evaluate([line(3, { overridden: true })]).map((reason) => reason.code)).toEqual(['OVERRIDE']);
  });

  it('hàng tồn kho chưa có giá vốn cần duyệt; dịch vụ thì không', () => {
    expect(evaluate([line(0, { estUnitCost: null })]).map((reason) => reason.code)).toEqual(['COST_UNKNOWN']);
    expect(evaluate([line(0, { estUnitCost: null, materialKind: 'SERVICE' })])).toEqual([]);
  });

  it('bình quân cả báo giá vượt hạn mức khi không dòng nào vượt (giá ghi đè cao hơn giá gốc kéo lệch)', () => {
    const reasons = evaluateQuoteApproval({
      settings: DEFAULT_QUOTE_APPROVAL_SETTINGS,
      tier: 'staff',
      lines: [line(5)],
      totalDiscountPercent: 6,
      marginPercent: 20,
    });
    expect(reasons.map((reason) => reason.code)).toEqual(['TOTAL_DISCOUNT_OVER_LIMIT']);
  });

  it('doanh thu 0: không xác định được biên', () => {
    expect(evaluate([line(0)], 'staff', null).map((reason) => reason.code)).toEqual(['MARGIN_BELOW_MIN']);
  });

  it('vai trò người lập theo quyền', () => {
    expect(quoteRoleTier({ isTenantAdmin: false, canReadAll: false, canApproveQuote: false })).toBe('staff');
    expect(quoteRoleTier({ isTenantAdmin: false, canReadAll: false, canApproveQuote: true })).toBe('teamLead');
    expect(quoteRoleTier({ isTenantAdmin: false, canReadAll: true, canApproveQuote: true })).toBe('manager');
    expect(quoteRoleTier({ isTenantAdmin: true, canReadAll: false, canApproveQuote: false })).toBe('manager');
  });

  it('kiểm cấu hình ngưỡng', () => {
    expect(normalizeQuoteApprovalSettings({ roleLimits: { staff: '5', teamLead: 15, manager: '' }, minMarginPercent: 10 })).toEqual(
      DEFAULT_QUOTE_APPROVAL_SETTINGS,
    );
    expect(() => normalizeQuoteApprovalSettings({ roleLimits: { staff: 101 }, minMarginPercent: 10 })).toThrow(
      'Hạn mức chiết khấu của nhân viên phải là số từ 0 đến 100.',
    );
    expect(() => normalizeQuoteApprovalSettings({ roleLimits: {}, minMarginPercent: 10.123 })).toThrow('tối đa 2 chữ số thập phân');
  });
});
