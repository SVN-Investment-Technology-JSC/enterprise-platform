import { PermanentMessageError } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { RealtimeDeliveryHandler } from './realtime-delivery';

describe('social.feed.changed delivery', () => {
  const event = (type: string, payload: Record<string, unknown>): IntegrationEventEnvelope => ({
    id: '10000000-0000-4000-8000-000000000009',
    type,
    version: 1,
    occurredAt: '2026-10-20T00:00:00.000Z',
    tenantId: 'tenant-a',
    source: 'social',
    correlationId: 'post-1',
    payload,
  });
  const handlerWith = (gateway: { emitRoomEvent: jest.Mock }) =>
    new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());

  it('sends a wall post signal to every session of the tenant, with ids only', async () => {
    const gateway = { emitRoomEvent: jest.fn() };
    await handlerWith(gateway).handle(
      event('social.post.published', { postId: 'post-1', authorId: 'user-a', authorName: 'Lan', title: 'Riêng' }),
    );
    expect(gateway.emitRoomEvent).toHaveBeenCalledWith('tenant:tenant-a', {
      id: '10000000-0000-4000-8000-000000000009',
      event: 'social.feed.changed',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 1,
      occurredAt: '2026-10-20T00:00:00.000Z',
      data: { change: 'post.created', postId: 'post-1', actorUserId: 'user-a' },
    });
  });

  it('keeps group posts out of the tenant room and sends them to the group room only', async () => {
    const gateway = { emitRoomEvent: jest.fn() };
    await handlerWith(gateway).handle(
      event('social.reaction.changed', { postId: 'post-2', groupId: 'group-1', actorId: 'user-b' }),
    );
    expect(gateway.emitRoomEvent).toHaveBeenCalledTimes(1);
    const [room, envelope] = gateway.emitRoomEvent.mock.calls[0] as [string, { data: unknown }];
    expect(room).toBe('tenant:tenant-a:social-group:group-1');
    expect(envelope.data).toEqual({
      change: 'reaction.changed',
      postId: 'post-2',
      groupId: 'group-1',
      actorUserId: 'user-b',
    });
  });

  it('treats an incomplete payload as a permanent failure', async () => {
    const gateway = { emitRoomEvent: jest.fn() };
    await expect(handlerWith(gateway).handle(event('social.post.published', { authorId: 'user-a' }))).rejects.toBeInstanceOf(
      PermanentMessageError,
    );
    expect(gateway.emitRoomEvent).not.toHaveBeenCalled();
  });
});
