import { categoryScrollTop, placePopover } from './emoji-position';
import { EMOJI_RECENT_LIMIT, pushRecentEmoji } from './emoji-preferences';
import { insertAtSelection } from './emoji-text';

const SMILE = '\u{1F600}';
const HEART = '\u{2764}\u{FE0F}';

describe('insertAtSelection', () => {
  it('chen tai con tro va dat con tro sau emoji (tinh theo UTF-16)', () => {
    expect(insertAtSelection('ab', 1, 1, SMILE)).toEqual({ text: `a${SMILE}b`, caret: 1 + SMILE.length });
  });

  it('thay the doan dang chon', () => {
    expect(insertAtSelection('abcd', 1, 3, HEART)).toEqual({ text: `a${HEART}d`, caret: 1 + HEART.length });
  });

  it('kep vi tri ngoai khoang va xu ly dao nguoc', () => {
    expect(insertAtSelection('ab', 99, 5, SMILE).text).toBe(`ab${SMILE}`);
    expect(insertAtSelection('ab', -3, -1, SMILE).text).toBe(`${SMILE}ab`);
    expect(insertAtSelection('abc', 2, 1, SMILE).text).toBe(`ab${SMILE}c`);
  });

  it('khong cat doi cap thay the cua emoji da co', () => {
    expect(insertAtSelection(SMILE, SMILE.length, SMILE.length, SMILE).text).toBe(`${SMILE}${SMILE}`);
  });
});

describe('pushRecentEmoji', () => {
  it('dua len dau, bo ban trung va cat theo gioi han', () => {
    expect(pushRecentEmoji(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    const long = Array.from({ length: EMOJI_RECENT_LIMIT }, (_, index) => `e${index}`);
    const next = pushRecentEmoji(long, 'new');
    expect(next).toHaveLength(EMOJI_RECENT_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`e${EMOJI_RECENT_LIMIT - 1}`);
  });
});

describe('placePopover', () => {
  const size = { width: 320, height: 372 };
  const viewport = { width: 1200, height: 800 };

  it('uu tien phia duoi khi du cho', () => {
    const rect = placePopover({ top: 100, bottom: 130, left: 500, right: 530 }, size, viewport);
    expect(rect.placement).toBe('below');
    expect(rect.top).toBe(136);
    expect(rect.left).toBe(210);
  });

  it('lat len tren khi duoi khong du va tren rong hon', () => {
    const rect = placePopover({ top: 700, bottom: 730, left: 500, right: 530 }, size, viewport);
    expect(rect.placement).toBe('above');
    expect(rect.top).toBe(700 - 6 - 372);
  });

  it('kep ngang vao khung nhin', () => {
    expect(placePopover({ top: 100, bottom: 130, left: 0, right: 20 }, size, viewport).left).toBe(8);
    expect(placePopover({ top: 100, bottom: 130, left: 1190, right: 1210 }, size, viewport).left).toBe(1200 - 320 - 8);
  });
});

describe('categoryScrollTop', () => {
  it('cong chieu cao tieu de va cac hang cua danh muc truoc', () => {
    expect(categoryScrollTop(0, 0, 36, 28)).toBe(0);
    expect(categoryScrollTop(2, 10, 36, 28)).toBe(2 * 28 + 10 * 36);
  });
});
