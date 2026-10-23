import type { CoreChatMessagePayload } from '@enterprise-platform/contracts-chat';
import { ChatPushDispatcher, parseMessagePayload, pushMessageFor, vapidFromEnv } from './push-dispatcher.js';
import { pushConfig } from './push-config.js';

const RECIPIENT = '11111111-1111-4111-8111-111111111111';

const payload = (overrides: Partial<CoreChatMessagePayload> = {}): CoreChatMessagePayload => ({
  conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  conversationKind: 'group',
  conversationTitle: 'Kế toán',
  messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorName: 'Nguyễn Văn An',
  excerpt: 'Chào cả nhà',
  attachmentCount: 0,
  hasImage: false,
  mentionedUserIds: [],
  recipientUserIds: [RECIPIENT],
  ...overrides,
});

describe('cấu hình thông báo đẩy', () => {
  it('chỉ bật khi có đủ cặp khoá VAPID', () => {
    expect(pushConfig({})).toEqual({ enabled: false, publicKey: null });
    expect(pushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: 'pub' })).toEqual({ enabled: false, publicKey: null });
    expect(pushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: ' pub ', WEB_PUSH_VAPID_PRIVATE_KEY: 'priv' })).toEqual({ enabled: true, publicKey: 'pub' });
    expect(vapidFromEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: 'priv' })).toBeNull();
    expect(vapidFromEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: 'pub', WEB_PUSH_VAPID_PRIVATE_KEY: 'priv' })).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:admin@localhost',
    });
    expect(vapidFromEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: 'pub', WEB_PUSH_VAPID_PRIVATE_KEY: 'priv', WEB_PUSH_SUBJECT: 'https://erp.example.com' })?.subject).toBe(
      'https://erp.example.com',
    );
  });
});

describe('nội dung thông báo đẩy', () => {
  it('bỏ qua sự kiện thiếu trường bắt buộc hoặc sai loại cuộc trò chuyện', () => {
    expect(parseMessagePayload(null)).toBeNull();
    expect(parseMessagePayload({ ...payload(), messageId: '' })).toBeNull();
    expect(parseMessagePayload({ ...payload(), conversationKind: 'channel' })).toBeNull();
  });

  it('chuẩn hoá danh sách id: bỏ trùng, bỏ giá trị lạ, đưa về chữ thường', () => {
    const parsed = parseMessagePayload({ ...payload(), recipientUserIds: [RECIPIENT.toUpperCase(), RECIPIENT, 5, ''], actorName: '' });
    expect(parsed?.recipientUserIds).toEqual([RECIPIENT]);
    expect(parsed?.actorName).toBe('Đồng nghiệp');
  });

  it('tiêu đề ghi tên người gửi, tên nhóm hoặc kênh chung, và "nhắc đến bạn" cho người được nhắc', () => {
    expect(pushMessageFor(payload({ conversationKind: 'direct', conversationTitle: null }), RECIPIENT).title).toBe('Nguyễn Văn An');
    expect(pushMessageFor(payload(), RECIPIENT).title).toBe('Nguyễn Văn An · Kế toán');
    expect(pushMessageFor(payload({ conversationKind: 'company', mentionedUserIds: [RECIPIENT] }), RECIPIENT.toUpperCase()).title).toBe(
      'Nguyễn Văn An · Tất cả nội bộ nhắc đến bạn',
    );
  });

  it('tin không có chữ thì mô tả ảnh hoặc tệp đính kèm', () => {
    expect(pushMessageFor(payload({ excerpt: '', hasImage: true, attachmentCount: 1 }), RECIPIENT).body).toBe('Đã gửi một ảnh');
    expect(pushMessageFor(payload({ excerpt: '', hasImage: true, attachmentCount: 3 }), RECIPIENT).body).toBe('Đã gửi 3 ảnh');
    expect(pushMessageFor(payload({ excerpt: '', attachmentCount: 2 }), RECIPIENT).body).toBe('Đã gửi 2 tệp đính kèm');
  });

  it('mở đúng cuộc trò chuyện và dùng chung thẻ với thông báo trong trang để không hiện trùng', () => {
    const message = pushMessageFor(payload(), RECIPIENT);
    expect(message.url).toBe('/dashboard#chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(message.tag).toBe('ep-chat:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('chưa cấu hình VAPID hoặc không có người nhận thì không đụng tới DB', async () => {
    const db = { query: jest.fn() };
    await expect(new ChatPushDispatcher(null).handle(db as never, payload())).resolves.toEqual({ sent: 0, removed: 0, failed: 0 });
    await expect(
      new ChatPushDispatcher({ send: jest.fn() }).handle(db as never, payload({ recipientUserIds: [] })),
    ).resolves.toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(db.query).not.toHaveBeenCalled();
  });
});
