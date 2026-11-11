import type { MaintenanceOccurrence } from '@enterprise-platform/contracts-maintenance';
import { isDueWithinSevenDays, isOverdueOccurrence, matchesQuickFilter } from './occurrence-rules';

const NOW = new Date(2026, 10, 11, 10, 0, 0); // 11/11/2026 10:00 giờ máy

function occurrence(overrides: Partial<MaintenanceOccurrence>): MaintenanceOccurrence {
  return {
    id: 'o1',
    kind: 'preventive',
    title: 'Phiếu',
    assetCode: 'MBA-T1',
    dueAt: new Date(2026, 10, 11, 7, 0, 0).toISOString(),
    priority: 'Normal',
    status: 'planned',
    createdAt: new Date(2026, 9, 1).toISOString(),
    ...overrides,
  };
}

describe('occurrence rules', () => {
  it('hạn trong hôm nay chưa tính là quá hạn, hạn hôm qua thì có', () => {
    expect(isOverdueOccurrence(occurrence({}), NOW)).toBe(false);
    expect(isOverdueOccurrence(occurrence({ dueAt: new Date(2026, 10, 10, 23, 0, 0).toISOString() }), NOW)).toBe(true);
  });

  it('phiếu đã hoàn thành không bao giờ quá hạn; phiếu lỗi vẫn tính', () => {
    const old = new Date(2026, 8, 1).toISOString();
    expect(isOverdueOccurrence(occurrence({ dueAt: old, status: 'completed' }), NOW)).toBe(false);
    expect(isOverdueOccurrence(occurrence({ dueAt: old, status: 'failed' }), NOW)).toBe(true);
  });

  it('7 ngày tới gồm hôm nay đến hết ngày thứ 7, không gồm ngày thứ 8', () => {
    const at = (days: number) => occurrence({ dueAt: new Date(2026, 10, 11 + days, 12, 0, 0).toISOString() });
    expect(isDueWithinSevenDays(at(0), NOW)).toBe(true);
    expect(isDueWithinSevenDays(at(7), NOW)).toBe(true);
    expect(isDueWithinSevenDays(at(8), NOW)).toBe(false);
    expect(isDueWithinSevenDays(at(-1), NOW)).toBe(false);
  });

  it('"Giao cho tôi" chỉ gồm phiếu chưa đóng được giao cho đúng người xem', () => {
    const mine = occurrence({ assigneeId: 'u1' });
    expect(matchesQuickFilter(mine, 'mine', 'u1', NOW)).toBe(true);
    expect(matchesQuickFilter(mine, 'mine', 'u2', NOW)).toBe(false);
    expect(matchesQuickFilter({ ...mine, status: 'completed' }, 'mine', 'u1', NOW)).toBe(false);
    expect(matchesQuickFilter(occurrence({}), 'mine', '', NOW)).toBe(false);
  });

  it('"Tất cả" không lọc gì', () => {
    expect(matchesQuickFilter(occurrence({ status: 'completed' }), 'all', 'u1', NOW)).toBe(true);
  });
});
