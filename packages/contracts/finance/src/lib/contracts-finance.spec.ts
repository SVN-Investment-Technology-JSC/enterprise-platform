import {
  FINANCE_VOUCHER_KINDS,
  financeIncludedTax,
  financeLineTotal,
  financeLinesTotal,
  financePeriodOf,
  formatFinanceDraftCode,
  formatFinanceOfficialCode,
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

  it('kỳ đánh số là YYMM của ngày', () => {
    expect(financePeriodOf('2026-10-14')).toBe('2610');
    expect(financePeriodOf('2027-01-05')).toBe('2701');
  });

  it('mã chính thức <tiền tố>-<YYMM>-<4 số>', () => {
    expect(formatFinanceOfficialCode('PAYMENT', '2610', 45)).toBe('PC-2610-0045');
    expect(formatFinanceOfficialCode('RECEIPT', '2610', 12)).toBe('PT-2610-0012');
    expect(formatFinanceOfficialCode('TRANSFER', '2601', 3)).toBe('CT-2601-0003');
    expect(formatFinanceOfficialCode('PAYMENT', '2610', 12345)).toBe('PC-2610-12345');
    expect(FINANCE_VOUCHER_KINDS).toHaveLength(3);
  });

  it('mã nháp NHAP_<tiền tố>_<YYMM>_<4 số>, không trùng dạng mã chính thức', () => {
    expect(formatFinanceDraftCode('PAYMENT', '2610', 45)).toBe('NHAP_PC_2610_0045');
    expect(formatFinanceDraftCode('TRANSFER', '2610', 3)).toBe('NHAP_CT_2610_0003');
    expect(formatFinanceDraftCode('PAYMENT', '2610', 45)).not.toBe(formatFinanceOfficialCode('PAYMENT', '2610', 45));
  });
});
