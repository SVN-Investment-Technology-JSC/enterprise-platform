import { granularityFor, previousWindow } from './report-period.js';

describe('granularityFor — độ mịn biểu đồ xu hướng', () => {
  const at = (iso: string) => new Date(iso);
  it('tới một tháng theo ngày, tới một quý theo tuần, dài hơn theo tháng', () => {
    expect(granularityFor(at('2026-10-01T00:00:00Z'), at('2026-10-31T23:59:59Z'))).toBe('day');
    expect(granularityFor(at('2026-07-01T00:00:00Z'), at('2026-09-30T23:59:59Z'))).toBe('week');
    expect(granularityFor(at('2026-01-01T00:00:00Z'), at('2026-12-31T23:59:59Z'))).toBe('month');
  });
});

describe('previousWindow — kỳ liền trước', () => {
  it('tuần trước của một tuần thứ Hai – Chủ nhật', () => {
    const previous = previousWindow(new Date('2026-10-19T00:00:00Z'), new Date('2026-10-25T23:59:59Z'));
    expect(previous.from.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(previous.to.toISOString()).toBe('2026-10-18T23:59:59.000Z');
  });
});
