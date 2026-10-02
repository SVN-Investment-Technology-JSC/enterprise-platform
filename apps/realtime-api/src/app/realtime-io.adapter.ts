import { createAdapter } from '@socket.io/redis-streams-adapter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';
import type { RealtimeAuthClient } from './realtime-runtime';
import { RealtimeOriginPolicy } from './realtime.gateway';
import { secureRealtimeRecovery } from './realtime-recovery-security';
import { RealtimeMetrics } from './realtime-health';

export class RedisStreamsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisClientType,
    private readonly auth: RealtimeAuthClient,
    private readonly origins: RealtimeOriginPolicy,
    private readonly metrics: RealtimeMetrics,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(
      createAdapter(this.redis, {
        streamName: 'enterprise:socket.io',
        maxLen: 20_000,
        readCount: 200,
        blockTimeInMs: 2_000,
        sessionKeyPrefix: 'enterprise:sio:session:',
        onlyPlaintext: true,
      }),
    );
    secureRealtimeRecovery(server, this.auth, this.origins, this.metrics);
    return server;
  }
}
