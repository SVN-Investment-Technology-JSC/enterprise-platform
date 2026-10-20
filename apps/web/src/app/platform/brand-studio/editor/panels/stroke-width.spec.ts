import { defaultStrokeWidth, isAllowedStrokeWidth, nearestAllowedStrokeWidth } from './stroke-width';

const ALLOWED = [1.5, 1.75, 2];

describe('độ dày nét theo quy chuẩn', () => {
  it('nhận độ dày trong bộ cho phép, có dung sai nhỏ', () => {
    expect(isAllowedStrokeWidth(1.75, ALLOWED)).toBe(true);
    expect(isAllowedStrokeWidth(1.7500001, ALLOWED)).toBe(true);
    expect(isAllowedStrokeWidth(1.6, ALLOWED)).toBe(false);
    expect(isAllowedStrokeWidth(1, [])).toBe(false);
  });

  it('tìm độ dày cho phép gần nhất', () => {
    expect(nearestAllowedStrokeWidth(1, ALLOWED)).toBe(1.5);
    expect(nearestAllowedStrokeWidth(3, ALLOWED)).toBe(2);
    expect(nearestAllowedStrokeWidth(1.8, ALLOWED)).toBe(1.75);
  });

  it('bộ trống thì giữ nguyên độ dày', () => {
    expect(nearestAllowedStrokeWidth(2.4, [])).toBe(2.4);
  });

  it('độ dày cho hình mới là mặc định của Studio hoặc giá trị gần nhất trong bộ', () => {
    expect(defaultStrokeWidth(ALLOWED)).toBe(1.75);
    expect(defaultStrokeWidth([1, 3])).toBe(1);
    expect(defaultStrokeWidth([2.5, 4])).toBe(2.5);
    expect(defaultStrokeWidth([1])).toBe(1);
  });
});
