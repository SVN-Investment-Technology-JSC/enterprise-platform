import { FINANCE_EMBED_PREFIX, isFinanceEmbedPath, normalizeFinancePath, stripFinanceEmbed } from './finance-navigation';

describe('trang nhúng của Tài chính (/embed)', () => {
  it('nhận ra đường dẫn nhúng, có hoặc không có tiền tố /modules/finance', () => {
    expect(isFinanceEmbedPath('/modules/finance/embed/payments/v1')).toBe(true);
    expect(isFinanceEmbedPath('/modules/finance/embed/receipts/v1/edit')).toBe(true);
    expect(isFinanceEmbedPath('/embed/payments/v1')).toBe(true);
  });

  it('không nhầm trang thường hay đường dẫn chỉ trông giống', () => {
    expect(isFinanceEmbedPath('/modules/finance/payments/v1')).toBe(false);
    expect(isFinanceEmbedPath('/modules/finance/embedded/payments/v1')).toBe(false);
    expect(isFinanceEmbedPath('/modules/finance/embed')).toBe(false);
    expect(isFinanceEmbedPath('/modules/finance')).toBe(false);
  });

  it('bỏ tiền tố nhúng để kiểm quyền theo trang gốc', () => {
    expect(stripFinanceEmbed(normalizeFinancePath('/modules/finance/embed/payments/v1'))).toBe('/payments/v1');
    expect(stripFinanceEmbed('/payments/v1')).toBe('/payments/v1');
    expect(FINANCE_EMBED_PREFIX).toBe('/embed');
  });
});
