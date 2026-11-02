import { BUSINESS_PLAN_COST_KINDS, DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS } from '@enterprise-platform/contracts-crm';
import {
  assertPlanEditable,
  assertPlanSubmittable,
  comparePlanFigures,
  computeBusinessPlan,
  normalizeDeviationSettings,
  normalizePlanLines,
} from './business-plan.js';
import { evaluatePlanApproval } from './quote-approval-policy.js';

const basis = { grossAmount: 10_000_000, quoteDiscountAmount: 300_000, revenue: 9_700_000, goodsCost: 8_000_000 };

describe('computeBusinessPlan (TC-BP-01, TC-BP-02, TC-BP-13)', () => {
  it('lợi nhuận = doanh thu - giá vốn - chi phí; trả tỷ suất và tỷ lệ chiết khấu', () => {
    const figures = computeBusinessPlan(basis, [
      { kind: 'DISCOUNT', amount: 100_000 },
      { kind: 'PRICE_REDUCTION', amount: 50_000 },
      { kind: 'SUBCONTRACT', amount: 200_000 },
    ]);
    expect(figures).toEqual({
      grossAmount: 10_000_000,
      revenue: 9_700_000,
      goodsCost: 8_000_000,
      discountAmount: 450_000,
      extraCostTotal: 350_000,
      totalCost: 8_350_000,
      profit: 1_350_000,
      marginPercent: 13.92,
      discountPercent: 4.5,
    });
  });

  it.each(BUSINESS_PLAN_COST_KINDS)('loại %s: tính đúng một loại riêng lẻ', (kind) => {
    const figures = computeBusinessPlan(basis, [{ kind, amount: 123_000 }]);
    expect(figures.extraCostTotal).toBe(123_000);
    expect(figures.totalCost).toBe(8_123_000);
    expect(figures.profit).toBe(1_577_000);
    // Chỉ chiết khấu và giảm giá làm tăng tỷ lệ chiết khấu.
    const discounting = kind === 'DISCOUNT' || kind === 'PRICE_REDUCTION';
    expect(figures.discountAmount).toBe(discounting ? 423_000 : 300_000);
  });

  it('chi phí bằng 0: lợi nhuận bằng doanh thu trừ giá vốn', () => {
    const figures = computeBusinessPlan(basis, []);
    expect(figures).toMatchObject({ extraCostTotal: 0, totalCost: 8_000_000, profit: 1_700_000, marginPercent: 17.53, discountPercent: 3 });
    expect(computeBusinessPlan(basis, [{ kind: 'OTHER', amount: 0 }]).profit).toBe(1_700_000);
  });

  it('doanh thu 0: không xác định tỷ suất; lợi nhuận âm khi chi phí vượt doanh thu', () => {
    const figures = computeBusinessPlan({ grossAmount: 0, quoteDiscountAmount: 0, revenue: 0, goodsCost: 0 }, [{ kind: 'OTHER', amount: 5 }]);
    expect(figures).toMatchObject({ marginPercent: null, profit: -5, discountPercent: 0 });
    expect(computeBusinessPlan(basis, [{ kind: 'OTHER', amount: 2_000_000 }]).profit).toBe(-300_000);
  });

  it('làm tròn đến đồng, xa số 0, theo từng dòng', () => {
    const figures = computeBusinessPlan(basis, [
      { kind: 'OTHER', amount: 0.5 },
      { kind: 'OTHER', amount: 1000.5 },
      { kind: 'OTHER', amount: 2.4999 },
    ]);
    // 0,5 -> 1; 1000,5 -> 1001; 2,4999 -> 2 (không cộng dồn lẻ rồi mới làm tròn)
    expect(figures.extraCostTotal).toBe(1 + 1001 + 2);
  });

  it('số lớn gần giới hạn NUMERIC(18,2): chính xác, không tràn', () => {
    const lines = Array.from({ length: 50 }, () => ({ kind: 'SUBCONTRACT' as const, amount: 9_999_999_999_999 }));
    const figures = computeBusinessPlan(
      { grossAmount: 9_000_000_000_000_000, quoteDiscountAmount: 1, revenue: 9_000_000_000_000_000, goodsCost: 1 },
      lines,
    );
    expect(figures.extraCostTotal).toBe(50 * 9_999_999_999_999);
    expect(figures.profit).toBe(9_000_000_000_000_000 - 1 - 50 * 9_999_999_999_999);
    expect(Math.abs(figures.totalCost)).toBeLessThan(1e16);
  });

  it('vượt giới hạn NUMERIC(18,2): báo lỗi tiếng Việt', () => {
    expect(() =>
      computeBusinessPlan({ grossAmount: 0, quoteDiscountAmount: 0, revenue: 0, goodsCost: 9_900_000_000_000_000 }, Array.from({ length: 50 }, () => ({ kind: 'OTHER' as const, amount: 1e13 }))),
    ).toThrow(expect.objectContaining({ code: 'AMOUNT_OVERFLOW' }));
  });
});

describe('normalizePlanLines', () => {
  it('chuẩn hoá loại, diễn giải, số tiền (làm tròn xa số 0)', () => {
    expect(normalizePlanLines([{ kind: 'SUBCONTRACT', description: '  Thầu phụ A ', amount: 1500.5 }])).toEqual([
      { kind: 'SUBCONTRACT', description: 'Thầu phụ A', amount: 1501 },
    ]);
    expect(normalizePlanLines(undefined)).toEqual([]);
  });

  it('từ chối loại sai, số tiền âm, vượt trần, quá 50 dòng', () => {
    expect(() => normalizePlanLines([{ kind: 'COMMISSION', amount: 1 }])).toThrow(expect.objectContaining({ code: 'INVALID_KIND' }));
    expect(() => normalizePlanLines([{ kind: 'OTHER', amount: -1 }])).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    expect(() => normalizePlanLines([{ kind: 'OTHER', amount: 1e13 + 1 }])).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    expect(() => normalizePlanLines([{ kind: 'OTHER', amount: 'x' }])).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    expect(() => normalizePlanLines(Array.from({ length: 51 }, () => ({ kind: 'OTHER', amount: 1 })))).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_LINES' }),
    );
    expect(() => normalizePlanLines('abc')).toThrow(expect.objectContaining({ code: 'INVALID_LINES' }));
  });
});

describe('comparePlanFigures: biên ngưỡng (TC-BP-06, TC-BP-07, TC-BP-08)', () => {
  const baseline = { profit: 1_000_000, discountPercent: 4 };

  it('theo lợi nhuận: đúng bằng ngưỡng 5% thì không vượt, hơn một đồng thì vượt', () => {
    expect(comparePlanFigures('PROFIT', baseline, { profit: 950_000, discountPercent: 4 }, 5)).toEqual({ deviationPercent: 5, exceeded: false });
    expect(comparePlanFigures('PROFIT', baseline, { profit: 949_999, discountPercent: 4 }, 5).exceeded).toBe(true);
    // Lệch 3% trong ngưỡng, 8% vượt.
    expect(comparePlanFigures('PROFIT', baseline, { profit: 970_000, discountPercent: 4 }, 5).exceeded).toBe(false);
    expect(comparePlanFigures('PROFIT', baseline, { profit: 920_000, discountPercent: 4 }, 5)).toEqual({ deviationPercent: 8, exceeded: true });
  });

  it('theo lợi nhuận: ngưỡng 10% đổi hiệu lực (lệch 8% không còn vượt); lợi nhuận tăng không tính', () => {
    expect(comparePlanFigures('PROFIT', baseline, { profit: 920_000, discountPercent: 4 }, 10).exceeded).toBe(false);
    expect(comparePlanFigures('PROFIT', baseline, { profit: 2_000_000, discountPercent: 4 }, 0)).toEqual({ deviationPercent: 0, exceeded: false });
  });

  it('theo lợi nhuận: ngưỡng 0 thì giảm một đồng đã vượt; ngưỡng thập phân 2,5%', () => {
    expect(comparePlanFigures('PROFIT', baseline, { profit: 999_999, discountPercent: 4 }, 0).exceeded).toBe(true);
    expect(comparePlanFigures('PROFIT', baseline, { profit: 975_000, discountPercent: 4 }, 2.5).exceeded).toBe(false);
    expect(comparePlanFigures('PROFIT', baseline, { profit: 974_999, discountPercent: 4 }, 2.5).exceeded).toBe(true);
  });

  it('theo lợi nhuận: lợi nhuận gốc không dương mà giảm thêm thì vượt mọi ngưỡng', () => {
    expect(comparePlanFigures('PROFIT', { profit: 0, discountPercent: 0 }, { profit: -1, discountPercent: 0 }, 100)).toEqual({
      deviationPercent: null,
      exceeded: true,
    });
    expect(comparePlanFigures('PROFIT', { profit: -100, discountPercent: 0 }, { profit: -100, discountPercent: 0 }, 5).exceeded).toBe(false);
  });

  it('theo chiết khấu: tăng đúng bằng ngưỡng không vượt; hơn 0,0001 điểm thì vượt; giảm không tính', () => {
    expect(comparePlanFigures('DISCOUNT', baseline, { profit: 0, discountPercent: 9 }, 5)).toEqual({ deviationPercent: 5, exceeded: false });
    expect(comparePlanFigures('DISCOUNT', baseline, { profit: 0, discountPercent: 9.0001 }, 5).exceeded).toBe(true);
    expect(comparePlanFigures('DISCOUNT', baseline, { profit: 0, discountPercent: 1 }, 0)).toEqual({ deviationPercent: 0, exceeded: false });
    expect(comparePlanFigures('DISCOUNT', baseline, { profit: 0, discountPercent: 5 }, 0.5).exceeded).toBe(true);
    expect(comparePlanFigures('DISCOUNT', baseline, { profit: 0, discountPercent: 4.5 }, 0.5).exceeded).toBe(false);
  });
});

describe('evaluatePlanApproval', () => {
  const settings = DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS;
  const figures = { profit: 1_000_000, discountPercent: 4 };

  it('PAKD đang soạn thì cần duyệt; đã duyệt hoặc không có thì không', () => {
    expect(evaluatePlanApproval({ plan: { status: 'DRAFT' }, current: null, baseline: null, settings }).reasons.map((r) => r.code)).toEqual(['BUSINESS_PLAN']);
    expect(evaluatePlanApproval({ plan: { status: 'APPROVED' }, current: null, baseline: null, settings }).reasons).toEqual([]);
    expect(evaluatePlanApproval({ plan: null, current: null, baseline: null, settings }).reasons).toEqual([]);
  });

  it('lệch vượt ngưỡng thêm lý do PLAN_DEVIATION kèm mức lệch; trong ngưỡng thì không', () => {
    const over = evaluatePlanApproval({ plan: null, current: { profit: 920_000, discountPercent: 4 }, baseline: figures, settings });
    expect(over.reasons).toEqual([
      { code: 'PLAN_DEVIATION', message: expect.stringContaining('Lợi nhuận giảm 8%') },
    ]);
    expect(evaluatePlanApproval({ plan: null, current: { profit: 970_000, discountPercent: 4 }, baseline: figures, settings }).reasons).toEqual([]);
    const discount = evaluatePlanApproval({
      plan: null,
      current: { profit: 0, discountPercent: 12 },
      baseline: figures,
      settings: { mode: 'DISCOUNT', thresholdPercent: 5 },
    });
    expect(discount.reasons[0].message).toContain('Chiết khấu tăng 8%');
  });

  it('không có PAKD đã duyệt thì không so', () => {
    const none = evaluatePlanApproval({ plan: null, current: { profit: 1, discountPercent: 99 }, baseline: null, settings });
    expect(none).toEqual({ result: null, reasons: [] });
  });
});

describe('cấu hình so lệch và máy trạng thái', () => {
  it('mặc định theo lợi nhuận, ngưỡng 5% (P2-D15)', () => {
    expect(DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS).toEqual({ mode: 'PROFIT', thresholdPercent: 5 });
  });

  it('chuẩn hoá cấu hình; từ chối chế độ sai, ngưỡng ngoài 0-100 hoặc quá 2 số thập phân', () => {
    expect(normalizeDeviationSettings({ mode: 'DISCOUNT', thresholdPercent: '10' })).toEqual({ mode: 'DISCOUNT', thresholdPercent: 10 });
    expect(normalizeDeviationSettings({ mode: 'PROFIT', thresholdPercent: 0 })).toEqual({ mode: 'PROFIT', thresholdPercent: 0 });
    expect(() => normalizeDeviationSettings({ mode: 'X', thresholdPercent: 5 })).toThrow(expect.objectContaining({ code: 'INVALID_MODE' }));
    expect(() => normalizeDeviationSettings({ mode: 'PROFIT', thresholdPercent: 101 })).toThrow(expect.objectContaining({ code: 'INVALID_NUMBER' }));
    expect(() => normalizeDeviationSettings({ mode: 'PROFIT', thresholdPercent: -1 })).toThrow(expect.objectContaining({ code: 'INVALID_NUMBER' }));
    expect(() => normalizeDeviationSettings({ mode: 'PROFIT', thresholdPercent: 1.234 })).toThrow(expect.objectContaining({ code: 'INVALID_NUMBER' }));
    expect(() => normalizeDeviationSettings(undefined)).toThrow();
  });

  it('khoá khi chờ duyệt hoặc đã duyệt; bị từ chối sửa được nhưng phải sửa rồi mới trình lại', () => {
    expect(() => assertPlanEditable('DRAFT')).not.toThrow();
    expect(() => assertPlanEditable('REJECTED')).not.toThrow();
    expect(() => assertPlanEditable('PENDING')).toThrow(expect.objectContaining({ code: 'PLAN_LOCKED', statusCode: 409 }));
    expect(() => assertPlanEditable('APPROVED')).toThrow(expect.objectContaining({ code: 'PLAN_LOCKED' }));
    expect(() => assertPlanSubmittable('DRAFT')).not.toThrow();
    expect(() => assertPlanSubmittable('REJECTED')).toThrow(expect.objectContaining({ code: 'PLAN_REJECTED' }));
    expect(() => assertPlanSubmittable('PENDING')).toThrow(expect.objectContaining({ code: 'PLAN_LOCKED' }));
  });
});
