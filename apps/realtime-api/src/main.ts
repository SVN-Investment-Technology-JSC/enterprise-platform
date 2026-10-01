import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import { AppModule } from './app/app.module';
import { RealtimeDeliveryConsumer } from './app/realtime-delivery';
import { RedisStreamsIoAdapter } from './app/realtime-io.adapter';
import {
  REALTIME_PLATFORM_POOL,
  REALTIME_REDIS_CLIENT,
  REALTIME_TENANT_POOLS,
} from './app/realtime-tokens';

try {
  process.loadEnvFile?.('.env');
} catch {
  // Runtime environments may inject configuration directly.
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const redis = app.get<RedisClientType>(REALTIME_REDIS_CLIENT);
  const platform = app.get<Pool>(REALTIME_PLATFORM_POOL);
  const tenantPools = app.get<PostgresPoolRegistry>(REALTIME_TENANT_POOLS);
  const delivery = app.get(RealtimeDeliveryConsumer);

  await redis.connect();
  app.useWebSocketAdapter(new RedisStreamsIoAdapter(app, redis));
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3338);
  await app.listen(port);
  await delivery.start();
  Logger.log(`Realtime API listening on http://localhost:${port}/${globalPrefix}`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await delivery.close();
    await app.close();
    if (redis.isOpen) await redis.quit();
    await tenantPools.closeAll();
    await platform.end();
  };
  process.once('SIGINT', () => void close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
}

bootstrap().catch((error) => {
  Logger.error(
    'Realtime API failed to start.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
