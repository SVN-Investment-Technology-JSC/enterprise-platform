import { buildTrend, changePercent, rate, resolveDashboardRange, trendGranularity } from './dashboard.js';

describe('kỳ dashboard', () => {
  it('tháng này: từ đầu tháng tới hôm nay, so với cùng số ngày đầu tháng trước', () => {
    expect(resolveDashboardRange('month', undefined, undefined, '2026-10-28')).toEqual({
      range: { from: '2026-10-01', to: '2026-10-28' },
      previous: { from: '2026-09-01', to: '2026-09-28' },
    });
  });

  it('kỳ trước ngắn hơn thì dừng ở cuối kỳ trước (31/3 so với hết tháng 2)', () => {
    expect(resolveDashboardRange('month', undefined, undefined, '2026-03-31').previous).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('quý này và năm nay, kể cả qua năm', () => {
    expect(resolveDashboardRange('quarter', undefined, undefined, '2026-01-15')).toEqual({
      range: { from: '2026-01-01', to: '2026-01-15' },
      previous: { from: '2025-10-01', to: '2025-10-15' },
    });
    expect(resolveDashboardRange('quarter', undefined, undefined, '2026-08-10').range.from).toBe('2026-07-01');
    expect(resolveDashboardRange('year', undefined, undefined, '2026-10-28')).toEqual({
      range: { from: '2026-01-01', to: '2026-10-28' },
      previous: { from: '2025-01-01', to: '2025-10-28' },
    });
    // Ngày cuối năm: kỳ trước là trọn năm trước.
    expect(resolveDashboardRange('year', undefined, undefined, '2028-12-31').previous).toEqual({
      from: '2027-01-01',
      to: '2027-12-31',
    });
  });

  it('tuỳ chọn: kỳ trước cùng số ngày, liền trước; kiểm ngày như báo cáo', () => {
    expect(resolveDashboardRange('custom', '2026-03-10', '2026-03-19', '2026-10-28')).toEqual({
      range: { from: '2026-03-10', to: '2026-03-19' },
      previous: { from: '2026-02-28', to: '2026-03-09' },
    });
    expect(() => resolveDashboardRange('custom', '2026-03-10', '2026-03-01', '2026-10-28')).toThrow('Từ ngày phải trước');
    expect(() => resolveDashboardRange('custom', 'abc', '2026-03-01', '2026-10-28')).toThrow();
  });
});

describe('phần trăm thay đổi', () => {
  it('so với kỳ trước, 1 chữ số', () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(1, 3)).toBe(-66.7);
  });

  it('kỳ trước bằng 0: cùng 0 là 0, khác 0 thì không so được', () => {
    expect(changePercent(0, 0)).toBe(0);
    expect(changePercent(100, 0)).toBeNull();
    expect(changePercent(-100, 0)).toBeNull();
  });

  it('kỳ trước âm (lợi nhuận lỗ): chia theo trị tuyệt đối để dấu đúng chiều', () => {
    expect(changePercent(50, -100)).toBe(150);
    expect(changePercent(-200, -100)).toBe(-100);
  });

  it('tỷ lệ: chênh lệch điểm phần trăm, thiếu một kỳ thì null', () => {
    expect(rate(40, 25)).toEqual({ value: 40, previous: 25, changePoints: 15 });
    expect(rate(null, 25).changePoints).toBeNull();
  });
});

describe('xu hướng', () => {
  it('mốc theo độ dài kỳ', () => {
    expect(trendGranularity({ from: '2026-10-01', to: '2026-10-31' })).toBe('day');
    expect(trendGranularity({ from: '2026-07-01', to: '2026-09-30' })).toBe('week');
    expect(trendGranularity({ from: '2026-01-01', to: '2026-10-28' })).toBe('month');
  });

  it('theo ngày: đủ mọi ngày, ngày trống bằng 0, bỏ ngày ngoài kỳ', () => {
    const trend = buildTrend({ from: '2026-10-01', to: '2026-10-03' }, [
      { date: '2026-10-02', revenue: 100.4, orders: 2 },
      { date: '2026-09-30', revenue: 999, orders: 9 },
    ]);
    expect(trend.buckets).toEqual([
      { start: '2026-10-01', end: '2026-10-01', revenue: 0, orders: 0 },
      { start: '2026-10-02', end: '2026-10-02', revenue: 100, orders: 2 },
      { start: '2026-10-03', end: '2026-10-03', revenue: 0, orders: 0 },
    ]);
  });

  it('theo tuần bắt đầu thứ Hai, mốc đầu cuối cắt theo kỳ', () => {
    // 01/07/2026 là thứ Tư.
    const trend = buildTrend({ from: '2026-07-01', to: '2026-08-15' }, [
      { date: '2026-07-01', revenue: 10, orders: 1 },
      { date: '2026-07-05', revenue: 5, orders: 0 },
      { date: '2026-07-06', revenue: 7, orders: 1 },
    ]);
    expect(trend.granularity).toBe('week');
    expect(trend.buckets[0]).toEqual({ start: '2026-07-01', end: '2026-07-05', revenue: 15, orders: 1 });
    expect(trend.buckets[1]).toEqual({ start: '2026-07-06', end: '2026-07-12', revenue: 7, orders: 1 });
    expect(trend.buckets[trend.buckets.length - 1]).toMatchObject({ start: '2026-08-10', end: '2026-08-15' });
  });

  it('theo tháng: năm nay tới tháng 10 có 10 mốc', () => {
    const trend = buildTrend({ from: '2026-01-01', to: '2026-10-28' }, [{ date: '2026-02-14', revenue: 3, orders: 1 }]);
    expect(trend.buckets).toHaveLength(10);
    expect(trend.buckets[1]).toEqual({ start: '2026-02-01', end: '2026-02-28', revenue: 3, orders: 1 });
    expect(trend.buckets[9].end).toBe('2026-10-28');
  });
});
