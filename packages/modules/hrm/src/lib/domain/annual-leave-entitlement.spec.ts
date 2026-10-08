import {
  addMonths,
  countsMonth,
  lastWorkingDayFromInactive,
  monthlyEntitlement,
  seniorityTierForMonth,
  sumEntitlement,
  validateSeniorityTiers,
  type AnnualLeavePolicy,
} from './annual-leave-entitlement.js';

const policy = (over: Partial<AnnualLeavePolicy> = {}): AnnualLeavePolicy => ({
  annualDays: 12,
  startOffsetMonths: 0,
  tiers: [],
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  ...over,
});
const counted = (months: ReturnType<typeof monthlyEntitlement>) =>
  months.filter((m) => m.counted).map((m) => m.month);

describe('annual leave entitlement', () => {
  it('counts a month only with at least 15 calendar days', () => {
    expect(countsMonth(2026, 3, '2026-03-10', null)).toBe(true);
    expect(countsMonth(2026, 3, '2026-03-17', null)).toBe(true); // 17..31 = 15 ngày
    expect(countsMonth(2026, 3, '2026-03-18', null)).toBe(false);
    expect(countsMonth(2026, 7, '2026-01-01', '2026-07-14')).toBe(false);
    expect(countsMonth(2026, 7, '2026-01-01', '2026-07-15')).toBe(true);
  });

  it('starts from the signing month when it has enough days', () => {
    expect(counted(monthlyEntitlement(policy(), '2026-03-10', 2026))).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(
      counted(monthlyEntitlement(policy(), '2026-03-20', 2026))[0],
    ).toBe(4);
  });

  it('delays the start by N months after signing', () => {
    const months = monthlyEntitlement(
      policy({ startOffsetMonths: 2 }),
      '2026-03-10',
      2026,
    );
    expect(counted(months)[0]).toBe(5);
    expect(sumEntitlement(months).total).toBe(8);
  });

  it('keeps the yearly total exact after rounding', () => {
    const months = monthlyEntitlement(
      policy({ annualDays: 14 }),
      '2020-01-01',
      2026,
    );
    expect(sumEntitlement(months).base).toBe(14);
    expect(months.every((m) => m.base === 1.17 || m.base === 1.16)).toBe(true);
    expect(sumEntitlement(months, 6).base).toBe(7);
  });

  it('applies the highest reached seniority tier from the milestone month', () => {
    const tiers = [
      { minYears: 5, bonusDays: 1 },
      { minYears: 10, bonusDays: 2 },
      { minYears: 15, bonusDays: 3 },
    ];
    // Ký 10/07/2016: đạt 10 năm ngày 10/07/2026 -> tháng 7 đủ 22 ngày.
    expect(seniorityTierForMonth('2016-07-10', 2026, 6, tiers)?.minYears).toBe(5);
    expect(seniorityTierForMonth('2016-07-10', 2026, 7, tiers)?.minYears).toBe(10);
    // Ký 20/07/2016: tháng 7 chỉ còn 12 ngày -> mốc 10 năm tính từ tháng 8.
    expect(seniorityTierForMonth('2016-07-20', 2026, 7, tiers)?.minYears).toBe(5);
    expect(seniorityTierForMonth('2016-07-20', 2026, 8, tiers)?.minYears).toBe(10);
    expect(seniorityTierForMonth('2025-01-01', 2026, 12, tiers)).toBeNull();

    const months = monthlyEntitlement(policy({ tiers }), '2016-07-10', 2026);
    // 6 tháng mốc 5 năm (1/12) + 6 tháng mốc 10 năm (2/12) = 0.5 + 1 = 1.5
    expect(sumEntitlement(months).seniority).toBe(1.5);
    expect(sumEntitlement(months).total).toBe(13.5);
  });

  it('stops at the termination month using the half-month rule', () => {
    expect(
      sumEntitlement(monthlyEntitlement(policy(), '2020-01-01', 2026, '2026-07-13'))
        .total,
    ).toBe(6);
    expect(
      sumEntitlement(monthlyEntitlement(policy(), '2020-01-01', 2026, '2026-07-19'))
        .total,
    ).toBe(7);
  });

  it('respects the schedule effective window', () => {
    const months = monthlyEntitlement(
      policy({ effectiveFrom: '2026-04-01', effectiveTo: '2026-09-30' }),
      '2020-01-01',
      2026,
    );
    expect(counted(months)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('handles month-end dates and inactive_from conversion', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2016-02-29', 120)).toBe('2026-02-28');
    expect(lastWorkingDayFromInactive('2026-08-01')).toBe('2026-07-31');
    expect(lastWorkingDayFromInactive(null)).toBeNull();
  });

  it('rejects duplicated or invalid tiers', () => {
    expect(() =>
      validateSeniorityTiers([
        { minYears: 5, bonusDays: 1 },
        { minYears: 5, bonusDays: 2 },
      ]),
    ).toThrow('trùng');
    expect(() => validateSeniorityTiers([{ minYears: 0, bonusDays: 1 }])).toThrow();
  });
});
