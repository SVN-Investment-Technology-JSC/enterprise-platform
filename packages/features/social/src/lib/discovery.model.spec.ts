import {
  birthdayCountdown,
  formatBirthday,
  formatDate,
  hasActiveFilters,
  highlightSegments,
  htmlToPlainText,
  isSearchable,
  normalizeQuery,
  presetRange,
  queryTerms,
  snippetAround,
  toQueryString,
  toSearchPostsQuery,
} from './discovery.model';

describe('từ khoá', () => {
  it('chuẩn hoá khoảng trắng và kiểm độ dài tối thiểu', () => {
    expect(normalizeQuery('  họp   tuần  ')).toBe('họp tuần');
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
  });

  it('gập dấu, bỏ trùng và giới hạn số từ', () => {
    expect(queryTerms('Đồng Hồ đồng')).toEqual(['dong', 'ho']);
    expect(queryTerms('a1 b2 c3 d4 e5 f6')).toHaveLength(5);
  });
});

describe('highlightSegments', () => {
  it('tô sáng không phân biệt dấu và hoa thường, giữ nguyên chữ gốc', () => {
    expect(highlightSegments('Họp tuần Đầu', 'hop dau')).toEqual([
      { text: 'Họp', match: true },
      { text: ' tuần ', match: false },
      { text: 'Đầu', match: true },
    ]);
  });

  it('không khớp hoặc từ khoá rỗng thì một đoạn thường', () => {
    expect(highlightSegments('abc', 'xyz')).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('abc', '')).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('', 'abc')).toEqual([]);
  });

  it('chuỗi giống thẻ HTML chỉ là chữ thuần', () => {
    const segments = highlightSegments('<b>x</b>', 'b');
    expect(segments.map((segment) => segment.text).join('')).toBe('<b>x</b>');
  });
});

describe('htmlToPlainText và snippetAround', () => {
  it('bỏ thẻ và giải mã thực thể thường gặp', () => {
    expect(htmlToPlainText('<p>A &amp; B</p><p>C&nbsp;D</p>')).toBe('A & B C D');
  });

  it('giữ nguyên đoạn ngắn, cắt đoạn dài quanh từ khoá', () => {
    expect(snippetAround('ngắn', 'ng')).toBe('ngắn');
    const long = `${'a '.repeat(100)}mục tiêu ${'b '.repeat(100)}`;
    const snippet = snippetAround(long, 'muc tieu', 80);
    expect(snippet).toContain('mục tiêu');
    expect(snippet.startsWith('…')).toBe(true);
  });
});

describe('bộ lọc', () => {
  const now = new Date('2026-05-20T00:00:00Z').getTime();

  it('khoảng thời gian có sẵn', () => {
    expect(presetRange('any', now)).toEqual({});
    expect(presetRange('7', now).from).toBe('2026-05-13T00:00:00.000Z');
  });

  it('dựng tham số tìm bài, bỏ giá trị rỗng', () => {
    expect(toSearchPostsQuery(' họp ', { preset: 'any' }, undefined, now)).toEqual({ q: 'họp' });
    expect(toSearchPostsQuery('họp', { preset: '30', topicId: 't', authorId: 'u' }, 'c', now)).toMatchObject({
      q: 'họp',
      topicId: 't',
      authorId: 'u',
      cursor: 'c',
    });
    expect(hasActiveFilters({ preset: 'any' })).toBe(false);
    expect(hasActiveFilters({ preset: 'any', groupId: 'g' })).toBe(true);
  });

  it('chuỗi truy vấn mã hoá và bỏ rỗng', () => {
    expect(toQueryString({ q: 'a b', limit: 5, x: undefined })).toBe('?q=a+b&limit=5');
    expect(toQueryString({})).toBe('');
  });
});

describe('sinh nhật và ngày', () => {
  it('định dạng ngày tháng không năm và đếm ngược', () => {
    expect(formatBirthday({ day: 5, month: 3 })).toBe('05/03');
    expect(birthdayCountdown(0)).toBe('Hôm nay');
    expect(birthdayCountdown(1)).toBe('Ngày mai');
    expect(birthdayCountdown(4)).toBe('Còn 4 ngày');
  });

  it('ngày sai thì rỗng', () => {
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('không phải ngày')).toBe('');
  });
});
