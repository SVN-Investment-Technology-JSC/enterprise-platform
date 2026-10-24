import type { ChatMemberView, ChatMessageView, ChatPerson } from '@enterprise-platform/contracts-chat';
import {
  applyMention,
  canEdit,
  dayLabel,
  deliveryStatus,
  findMentionQuery,
  fold,
  keptMentions,
  mergeMessages,
  namePastedFile,
  previewText,
  splitBody,
  suggestPeople,
  systemText,
  threadItems,
} from './chat-model';
import { applyPresenceSignal, lastSeenLabel } from './presence';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const AN = 'aaaaaaaa-0000-4000-8000-000000000002';
const BINH = 'aaaaaaaa-0000-4000-8000-000000000003';

function message(over: Partial<ChatMessageView>): ChatMessageView {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: AN,
    kind: 'text',
    body: 'Xin chào',
    mentions: [],
    replyTo: null,
    attachments: [],
    reactions: [],
    systemEvent: null,
    clientId: null,
    isEdited: false,
    isDeleted: false,
    createdAt: '2026-10-23T08:00:00.000Z',
    updatedAt: '2026-10-23T08:00:00.000Z',
    ...over,
  };
}

const people: ChatPerson[] = [
  { id: ME, fullName: 'Hồ Thọ', email: 'tho@test.local', avatarVersion: null },
  { id: AN, fullName: 'Nguyễn Văn An', email: 'an@test.local', avatarVersion: 2 },
  { id: BINH, fullName: 'Trần Thị Bình', email: 'binh@test.local', avatarVersion: null },
];

describe('nhắc tên', () => {
  it('nhận ra "@" đang gõ ở đầu dòng hoặc sau khoảng trắng, cho phép tên nhiều tiếng', () => {
    expect(findMentionQuery('Chào @Ngu', 9)).toEqual({ start: 5, query: 'Ngu' });
    expect(findMentionQuery('@Nguyễn Văn', 11)).toEqual({ start: 0, query: 'Nguyễn Văn' });
    expect(findMentionQuery('email@test', 10)).toBeNull();
    expect(findMentionQuery('xong\n@', 6)).toEqual({ start: 5, query: '' });
    expect(findMentionQuery('@an\nkhác', 8)).toBeNull();
  });

  it('gợi ý không dấu, bỏ chính mình; chèn "@Họ Tên " và chỉ giữ người còn trong nội dung', () => {
    expect(suggestPeople(people, 'binh', { excludeId: ME }).map((p) => p.id)).toEqual([BINH]);
    expect(suggestPeople(people, '', { excludeId: ME }).map((p) => p.id)).toEqual([AN, BINH]);
    const next = applyMention('Chào @an', { start: 5, query: 'an' }, 8, 'Nguyễn Văn An');
    expect(next).toEqual({ text: 'Chào @Nguyễn Văn An ', caret: 20 });
    const picked = new Map([
      [AN, 'Nguyễn Văn An'],
      [BINH, 'Trần Thị Bình'],
    ]);
    expect(keptMentions('Chào @Nguyễn Văn An', picked)).toEqual([AN]);
  });

  it('tách nội dung thành chữ, lời nhắc (tên dài trước) và liên kết', () => {
    const segments = splitBody('@Nguyễn Văn An xem https://erp.test/a, nhé @Nguyễn', [{ id: AN, name: 'Nguyễn Văn An' }]);
    expect(segments).toEqual([
      { kind: 'mention', text: '@Nguyễn Văn An', userId: AN },
      { kind: 'text', text: ' xem ' },
      { kind: 'link', text: 'https://erp.test/a', href: 'https://erp.test/a' },
      { kind: 'text', text: ', nhé @Nguyễn' },
    ]);
    expect(fold('Đặng Thị Ánh')).toBe('dang thi anh');
  });
});

describe('dải tin', () => {
  it('gộp tin theo id (bản mới thắng) và sắp theo thời gian', () => {
    const a = message({ id: 'a', createdAt: '2026-10-23T08:00:00.000Z' });
    const b = message({ id: 'b', createdAt: '2026-10-23T08:01:00.000Z' });
    const edited = { ...a, body: 'Đã sửa', isEdited: true };
    expect(mergeMessages([b, a], [edited]).map((m) => [m.id, m.body])).toEqual([
      ['a', 'Đã sửa'],
      ['b', 'Xin chào'],
    ]);
  });

  it('chia mốc ngày, gom tin liền nhau của cùng người, tin hệ thống đứng riêng', () => {
    const now = new Date('2026-10-23T12:00:00');
    const items = threadItems(
      [
        message({ id: '1', createdAt: new Date('2026-10-22T09:00:00').toISOString() }),
        message({ id: '2', createdAt: new Date('2026-10-23T09:00:00').toISOString() }),
        message({ id: '3', createdAt: new Date('2026-10-23T09:02:00').toISOString() }),
        message({ id: '4', senderId: ME, createdAt: new Date('2026-10-23T09:03:00').toISOString() }),
        message({ id: '5', kind: 'system', systemEvent: { type: 'member.left' }, createdAt: new Date('2026-10-23T09:04:00').toISOString() }),
      ],
      now,
    );
    expect(items.map((item) => (item.kind === 'message' ? `${item.message.id}:${item.first ? 'F' : ''}${item.last ? 'L' : ''}` : item.kind === 'date' ? item.label : 'system'))).toEqual([
      'Hôm qua',
      '1:FL',
      'Hôm nay',
      '2:F',
      '3:L',
      '4:FL',
      'system',
    ]);
    expect(dayLabel(new Date('2026-10-01T09:00:00').toISOString(), now)).toBe('01/10/2026');
  });
});

describe('trạng thái tin của mình', () => {
  const sent = message({ senderId: ME, createdAt: '2026-10-23T08:00:00.000Z' });
  const member = (userId: string, read: string | null, delivered: string | null): ChatMemberView => ({ userId, role: 'member', lastReadAt: read, lastDeliveredAt: delivered });

  it('đã gửi, đã nhận, đã xem theo mốc của người khác (bỏ qua mốc của chính mình)', () => {
    expect(deliveryStatus(sent, [member(ME, '2026-10-23T08:00:00.000Z', '2026-10-23T08:00:00.000Z'), member(AN, null, null)], ME)).toEqual({ kind: 'sent' });
    expect(deliveryStatus(sent, [member(AN, null, '2026-10-23T08:00:00.000Z')], ME)).toEqual({ kind: 'delivered' });
    expect(deliveryStatus(sent, [member(AN, '2026-10-23T08:05:00.000Z', '2026-10-23T08:05:00.000Z'), member(BINH, '2026-10-23T07:00:00.000Z', null)], ME)).toEqual({
      kind: 'seen',
      readers: [AN],
    });
  });

  it('chỉ sửa được trong khung thời gian cho phép', () => {
    expect(canEdit(sent, 15, new Date('2026-10-23T08:14:00.000Z'))).toBe(true);
    expect(canEdit(sent, 15, new Date('2026-10-23T08:16:00.000Z'))).toBe(false);
  });
});

describe('chữ hiển thị', () => {
  const nameOf = (id: string) => people.find((p) => p.id === id)?.fullName ?? '?';

  it('dòng xem trước ở danh sách', () => {
    const base = { id: 'm', senderId: AN, kind: 'text' as const, excerpt: 'Họp lúc 9h', attachmentCount: 0, hasImage: false, isDeleted: false, systemEvent: null, createdAt: '' };
    expect(previewText(base, { me: ME, kind: 'direct', nameOf })).toBe('Họp lúc 9h');
    expect(previewText(base, { me: ME, kind: 'group', nameOf })).toBe('Nguyễn Văn An: Họp lúc 9h');
    expect(previewText({ ...base, senderId: ME }, { me: ME, kind: 'direct', nameOf })).toBe('Bạn: Họp lúc 9h');
    expect(previewText({ ...base, excerpt: '', hasImage: true, attachmentCount: 2 }, { me: ME, kind: 'direct', nameOf })).toBe('2 ảnh');
    expect(previewText({ ...base, isDeleted: true }, { me: ME, kind: 'group', nameOf })).toBe('Nguyễn Văn An đã thu hồi một tin nhắn');
    expect(previewText(null, { me: ME, kind: 'group', nameOf })).toBe('Chưa có tin nhắn');
  });

  it('tin hệ thống của nhóm', () => {
    expect(systemText({ type: 'members.added', userIds: [AN, BINH] }, 'Bạn', nameOf)).toBe('Bạn đã thêm Nguyễn Văn An, Trần Thị Bình vào nhóm');
    expect(systemText({ type: 'title.changed', title: 'Kế toán' }, 'An', nameOf)).toBe('An đã đổi tên nhóm thành "Kế toán"');
  });

  it('ảnh dán từ khay nhớ tạm được đặt tên riêng', () => {
    const pasted = namePastedFile(new File(['x'], 'image.png', { type: 'image/png' }), 0, new Date(2026, 9, 23, 8, 5, 9));
    expect(pasted.name).toBe('anh-dan-20261023-080509.png');
    const named = new File(['x'], 'bao-cao.pdf', { type: 'application/pdf' });
    expect(namePastedFile(named, 0)).toBe(named);
  });
});

describe('trạng thái trực tuyến', () => {
  it('áp tín hiệu vào và ra mạng', () => {
    let state = { online: new Set<string>(), lastSeen: new Map<string, string>() } as ReturnType<typeof applyPresenceSignal>;
    state = applyPresenceSignal(state, { userId: AN, online: true, lastSeenAt: null });
    expect([...state.online]).toEqual([AN]);
    state = applyPresenceSignal(state, { userId: AN, online: false, lastSeenAt: '2026-10-23T08:00:00.000Z' });
    expect(state.online.size).toBe(0);
    expect(state.lastSeen.get(AN)).toBe('2026-10-23T08:00:00.000Z');
  });

  it('nhãn "hoạt động ... trước"', () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    expect(lastSeenLabel(undefined, now)).toBe('Ngoại tuyến');
    expect(lastSeenLabel('2026-10-23T09:59:40.000Z', now)).toBe('Vừa mới hoạt động');
    expect(lastSeenLabel('2026-10-23T09:55:00.000Z', now)).toBe('Hoạt động 5 phút trước');
    expect(lastSeenLabel('2026-10-23T07:00:00.000Z', now)).toBe('Hoạt động 3 giờ trước');
    expect(lastSeenLabel('2026-10-22T09:00:00.000Z', now)).toBe('Hoạt động hôm qua');
  });
});
