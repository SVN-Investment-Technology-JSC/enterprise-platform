import {
  businessPlanSourceSummary,
  moneyText,
  percentText,
  quoteSourceSummary,
  sanitizeSourceSummary,
  SOURCE_SUMMARY_LIMITS,
  type QuoteSourceInput,
} from './procedure-source-summary.js';

const QUOTE: QuoteSourceInput = {
  quoteId: '11111111-1111-4111-8111-111111111111',
  code: 'BG2600401',
  versionNo: 2,
  customerName: 'Công ty ABC',
  opportunityName: 'Dự án nhà máy',
  ownerName: 'Nguyễn Văn A',
  organizationName: 'Công ty con miền Bắc',
  totalAmount: 1_234_567,
  discountAmount: 150_000,
  discountPercent: 12.5,
  estCost: 900_000,
  marginPercent: 8.25,
  reasons: ['Chiết khấu vượt hạn mức.', 'Biên lợi nhuận dưới mức tối thiểu.'],
  plan: { revenue: 1_100_000, goodsCost: 900_000, totalCost: 950_000, profit: 150_000, marginPercent: 13.64 },
};

describe('thông tin nguồn gửi Quy trình (plan mục 17.2)', () => {
  it('định dạng tiền, phần trăm kiểu Việt Nam', () => {
    expect(moneyText(1_234_567)).toBe('1.234.567 đ');
    expect(percentText(12.5)).toBe('12,5%');
    expect(percentText(null)).toBe('Chưa tính được');
  });

  it('báo giá: tiêu đề, các dòng theo thứ tự, mỗi lý do một dòng, PAKD đi kèm, link về báo giá', () => {
    const summary = quoteSourceSummary(QUOTE);
    expect(summary.title).toBe('Báo giá BG2600401 v2');
    expect(summary.url).toBe('/modules/crm#quotes/11111111-1111-4111-8111-111111111111');
    expect(summary.urlLabel).toBe('Mở báo giá trong Bán hàng');
    expect(summary.items).toEqual([
      { label: 'Khách hàng', value: 'Công ty ABC' },
      { label: 'Dự án', value: 'Dự án nhà máy' },
      { label: 'Người phụ trách', value: 'Nguyễn Văn A' },
      { label: 'Tổ chức báo giá', value: 'Công ty con miền Bắc' },
      { label: 'Tổng tiền', value: '1.234.567 đ' },
      { label: 'Chiết khấu', value: '150.000 đ (12,5%)' },
      { label: 'Giá vốn ước tính', value: '900.000 đ' },
      { label: 'Biên lợi nhuận ước tính', value: '8,25%' },
      { label: 'Lý do cần duyệt', value: 'Chiết khấu vượt hạn mức.' },
      { label: 'Lý do cần duyệt', value: 'Biên lợi nhuận dưới mức tối thiểu.' },
      { label: 'PAKD - Doanh thu', value: '1.100.000 đ' },
      { label: 'PAKD - Giá vốn', value: '900.000 đ' },
      { label: 'PAKD - Tổng chi phí', value: '950.000 đ' },
      { label: 'PAKD - Lợi nhuận', value: '150.000 đ' },
      { label: 'PAKD - Biên lợi nhuận', value: '13,64%' },
    ]);
  });

  it('báo giá thiếu dự án, người phụ trách, tổ chức, PAKD thì bỏ các dòng đó', () => {
    const summary = quoteSourceSummary({ ...QUOTE, opportunityName: null, ownerName: null, organizationName: null, plan: null, reasons: [] });
    expect(summary.items.map((item) => item.label)).toEqual([
      'Khách hàng',
      'Tổng tiền',
      'Chiết khấu',
      'Giá vốn ước tính',
      'Biên lợi nhuận ước tính',
    ]);
  });

  it('quá nhiều lý do: giữ đủ 30 dòng, dòng lý do cuối gộp phần còn lại, PAKD vẫn còn', () => {
    const reasons = Array.from({ length: 40 }, (_, index) => `Dòng ${index + 1}: có ghi đè giá.`);
    const summary = quoteSourceSummary({ ...QUOTE, reasons });
    expect(summary.items).toHaveLength(SOURCE_SUMMARY_LIMITS.items);
    const reasonRows = summary.items.filter((item) => item.label === 'Lý do cần duyệt');
    expect(reasonRows.at(-1)?.value).toBe(`Và ${40 - (reasonRows.length - 1)} lý do khác (xem trên báo giá).`);
    expect(summary.items.at(-1)).toEqual({ label: 'PAKD - Biên lợi nhuận', value: '13,64%' });
  });

  it('PAKD trình riêng: tiêu đề, khách, người phụ trách, số liệu, lý do lệch ngưỡng', () => {
    const summary = businessPlanSourceSummary({
      quoteId: QUOTE.quoteId,
      code: 'BG2600401',
      versionNo: 1,
      customerName: 'Công ty ABC',
      ownerName: null,
      figures: { revenue: 1_000_000, goodsCost: 700_000, totalCost: 800_000, profit: 200_000, marginPercent: 20 },
      reasons: ['Lợi nhuận giảm 15% so với phương án kinh doanh đã duyệt (vượt ngưỡng 10%).'],
    });
    expect(summary).toEqual({
      title: 'PAKD báo giá BG2600401 v1',
      url: '/modules/crm#quotes/11111111-1111-4111-8111-111111111111',
      urlLabel: 'Mở báo giá trong Bán hàng',
      items: [
        { label: 'Khách hàng', value: 'Công ty ABC' },
        { label: 'Doanh thu', value: '1.000.000 đ' },
        { label: 'Giá vốn', value: '700.000 đ' },
        { label: 'Tổng chi phí', value: '800.000 đ' },
        { label: 'Lợi nhuận', value: '200.000 đ' },
        { label: 'Biên lợi nhuận', value: '20%' },
        { label: 'Lý do cần duyệt', value: 'Lợi nhuận giảm 15% so với phương án kinh doanh đã duyệt (vượt ngưỡng 10%).' },
      ],
    });
  });

  it('cắt về giới hạn của Quy trình thay vì để bị từ chối; bỏ link không phải đường dẫn nội bộ', () => {
    const long = 'x'.repeat(2000);
    const summary = sanitizeSourceSummary({
      title: long,
      items: [{ label: long, value: long }, { label: '   ', value: 'không nhãn' }, ...Array.from({ length: 40 }, () => ({ label: 'A', value: 'B' }))],
      url: 'https://example.com',
      urlLabel: long,
    });
    expect(summary.title).toHaveLength(SOURCE_SUMMARY_LIMITS.title);
    expect(summary.items).toHaveLength(SOURCE_SUMMARY_LIMITS.items);
    expect(summary.items[0].label).toHaveLength(SOURCE_SUMMARY_LIMITS.label);
    expect(summary.items[0].value).toHaveLength(SOURCE_SUMMARY_LIMITS.value);
    expect(summary.items.some((item) => !item.label)).toBe(false);
    expect(summary.url).toBeUndefined();
    expect(summary.urlLabel).toBeUndefined();
    for (const url of ['//evil.example', '/http://evil.example', '/a\\b', `/${'a'.repeat(600)}`]) {
      expect(sanitizeSourceSummary({ items: [], url }).url).toBeUndefined();
    }
    expect(sanitizeSourceSummary({ items: [], url: '/modules/crm#quotes/1' }).url).toBe('/modules/crm#quotes/1');
  });
});
