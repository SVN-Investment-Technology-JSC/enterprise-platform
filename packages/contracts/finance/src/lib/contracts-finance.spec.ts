import {
  FINANCE_VOUCHER_DISPLAY_STATUSES,
  FINANCE_VOUCHER_KINDS,
  FINANCE_VOUCHER_STATUS_LABELS,
  financeDisplayStatusTotals,
  financeIncludedTax,
  financeLineTotal,
  financeLinesTotal,
  financeMissingFields,
  financeMissingFieldsMessage,
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

describe('trạng thái hiển thị của phiếu', () => {
  it('chỉ hai trạng thái: chờ duyệt và bị từ chối hiện là "Nháp"; số đếm gộp về hai nhóm, phiếu đã huỷ không tính', () => {
    expect(FINANCE_VOUCHER_DISPLAY_STATUSES.map((status) => FINANCE_VOUCHER_STATUS_LABELS[status])).toEqual(['Nháp', 'Đã duyệt']);
    expect(FINANCE_VOUCHER_STATUS_LABELS.PENDING).toBe('Nháp');
    expect(FINANCE_VOUCHER_STATUS_LABELS.REJECTED).toBe('Nháp');
    expect(financeDisplayStatusTotals({ DRAFT: 1, PENDING: 2, REJECTED: 3, APPROVED: 4, CANCELLED: 5 })).toEqual({ DRAFT: 6, APPROVED: 4 });
  });
});

describe('trường bắt buộc trước khi duyệt ghi sổ', () => {
  const complete = {
    kind: 'PAYMENT' as const,
    voucherDate: '2026-10-14',
    postingDate: '2026-10-14',
    content: 'Thanh toán dịch vụ',
    totalAmount: 500_000,
    reasonId: 'r1',
    accountId: 'a1',
    accountType: 'CASH' as const,
    counterpartyGroupId: 'g1',
    counterpartyName: 'Nguyễn Văn A',
  };

  it('phiếu đủ thông tin thì không thiếu gì; lệnh chuyển tiền không dùng danh sách này', () => {
    expect(financeMissingFields(complete)).toEqual([]);
    expect(financeMissingFields({ kind: 'TRANSFER', totalAmount: 0 })).toEqual([]);
  });

  it('báo đủ các trường còn thiếu theo thứ tự ô trên biểu mẫu, nhãn theo loại phiếu', () => {
    const missing = financeMissingFields({ ...complete, reasonId: null, accountId: '', counterpartyName: '  ', totalAmount: 0 });
    expect(missing).toEqual(['reason', 'account', 'amount']);
    expect(financeMissingFieldsMessage('PAYMENT', missing)).toBe('Còn thiếu: Lý do chi, Tài khoản chi, Số tiền (lớn hơn 0).');
    expect(financeMissingFieldsMessage('RECEIPT', ['counterpartyGroup', 'counterpartyName'])).toBe('Còn thiếu: Đối tượng thu, Người nộp tiền.');
    expect(financeMissingFieldsMessage('RECEIPT', [])).toBe('');
  });

  it('người nộp/nhận tiền, số tài khoản, ngân hàng có thể có hoặc không, kể cả phiếu chi từ tài khoản ngân hàng', () => {
    const bank = { ...complete, accountType: 'BANK' as const, counterpartyName: null };
    expect(financeMissingFields(bank)).toEqual([]);
    expect(financeMissingFields({ ...bank, kind: 'RECEIPT' })).toEqual([]);
  });

  it('bắt buộc hạch toán dự án thì thiếu dự án là thiếu trường', () => {
    expect(financeMissingFields({ ...complete, allocationRequired: true })).toEqual(['allocation']);
    expect(financeMissingFields({ ...complete, allocationRequired: true, hasAllocation: true })).toEqual([]);
  });
});
