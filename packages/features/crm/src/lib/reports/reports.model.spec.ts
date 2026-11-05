import type { SalesReport } from '@enterprise-platform/contracts-crm';
import { barPercent, periodPresets, salesRowLabel, salesSheet, vietnamToday } from './reports.model';

describe('reports.model', () => {
  it('kỳ chọn nhanh tính từ hôm nay', () => {
    const presets = Object.fromEntries(periodPresets('2026-03-15').map((preset) => [preset.id, [preset.from, preset.to]]));
    expect(presets).toEqual({
      month: ['2026-03-01', '2026-03-15'],
      'last-month': ['2026-02-01', '2026-02-28'],
      quarter: ['2026-01-01', '2026-03-15'],
      year: ['2026-01-01', '2026-03-15'],
      '12-months': ['2025-04-01', '2026-03-15'],
    });
    expect(periodPresets('2026-01-10').find((preset) => preset.id === 'last-month')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('ngày giờ Việt Nam', () => {
    expect(vietnamToday(new Date('2026-10-27T18:00:00Z'))).toBe('2026-10-28');
  });

  it('nhãn dòng và thanh so sánh', () => {
    const name = (id: string) => (id === 'u1' ? 'Nguyễn Văn A' : 'Người dùng khác');
    expect(salesRowLabel('owner', { key: 'u1', label: '' }, name)).toBe('Nguyễn Văn A');
    expect(salesRowLabel('region', { key: null, label: '' }, name)).toBe('Chưa có khu vực');
    expect(salesRowLabel('category', { key: null, label: '' }, name)).toBe('Chưa phân nhóm');
    expect(barPercent(50, 200)).toBe(25);
    expect(barPercent(-5, 200)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });

  it('bảng xuất Excel chỉ gồm các dòng API trả về và dòng tổng', () => {
    const report: SalesReport = {
      from: '2026-10-01',
      to: '2026-10-28',
      groupBy: 'owner',
      truncated: false,
      rows: [{ key: 'u1', code: null, label: '', quantity: 2, revenue: 2_000_000, vatAmount: 200_000, costAmount: 1_660_000, profit: 340_000, marginPercent: 17, orderCount: 1 }],
      totals: { quantity: 2, revenue: 2_000_000, vatAmount: 200_000, costAmount: 1_660_000, profit: 340_000, marginPercent: 17, orderCount: 1 },
    };
    const sheet = salesSheet(report, () => 'NV1');
    expect(sheet.rows).toHaveLength(4);
    expect(sheet.rows[0][0]).toBe('Doanh thu, lợi nhuận theo nhân viên từ 01/10/2026 đến 28/10/2026');
    expect(sheet.rows[2]).toEqual(['NV1', null, 2, 2_000_000, 200_000, 1_660_000, 340_000, 17, 1]);
    expect(sheet.rows[3][0]).toBe('Tổng cộng');
  });
});
