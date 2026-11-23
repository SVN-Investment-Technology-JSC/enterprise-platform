import { parseStoredTab, resolveOverviewTab } from './overview-tabs';

describe('parseStoredTab', () => {
  it('trả tab đã lưu của đúng công việc', () => {
    expect(parseStoredTab('a|documents', 'a')).toBe('documents');
  });

  it('việc khác, giá trị lạ hoặc rỗng thì về Chi tiết', () => {
    expect(parseStoredTab('b|documents', 'a')).toBe('detail');
    expect(parseStoredTab('a|nope', 'a')).toBe('detail');
    expect(parseStoredTab(null, 'a')).toBe('detail');
  });
});

describe('resolveOverviewTab', () => {
  it('tab links không còn thì quy về detail', () => {
    expect(resolveOverviewTab('links', false)).toBe('detail');
  });

  it('giữ nguyên tab links khi có hồ sơ liên kết và các tab khác', () => {
    expect(resolveOverviewTab('links', true)).toBe('links');
    expect(resolveOverviewTab('progress', false)).toBe('progress');
  });
});
