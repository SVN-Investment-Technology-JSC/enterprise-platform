import type { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import { AppModule } from './app.module';
import { RealtimeDeliveryConsumer } from './realtime-delivery';
import { RealtimeGateway } from './realtime.gateway';
import {
  REALTIME_PLATFORM_POOL,
  REALTIME_REDIS_CLIENT,
  REALTIME_TENANT_POOLS,
} from './realtime-tokens';

describe('AppModule realtime wiring', () => {
  it('resolves the gateway and delivery consumer without opening external connections', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const platform = module.get<Pool>(REALTIME_PLATFORM_POOL);
    const pools = module.get<PostgresPoolRegistry>(REALTIME_TENANT_POOLS);
    const redis = module.get<RedisClientType>(REALTIME_REDIS_CLIENT);

    expect(module.get(RealtimeGateway)).toBeInstanceOf(RealtimeGateway);
    expect(module.get(RealtimeDeliveryConsumer)).toBeInstanceOf(RealtimeDeliveryConsumer);
    expect(redis.isOpen).toBe(false);

    await module.close();
    await pools.closeAll();
    await platform.end();
  });
});
