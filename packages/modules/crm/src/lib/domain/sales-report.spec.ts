import { CrmValidationError } from './crm.error.js';
import { conversionSteps, factAmounts, percentOf, resolvePeriod, salesFigures } from './sales-report.js';

describe('factAmounts', () => {
  const line = { quantity: 3, lineAmount: 1_000_000, vatAmount: 100_000 };

  it('chia doanh thu, VAT theo số đã giao, giao nhiều lần cộng lại đúng thành tiền dòng', () => {
    const first = factAmounts(line, 0, 1);
    const second = factAmounts(line, 1, 2);
    const third = factAmounts(line, 2, 3);
    expect(first).toEqual({ revenue: 333_333, vatAmount: 33_333 });
    expect(first.revenue + second.revenue + third.revenue).toBe(1_000_000);
    expect(first.vatAmount + second.vatAmount + third.vatAmount).toBe(100_000);
  });

  it('chứng từ đảo cho số âm', () => {
    expect(factAmounts(line, 3, 0)).toEqual({ revenue: -1_000_000, vatAmount: -100_000 });
  });

  it('dòng số lượng 0 không có doanh thu', () => {
    expect(factAmounts({ quantity: 0, lineAmount: 5, vatAmount: 1 }, 0, 1)).toEqual({ revenue: 0, vatAmount: 0 });
  });
});

describe('salesFigures', () => {
  it('lợi nhuận = doanh thu − giá vốn thực tế; biên 2 chữ số', () => {
    expect(salesFigures({ quantity: 1, revenue: 1_000_000, vatAmount: 100_000, costAmount: 830_000, orderCount: 1 })).toEqual({
      quantity: 1,
      revenue: 1_000_000,
      vatAmount: 100_000,
      costAmount: 830_000,
      profit: 170_000,
      marginPercent: 17,
      orderCount: 1,
    });
  });

  it('doanh thu 0 thì biên không xác định', () => {
    expect(salesFigures({ quantity: 0, revenue: 0, vatAmount: 0, costAmount: 0, orderCount: 0 }).marginPercent).toBeNull();
  });
});

describe('conversionSteps', () => {
  it('TC-RPT-03: 10 cơ hội, 6 báo giá, 4 hợp đồng, 3 đơn', () => {
    expect(conversionSteps({ OPPORTUNITY: 10, QUOTE: 6, CONTRACT: 4, ORDER: 3 })).toEqual([
      { stage: 'OPPORTUNITY', count: 10, stepPercent: null, overallPercent: 100 },
      { stage: 'QUOTE', count: 6, stepPercent: 60, overallPercent: 60 },
      { stage: 'CONTRACT', count: 4, stepPercent: 66.67, overallPercent: 40 },
      { stage: 'ORDER', count: 3, stepPercent: 75, overallPercent: 30 },
    ]);
  });

  it('bước trước bằng 0 thì tỷ lệ rỗng', () => {
    expect(conversionSteps({ OPPORTUNITY: 0, QUOTE: 2, CONTRACT: 0, ORDER: 1 }).map((step) => step.stepPercent)).toEqual([null, null, 0, null]);
    expect(percentOf(1, 0)).toBeNull();
  });
});

describe('resolvePeriod', () => {
  it('mặc định từ đầu tháng tới hôm nay', () => {
    expect(resolvePeriod(undefined, '', '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-28' });
  });

  it('từ sau đến, kỳ quá dài, ngày sai là lỗi nhập', () => {
    expect(() => resolvePeriod('2026-10-02', '2026-10-01', '2026-10-28')).toThrow(CrmValidationError);
    expect(() => resolvePeriod('2020-01-01', '2026-10-01', '2026-10-28')).toThrow(/3 năm/);
    expect(() => resolvePeriod('2026-13-01', undefined, '2026-10-28')).toThrow(CrmValidationError);
  });
});
