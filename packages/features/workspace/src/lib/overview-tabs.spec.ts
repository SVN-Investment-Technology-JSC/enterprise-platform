import { parseStoredTab } from './overview-tabs';

describe('parseStoredTab', () => {
  it('trả tab đã lưu của đúng công việc', () => {
    expect(parseStoredTab('a|documents', 'a')).toBe('documents');
  });

  it('việc khác, giá trị lạ hoặc rỗng thì về Chi tiết', () => {
    expect(parseStoredTab('b|documents', 'a')).toBe('chat');
    expect(parseStoredTab('a|nope', 'a')).toBe('chat');
    expect(parseStoredTab(null, 'a')).toBe('chat');
  });

  it('tab "Hồ sơ liên kết" đã bỏ (nội dung nằm trong Chi tiết) nên giá trị đã lưu cũ về Chi tiết', () => {
    expect(parseStoredTab('a|links', 'a')).toBe('chat');
  });
});
