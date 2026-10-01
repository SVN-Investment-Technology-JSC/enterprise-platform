import { createAdapter } from '@socket.io/redis-streams-adapter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisStreamsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisClientType,
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
    return server;
  }
}
