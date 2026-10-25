import { sliceSafe } from './safe-text';

const SMILE = '\u{1F600}';

describe('sliceSafe', () => {
  it('giu chuoi ngan va cat chuoi thuong dung vi tri', () => {
    expect(sliceSafe('abc', 5)).toBe('abc');
    expect(sliceSafe('abcdef', 3)).toBe('abc');
    expect(sliceSafe('abc', 0)).toBe('');
  });

  it('khong de lai nua cap thay the khi cat giua emoji', () => {
    expect(sliceSafe(`ab${SMILE}cd`, 3)).toBe('ab');
    expect(sliceSafe(`ab${SMILE}cd`, 4)).toBe(`ab${SMILE}`);
    expect(sliceSafe(SMILE, 1)).toBe('');
  });
});
