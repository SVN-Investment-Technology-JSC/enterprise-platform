import { MAX_MENTION_RECIPIENTS, sanitizeMentions } from './procedure-mentions.js';

describe('sanitizeMentions', () => {
  it('giữ id hợp lệ, bỏ trùng và khoảng trắng thừa, giữ nguyên thứ tự', () => {
    expect(
      sanitizeMentions(['user-a', ' user-b ', 'user-a', '26b47afc-6d35-4809-b36a-28db731a1c5c']),
    ).toEqual(['user-a', 'user-b', '26b47afc-6d35-4809-b36a-28db731a1c5c']);
  });

  it('bỏ phần tử không phải chuỗi hoặc sai dạng (khoảng trắng, ký tự lạ, rỗng, quá dài)', () => {
    expect(
      sanitizeMentions([
        'ok',
        '',
        '  ',
        'a b',
        "x'; DROP",
        '<script>',
        42,
        null,
        { id: 'x' },
        'a'.repeat(101),
      ]),
    ).toEqual(['ok']);
  });

  it('không phải mảng hoặc không còn gì hợp lệ thì trả undefined (không lưu danh sách rỗng)', () => {
    expect(sanitizeMentions(undefined)).toBeUndefined();
    expect(sanitizeMentions('user-a')).toBeUndefined();
    expect(sanitizeMentions([])).toBeUndefined();
    expect(sanitizeMentions(['a b', ''])).toBeUndefined();
  });

  it('chặn nhắc hàng loạt: tối đa MAX_MENTION_RECIPIENTS người', () => {
    const many = Array.from({ length: MAX_MENTION_RECIPIENTS + 15 }, (_, i) => `user-${i}`);
    expect(sanitizeMentions(many)).toHaveLength(MAX_MENTION_RECIPIENTS);
    expect(sanitizeMentions(many)?.[0]).toBe('user-0');
  });
});
