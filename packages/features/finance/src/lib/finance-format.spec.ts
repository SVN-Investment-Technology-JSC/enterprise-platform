import type { FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { FINANCE_KIND_CONFIG, kindOfPath } from './finance-kinds';
import { dateTimeVn, dateVn, groupDigits, initialsOf, isMonth, money, monthLabel, monthRange, parseMoneyInput, periodLabel, periodPresets, reformatMoneyInput, shiftMonth, voucherCsvRows } from './finance-format';
import { getActiveFinanceNavId, normalizeFinancePath } from './finance-navigation';

describe('định dạng', () => {
  it('ngày giờ theo kiểu Việt Nam, giờ UTC+7', () => {
    expect(dateVn('2026-10-14')).toBe('14/10/2026');
    expect(dateVn(null)).toBe('');
    expect(dateTimeVn('2026-10-14T02:30:00.000Z')).toBe('14/10/2026 09:30');
    expect(dateTimeVn('2026-10-14T20:00:00.000Z')).toBe('15/10/2026 03:00');
  });

  it('số tiền và nhập tiền', () => {
    expect(money(1500000)).toBe('1.500.000');
    expect(money(null)).toBe('-');
    expect(parseMoneyInput('1.500.000 đ')).toBe(1500000);
    expect(parseMoneyInput('')).toBe(0);
    expect(parseMoneyInput('abc')).toBe(0);
  });

  it('nhóm chữ số bằng dấu chấm', () => {
    expect(groupDigits('')).toBe('');
    expect(groupDigits('7')).toBe('7');
    expect(groupDigits('1234')).toBe('1.234');
    expect(groupDigits('123456')).toBe('123.456');
    expect(groupDigits('1234567890123')).toBe('1.234.567.890.123');
  });

  it('định dạng ô nhập tiền: giá trị, chuỗi hiển thị và con trỏ', () => {
    expect(reformatMoneyInput('1500000', 7)).toEqual({ value: 1_500_000, display: '1.500.000', caret: 9, pendingMinus: false });
    expect(reformatMoneyInput('', 0)).toEqual({ value: 0, display: '', caret: 0, pendingMinus: false });
    expect(reformatMoneyInput('-', 1)).toEqual({ value: 0, display: '', caret: 0, pendingMinus: false });
    expect(reformatMoneyInput('-', 1, true)).toEqual({ value: 0, display: '-', caret: 1, pendingMinus: true });
    expect(reformatMoneyInput('-1500', 5, true)).toEqual({ value: -1500, display: '-1.500', caret: 6, pendingMinus: false });
    // Con trỏ ngay sau chữ số thứ hai của "12.500".
    expect(reformatMoneyInput('12.500', 2)?.caret).toBe(2);
    // Số 0 đứng đầu bị bỏ và không làm lệch con trỏ.
    expect(reformatMoneyInput('0012', 4)).toMatchObject({ value: 12, display: '12', caret: 2 });
    // Dán kèm phần thập phân và đơn vị.
    expect(reformatMoneyInput('1.500.000,25 đ', 14)).toMatchObject({ value: 1_500_000, display: '1.500.000' });
    // Vượt 15 chữ số thì từ chối, đúng 15 chữ số thì nhận.
    expect(reformatMoneyInput('1000000000000000', 16)).toBeNull();
    expect(reformatMoneyInput('999999999999999', 15)?.value).toBe(999_999_999_999_999);
  });

  it('chữ cái đầu của tên lấy theo tên gọi (từ cuối)', () => {
    expect(initialsOf('Nguyễn Văn An')).toBe('A');
    expect(initialsOf('Bình')).toBe('B');
    expect(initialsOf('  ')).toBe('?');
  });

  it('khoảng thời gian chọn nhanh cho báo cáo', () => {
    const presets = Object.fromEntries(periodPresets('2026-10-14').map((p) => [p.id, p]));
    expect(presets.month).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(presets['prev-month']).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(presets.quarter).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
    expect(presets.year).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(presets['30d']).toMatchObject({ from: '2026-09-15', to: '2026-10-14' });
    const january = Object.fromEntries(periodPresets('2026-01-10').map((p) => [p.id, p]));
    expect(january['prev-month']).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    const leap = Object.fromEntries(periodPresets('2024-02-10').map((p) => [p.id, p]));
    expect(leap.month.to).toBe('2024-02-29');
  });

  it('nhãn kỳ biểu đồ', () => {
    expect(periodLabel('2026-10')).toBe('T10/2026');
    expect(periodLabel('2026-10-14')).toBe('14/10');
  });

  it('CSV có tiêu đề và đúng các dòng, tiền là số', () => {
    const item = {
      code: 'PT_1_10_2026',
      kind: 'RECEIPT',
      voucherDate: '2026-10-14',
      postingDate: '2026-10-14',
      content: 'Thu tiền hàng',
      reasonName: 'Thu tiền hàng',
      accountName: 'VCB',
      destAccountName: null,
      counterpartyGroupName: 'Khách hàng',
      counterpartyName: 'Công ty ABC',
      totalAmount: 300000,
      status: 'APPROVED',
      createdByName: 'An',
    } as FinanceVoucherSummary;
    const rows = voucherCsvRows([item]);
    expect(rows[0]).toContain('Trạng thái');
    expect(rows[1]).toEqual(['PT_1_10_2026', 'Phiếu thu', '14/10/2026', '14/10/2026', 'Thu tiền hàng', 'Thu tiền hàng', 'VCB', '', 'Khách hàng', 'Công ty ABC', 300000, 'Đã duyệt', 'An']);
  });
});

describe('theo dõi theo tháng', () => {
  it('khoảng ngày của tháng, kể cả tháng 2 năm nhuận và tháng 12', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('chuyển tháng qua ranh giới năm', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -10)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(shiftMonth('2026-10', 14)).toBe('2027-12');
  });

  it('nhãn tháng và kiểm định dạng', () => {
    expect(monthLabel('2026-02')).toBe('Tháng 2/2026');
    expect(isMonth('2026-10')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', 'all', '', null, 202610]) expect(isMonth(bad)).toBe(false);
  });
});

describe('điều hướng và loại phiếu', () => {
  it('bỏ tiền tố basePath và dấu / cuối', () => {
    expect(normalizeFinancePath('/modules/finance/receipts/')).toBe('/receipts');
    expect(normalizeFinancePath('/modules/finance')).toBe('/');
    expect(normalizeFinancePath('/receipts?x=1')).toBe('/receipts');
  });

  it('trang chi tiết và trang tạo vẫn sáng đúng mục menu', () => {
    expect(getActiveFinanceNavId('/modules/finance/receipts/new')).toBe('receipts');
    expect(getActiveFinanceNavId('/modules/finance/payments/abc-123')).toBe('payments');
    expect(getActiveFinanceNavId('/modules/finance')).toBe('dashboard');
    expect(getActiveFinanceNavId('/modules/finance/unknown')).toBeNull();
  });

  it('mỗi loại phiếu có cấu hình đường dẫn khớp menu', () => {
    expect(kindOfPath('/payments')).toBe('PAYMENT');
    expect(kindOfPath('/xyz')).toBeNull();
    expect(FINANCE_KIND_CONFIG.TRANSFER.hasLines).toBe(false);
    expect(FINANCE_KIND_CONFIG.RECEIPT.listTitle).toBe('Danh sách phiếu thu');
  });
});
