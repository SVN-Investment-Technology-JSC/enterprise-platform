import { matchesSearch, normalizeSearchText, SEARCH_TRANSLATE_FROM, SEARCH_TRANSLATE_TO, searchTerms } from './notification-search.js';

describe('notification search', () => {
  it('ignores case and Vietnamese diacritics', () => {
    expect(normalizeSearchText('Đơn NGHỈ phép của Nguyễn Văn Ạ')).toBe('don nghi phep cua nguyen van a');
  });

  it('splits the query into at most five terms', () => {
    expect(searchTerms('  Phê   duyệt ')).toEqual(['phe', 'duyet']);
    expect(searchTerms('a b c d e f g')).toHaveLength(5);
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('requires every term to appear in the title or body, in any order', () => {
    const record = { title: 'Có yêu cầu cần phê duyệt', body: 'Đơn nghỉ phép của Nguyễn Văn A' };
    expect(matchesSearch(record, 'phe duyet')).toBe(true);
    expect(matchesSearch(record, 'nghi phep nguyen')).toBe(true);
    expect(matchesSearch(record, 'duyet phe')).toBe(true);
    expect(matchesSearch(record, 'phe duyet bao tri')).toBe(false);
    expect(matchesSearch(record, '')).toBe(true);
  });

  it('exposes translation strings of equal length for the SQL translate() call', () => {
    expect(SEARCH_TRANSLATE_FROM.length).toBe(SEARCH_TRANSLATE_TO.length);
    expect(SEARCH_TRANSLATE_FROM).toContain('đ');
    expect(SEARCH_TRANSLATE_FROM).toContain('Đ');
    expect(SEARCH_TRANSLATE_FROM).not.toMatch(/['\\]/);
  });
});
