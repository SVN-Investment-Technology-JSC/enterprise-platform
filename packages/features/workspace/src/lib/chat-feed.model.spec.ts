import type { ProjectChatFeedItem, WorkItem } from '@enterprise-platform/contracts-workspace';
import { buildChatFeedRows, previewOf, splitByTerm } from './chat-feed.model';

const item = (id: string, parentId?: string): WorkItem =>
  ({ id, code: `CV-${id}`, title: `Việc ${id}`, parentId }) as unknown as WorkItem;

const entry = (workItemId: string, extra: Partial<ProjectChatFeedItem> = {}): ProjectChatFeedItem => ({
  workItemId,
  messageCount: 0,
  ...extra,
});

describe('buildChatFeedRows', () => {
  const items = [item('1'), item('2', '1'), item('3', '2'), item('4')];

  it('giữ nguyên thứ tự server và gắn thông tin công việc', () => {
    const rows = buildChatFeedRows(
      [entry('4', { messageCount: 1, latestAt: '2026-10-02' }), entry('1', { messageCount: 2, latestAt: '2026-10-01' })],
      items,
    );
    expect(rows.map((row) => row.item.id)).toEqual(['4', '1']);
    expect(rows[1].messageCount).toBe(2);
    expect(rows[0].latestAt).toBe('2026-10-02');
  });

  it('việc lồng nhiều cấp có chuỗi cha từ gốc xuống', () => {
    const [row] = buildChatFeedRows([entry('3')], items);
    expect(row.ancestors.map((ancestor) => ancestor.id)).toEqual(['1', '2']);
  });

  it('bỏ công việc không còn trong danh sách của dự án', () => {
    expect(buildChatFeedRows([entry('ghost'), entry('1')], items).map((row) => row.item.id)).toEqual(['1']);
  });
});

describe('previewOf', () => {
  const nameOf = (id: string) => (id === 'u1' ? 'An' : id);
  const [row] = buildChatFeedRows(
    [entry('1', { messageCount: 1, latestBy: 'u1', latestBody: 'xin   chào\nbạn' })],
    [item('1')],
  );

  it('tách tên người và nội dung, gộp khoảng trắng', () => {
    expect(previewOf(row, nameOf)).toEqual({ author: 'An', text: 'xin chào bạn' });
  });

  it('việc chưa có tin thì không có xem trước', () => {
    const [silent] = buildChatFeedRows([entry('1')], [item('1')]);
    expect(previewOf(silent, nameOf)).toBeUndefined();
  });
});

describe('splitByTerm', () => {
  it('tách và đánh dấu mọi chỗ khớp, không phân biệt hoa thường, giữ nguyên chữ gốc', () => {
    expect(splitByTerm('Gửi BÁO giá, báo giá lại', 'báo giá')).toEqual([
      { text: 'Gửi ', match: false },
      { text: 'BÁO giá', match: true },
      { text: ', ', match: false },
      { text: 'báo giá', match: true },
      { text: ' lại', match: false },
    ]);
  });

  it('từ khoá rỗng, toàn khoảng trắng hoặc không khớp thì trả nguyên chuỗi', () => {
    expect(splitByTerm('abc', undefined)).toEqual([{ text: 'abc', match: false }]);
    expect(splitByTerm('abc', '   ')).toEqual([{ text: 'abc', match: false }]);
    expect(splitByTerm('abc', 'xyz')).toEqual([{ text: 'abc', match: false }]);
  });

  it('chuỗi rỗng và khớp trọn chuỗi', () => {
    expect(splitByTerm('', 'a')).toEqual([{ text: '', match: false }]);
    expect(splitByTerm('abc', 'ABC')).toEqual([{ text: 'abc', match: true }]);
  });

  it('chữ đổi độ dài khi hạ chữ thường thì không tô sáng sai chỗ', () => {
    expect(splitByTerm('İstanbul', 'stan')).toEqual([{ text: 'İstanbul', match: false }]);
  });
});
