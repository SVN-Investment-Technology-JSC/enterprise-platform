import { isUnassignedSunday } from './hrm-time';

describe('isUnassignedSunday', () => {
  it('Chủ nhật không ca, không lịch riêng: ngày trống', () => {
    expect(isUnassignedSunday('2026-10-18', null, false)).toBe(true);
    expect(isUnassignedSunday('2026-10-18', 'WORK', false)).toBe(true);
  });
  it('Chủ nhật đã phân ca hoặc có lịch riêng (lễ, nghỉ): không áp dụng', () => {
    expect(isUnassignedSunday('2026-10-18', null, true)).toBe(false);
    expect(isUnassignedSunday('2026-10-18', 'HOLIDAY', false)).toBe(false);
    expect(isUnassignedSunday('2026-10-18', 'OFF', false)).toBe(false);
  });
  it('ngày khác Chủ nhật chưa phân ca vẫn là thiếu ca', () => {
    expect(isUnassignedSunday('2026-10-19', null, false)).toBe(false);
    expect(isUnassignedSunday('2026-10-17', null, false)).toBe(false);
  });
});
