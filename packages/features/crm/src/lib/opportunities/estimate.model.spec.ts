import { compareEstimateWithPlan, digitsOnly, parseEstimateInput, planFiguresOf, summarizeEstimate } from './estimate.model';

describe('dự toán của dự án bán hàng (P2D-09, TC-BP-12)', () => {
  it('chỉ giữ chữ số khi nhập', () => {
    expect(digitsOnly('1.500.000 ₫')).toBe('1500000');
  });

  it('parse: rỗng là null, số hợp lệ, số âm hoặc chữ báo lỗi tiếng Việt', () => {
    expect(parseEstimateInput({ total: '', cost: '' })).toEqual({ ok: true, total: null, cost: null });
    expect(parseEstimateInput({ total: '1000', cost: '700' })).toEqual({ ok: true, total: 1000, cost: 700 });
    expect(parseEstimateInput({ total: '-1', cost: '' })).toEqual({ ok: false, message: 'Tổng giá trị dự toán phải là số không âm.' });
    expect(parseEstimateInput({ total: '1', cost: 'abc' })).toEqual({ ok: false, message: 'Giá vốn dự kiến phải là số không âm.' });
  });

  it('tính lợi nhuận khi có đủ hai số', () => {
    expect(summarizeEstimate(1000, 750)).toEqual({ profit: 250, marginPercent: 25 });
    expect(summarizeEstimate(0, 0)).toEqual({ profit: 0, marginPercent: null });
    expect(summarizeEstimate(1000, null)).toBeNull();
  });

  it('đối chiếu: chưa có PAKD chỉ hiển thị; khớp; lệch', () => {
    expect(compareEstimateWithPlan(1000, 700, null).status).toBe('NO_PLAN');
    const plan = { totalValue: 1000, totalCost: 700 };
    expect(compareEstimateWithPlan(null, null, plan).status).toBe('NO_ESTIMATE');
    expect(compareEstimateWithPlan(1000, 700, plan)).toMatchObject({ status: 'MATCH', totalDelta: 0, costDelta: 0 });
    expect(compareEstimateWithPlan(1200, 700, plan)).toMatchObject({ status: 'DIFFERENT', totalDelta: 200, costDelta: 0 });
  });

  it('không có quyền xem giá vốn: chỉ đối chiếu doanh thu, không so giá vốn', () => {
    expect(planFiguresOf(null)).toBeNull();
    const hidden = planFiguresOf({ revenue: 1000, totalCost: null });
    expect(hidden).toEqual({ totalValue: 1000, totalCost: null });
    expect(compareEstimateWithPlan(1000, 5, hidden)).toMatchObject({ status: 'MATCH', totalDelta: 0, costDelta: null });
    expect(compareEstimateWithPlan(900, 5, hidden)).toMatchObject({ status: 'DIFFERENT', totalDelta: -100, costDelta: null });
  });
});
