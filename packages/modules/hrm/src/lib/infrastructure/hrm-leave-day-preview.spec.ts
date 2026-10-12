import { leaveDayWeight } from './hrm-leave-day-preview.js';

describe('leaveDayWeight', () => {
  it('quy ca ngắn về nửa ngày, ca chuẩn về một ngày', () => {
    expect(leaveDayWeight(480)).toBe(1);
    expect(leaveDayWeight(450)).toBe(1);
    expect(leaveDayWeight(240)).toBe(0.5);
  });
  it('không âm hoặc không có ca thì bằng 0', () => {
    expect(leaveDayWeight(0)).toBe(0);
    expect(leaveDayWeight(-10)).toBe(0);
  });
});
