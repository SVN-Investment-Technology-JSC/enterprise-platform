import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { createServer, type Server as HttpServer } from 'node:http';
import { createClient, type RedisClientType } from 'redis';
import { Server, type ServerOptions, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { RealtimeDeliveryHandler } from './realtime-delivery';
import {
  REALTIME_RECOVERY_MS,
  RealtimeGateway,
  sessionRoom,
  userRoom,
} from './realtime.gateway';

const redisUrl = process.env.REALTIME_TEST_REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('realtime two-replica Redis Streams integration', () => {
  let redisA: RedisClientType;
  let redisB: RedisClientType;
  let httpA: HttpServer;
  let httpB: HttpServer;
  let ioA: Server;
  let ioB: Server;
  let client: ClientSocket;
  const additionalClients: ClientSocket[] = [];
  let serverSocket: ServerSocket | undefined;

  beforeEach(async () => {
    redisA = createClient({ url: redisUrl });
    redisB = createClient({ url: redisUrl });
    await Promise.all([redisA.connect(), redisB.connect()]);
    httpA = createServer();
    httpB = createServer();
    const options: Partial<ServerOptions> = {
      path: '/realtime/socket.io',
      transports: ['websocket'],
      connectionStateRecovery: {
        maxDisconnectionDuration: REALTIME_RECOVERY_MS,
        skipMiddlewares: false,
      },
    };
    ioA = new Server(httpA, options);
    ioB = new Server(httpB, options);
    ioA.adapter(createAdapter(redisA, { streamName: 'test:enterprise:socket.io' }));
    ioB.adapter(createAdapter(redisB, { streamName: 'test:enterprise:socket.io' }));
    ioB.on('connection', async (socket) => {
      serverSocket = socket;
      await socket.join(userRoom('tenant-a', 'user-a'));
      await socket.join(sessionRoom('session-a'));
    });
    await Promise.all([listen(httpA), listen(httpB)]);
    // Do not stop a replica while its asynchronous SUBSCRIBE is still pending.
    const deadline = Date.now() + 2_000;
    while ((await redisA.pubSubNumSub('socket.io#/#'))['socket.io#/#'] < 2) {
      if (Date.now() >= deadline) throw new Error('Replica subscriptions did not become ready.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const address = httpB.address();
    if (!address || typeof address === 'string') throw new Error('Replica B did not bind TCP.');
    client = io(`http://127.0.0.1:${address.port}`, {
      path: '/realtime/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 500,
    });
    await onceClient(client, 'connect');
    await waitFor(() => Boolean(serverSocket?.rooms.has(userRoom('tenant-a', 'user-a'))));
  });

  afterEach(async () => {
    client?.disconnect();
    for (const additionalClient of additionalClients.splice(0)) {
      additionalClient.disconnect();
    }
    await Promise.all([closeIo(ioA), closeIo(ioB)]);
    await Promise.all([
      redisA?.isOpen ? redisA.quit() : Promise.resolve(),
      redisB?.isOpen ? redisB.quit() : Promise.resolve(),
    ]);
  });

  it('delivers one notification from replica A to a client connected to replica B without client-controlled rooms', async () => {
    const realtime: RealtimeEventEnvelope = {
      id: '10000000-0000-4000-8000-000000000001',
      event: 'notification.created',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 9,
      occurredAt: '2026-10-01T00:00:00.000Z',
      data: { notificationId: 'notification-a' },
    };
    const gateway = new RealtimeGateway(
      { authenticate: jest.fn() },
      { allows: () => true } as never,
      { watch: jest.fn(), unwatch: jest.fn() } as never,
    );
    gateway.server = ioA;
    const handler = new RealtimeDeliveryHandler(gateway, async (_id, operation) => operation());
    const event: IntegrationEventEnvelope = {
      id: realtime.id,
      type: 'notification.delivery.v1',
      version: 1,
      occurredAt: realtime.occurredAt,
      tenantId: realtime.tenantId,
      source: 'notification-worker',
      correlationId: 'user-a:9',
      payload: realtime,
    };
    let received = 0;
    const delivered = new Promise<RealtimeEventEnvelope>((resolve) => {
      client.on('notification.created', (value: RealtimeEventEnvelope) => {
        received += 1;
        resolve(value);
      });
    });

    await handler.handle(event);
    await expect(delivered).resolves.toMatchObject({ id: realtime.id, sequence: 9 });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(received).toBe(1);

    client.emit('join', 'tenant:tenant-b:user:user-b');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(serverSocket?.rooms.has('tenant:tenant-b:user:user-b')).toBe(false);
  });

  it('delivers the same sequence once to every active tab for a user', async () => {
    const address = httpB.address();
    if (!address || typeof address === 'string') throw new Error('Replica B did not bind TCP.');
    const secondTab = io(`http://127.0.0.1:${address.port}`, {
      path: '/realtime/socket.io',
      transports: ['websocket'],
      reconnection: false,
    });
    additionalClients.push(secondTab);
    await onceClient(secondTab, 'connect');

    const event = realtimeEvent(10);
    const firstDelivery = onceRealtime(client, 'notification.created');
    const secondDelivery = onceRealtime(secondTab, 'notification.created');
    await deliveryHandler(ioA).handle(deliveryEvent(event));

    await expect(Promise.all([firstDelivery, secondDelivery])).resolves.toEqual([
      expect.objectContaining({ id: event.id, sequence: 10 }),
      expect.objectContaining({ id: event.id, sequence: 10 }),
    ]);
  });

  it('recovers a notification published while the browser transport is offline', async () => {
    const seed = realtimeEvent(10);
    const seeded = onceRealtime(client, 'notification.created');
    await deliveryHandler(ioA).handle(deliveryEvent(seed));
    await seeded;

    const disconnected = onceClientEvent(client, 'disconnect');
    client.io.engine?.close();
    await disconnected;
    await waitFor(() => serverSocket?.connected === false);

    const event = realtimeEvent(11);
    const recovered = onceRealtime(client, 'notification.created');
    await deliveryHandler(ioA).handle(deliveryEvent(event));

    await expect(recovered).resolves.toMatchObject({ id: event.id, sequence: 11 });
  }, 15_000);

  it('propagates session revocation across replicas and disconnects every matching tab', async () => {
    const revoked = onceRealtime(client, 'session.revoked');
    const disconnected = onceClientEvent(client, 'disconnect');
    const gateway = gatewayFor(ioA);

    await gateway.disconnectSession('session-a', {
      tenantId: 'tenant-a',
      userId: 'user-a',
      reason: 'logout',
    });

    await expect(revoked).resolves.toMatchObject({ reason: 'logout' });
    await disconnected;
    expect(client.connected).toBe(false);
  }, 15_000);

  it('keeps a client on replica B available after replica A stops', async () => {
    await closeIo(ioA);
    const event = realtimeEvent(12);
    const delivered = onceRealtime(client, 'notification.created');

    await deliveryHandler(ioB).handle(deliveryEvent(event));

    await expect(delivered).resolves.toMatchObject({ id: event.id, sequence: 12 });
  });
});

function gatewayFor(server: Server): RealtimeGateway {
  const gateway = new RealtimeGateway(
    { authenticate: jest.fn() },
    { allows: () => true } as never,
    { watch: jest.fn(), unwatch: jest.fn() } as never,
  );
  gateway.server = server;
  return gateway;
}

function deliveryHandler(server: Server): RealtimeDeliveryHandler {
  return new RealtimeDeliveryHandler(gatewayFor(server), async (_id, operation) => operation());
}

function realtimeEvent(sequence: number): RealtimeEventEnvelope {
  return {
    id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    event: 'notification.created',
    version: 1,
    tenantId: 'tenant-a',
    userId: 'user-a',
    sequence,
    occurredAt: '2026-10-02T00:00:00.000Z',
    data: { notificationId: `notification-${sequence}` },
  };
}

function deliveryEvent(
  realtime: RealtimeEventEnvelope,
): IntegrationEventEnvelope {
  return {
    id: realtime.id,
    type: 'notification.delivery.v1',
    version: 1,
    occurredAt: realtime.occurredAt,
    tenantId: realtime.tenantId,
    source: 'notification-worker',
    correlationId: `${realtime.userId}:${realtime.sequence}`,
    payload: realtime,
  };
}

function listen(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function onceClient(socket: ClientSocket, event: 'connect'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), 5_000);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function onceClientEvent(
  socket: ClientSocket,
  event: 'disconnect',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}.`)),
      5_000,
    );
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function onceRealtime(
  socket: ClientSocket,
  event: 'notification.created' | 'session.revoked',
): Promise<RealtimeEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}.`)),
      7_500,
    );
    socket.once(event, (value: RealtimeEventEnvelope) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Condition was not reached.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function closeIo(server: Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
