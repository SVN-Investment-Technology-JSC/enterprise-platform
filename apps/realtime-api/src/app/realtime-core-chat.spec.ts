import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { PermanentMessageError } from '@enterprise-platform/adapter-events';
import {
  HttpCoreChatTypingClient,
  parseCoreChatTypingMessage,
  RealtimeCoreChatTyping,
  type CoreChatTypingRecipientsClient,
} from './realtime-core-chat-typing';
import { RealtimeDeliveryHandler } from './realtime-delivery';

const CONVERSATION = '22222222-2222-4222-8222-222222222222';

describe('core.chat.changed delivery', () => {
  const chatEvent = (payload: Record<string, unknown>): IntegrationEventEnvelope => ({
    id: '10000000-0000-4000-8000-000000000009',
    type: 'core.chat.changed',
    version: 1,
    occurredAt: '2026-10-23T00:00:00.000Z',
    tenantId: 'tenant-a',
    source: 'platform-chat',
    correlationId: 'c-1',
    payload: {
      conversationId: CONVERSATION,
      messageId: 'message-1',
      change: 'message.created',
      actorUserId: 'user-actor',
      audience: 'members',
      recipientUserIds: ['user-a', 'user-b'],
      ...payload,
    },
  });

  it('gửi tín hiệu chỉ mang id vào phòng cá nhân của từng thành viên, không gửi người làm', async () => {
    const gateway = { emitUserEvent: jest.fn(), emitRoomEvent: jest.fn() };
    const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
    await handler.handle(chatEvent({ recipientUserIds: ['user-a', 'user-actor', 'user-b', 'user-a'] }));
    expect(gateway.emitRoomEvent).not.toHaveBeenCalled();
    expect(gateway.emitUserEvent.mock.calls.map(([event]) => event.userId)).toEqual(['user-a', 'user-b']);
    expect(gateway.emitUserEvent).toHaveBeenCalledWith({
      id: '10000000-0000-4000-8000-000000000009:user-a',
      event: 'core.chat.changed',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 1,
      occurredAt: '2026-10-23T00:00:00.000Z',
      data: { conversationId: CONVERSATION, messageId: 'message-1', change: 'message.created', actorUserId: 'user-actor' },
    });
  });

  it('cuộc chung toàn công ty: một bao thư vào phòng của công ty, mang người làm ở userId', async () => {
    const gateway = { emitUserEvent: jest.fn(), emitRoomEvent: jest.fn() };
    const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
    await handler.handle(chatEvent({ audience: 'company', recipientUserIds: [], messageId: null, change: 'conversation.updated' }));
    expect(gateway.emitUserEvent).not.toHaveBeenCalled();
    expect(gateway.emitRoomEvent).toHaveBeenCalledWith(
      'tenant:tenant-a',
      expect.objectContaining({ id: '10000000-0000-4000-8000-000000000009', userId: 'user-actor', event: 'core.chat.changed', data: expect.objectContaining({ messageId: null }) }),
    );
  });

  it.each([
    ['loại thay đổi lạ', { change: 'message.pinned' }],
    ['thiếu cuộc trò chuyện', { conversationId: '' }],
    ['đối tượng nhận lạ', { audience: 'everyone' }],
    ['danh sách người nhận không phải mảng', { recipientUserIds: 'user-a' }],
  ])('đẩy vào hàng lỗi khi payload sai: %s', async (_label, payload) => {
    const gateway = { emitUserEvent: jest.fn(), emitRoomEvent: jest.fn() };
    const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
    await expect(handler.handle(chatEvent(payload))).rejects.toBeInstanceOf(PermanentMessageError);
  });
});

describe('core chat typing', () => {
  const principal = { tenantId: 'tenant-a', userId: 'user-typist', sessionId: 's-1' } as unknown as TenantUserPrincipal;

  function setup(answer: Awaited<ReturnType<CoreChatTypingRecipientsClient['recipients']>> | 'fail') {
    let clock = 1_000_000;
    const client: CoreChatTypingRecipientsClient = {
      recipients: jest.fn(async () => {
        if (answer === 'fail') throw new Error('down');
        return answer;
      }),
    };
    const typing = new RealtimeCoreChatTyping(client, true, () => clock);
    const users: RealtimeEventEnvelope[] = [];
    const company: { event: RealtimeEventEnvelope; except: string }[] = [];
    const send = (raw: unknown, socketId = 'socket-1') =>
      typing.handle(principal, socketId, 'ep_access=token', raw, {
        user: async (event) => {
          users.push(event);
        },
        company: async (event, except) => {
          company.push({ event, except });
        },
      });
    return { client, users, company, send, advance: (ms: number) => (clock += ms) };
  }

  it('đọc tin client gửi lên, bỏ qua tin sai dạng', () => {
    expect(parseCoreChatTypingMessage({ conversationId: CONVERSATION, typing: true })).toEqual({ conversationId: CONVERSATION, typing: true });
    expect(parseCoreChatTypingMessage({ conversationId: 'x', typing: true })).toBeUndefined();
    expect(parseCoreChatTypingMessage({ conversationId: CONVERSATION, typing: 'yes' })).toBeUndefined();
    expect(parseCoreChatTypingMessage(null)).toBeUndefined();
  });

  it('gửi cho từng thành viên trừ người gõ; người gõ lấy từ phiên', async () => {
    const { users, send } = setup({ audience: 'members', userIds: ['user-a', 'user-typist', 'user-b'] });
    await send({ conversationId: CONVERSATION, typing: true });
    expect(users.map((event) => event.userId)).toEqual(['user-a', 'user-b']);
    expect(users[0]).toMatchObject({ event: 'core.chat.typing', data: { conversationId: CONVERSATION, userId: 'user-typist', typing: true } });
  });

  it('cuộc chung: gửi cho mọi phiên của công ty trừ chính socket đang gõ', async () => {
    const { company, users, send } = setup({ audience: 'company' });
    await send({ conversationId: CONVERSATION, typing: false }, 'socket-9');
    expect(users).toEqual([]);
    expect(company).toEqual([{ event: expect.objectContaining({ userId: 'user-typist', data: expect.objectContaining({ typing: false }) }), except: 'socket-9' }]);
  });

  it('giới hạn tần suất, nhớ tạm người nhận, không có quyền thì không gửi', async () => {
    const allowed = setup({ audience: 'members', userIds: ['user-a'] });
    await allowed.send({ conversationId: CONVERSATION, typing: true });
    await allowed.send({ conversationId: CONVERSATION, typing: true });
    expect(allowed.users).toHaveLength(1);
    allowed.advance(1_000);
    await allowed.send({ conversationId: CONVERSATION, typing: true });
    expect(allowed.users).toHaveLength(2);
    expect(allowed.client.recipients).toHaveBeenCalledTimes(1);

    const denied = setup(null);
    await denied.send({ conversationId: CONVERSATION, typing: true });
    expect(denied.users).toEqual([]);
    const failing = setup('fail');
    await failing.send({ conversationId: CONVERSATION, typing: true });
    expect(failing.users).toEqual([]);
  });

  it('client HTTP chỉ chuyển cookie ep_access tới core API và hiểu hai loại người nhận', async () => {
    const fetcher = jest.fn(async () => ({ ok: true, json: async () => ({ audience: 'members', userIds: ['user-a', 3] }) }));
    const client = new HttpCoreChatTypingClient('http://api:3333/', fetcher as never);
    expect(await client.recipients('other=1; ep_access=abc; ep_csrf=z', CONVERSATION)).toEqual({ audience: 'members', userIds: ['user-a'] });
    expect(fetcher).toHaveBeenCalledWith(
      `http://api:3333/api/platform/v1/chat/conversations/${CONVERSATION}/typing-recipients`,
      expect.objectContaining({ headers: { cookie: 'ep_access=abc' } }),
    );
    expect(await client.recipients(undefined, CONVERSATION)).toBeNull();
    const company = new HttpCoreChatTypingClient('http://api:3333', (async () => ({ ok: true, json: async () => ({ audience: 'company' }) })) as never);
    expect(await company.recipients('ep_access=abc', CONVERSATION)).toEqual({ audience: 'company' });
  });
});
