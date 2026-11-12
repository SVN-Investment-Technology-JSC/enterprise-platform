import {
  currentMonthInVietnam,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMonth,
  formatTime,
  todayInVietnam,
} from './date-format';

describe('date-format', () => {
  it('formats plain dates as dd/mm/yyyy without timezone shifts', () => {
    expect(formatDate('2026-10-09')).toBe('09/10/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
  });

  it('formats datetime values in local time', () => {
    const d = new Date(2026, 9, 9, 14, 5);
    expect(formatDate(d)).toBe('09/10/2026');
    expect(formatDateTime(d)).toBe('09/10/2026 14:05');
    expect(formatTime(d)).toBe('14:05');
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe(
      '02/01/2026 03:04',
    );
  });

  it('formats months and ranges, returns the fallback for empty/invalid input', () => {
    expect(formatMonth('2026-10')).toBe('10/2026');
    expect(formatDateRange('2026-01-01', null)).toBe(
      '01/01/2026 - Không giới hạn',
    );
    expect(formatDate(null, '—')).toBe('—');
    expect(formatDate('không phải ngày', '—')).toBe('—');
    expect(formatDate('')).toBe('');
  });

  it('computes today and current month in Vietnam timezone (UTC+7)', () => {
    // 2026-10-01 18:30:00 UTC = 2026-10-02 01:30:00 Vietnam
    const earlyMorningVn = new Date('2026-10-01T18:30:00.000Z');
    expect(todayInVietnam(earlyMorningVn)).toBe('2026-10-02');
    expect(currentMonthInVietnam(new Date('2026-09-30T18:30:00.000Z'))).toBe('2026-10');
  });
});
