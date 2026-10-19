import {
  entitlementOf,
  mergeMonths,
  usableFrom,
  type ContractSchedule,
} from './hrm-annual-leave';
import { monthlyEntitlement } from '../domain/annual-leave-entitlement';

const schedule = (over: Partial<ContractSchedule['policy']> = {}, advance = false): ContractSchedule => ({
  id: 's1',
  leaveTypeId: 'lt',
  advanceAllowed: advance,
  policy: {
    annualDays: 12,
    startOffsetMonths: 0,
    tiers: [
      { minYears: 5, bonusDays: 1 },
      { minYears: 10, bonusDays: 2 },
    ],
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...over,
  },
});
const total = (e: ReturnType<typeof entitlementOf>) =>
  e.months.reduce((n, m) => n + m.base + m.seniority, 0);

describe('entitlementOf (tính phép theo ngày ký HĐLĐ)', () => {
  it('không có lịch theo HĐ: không có chính sách, mọi tháng bằng 0', () => {
    const e = entitlementOf([], '2020-01-01', 2026, null);
    expect(e.hasPolicy).toBe(false);
    expect(total(e)).toBe(0);
  });

  it('chưa có ngày ký HĐLĐ: có chính sách nhưng không phát sinh phép', () => {
    const e = entitlementOf([schedule()], null, 2026, null);
    expect(e.hasPolicy).toBe(true);
    expect(e.signDate).toBeNull();
    expect(total(e)).toBe(0);
  });

  it('ký từ nhiều năm trước: đủ 12 ngày; thâm niên theo mốc cao nhất đạt trong năm', () => {
    // Ký 10/07/2016: 5 năm +1 từ tháng 1; lên mốc 10 năm từ tháng 7 (tổng +2, cộng thêm phần chênh +1).
    const e = entitlementOf([schedule()], '2016-07-10', 2026, null);
    expect(e.months.reduce((n, m) => n + m.base, 0)).toBe(12);
    expect(e.months[0].seniority).toBe(1);
    expect(e.months[6].seniority).toBe(1);
    expect(e.months.reduce((n, m) => n + m.seniority, 0)).toBe(2);
    expect(e.startDate).toBe('2016-07-10');
  });

  it('ký giữa năm: tháng ký được tính (từ ngày bất kỳ), các tháng trước không có', () => {
    const e = entitlementOf([schedule()], '2026-03-31', 2026, null);
    expect(e.months.filter((m) => m.counted).map((m) => m.month)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(total(e)).toBe(10);
  });

  it('bắt đầu hưởng sau N tháng kể từ ngày ký', () => {
    const e = entitlementOf([schedule({ startOffsetMonths: 2 })], '2026-03-10', 2026, null);
    expect(e.startDate).toBe('2026-05-10');
    expect(e.months.filter((m) => m.counted).map((m) => m.month)[0]).toBe(5);
    expect(total(e)).toBe(8);
  });

  it('nghỉ việc: dừng ở tháng của ngày làm việc cuối', () => {
    const e = entitlementOf([schedule()], '2020-01-01', 2026, '2026-07-09');
    // 7 tháng định mức (tháng 7 làm 9 ngày vẫn được tính) + 1 thâm niên (mốc 5 năm).
    expect(e.months.reduce((n, m) => n + m.base, 0)).toBe(7);
    expect(total(e)).toBe(8);
  });

  it('chính sách bắt đầu hiệu lực giữa năm (dữ liệu cũ): không tính các tháng trước hiệu lực', () => {
    const e = entitlementOf([schedule({ effectiveFrom: '2026-07-01' })], '2020-01-01', 2026, null);
    expect(e.months.reduce((n, m) => n + m.base, 0)).toBe(6);
  });
});

describe('mergeMonths (nhiều phiên bản lịch trong năm)', () => {
  it('cộng định mức các phiên bản và không cộng trùng thâm niên', () => {
    const signDate = '2016-01-01';
    const first = monthlyEntitlement(schedule({ effectiveTo: '2026-06-30' }).policy, signDate, 2026);
    const second = monthlyEntitlement(schedule({ annualDays: 24, effectiveFrom: '2026-07-01' }).policy, signDate, 2026);
    const merged = mergeMonths([first, second]);
    // 6 tháng x 1 + 6 tháng x 2 = 18; thâm niên mốc 10 năm (+2) chỉ cộng một lần.
    expect(merged.reduce((n, m) => n + m.base, 0)).toBe(18);
    expect(merged.reduce((n, m) => n + m.seniority, 0)).toBe(2);
  });
});

describe('usableFrom (phần quỹ được dùng)', () => {
  const ent = (advance: boolean) => entitlementOf([schedule({}, advance)], '2016-07-10', 2026, null);

  it('không cho ứng: chỉ tới tháng hiện tại, trừ phần đã ghi sổ', () => {
    // Tới tháng 10: 10 định mức + 2 thâm niên = 12.
    const u = usableFrom(ent(false), 2026, 5, '2026-10-08');
    expect(u).toMatchObject({ extra: 7, projected: 14, projectedSeniority: 2, advanceAllowed: false });
  });

  it('cho ứng: tới hết năm', () => {
    expect(usableFrom(ent(true), 2026, 5, '2026-10-08').extra).toBe(9);
  });

  it('năm sau: không cho ứng thì chưa dùng được; cho ứng thì dùng cả năm', () => {
    expect(usableFrom(entitlementOf([schedule()], '2016-07-10', 2027, null), 2027, 0, '2026-10-08').extra).toBe(0);
    expect(usableFrom(entitlementOf([schedule({}, true)], '2016-07-10', 2027, null), 2027, 0, '2026-10-08').extra).toBeGreaterThan(0);
  });

  it('sổ đã ghi nhiều hơn chính sách: không âm', () => {
    expect(usableFrom(ent(false), 2026, 99, '2026-10-08').extra).toBe(0);
  });

  it('loại nghỉ không có lịch: không cộng thêm', () => {
    expect(usableFrom(entitlementOf([], null, 2026, null), 2026, 0, '2026-10-08')).toEqual({
      extra: 0,
      projected: null,
      projectedSeniority: 0,
      advanceAllowed: false,
      entitledToDate: null,
    });
  });
});
