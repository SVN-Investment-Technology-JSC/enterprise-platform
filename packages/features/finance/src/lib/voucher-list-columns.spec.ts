import { FINANCE_KIND_CONFIG } from './finance-kinds';
import { visibleVoucherColumns, voucherColumnCatalog, voucherColumnWidths } from './voucher-list-columns';

describe('cột hiển thị danh sách phiếu', () => {
  const payment = voucherColumnCatalog('PAYMENT', FINANCE_KIND_CONFIG.PAYMENT);

  it('chưa chọn thì dùng bộ mặc định; người nhận tiền và dự án là cột thêm', () => {
    const keys = visibleVoucherColumns(payment, null).map((c) => c.key);
    expect(keys).toEqual(['creator', 'code', 'date', 'content', 'reason', 'account', 'counterparty', 'allocation', 'amount', 'status']);
    expect(payment.find((c) => c.key === 'person')?.label).toBe('Người nhận tiền');
  });

  it('chỉ chọn dự án và số tiền: vẫn giữ mã phiếu, theo thứ tự của bảng, bỏ mã lạ', () => {
    const keys = visibleVoucherColumns(payment, ['amount', 'project', 'khong-co']).map((c) => c.key);
    expect(keys).toEqual(['code', 'project', 'amount']);
  });

  it('bề ngang chia theo tỷ trọng, cộng lại 100%', () => {
    const widths = voucherColumnWidths(visibleVoucherColumns(payment, ['project', 'amount']));
    const sum = Object.values(widths).reduce((s, w) => s + Number.parseFloat(w), 0);
    expect(Math.round(sum)).toBe(100);
  });

  it('lệnh chuyển tiền không có cột lý do, đối tượng, dự án', () => {
    const keys = voucherColumnCatalog('TRANSFER', FINANCE_KIND_CONFIG.TRANSFER).map((c) => c.key);
    expect(keys).toContain('accounts');
    for (const key of ['reason', 'counterparty', 'project', 'person']) expect(keys).not.toContain(key);
  });
});
