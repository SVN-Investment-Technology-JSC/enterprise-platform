import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { createServer } from 'node:http';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { RealtimeOriginPolicy, userRoom } from './realtime.gateway';
import { secureRealtimeRecovery } from './realtime-recovery-security';

const redisUrl = process.env.REALTIME_TEST_REDIS_URL;
(redisUrl ? describe : describe.skip)('authentication before recovery replay', () => {
  it.each(['revoked', 'different-user', 'valid'])('binds recovery to the verified identity with a %s cookie', async (mode) => {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    const http = createServer();
    const server = new Server(http, {
      transports: ['websocket'],
      connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
    });
    server.adapter(createAdapter(redis, { streamName: `security:${mode}`, blockTimeInMs: 100 }));
    const principal = (userId: string) => ({
      kind: 'tenant-user', userId, tenantId: 'tenant-a', sessionId: `session-${userId}`,
    }) as TenantUserPrincipal;
    const authenticate = async (cookie: string | undefined) => {
      if (cookie === 'ep_access=revoked') throw new Error('Revoked session');
      return principal(cookie === 'ep_access=other' ? 'user-b' : 'user-a');
    };
    const metrics = { authFailed: jest.fn() };
    secureRealtimeRecovery(server, { authenticate }, new RealtimeOriginPolicy(['http://allowed.local']), metrics);
    server.on('connection', async (socket) => {
      try {
        const current = await authenticate(socket.handshake.headers.cookie);
        socket.data.principal = current;
        await socket.join(userRoom(current.tenantId, current.userId));
        server.local.to(socket.id).emit('ready');
      } catch { socket.disconnect(true); }
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const client = io(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'], reconnection: false,
      extraHeaders: { origin: 'http://allowed.local', cookie: 'ep_access=valid' },
    });
    const received: string[] = [];
    client.on('private', (value: string) => received.push(value));
    const wait = (event: string) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 3000);
      client.once(event, () => { clearTimeout(timer); resolve(); });
    });
    try {
      await wait('ready');
      const seeded = wait('private');
      server.to(userRoom('tenant-a', 'user-a')).emit('private', 'seed');
      await seeded;
      const disconnected = wait('disconnect');
      client.io.engine.close();
      await disconnected;
      const deadline = Date.now() + 2000;
      while (server.of('/').sockets.size !== 0) {
        if (Date.now() > deadline) throw new Error('Server transport did not disconnect');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      server.to(userRoom('tenant-a', 'user-a')).emit('private', 'confidential-offline');
      client.io.opts.extraHeaders = {
        origin: 'http://allowed.local',
        cookie: mode === 'revoked' ? 'ep_access=revoked' : mode === 'different-user' ? 'ep_access=other' : 'ep_access=valid',
      };
      const settled = wait(mode === 'revoked' ? 'connect_error' : 'ready');
      client.connect();
      await settled;
      expect(received).toEqual(mode === 'valid' ? ['seed', 'confidential-offline'] : ['seed']);
      if (mode === 'valid') expect(client.recovered).toBe(true);
      if (mode === 'different-user') expect(client.recovered).toBe(false);
      if (mode === 'revoked') expect(metrics.authFailed).toHaveBeenCalledWith('session');
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (redis.isOpen) await redis.quit();
    }
  }, 10_000);
});
