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
