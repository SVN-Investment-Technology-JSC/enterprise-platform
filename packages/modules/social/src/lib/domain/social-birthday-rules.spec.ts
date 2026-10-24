import { addDays, ageAtOccurrence, dayInTimeZone, daysUntilBirthday, endOfMonthWindow, isValidBirthday } from './social-birthday-rules.js';

describe('daysUntilBirthday', () => {
  it('is 0 today and counts forward', () => {
    expect(daysUntilBirthday('2026-10-21', { day: 21, month: 10 })).toBe(0);
    expect(daysUntilBirthday('2026-10-21', { day: 25, month: 10 })).toBe(4);
  });

  it('wraps to next year once the date has passed', () => {
    expect(daysUntilBirthday('2026-10-21', { day: 20, month: 10 })).toBe(364);
    expect(daysUntilBirthday('2026-12-30', { day: 2, month: 1 })).toBe(3);
  });

  it('moves a 29 February birthday to 28 February in non-leap years', () => {
    expect(daysUntilBirthday('2027-02-27', { day: 29, month: 2 })).toBe(1);
    expect(daysUntilBirthday('2028-02-27', { day: 29, month: 2 })).toBe(2);
  });
});

describe('isValidBirthday', () => {
  it('accepts real day/month pairs including 29 February', () => {
    expect(isValidBirthday({ day: 29, month: 2 })).toBe(true);
    expect(isValidBirthday({ day: 31, month: 4 })).toBe(false);
    expect(isValidBirthday({ day: 1, month: 13 })).toBe(false);
    expect(isValidBirthday({ day: Number.NaN, month: 1 })).toBe(false);
  });
});

describe('dayInTimeZone', () => {
  it('uses the company day, not the UTC day', () => {
    // 20:00 UTC ngày 20/10 đã là 03:00 ngày 21/10 ở Việt Nam.
    expect(dayInTimeZone(new Date('2026-10-20T20:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-21');
    expect(dayInTimeZone(new Date('2026-10-20T20:00:00Z'), 'UTC')).toBe('2026-10-20');
  });
});

describe('window helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('ends the window on the last day of the Nth month counting the current one', () => {
    expect(endOfMonthWindow('2026-10-21', 1)).toBe('2026-10-31');
    expect(endOfMonthWindow('2026-12-21', 3)).toBe('2027-02-28');
    expect(endOfMonthWindow('2027-12-31', 12)).toBe('2028-11-30');
  });

  it('computes the turning age or nothing for absent or absurd birth years', () => {
    expect(ageAtOccurrence('2026-12-21', 1990)).toBe(36);
    expect(ageAtOccurrence('2026-12-21', undefined)).toBeUndefined();
    expect(ageAtOccurrence('2026-12-21', 2030)).toBeUndefined();
    expect(ageAtOccurrence('2026-12-21', 1800)).toBeUndefined();
  });
});
