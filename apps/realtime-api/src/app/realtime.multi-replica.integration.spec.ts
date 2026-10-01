import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { createServer, type Server as HttpServer } from 'node:http';
import { createClient, type RedisClientType } from 'redis';
import { Server, type ServerOptions, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { RealtimeDeliveryHandler } from './realtime-delivery';
import { REALTIME_RECOVERY_MS, RealtimeGateway, userRoom } from './realtime.gateway';

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
    });
    await Promise.all([listen(httpA), listen(httpB)]);
    const address = httpB.address();
    if (!address || typeof address === 'string') throw new Error('Replica B did not bind TCP.');
    client = io(`http://127.0.0.1:${address.port}`, {
      path: '/realtime/socket.io',
      transports: ['websocket'],
      reconnection: false,
    });
    await onceClient(client, 'connect');
    await waitFor(() => Boolean(serverSocket?.rooms.has(userRoom('tenant-a', 'user-a'))));
  });

  afterEach(async () => {
    client?.disconnect();
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
    const handler = new RealtimeDeliveryHandler(gateway);
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
});

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
