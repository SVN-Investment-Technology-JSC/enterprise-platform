import type { ChatMessage } from '@enterprise-platform/contracts-workspace';
import {
  activeTypers,
  groupThread,
  mergeLatestPage,
  mergeMessages,
  nextTypingSignal,
  pruneTyping,
  seenByNewest,
  seenLabel,
  typingLabel,
  TYPING_TTL_MS,
  withReader,
  withTyping,
} from './chat.model';

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

describe('seenByNewest ("Đã xem bởi")', () => {
  const list = [
    msg('m1', '2026-10-01T08:00:00.000Z', { createdBy: 'author' }),
    msg('m2', '2026-10-01T09:00:00.000Z', { createdBy: 'author' }),
  ];

  it('chỉ tính người đã đọc tới đúng tin mới nhất', () => {
    const readers = [
      { userId: 'a', messageId: 'm2' },
      { userId: 'b', messageId: 'm1' },
      { userId: 'c' },
    ];
    expect(seenByNewest(list, readers, 'me')).toEqual(['a']);
  });

  it('loại người gửi tin và chính mình', () => {
    const readers = [
      { userId: 'author', messageId: 'm2' },
      { userId: 'me', messageId: 'm2' },
      { userId: 'a', messageId: 'm2' },
    ];
    expect(seenByNewest(list, readers, 'me')).toEqual(['a']);
  });

  it('luồng rỗng hoặc chưa ai đọc thì không có ai', () => {
    expect(seenByNewest([], [{ userId: 'a', messageId: 'm2' }], 'me')).toEqual([]);
    expect(seenByNewest(list, [], 'me')).toEqual([]);
  });

  it('nhiều người cùng chat: mỗi người một mốc, đọc tới đâu tính tới đó', () => {
    const readers = [
      { userId: 'a', messageId: 'm2' },
      { userId: 'b', messageId: 'm2' },
      { userId: 'c', messageId: 'm1' },
    ];
    expect(seenByNewest(list, readers, 'me')).toEqual(['a', 'b']);
  });
});

describe('withReader', () => {
  it('thay mốc cũ của người đó, giữ nguyên mốc của người khác', () => {
    const next = withReader(
      [
        { userId: 'a', messageId: 'm1' },
        { userId: 'b', messageId: 'm1' },
      ],
      'a',
      'm2',
    );
    expect(next).toEqual([
      { userId: 'b', messageId: 'm1' },
      { userId: 'a', messageId: 'm2' },
    ]);
  });

  it('thêm người chưa có mốc', () => {
    expect(withReader([], 'a', 'm1')).toEqual([{ userId: 'a', messageId: 'm1' }]);
  });
});

describe('seenLabel / typingLabel', () => {
  it('seenLabel rút gọn khi quá ba người', () => {
    expect(seenLabel([])).toBe('');
    expect(seenLabel(['A'])).toBe('Đã xem: A');
    expect(seenLabel(['A', 'B', 'C'])).toBe('Đã xem: A, B, C');
    expect(seenLabel(['A', 'B', 'C', 'D', 'E'])).toBe('Đã xem: A, B và 3 người khác');
  });

  it('typingLabel theo số người', () => {
    expect(typingLabel([])).toBe('');
    expect(typingLabel(['A'])).toBe('A đang nhập');
    expect(typingLabel(['A', 'B'])).toBe('A và B đang nhập');
    expect(typingLabel(['A', 'B', 'C', 'D'])).toBe('A, B và 2 người khác đang nhập');
  });
});

describe('bảng "đang nhập"', () => {
  const T0 = 1_000_000;

  it('có tín hiệu thì hiện, hết hạn thì tự mất', () => {
    const map = withTyping({}, 'a', true, T0);
    expect(activeTypers(map, T0 + 1_000)).toEqual(['a']);
    expect(activeTypers(map, T0 + TYPING_TTL_MS)).toEqual([]);
  });

  it('tín hiệu mới gia hạn thời gian', () => {
    let map = withTyping({}, 'a', true, T0);
    map = withTyping(map, 'a', true, T0 + 4_000);
    expect(activeTypers(map, T0 + 8_000)).toEqual(['a']);
  });

  it('báo ngừng thì bỏ ngay, kể cả chưa hết hạn; bỏ người không có thì giữ nguyên đối tượng', () => {
    const map = withTyping({}, 'a', true, T0);
    expect(activeTypers(withTyping(map, 'a', false, T0 + 100), T0 + 100)).toEqual([]);
    expect(withTyping(map, 'zzz', false, T0)).toBe(map);
  });

  it('nhiều người cùng gõ: giữ thứ tự bắt đầu', () => {
    let map = withTyping({}, 'a', true, T0);
    map = withTyping(map, 'b', true, T0 + 500);
    expect(activeTypers(map, T0 + 600)).toEqual(['a', 'b']);
  });

  it('pruneTyping bỏ mục hết hạn và trả lại đúng đối tượng cũ khi không đổi', () => {
    const map = withTyping(withTyping({}, 'a', true, T0), 'b', true, T0 + 4_000);
    expect(pruneTyping(map, T0 + 1_000)).toBe(map);
    expect(Object.keys(pruneTyping(map, T0 + 6_000))).toEqual(['b']);
  });
});

describe('nextTypingSignal (khi nào báo lên máy chủ)', () => {
  const idle = { typing: false, at: 0 };

  it('ô trống từ đầu thì không báo gì', () => {
    expect(nextTypingSignal(idle, false, 1_000).send).toBeUndefined();
  });

  it('bắt đầu gõ thì báo ngay một lần', () => {
    const first = nextTypingSignal(idle, true, 1_000);
    expect(first.send).toBe(true);
    expect(first.state).toEqual({ typing: true, at: 1_000 });
  });

  it('đang gõ liên tục: chỉ nhắc lại sau mỗi 3 giây, không báo mỗi phím', () => {
    let state = nextTypingSignal(idle, true, 1_000).state;
    const sends: boolean[] = [];
    for (let t = 1_100; t <= 8_000; t += 100) {
      const step = nextTypingSignal(state, true, t);
      if (step.send !== undefined) sends.push(step.send);
      state = step.state;
    }
    // 4,0s, 7,0s: hai lần nhắc lại trong 7 giây gõ.
    expect(sends).toEqual([true, true]);
  });

  it('xoá hết nội dung thì báo ngừng đúng một lần', () => {
    const typing = { typing: true, at: 1_000 };
    const stop = nextTypingSignal(typing, false, 1_500);
    expect(stop.send).toBe(false);
    expect(nextTypingSignal(stop.state, false, 1_600).send).toBeUndefined();
  });
});

describe('mergeLatestPage (trang 10 tin, không để lỗ hổng)', () => {
  const at = (n: number) => `2026-10-01T08:${String(n).padStart(2, '0')}:00.000Z`;
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => msg(`m${from + i}`, at(from + i)));
  const ids = (list: readonly ChatMessage[]) => list.map((m) => m.id);

  it('trang mới nhất chạm tới tin đang có thì gộp bình thường, giữ các trang cũ đã tải', () => {
    const current = range(1, 10);
    const result = mergeLatestPage(current, range(8, 12), true);
    expect(result.reset).toBe(false);
    expect(ids(result.messages)).toEqual(range(1, 12).map((m) => m.id));
  });

  it('nhiều hơn một trang tin đến: không chạm tới tin đang có thì thay hẳn, không thiếu tin ở giữa', () => {
    const current = range(1, 10);
    const page = range(21, 30); // tin 11..20 đến trong lúc chờ, nằm ngoài trang mới nhất
    const result = mergeLatestPage(current, page, true);
    expect(result.reset).toBe(true);
    expect(result.messages).toBe(page);
  });

  it('trang đã là toàn bộ luồng (hết tin cũ) thì gộp, không cần thay', () => {
    const result = mergeLatestPage(range(1, 3), range(5, 7), false);
    expect(result.reset).toBe(false);
    expect(ids(result.messages)).toEqual(['m1', 'm2', 'm3', 'm5', 'm6', 'm7']);
  });

  it('chưa có tin nào thì lấy nguyên trang, không coi là thay thế', () => {
    const page = range(1, 10);
    const result = mergeLatestPage([], page, true);
    expect(result.reset).toBe(false);
    expect(ids(result.messages)).toEqual(ids(page));
  });

  it('tin đã sửa hoặc thu hồi trong phần chồng nhau lấy bản mới', () => {
    const current = range(1, 3);
    const page = [msg('m3', at(3), { isDeleted: true, body: '' }), msg('m4', at(4))];
    const result = mergeLatestPage(current, page, true);
    expect(result.reset).toBe(false);
    expect(result.messages.find((m) => m.id === 'm3')?.isDeleted).toBe(true);
    expect(ids(result.messages)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('trang trống thì giữ nguyên danh sách', () => {
    const current = range(1, 3);
    expect(ids(mergeLatestPage(current, [], false).messages)).toEqual(ids(current));
  });
});
