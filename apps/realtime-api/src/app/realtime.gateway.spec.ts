import { PermanentMessageError } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import type { Socket } from 'socket.io';
import {
  RealtimeGateway,
  RealtimeOriginPolicy,
  RealtimeSessionRevalidator,
  userRoom,
  sessionRoom,
  tenantRoom,
} from './realtime.gateway';
import { RealtimeDeliveryHandler } from './realtime-delivery';

const principal = {
  kind: 'tenant-user' as const,
  tenantId: 'tenant-a',
  tenantSlug: 'a',
  membershipId: 'membership-a',
  userId: 'user-a',
  sessionId: 'session-a',
  email: 'a@example.test',
  displayName: 'A',
  roles: ['tenant-user'],
  permissions: [],
};

function socket() {
  return {
    id: 'socket-a',
    connected: true,
    handshake: {
      headers: {
        origin: 'https://erp.example.test',
        cookie: 'ep_access=signed',
      },
    },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket & {
    join: jest.Mock;
    emit: jest.Mock;
    disconnect: jest.Mock;
  };
}

describe('RealtimeGateway', () => {
  it('does not join rooms or register timers after disconnecting during authentication', async () => {
    let resolve!: (value: typeof principal) => void;
    const auth = { authenticate: () => new Promise<typeof principal>((done) => { resolve = done; }) };
    const watch = jest.fn();
    const gateway = new RealtimeGateway(auth, new RealtimeOriginPolicy(['https://erp.example.test']), { watch, unwatch: jest.fn() } as never);
    const client = socket();
    const pending = gateway.handleConnection(client);
    Object.defineProperty(client, 'connected', { value: false });
    resolve(principal);
    await pending;
    expect(client.join).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  });
  it('authenticates the cookie, enforces Origin, and joins only server-owned rooms', async () => {
    const auth = { authenticate: jest.fn().mockResolvedValue(principal) };
    const revalidator = { watch: jest.fn(), unwatch: jest.fn() };
    const gateway = new RealtimeGateway(
      auth,
      new RealtimeOriginPolicy(['https://erp.example.test']),
      revalidator as never,
    );
    const client = socket();
    const local = { emit: jest.fn() };
    gateway.server = { local: { to: jest.fn().mockReturnValue(local) } } as never;

    await gateway.handleConnection(client);

    expect(auth.authenticate).toHaveBeenCalledWith('ep_access=signed');
    expect(client.join.mock.calls.map(([room]) => room)).toEqual([
      userRoom('tenant-a', 'user-a'),
      sessionRoom('session-a'),
      tenantRoom('tenant-a'),
    ]);
    expect(client.data).toMatchObject({ principal });
    expect(gateway.server.local.to).toHaveBeenCalledWith(client.id);
    expect(local.emit).toHaveBeenCalledWith('session.ready', {
      sessionId: principal.sessionId,
      tenantId: principal.tenantId,
      userId: principal.userId,
    });
    expect(client.emit).not.toHaveBeenCalled();
    expect(revalidator.watch).toHaveBeenCalledWith(client, 'ep_access=signed', principal);
  });

  describe('chat.typing', () => {
    const typingMessage = {
      entityType: 'project',
      entityId: '11111111-1111-4111-8111-111111111111',
      typing: true,
    };

    function gatewayWithTyping(handle: jest.Mock) {
      const typing = { handle, forget: jest.fn() };
      const gateway = new RealtimeGateway(
        { authenticate: jest.fn().mockResolvedValue(principal) },
        new RealtimeOriginPolicy(['https://erp.example.test']),
        { watch: jest.fn(), unwatch: jest.fn() } as never,
        undefined,
        typing as never,
      );
      gateway.server = { local: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } } as never;
      return { gateway, typing };
    }

    it('forwards the authenticated principal, the cookie and the payload to the typing service', async () => {
      const handle = jest.fn().mockResolvedValue(undefined);
      const { gateway } = gatewayWithTyping(handle);
      const client = socket();
      await gateway.handleConnection(client);

      await gateway.handleChatTyping(client, typingMessage);

      expect(handle).toHaveBeenCalledWith(
        principal,
        client.id,
        'ep_access=signed',
        typingMessage,
        expect.any(Function),
      );
    });

    it('ignores a socket that never authenticated', async () => {
      const handle = jest.fn();
      const { gateway } = gatewayWithTyping(handle);
      await gateway.handleChatTyping(socket(), typingMessage);
      expect(handle).not.toHaveBeenCalled();
    });

    it('swallows typing failures so they cannot break the connection', async () => {
      const handle = jest.fn().mockRejectedValue(new Error('boom'));
      const { gateway } = gatewayWithTyping(handle);
      const client = socket();
      await gateway.handleConnection(client);
      await expect(gateway.handleChatTyping(client, typingMessage)).resolves.toBeUndefined();
    });

    it('forgets the socket throttle state on disconnect', async () => {
      const { gateway, typing } = gatewayWithTyping(jest.fn());
      const client = socket();
      await gateway.handleConnection(client);
      gateway.handleDisconnect(client);
      expect(typing.forget).toHaveBeenCalledWith(client.id);
    });

    it('does nothing when the typing service is not configured', async () => {
      const gateway = new RealtimeGateway(
        { authenticate: jest.fn().mockResolvedValue(principal) },
        new RealtimeOriginPolicy(['https://erp.example.test']),
        { watch: jest.fn(), unwatch: jest.fn() } as never,
      );
      gateway.server = { local: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } } as never;
      const client = socket();
      await gateway.handleConnection(client);
      await expect(gateway.handleChatTyping(client, typingMessage)).resolves.toBeUndefined();
    });
  });

  describe('procedure rooms', () => {
    const INSTANCE = 'instance-1';

    function gatewayWithRooms(rooms: Record<string, jest.Mock>) {
      const gateway = new RealtimeGateway(
        { authenticate: jest.fn().mockResolvedValue(principal) },
        new RealtimeOriginPolicy(['https://erp.example.test']),
        { watch: jest.fn(), unwatch: jest.fn() } as never,
        undefined,
        undefined,
        rooms as never,
      );
      const local = { emit: jest.fn(), except: jest.fn() };
      local.except.mockReturnValue(local);
      gateway.server = {
        of: jest.fn().mockReturnValue({
          name: '/',
          adapter: { uid: 'node-a', doPublish: jest.fn().mockResolvedValue('7-0') },
        }),
        local: { to: jest.fn().mockReturnValue(local) },
      } as never;
      return { gateway, local };
    }

    it('subscribe forwards the principal, socket, cookie and payload, and acknowledges with ok', async () => {
      const subscribe = jest.fn().mockResolvedValue(true);
      const { gateway } = gatewayWithRooms({ subscribe, forget: jest.fn() });
      const client = socket();
      await gateway.handleConnection(client);

      await expect(gateway.handleProcedureSubscribe(client, { instanceId: INSTANCE })).resolves.toEqual({ ok: true });
      expect(subscribe).toHaveBeenCalledWith(principal, client, 'ep_access=signed', { instanceId: INSTANCE });
    });

    it('subscribe is refused for a socket that never authenticated', async () => {
      const subscribe = jest.fn();
      const { gateway } = gatewayWithRooms({ subscribe, forget: jest.fn() });
      await expect(gateway.handleProcedureSubscribe(socket(), { instanceId: INSTANCE })).resolves.toEqual({ ok: false });
      expect(subscribe).not.toHaveBeenCalled();
    });

    it('subscribe turns any failure into ok:false instead of breaking the connection', async () => {
      const { gateway } = gatewayWithRooms({ subscribe: jest.fn().mockRejectedValue(new Error('boom')), forget: jest.fn() });
      const client = socket();
      await gateway.handleConnection(client);
      await expect(gateway.handleProcedureSubscribe(client, { instanceId: INSTANCE })).resolves.toEqual({ ok: false });
    });

    it('subscribe is a no-op (ok:false) when rooms are not configured', async () => {
      const gateway = new RealtimeGateway(
        { authenticate: jest.fn().mockResolvedValue(principal) },
        new RealtimeOriginPolicy(['https://erp.example.test']),
        { watch: jest.fn(), unwatch: jest.fn() } as never,
      );
      gateway.server = { local: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } } as never;
      const client = socket();
      await gateway.handleConnection(client);
      await expect(gateway.handleProcedureSubscribe(client, { instanceId: INSTANCE })).resolves.toEqual({ ok: false });
    });

    it('unsubscribe leaves the room only for an authenticated socket', async () => {
      const unsubscribe = jest.fn().mockResolvedValue(undefined);
      const { gateway } = gatewayWithRooms({ unsubscribe, forget: jest.fn() });
      await gateway.handleProcedureUnsubscribe(socket(), { instanceId: INSTANCE });
      expect(unsubscribe).not.toHaveBeenCalled();

      const client = socket();
      await gateway.handleConnection(client);
      await gateway.handleProcedureUnsubscribe(client, { instanceId: INSTANCE });
      expect(unsubscribe).toHaveBeenCalledWith(principal, client, { instanceId: INSTANCE });
    });

    it('typing is pushed to the room as an envelope from the typist, never back to the typing socket', async () => {
      const typing = jest.fn(async (_p, _s, _body, emit) => {
        await emit('tenant:tenant-a:procedure:instance-1', { instanceId: INSTANCE, userId: 'user-a', typing: true });
      });
      const { gateway, local } = gatewayWithRooms({ typing, forget: jest.fn() });
      const client = socket();
      await gateway.handleConnection(client);

      await gateway.handleProcedureTyping(client, { instanceId: INSTANCE, typing: true });

      expect(gateway.server.local.to).toHaveBeenCalledWith('tenant:tenant-a:procedure:instance-1');
      expect(local.except).toHaveBeenCalledWith([client.id]);
      expect(local.emit).toHaveBeenCalledWith(
        'procedure.comment.typing',
        expect.objectContaining({
          event: 'procedure.comment.typing',
          tenantId: 'tenant-a',
          userId: 'user-a',
          sequence: 1,
          data: { instanceId: INSTANCE, userId: 'user-a', typing: true },
        }),
        '7-0',
      );
    });

    it('typing swallows failures and ignores unauthenticated sockets', async () => {
      const typing = jest.fn().mockRejectedValue(new Error('boom'));
      const { gateway } = gatewayWithRooms({ typing, forget: jest.fn() });
      await gateway.handleProcedureTyping(socket(), { instanceId: INSTANCE, typing: true });
      expect(typing).not.toHaveBeenCalled();

      const client = socket();
      await gateway.handleConnection(client);
      await expect(gateway.handleProcedureTyping(client, { instanceId: INSTANCE, typing: true })).resolves.toBeUndefined();
    });

    it('forgets the socket rooms on disconnect', async () => {
      const forget = jest.fn();
      const { gateway } = gatewayWithRooms({ forget });
      const client = socket();
      await gateway.handleConnection(client);
      gateway.handleDisconnect(client);
      expect(forget).toHaveBeenCalledWith(client.id);
    });

    it('emitRoomEvent publishes to the cluster with the excluded sockets and delivers locally with the same offset', async () => {
      const { gateway, local } = gatewayWithRooms({ forget: jest.fn() });
      const doPublish = (gateway.server.of('/') as unknown as { adapter: { doPublish: jest.Mock } }).adapter.doPublish;
      const envelope: RealtimeEventEnvelope = {
        id: 'e1',
        event: 'procedure.comment.changed',
        version: 1,
        tenantId: 'tenant-a',
        userId: 'user-actor',
        sequence: 1,
        occurredAt: '2026-10-01T00:00:00.000Z',
        data: { instanceId: INSTANCE },
      };

      await gateway.emitRoomEvent('tenant:tenant-a:procedure:instance-1', envelope, ['socket-x']);

      expect(doPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            opts: expect.objectContaining({ rooms: ['tenant:tenant-a:procedure:instance-1'], except: ['socket-x'] }),
          }),
        }),
      );
      expect(local.except).toHaveBeenCalledWith(['socket-x']);
      expect(local.emit).toHaveBeenCalledWith('procedure.comment.changed', envelope, '7-0');
    });

    it('emitRoomEvent without exclusions does not call except()', async () => {
      const { gateway, local } = gatewayWithRooms({ forget: jest.fn() });
      await gateway.emitRoomEvent('r', {
        id: 'e2', event: 'procedure.comment.changed', version: 1, tenantId: 'tenant-a', userId: 'u',
        sequence: 1, occurredAt: '2026-10-01T00:00:00.000Z', data: {},
      });
      expect(local.except).not.toHaveBeenCalled();
      expect(local.emit).toHaveBeenCalled();
    });
  });

  it('rejects disallowed origins before authentication', async () => {
    const auth = { authenticate: jest.fn().mockResolvedValue(principal) };
    const gateway = new RealtimeGateway(
      auth,
      new RealtimeOriginPolicy(['https://erp.example.test']),
      { watch: jest.fn(), unwatch: jest.fn() } as never,
    );
    const client = socket();
    client.handshake.headers.origin = 'https://attacker.example';

    await gateway.handleConnection(client);

    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects a revoked session after notifying that server-owned room', () => {
    const gateway = new RealtimeGateway(
      { authenticate: jest.fn() },
      new RealtimeOriginPolicy(['https://erp.example.test']),
      { watch: jest.fn(), unwatch: jest.fn() } as never,
    );
    const room = {
      emit: jest.fn(),
      disconnectSockets: jest.fn(),
    };
    gateway.server = {
      of: jest.fn().mockReturnValue({
        name: '/',
        adapter: {
          uid: 'node-a',
          doPublish: jest.fn().mockResolvedValue('10-0'),
        },
      }),
      local: {
        to: jest.fn().mockReturnValue(room),
        in: jest.fn().mockReturnValue(room),
      },
    } as never;

    return gateway.disconnectSession('session-a', {
      reason: 'logout',
      tenantId: 'tenant-a',
      userId: 'user-a',
    }).then(() => {
      expect(gateway.server.local.to).toHaveBeenCalledWith(sessionRoom('session-a'));
      expect(room.emit).toHaveBeenCalledWith(
        'session.revoked',
        expect.objectContaining({ reason: 'logout' }),
        expect.any(String),
      );
      expect(room.disconnectSockets).toHaveBeenCalledWith(true);
    });
  });

  it('awaits the Redis Streams XADD before completing delivery and emits locally with the recovery offset', async () => {
    let completePublish!: (offset: string) => void;
    const doPublish = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          completePublish = resolve;
        }),
    );
    const local = { emit: jest.fn() };
    const gateway = new RealtimeGateway(
      { authenticate: jest.fn() },
      new RealtimeOriginPolicy(['https://erp.example.test']),
      { watch: jest.fn(), unwatch: jest.fn() } as never,
    );
    gateway.server = {
      of: jest.fn().mockReturnValue({
        name: '/',
        adapter: { uid: 'node-a', doPublish },
      }),
      local: { to: jest.fn().mockReturnValue(local) },
    } as never;
    const event: RealtimeEventEnvelope = {
      id: '10000000-0000-4000-8000-000000000001',
      event: 'notification.created',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 4,
      occurredAt: '2026-10-01T00:00:00.000Z',
      data: { notificationId: 'notification-a' },
    };

    const pending = gateway.emitUserEvent(event);
    await Promise.resolve();
    expect(local.emit).not.toHaveBeenCalled();
    expect(doPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'node-a',
        nsp: '/',
        type: 3,
        data: expect.objectContaining({
          opts: expect.objectContaining({ rooms: [userRoom('tenant-a', 'user-a')] }),
        }),
      }),
    );

    completePublish('42-0');
    await pending;
    expect(local.emit).toHaveBeenCalledWith('notification.created', event, '42-0');
  });

  it('propagates Redis publish failures so the RabbitMQ delivery is retried', async () => {
    const gateway = new RealtimeGateway(
      { authenticate: jest.fn() },
      new RealtimeOriginPolicy(['https://erp.example.test']),
      { watch: jest.fn(), unwatch: jest.fn() } as never,
    );
    const local = { emit: jest.fn() };
    gateway.server = {
      of: jest.fn().mockReturnValue({
        name: '/',
        adapter: {
          uid: 'node-a',
          doPublish: jest.fn().mockRejectedValue(new Error('VALKEY_DOWN')),
        },
      }),
      local: { to: jest.fn().mockReturnValue(local) },
    } as never;
    const event: RealtimeEventEnvelope = {
      id: '10000000-0000-4000-8000-000000000001',
      event: 'notification.created',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 4,
      occurredAt: '2026-10-01T00:00:00.000Z',
      data: {},
    };

    await expect(gateway.emitUserEvent(event)).rejects.toThrow('VALKEY_DOWN');
    expect(local.emit).not.toHaveBeenCalled();
  });
});

describe('RealtimeSessionRevalidator', () => {
  it('schedules jittered revalidation and disconnects a socket when the session is no longer valid', async () => {
    const auth = { authenticate: jest.fn().mockRejectedValue(new Error('revoked')) };
    let scheduled: (() => void) | undefined;
    let delay = 0;
    const revalidator = new RealtimeSessionRevalidator(
      auth,
      (callback, ms) => {
        scheduled = callback;
        delay = ms;
        return 1 as never;
      },
      () => 0.75,
      60_000,
    );
    const client = socket();

    revalidator.watch(client, 'ep_access=signed', principal);
    expect(delay).toBeGreaterThanOrEqual(48_000);
    expect(delay).toBeLessThanOrEqual(72_000);
    scheduled?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('RealtimeDeliveryHandler', () => {
  it('does not emit queued deliveries after the tenant becomes inactive', async () => {
    const gateway = { emitUserEvent: jest.fn() };
    const guard = jest.fn(async () => undefined);
    const handler = new RealtimeDeliveryHandler(gateway as never, guard);
    await handler.handle({ ...eventForInactiveTenant() });
    expect(guard).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(gateway.emitUserEvent).not.toHaveBeenCalled();
  });
  it('emits a validated delivery envelope to the authenticated user room', async () => {
    const realtime: RealtimeEventEnvelope = {
      id: '10000000-0000-4000-8000-000000000001',
      event: 'notification.created',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 4,
      occurredAt: '2026-10-01T00:00:00.000Z',
      data: { notificationId: 'notification-a' },
    };
    const gateway = { emitUserEvent: jest.fn() };
    const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
    const event = {
      id: realtime.id,
      type: 'notification.delivery.v1',
      version: 1,
      occurredAt: realtime.occurredAt,
      tenantId: realtime.tenantId,
      source: 'notification-worker',
      correlationId: 'user-a:4',
      payload: realtime,
    } satisfies IntegrationEventEnvelope;

    await handler.handle(event);
    expect(gateway.emitUserEvent).toHaveBeenCalledWith(realtime);
  });

  it('disconnects identity session revocation events immediately', async () => {
    const gateway = { disconnectSession: jest.fn() };
    const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
    await handler.handle({
      id: '10000000-0000-4000-8000-000000000002',
      type: 'identity.session.revoked',
      version: 1,
      occurredAt: '2026-10-01T00:00:00.000Z',
      tenantId: 'tenant-a',
      source: 'platform-identity',
      correlationId: 'session-a',
      payload: { userId: 'user-a', sessionId: 'session-a', reason: 'logout' },
    });

    expect(gateway.disconnectSession).toHaveBeenCalledWith('session-a', {
      tenantId: 'tenant-a',
      userId: 'user-a',
      reason: 'logout',
    });
  });

  describe('core.authorization.changed', () => {
    const changed = (payload: Record<string, unknown>): IntegrationEventEnvelope => ({
      id: '10000000-0000-4000-8000-000000000005',
      type: 'core.authorization.changed',
      version: 1,
      occurredAt: '2026-10-18T00:00:00.000Z',
      tenantId: 'tenant-a',
      source: 'tenant-core',
      correlationId: '10000000-0000-4000-8000-000000000005',
      payload,
    });

    it('báo mọi phiên của công ty, chỉ kèm số hiệu quyền', async () => {
      const gateway = { emitRoomEvent: jest.fn() };
      const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
      await handler.handle(changed({ revision: 7 }));
      expect(gateway.emitRoomEvent).toHaveBeenCalledWith('tenant:tenant-a', {
        id: '10000000-0000-4000-8000-000000000005',
        event: 'authorization.changed',
        version: 1,
        tenantId: 'tenant-a',
        userId: '',
        sequence: 1,
        occurredAt: '2026-10-18T00:00:00.000Z',
        data: { revision: '7' },
      });
    });

    it('thiếu revision là lỗi vĩnh viễn, không thử lại mãi', async () => {
      const handler = new RealtimeDeliveryHandler({ emitRoomEvent: jest.fn() } as never, async (_id, operation) => operation());
      await expect(handler.handle(changed({}))).rejects.toBeInstanceOf(PermanentMessageError);
    });
  });

  describe('procedure.comment.posted', () => {
    const posted = (payload: Record<string, unknown>): IntegrationEventEnvelope => ({
      id: '10000000-0000-4000-8000-000000000004',
      type: 'procedure.comment.posted',
      version: 1,
      occurredAt: '2026-10-01T00:00:00.000Z',
      tenantId: 'tenant-a',
      source: 'procedure-engine',
      correlationId: 'instance-1',
      payload: { instanceId: 'instance-1', activityId: 'activity-1', actorUserId: 'user-actor', ...payload },
    });

    it('is pushed into the instance room as an id-only envelope carrying the author', async () => {
      const gateway = { emitRoomEvent: jest.fn() };
      const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
      await handler.handle(posted({ body: 'bí mật', excerpt: 'bí mật' }));

      expect(gateway.emitRoomEvent).toHaveBeenCalledTimes(1);
      const [room, envelope] = gateway.emitRoomEvent.mock.calls[0];
      expect(room).toBe('tenant:tenant-a:procedure:instance-1');
      expect(envelope).toEqual({
        id: '10000000-0000-4000-8000-000000000004',
        event: 'procedure.comment.changed',
        version: 1,
        tenantId: 'tenant-a',
        userId: 'user-actor',
        sequence: 1,
        occurredAt: '2026-10-01T00:00:00.000Z',
        data: { instanceId: 'instance-1', activityId: 'activity-1', actorUserId: 'user-actor' },
      });
      expect(JSON.stringify(envelope)).not.toContain('bí mật');
    });

    it('does not emit when the tenant is no longer active', async () => {
      const gateway = { emitRoomEvent: jest.fn() };
      const handler = new RealtimeDeliveryHandler(gateway as never, async () => undefined);
      await handler.handle(posted({}));
      expect(gateway.emitRoomEvent).not.toHaveBeenCalled();
    });

    it.each([['instanceId'], ['activityId'], ['actorUserId']])(
      'a payload without %s is a permanent failure (DLQ), not an endless retry',
      async (field) => {
        const handler = new RealtimeDeliveryHandler({ emitRoomEvent: jest.fn() } as never, async (_id, operation) => operation());
        await expect(handler.handle(posted({ [field]: undefined }))).rejects.toBeInstanceOf(PermanentMessageError);
      },
    );
  });

  describe('workspace.chat.changed', () => {
    const chatEvent = (payload: Record<string, unknown>): IntegrationEventEnvelope => ({
      id: '10000000-0000-4000-8000-000000000003',
      type: 'workspace.chat.changed',
      version: 1,
      occurredAt: '2026-10-01T00:00:00.000Z',
      tenantId: 'tenant-a',
      source: 'workspace',
      correlationId: 'message-1',
      payload: {
        channelId: 'channel-1',
        entityType: 'work_item',
        entityId: 'item-1',
        projectId: 'project-1',
        messageId: 'message-1',
        change: 'created',
        actorUserId: 'user-actor',
        recipientUserIds: ['user-a', 'user-b'],
        ...payload,
      },
    });

    it('emits an id-only signal to each recipient personal room, never the actor', async () => {
      const gateway = { emitUserEvent: jest.fn() };
      const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
      await handler.handle(chatEvent({ recipientUserIds: ['user-a', 'user-b', 'user-actor', 'user-a'] }));

      expect(gateway.emitUserEvent).toHaveBeenCalledTimes(2);
      expect(gateway.emitUserEvent).toHaveBeenCalledWith({
        id: '10000000-0000-4000-8000-000000000003:user-a',
        event: 'workspace.chat.changed',
        version: 1,
        tenantId: 'tenant-a',
        userId: 'user-a',
        sequence: 1,
        occurredAt: '2026-10-01T00:00:00.000Z',
        data: {
          channelId: 'channel-1',
          entityType: 'work_item',
          entityId: 'item-1',
          projectId: 'project-1',
          messageId: 'message-1',
          change: 'created',
          actorUserId: 'user-actor',
        },
      });
      const users = gateway.emitUserEvent.mock.calls.map(([event]) => event.userId);
      expect(users).toEqual(['user-a', 'user-b']);
    });

    it('does not carry the recipient list or message content to clients', async () => {
      const gateway = { emitUserEvent: jest.fn() };
      const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
      await handler.handle(chatEvent({ body: 'bí mật', excerpt: 'bí mật' }));
      for (const [event] of gateway.emitUserEvent.mock.calls) {
        expect(JSON.stringify(event)).not.toContain('bí mật');
        expect(event.data).not.toHaveProperty('recipientUserIds');
      }
    });

    it('does not emit when the tenant is no longer active', async () => {
      const gateway = { emitUserEvent: jest.fn() };
      const handler = new RealtimeDeliveryHandler(gateway as never, async () => undefined);
      await handler.handle(chatEvent({}));
      expect(gateway.emitUserEvent).not.toHaveBeenCalled();
    });

    it.each(['created', 'edited', 'deleted', 'read'])(
      'delivers a "%s" signal instead of sending it to the DLQ',
      async (change) => {
        const gateway = { emitUserEvent: jest.fn() };
        const handler = new RealtimeDeliveryHandler(gateway as never, async (_id, operation) => operation());
        await handler.handle(chatEvent({ change, recipientUserIds: ['user-a'] }));
        expect(gateway.emitUserEvent).toHaveBeenCalledTimes(1);
        expect(gateway.emitUserEvent.mock.calls[0][0].data.change).toBe(change);
      },
    );

    it('treats an incomplete signal as a permanent failure', async () => {
      const handler = new RealtimeDeliveryHandler({ emitUserEvent: jest.fn() } as never, async (_id, operation) => operation());
      await expect(handler.handle(chatEvent({ change: 'moved' }))).rejects.toBeInstanceOf(PermanentMessageError);
      await expect(handler.handle(chatEvent({ recipientUserIds: 'user-a' }))).rejects.toBeInstanceOf(PermanentMessageError);
    });
  });

  it('marks malformed delivery events as permanent failures so RabbitMQ sends them to DLQ', async () => {
    const handler = new RealtimeDeliveryHandler({ emitUserEvent: jest.fn() } as never, async (_id, operation) => operation());
    await expect(
      handler.handle({
        id: 'broken',
        type: 'notification.delivery.v1',
        version: 1,
        occurredAt: '2026-10-01T00:00:00.000Z',
        tenantId: 'tenant-a',
        source: 'notification-worker',
        correlationId: 'broken',
        payload: { event: 'notification.created' },
      }),
    ).rejects.toBeInstanceOf(PermanentMessageError);
  });
});

function eventForInactiveTenant(): IntegrationEventEnvelope {
  const payload: RealtimeEventEnvelope = {
    id: '10000000-0000-4000-8000-000000000001', event: 'notification.created', version: 1,
    tenantId: 'tenant-a', userId: 'user-a', sequence: 4,
    occurredAt: '2026-10-01T00:00:00.000Z', data: {},
  };
  return { id: payload.id, type: 'notification.delivery.v1', version: 1,
    occurredAt: payload.occurredAt, tenantId: payload.tenantId,
    source: 'notification-worker', correlationId: 'user-a:4', payload };
}
