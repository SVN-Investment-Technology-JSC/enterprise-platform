import { SocialValidationError } from './social.error.js';
import { buildLikePatterns, buildPrefixTsQuery, foldSearchText, normalizeSearchQuery } from './social-search-text.js';

describe('foldSearchText', () => {
  it('drops Vietnamese diacritics and case', () => {
    expect(foldSearchText('Nguyễn Đức Thắng')).toBe('nguyen duc thang');
    expect(foldSearchText('ĐƯỜNG')).toBe('duong');
  });
});

describe('normalizeSearchQuery', () => {
  it('folds, splits and de-duplicates terms', () => {
    expect(normalizeSearchQuery('  Họp  Tổng kết, họp  ')).toEqual({
      text: 'Họp  Tổng kết, họp',
      tokens: ['hop', 'tong', 'ket'],
    });
  });

  it('keeps only letters and digits so a term can never inject tsquery syntax', () => {
    const { tokens } = normalizeSearchQuery("a' | b:* & !c <-> (d)");
    expect(tokens).toEqual(['a', 'b', 'c', 'd']);
    expect(buildPrefixTsQuery(tokens)).toBe('a:* & b:* & c:* & d:*');
  });

  it('limits the number of terms', () => {
    expect(normalizeSearchQuery('a1 b2 c3 d4 e5 f6 g7').tokens).toHaveLength(5);
  });

  it('rejects too short, too long and symbol-only queries with a Vietnamese message', () => {
    expect(() => normalizeSearchQuery('a')).toThrow(SocialValidationError);
    expect(() => normalizeSearchQuery('x'.repeat(101))).toThrow('Từ khoá tìm kiếm cần từ 2 đến 100 ký tự.');
    expect(() => normalizeSearchQuery('!!')).toThrow('Từ khoá tìm kiếm cần có chữ hoặc số.');
    expect(() => normalizeSearchQuery(undefined)).toThrow(SocialValidationError);
  });

  it('builds LIKE patterns for group search', () => {
    expect(buildLikePatterns(['du', 'an'])).toEqual(['%du%', '%an%']);
  });
});
