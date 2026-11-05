import type { ProjectChatTimelineItem, WorkItem } from '@enterprise-platform/contracts-workspace';
import {
  buildTimelineRows,
  CHIP_HUES,
  chipHueMap,
  dayKeyOf,
  flattenTimelinePages,
  EMPTY_FILTER_DRAFT,
  isTimelineFilterActive,
  panelFilterCount,
  splitByQuery,
  splitTimeline,
  toTimelineFilter,
} from './chat-timeline.model';

const work = (id: string, parentId?: string): WorkItem =>
  ({ id, code: `CV-${id}`, title: `Việc ${id}`, parentId }) as unknown as WorkItem;

/** Giờ máy người xem, để kết quả không phụ thuộc múi giờ chạy test. */
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0).toISOString();

const msg = (
  id: string,
  entityId: string,
  createdAt: string,
  entityType: 'work_item' | 'project' = 'work_item',
): ProjectChatTimelineItem => ({
  message: { id, createdAt, body: id, createdBy: 'u1' } as ProjectChatTimelineItem['message'],
  entityType,
  entityId,
});

describe('buildTimelineRows', () => {
  const items = [work('A'), work('B', 'A'), work('C')];

  it('chèn vạch ngày khi sang ngày mới và giữ thứ tự thời gian', () => {
    const rows = buildTimelineRows(
      [msg('m1', 'A', at(2, 13)), msg('m2', 'B', at(2, 14)), msg('m3', 'C', at(3, 9))],
      items,
    );
    expect(rows.map((row) => (row.kind === 'day' ? `day:${row.day}` : row.entry.message.id))).toEqual([
      'day:2026-11-02',
      'm1',
      'm2',
      'day:2026-11-03',
      'm3',
    ]);
  });

  it('chỉ tin đầu mạch cùng công việc mang chip; xen việc khác thì chip hiện lại', () => {
    const rows = buildTimelineRows(
      [
        msg('a1', 'A', at(2, 13)),
        msg('a2', 'A', at(2, 14)),
        msg('c1', 'C', at(2, 15)),
        msg('a3', 'A', at(2, 16)),
      ],
      items,
    );
    const chips = rows.filter((row) => row.kind === 'message').map((row) => row.kind === 'message' && row.showChip);
    expect(chips).toEqual([true, false, true, true]);
  });

  it('sang ngày mới thì tin đầu ngày mang chip dù cùng công việc với tin cuối hôm trước', () => {
    const rows = buildTimelineRows([msg('a1', 'A', at(2, 23)), msg('a2', 'A', at(3, 8))], items);
    const messages = rows.filter((row) => row.kind === 'message');
    expect(messages.map((row) => row.kind === 'message' && row.showChip)).toEqual([true, true]);
  });

  it('gắn công việc và chuỗi cha; việc không còn trên màn hình hoặc chat chung thì không có công việc', () => {
    const rows = buildTimelineRows(
      [msg('b1', 'B', at(2, 13)), msg('x1', 'ghost', at(2, 14)), msg('p1', 'p1', at(2, 15), 'project')],
      items,
    );
    const messages = rows.filter((row) => row.kind === 'message');
    expect(messages[0].kind === 'message' && messages[0].work?.id).toBe('B');
    expect(messages[0].kind === 'message' && messages[0].ancestors.map((a) => a.id)).toEqual(['A']);
    expect(messages[1].kind === 'message' && messages[1].work).toBeUndefined();
    expect(messages[2].kind === 'message' && messages[2].work).toBeUndefined();
  });

  it('danh sách rỗng thì không có dòng nào', () => {
    expect(buildTimelineRows([], items)).toEqual([]);
  });
});

describe('flattenTimelinePages', () => {
  it('đảo trang (mới nhất đứng đầu) thành cũ → mới và bỏ tin trùng id', () => {
    const newest = { items: [msg('m3', 'A', at(2, 15)), msg('m4', 'A', at(2, 16))] };
    const older = { items: [msg('m1', 'A', at(2, 13)), msg('m2', 'A', at(2, 14)), msg('m3', 'A', at(2, 15))] };
    expect(flattenTimelinePages([newest, older]).map((entry) => entry.message.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
});

describe('dayKeyOf', () => {
  it('lấy ngày theo giờ máy, không theo UTC', () => {
    expect(dayKeyOf(new Date(2026, 10, 2, 23, 50).toISOString())).toBe('2026-11-02');
    expect(dayKeyOf(new Date(2026, 10, 3, 0, 5).toISOString())).toBe('2026-11-03');
  });
});

describe('chip màu và tách cột', () => {
  it('mỗi công việc đầu danh sách một sắc độ khác nhau, ổn định theo vị trí', () => {
    const hues = chipHueMap([work('a'), work('b'), work('c')]);
    expect(new Set([hues.get('a'), hues.get('b'), hues.get('c')]).size).toBe(3);
    expect(chipHueMap([work('a'), work('b'), work('c')]).get('b')).toBe(hues.get('b'));
  });

  it('quá số màu thì quay vòng', () => {
    const many = Array.from({ length: CHIP_HUES.length + 1 }, (_, index) => work(`w${index}`));
    const hues = chipHueMap(many);
    expect(hues.get(`w${CHIP_HUES.length}`)).toBe(hues.get('w0'));
  });

  it('tách tin chat chung khỏi tin công việc, giữ thứ tự', () => {
    const { work: left, project: right } = splitTimeline([
      msg('1', 'a', at(2, 9)),
      msg('2', 'p', at(2, 10), 'project'),
      msg('3', 'b', at(2, 11)),
    ]);
    expect(left.map((entry) => entry.message.id)).toEqual(['1', '3']);
    expect(right.map((entry) => entry.message.id)).toEqual(['2']);
  });
});

describe('bộ lọc', () => {
  it('bỏ giá trị rỗng: bộ lọc trống không có khoá nào', () => {
    expect(toTimelineFilter(EMPTY_FILTER_DRAFT)).toEqual({});
    expect(isTimelineFilterActive(toTimelineFilter({ ...EMPTY_FILTER_DRAFT, q: '   ' }))).toBe(false);
  });

  it('chỉ giữ ô đã điền; từ khoá được cắt khoảng trắng', () => {
    expect(
      toTimelineFilter({ ...EMPTY_FILTER_DRAFT, q: ' giá ', authors: ['u1', 'u2'], nodes: ['project'], mentionsMe: true, hasAttachment: true }),
    ).toEqual({ q: 'giá', authors: ['u1', 'u2'], nodes: ['project'], mentionsMe: true, hasAttachment: true });
  });

  it('đếm số nhóm lọc trong bảng: từ khoá và nhắc tôi không tính, hai ngày tính một', () => {
    expect(panelFilterCount({ ...EMPTY_FILTER_DRAFT, q: 'x', mentionsMe: true })).toBe(0);
    expect(
      panelFilterCount({ ...EMPTY_FILTER_DRAFT, authors: ['u1'], nodes: ['p'], fromDay: '2026-11-01', toDay: '2026-11-02', hasAttachment: true }),
    ).toBe(4);
  });

  it('"đến ngày" gồm cả ngày đó: mốc là 0h ngày kế tiếp theo giờ máy', () => {
    const filter = toTimelineFilter({ ...EMPTY_FILTER_DRAFT, fromDay: '2026-11-02', toDay: '2026-11-03' });
    expect(filter.from).toBe(new Date(2026, 10, 2).toISOString());
    expect(filter.to).toBe(new Date(2026, 10, 4).toISOString());
    expect(toTimelineFilter({ ...EMPTY_FILTER_DRAFT, fromDay: 'hôm qua' })).toEqual({});
  });

  it('tô sáng từ khoá không phân biệt hoa thường, ký tự đặc biệt hiểu theo nghĩa đen', () => {
    expect(splitByQuery('Báo GIÁ và báo giá', 'báo giá')).toEqual([
      { text: 'Báo GIÁ', match: true },
      { text: ' và ', match: false },
      { text: 'báo giá', match: true },
    ]);
    expect(splitByQuery('giảm 10% (nay)', '10% (')).toEqual([
      { text: 'giảm ', match: false },
      { text: '10% (', match: true },
      { text: 'nay)', match: false },
    ]);
    expect(splitByQuery('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
});
