import { sliceSafe } from './safe-text.js';

const SMILE = '\u{1F600}';
// Nửa cặp thay thế mồ côi (thay cho `isWellFormed`, chưa có trong thư viện kiểu của TypeScript đang dùng).
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe('sliceSafe', () => {
  it('giu nguyen chuoi ngan hon gioi han', () => {
    expect(sliceSafe('abc', 5)).toBe('abc');
    expect(sliceSafe(`a${SMILE}`, 3)).toBe(`a${SMILE}`);
  });

  it('cat chuoi thuong dung vi tri', () => {
    expect(sliceSafe('abcdef', 3)).toBe('abc');
    expect(sliceSafe('abc', 0)).toBe('');
  });

  it('khong de lai nua cap thay the khi cat giua emoji', () => {
    expect(sliceSafe(`ab${SMILE}cd`, 3)).toBe('ab');
    expect(sliceSafe(`ab${SMILE}cd`, 4)).toBe(`ab${SMILE}`);
    expect(sliceSafe(`${SMILE}${SMILE}`, 1)).toBe('');
  });

  it('ket qua luon la chuoi hop le (khong co surrogate mo coi)', () => {
    const text = `x${SMILE}`.repeat(10);
    for (let max = 0; max <= text.length; max += 1) {
      expect(sliceSafe(text, max)).not.toMatch(LONE_SURROGATE);
    }
  });
});
