import {
  buildMyWorkSearch,
  highlightRanges,
  normaliseQuery,
  normaliseSearchText,
  resolvePersonIds,
  splitHighlight,
} from './my-work-search';

describe('my-work-search', () => {
  it('chuẩn hoá bỏ dấu, đ thành d, gộp khoảng trắng', () => {
    expect(normaliseSearchText('  Đặng   Thị Hồng ')).toBe('dang thi hong');
  });

  it('cắt chữ tìm ở 100 ký tự', () => {
    expect(normaliseQuery('a'.repeat(150))).toHaveLength(100);
  });

  it('tra id người theo tên chứa trọn chữ tìm', () => {
    const people = [
      { userId: 'u1', displayName: 'Nguyễn Văn Đạt' },
      { userId: 'u2', displayName: 'Trần Thị Lan' },
    ];
    expect(resolvePersonIds(people, 'van dat')).toEqual(['u1']);
    expect(resolvePersonIds(people, '   ')).toEqual([]);
  });

  it('buildMyWorkSearch bỏ personIds khi không tìm theo người', () => {
    const people = [{ userId: 'u1', displayName: 'Lan' }];
    expect(buildMyWorkSearch('  ', ['title'], people)).toBeUndefined();
    expect(buildMyWorkSearch('lan', ['title'], people)?.personIds).toBeUndefined();
    expect(buildMyWorkSearch('lan', ['title', 'people'], people)?.personIds).toEqual(['u1']);
  });

  it('tô đậm đúng vị trí trên chuỗi gốc có dấu', () => {
    const segments = splitHighlight('Đặt hàng mới', ['dat']);
    expect(segments).toEqual([
      { text: 'Đặt', hit: true },
      { text: ' hàng mới', hit: false },
    ]);
  });

  it('gộp các khoảng chồng nhau', () => {
    expect(highlightRanges('abcd', ['abc', 'bcd'])).toEqual([[0, 4]]);
  });

  it('dấu tổ hợp (NFD) vẫn khớp chỉ số', () => {
    const text = 'Cong viec'.replace('o', 'ô');
    const ranges = highlightRanges(text, ['cong']);
    expect(text.slice(ranges[0][0], ranges[0][1])).toBe('Công');
  });

  it('dấu tổ hợp rời ở cuối phần khớp vẫn nằm trong phần tô', () => {
    const text = 'Các loai';
    const ranges = highlightRanges(text, ['ca']);
    expect(text.slice(ranges[0][0], ranges[0][1])).toBe('Cá');
  });
});
