/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { CashflowChart, niceMax, shortMoney } from './cashflow-chart';

describe('trục biểu đồ', () => {
  it('mốc trên của trục là số đẹp luôn không nhỏ hơn giá trị lớn nhất', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(2_300_000)).toBe(5_000_000);
    expect(niceMax(5_000_000)).toBe(5_000_000);
    for (const value of [1, 3, 99, 101, 1_234_567, 987_654_321]) expect(niceMax(value)).toBeGreaterThanOrEqual(value);
  });

  it('nhãn tiền ngắn gọn theo nghìn, triệu, tỷ', () => {
    expect(shortMoney(0)).toBe('0');
    expect(shortMoney(1_500)).toBe('1,5 k');
    expect(shortMoney(250_000_000)).toBe('250 tr');
    expect(shortMoney(1_500_000_000)).toBe('1,5 tỷ');
  });
});

describe('CashflowChart', () => {
  it('không có dữ liệu thì báo chưa có dữ liệu để vẽ', () => {
    render(<CashflowChart points={[]} />);
    expect(screen.getByText('Chưa có dữ liệu để vẽ.')).toBeTruthy();
  });

  it('mô tả tổng thu chi cho trình đọc màn hình và có tiêu đề từng cột để xem số tiền', () => {
    const { container } = render(
      <CashflowChart
        points={[
          { period: '2026-09', receipts: 1_000_000, payments: 400_000, net: 600_000 },
          { period: '2026-10', receipts: 0, payments: 250_000, net: -250_000 },
        ]}
      />,
    );
    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toContain('2 kỳ');
    expect(chart.getAttribute('aria-label')).toContain('tổng thu 1.000.000');
    expect(chart.getAttribute('aria-label')).toContain('tổng chi 650.000');
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain('T9/2026: thu 1.000.000');
    expect(titles).toContain('T10/2026: chi 250.000');
  });

  it('cột không vượt khung vẽ: chiều cao tối đa bằng chiều cao vùng vẽ', () => {
    const { container } = render(<CashflowChart height={220} points={[{ period: '2026-10-01', receipts: 123, payments: 0, net: 123 }]} />);
    const heights = [...container.querySelectorAll('rect')].map((rect) => Number(rect.getAttribute('height')));
    expect(Math.max(...heights)).toBeLessThanOrEqual(220 - 12 - 28);
    expect(heights.every((h) => h >= 0)).toBe(true);
  });
});
