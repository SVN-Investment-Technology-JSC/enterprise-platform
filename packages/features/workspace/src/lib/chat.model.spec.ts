import type { ChatMessage } from '@enterprise-platform/contracts-workspace';
import { groupThread, mergeMessages } from './chat.model';

const msg = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channelId: 'c1',
  body: id,
  mentions: [],
  isEdited: false,
  isDeleted: false,
  createdBy: 'u',
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

describe('mergeMessages', () => {
  it('giữ các trang cũ đã tải khi trang mới nhất được tải lại', () => {
    const older = [msg('a', '2026-10-01T08:00:00.000Z'), msg('b', '2026-10-01T08:01:00.000Z')];
    const latest = [msg('c', '2026-10-01T09:00:00.000Z')];
    expect(mergeMessages(older, latest).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('tin trùng id lấy bản mới: đã sửa hoặc đã thu hồi', () => {
    const before = [msg('a', '2026-10-01T08:00:00.000Z')];
    const after = [
      msg('a', '2026-10-01T08:00:00.000Z', { body: '', isDeleted: true, isEdited: false }),
    ];
    const merged = mergeMessages(before, after);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ isDeleted: true, body: '' });
  });

  it('chèn trang cũ lên đầu và không lặp tin ở ranh giới', () => {
    const current = [msg('c', '2026-10-01T09:00:00.000Z'), msg('d', '2026-10-01T09:01:00.000Z')];
    const olderPage = [msg('a', '2026-10-01T08:00:00.000Z'), msg('c', '2026-10-01T09:00:00.000Z')];
    expect(mergeMessages(current, olderPage).map((m) => m.id)).toEqual(['a', 'c', 'd']);
  });

  it('cùng thời điểm thì sắp theo id để thứ tự ổn định', () => {
    const at = '2026-10-01T09:00:00.000Z';
    expect(mergeMessages([msg('b', at)], [msg('a', at)]).map((m) => m.id)).toEqual(['a', 'b']);
    expect(mergeMessages([msg('a', at)], [msg('b', at)]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('không sửa danh sách đầu vào', () => {
    const current = [msg('a', '2026-10-01T08:00:00.000Z')];
    mergeMessages(current, [msg('b', '2026-10-01T09:00:00.000Z')]);
    expect(current).toHaveLength(1);
  });
});

describe('groupThread', () => {
  it('xếp trả lời dưới tin gốc đã tải', () => {
    const list = [
      msg('root', '2026-10-01T08:00:00.000Z'),
      msg('reply', '2026-10-01T08:05:00.000Z', { parentId: 'root' }),
    ];
    const { roots, repliesOf } = groupThread(list);
    expect(roots.map((m) => m.id)).toEqual(['root']);
    expect(repliesOf('root').map((m) => m.id)).toEqual(['reply']);
  });

  it('trả lời mà tin gốc chưa tải vẫn hiện ra ở mức gốc, không biến mất', () => {
    const list = [msg('reply', '2026-10-01T08:05:00.000Z', { parentId: 'old-root' })];
    expect(groupThread(list).roots.map((m) => m.id)).toEqual(['reply']);
  });

  it('khi gốc được tải thì trả lời tự về đúng chỗ', () => {
    const list = [
      msg('old-root', '2026-10-01T07:00:00.000Z'),
      msg('reply', '2026-10-01T08:05:00.000Z', { parentId: 'old-root' }),
    ];
    const { roots, repliesOf } = groupThread(list);
    expect(roots.map((m) => m.id)).toEqual(['old-root']);
    expect(repliesOf('old-root').map((m) => m.id)).toEqual(['reply']);
  });
});
