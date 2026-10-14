import {
  FINANCE_VOUCHER_KINDS,
  financeIncludedTax,
  financeLineTotal,
  financeLinesTotal,
  formatFinanceVoucherCode,
  roundMoney,
} from './contracts-finance.js';

describe('tính tiền dùng chung', () => {
  it('làm tròn 2 chữ số không sinh sai số nhị phân', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(Number.NaN)).toBe(0);
  });

  it('thành tiền dòng = số lượng nhân đơn giá; tổng là tổng các dòng đã làm tròn', () => {
    expect(financeLineTotal(3, 33.33)).toBe(99.99);
    expect(financeLinesTotal([{ quantity: 2, unitAmount: 150_000 }, { quantity: 0.5, unitAmount: 100 }])).toBe(300_050);
    expect(financeLinesTotal([])).toBe(0);
  });

  it('thuế nằm trong tổng đã gồm thuế', () => {
    expect(financeIncludedTax(110_000, 10)).toBe(10_000);
    expect(financeIncludedTax(110_000, 0)).toBe(0);
  });

  it('mã phiếu theo dạng PT_<số>_<tháng>_<năm>', () => {
    expect(formatFinanceVoucherCode('RECEIPT', 2027, '2026-10-14')).toBe('PT_2027_10_2026');
    expect(formatFinanceVoucherCode('PAYMENT', 2015, '2026-10-14')).toBe('PC_2015_10_2026');
    expect(formatFinanceVoucherCode('TRANSFER', 288, '2026-01-05')).toBe('PCT_288_01_2026');
    expect(FINANCE_VOUCHER_KINDS).toHaveLength(3);
  });
});
