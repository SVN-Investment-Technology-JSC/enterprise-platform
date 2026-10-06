import {
  PostgresPoolRegistry,
  createPostgresPool,
  withActiveTenant,
} from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { createClient } from 'redis';
import { RealtimeDeliveryConsumer, RealtimeDeliveryHandler } from './realtime-delivery';
import { RealtimeGateway, RealtimeOriginPolicy, RealtimeSessionRevalidator } from './realtime.gateway';
import { RealtimeHealthController } from './realtime-health.controller';
import { RealtimeHealthService, RealtimeMetrics } from './realtime-health';
import { featureFlag, RealtimeMutationPolicy } from './realtime-operational';
import { RealtimeNotificationsController } from './realtime-notifications.controller';
import {
  DefaultRealtimeRequestContextResolver,
  HttpRealtimeAuthClient,
  PostgresRealtimeStoreRegistry,
  type RealtimeAuthClient,
  type RealtimeStoreRegistry,
} from './realtime-runtime';
import {
  REALTIME_AUTH_CLIENT,
  REALTIME_PLATFORM_POOL,
  REALTIME_REDIS_CLIENT,
  REALTIME_REQUEST_CONTEXTS,
  REALTIME_STORE_REGISTRY,
  REALTIME_TENANT_POOLS,
} from './realtime-tokens';

function allowedOrigins(): readonly string[] {
  const configured = process.env.REALTIME_ALLOWED_ORIGINS;
  if (configured) {
    return configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return ['http://localhost:4200', 'http://localhost:3000'];
}

@Module({
  imports: [],
  controllers: [RealtimeNotificationsController, RealtimeHealthController],
  providers: [
    {
      provide: REALTIME_PLATFORM_POOL,
      useFactory: () =>
        createPostgresPool(
          process.env.PLATFORM_DATABASE_URL ??
            'postgresql://platform:platform@localhost:55432/platform',
          { max: 6, application_name: 'enterprise-platform:realtime-api' },
        ),
    },
    {
      provide: REALTIME_TENANT_POOLS,
      useFactory: () =>
        new PostgresPoolRegistry(undefined, {
          maxPools: Number(process.env.REALTIME_MAX_TENANT_POOLS ?? 24),
          maxConnectionsPerPool: Number(process.env.REALTIME_TENANT_POOL_SIZE ?? 4),
        }),
    },
    {
      provide: REALTIME_REDIS_CLIENT,
      useFactory: () =>
        createClient({
          url: process.env.VALKEY_URL ?? 'redis://localhost:6379',
        }),
    },
    {
      provide: REALTIME_AUTH_CLIENT,
      useFactory: () =>
        new HttpRealtimeAuthClient(
          process.env.PLATFORM_INTERNAL_URL ?? 'http://localhost:3333',
        ),
    },
    {
      provide: REALTIME_STORE_REGISTRY,
      inject: [REALTIME_PLATFORM_POOL, REALTIME_TENANT_POOLS],
      useFactory: (platform: ReturnType<typeof createPostgresPool>, pools: PostgresPoolRegistry) =>
        new PostgresRealtimeStoreRegistry(platform, pools),
    },
    {
      provide: REALTIME_REQUEST_CONTEXTS,
      inject: [REALTIME_AUTH_CLIENT, REALTIME_STORE_REGISTRY],
      useFactory: (auth: RealtimeAuthClient, stores: RealtimeStoreRegistry) =>
        new DefaultRealtimeRequestContextResolver(auth, stores),
    },
    {
      provide: RealtimeOriginPolicy,
      useFactory: () => new RealtimeOriginPolicy(allowedOrigins()),
    },
    {
      provide: RealtimeSessionRevalidator,
      inject: [REALTIME_AUTH_CLIENT],
      useFactory: (auth: RealtimeAuthClient) => new RealtimeSessionRevalidator(auth),
    },
    RealtimeMetrics,
    {
      provide: RealtimeMutationPolicy,
      useFactory: () =>
        new RealtimeMutationPolicy(
          featureFlag(process.env.REALTIME_MUTATIONS_ENABLED, true),
        ),
    },
    RealtimeGateway,
    {
      provide: RealtimeHealthService,
      inject: [REALTIME_PLATFORM_POOL, REALTIME_REDIS_CLIENT, RealtimeDeliveryConsumer],
      useFactory: (
        platform: ReturnType<typeof createPostgresPool>,
        redis: ReturnType<typeof createClient>,
        delivery: RealtimeDeliveryConsumer,
      ) => new RealtimeHealthService(platform, redis, delivery),
    },
    {
      provide: RealtimeDeliveryHandler,
      inject: [RealtimeGateway, REALTIME_PLATFORM_POOL],
      useFactory: (gateway: RealtimeGateway, platform: ReturnType<typeof createPostgresPool>) =>
        new RealtimeDeliveryHandler(gateway, async (tenantId, operation) => {
          const outcome = await withActiveTenant(platform, tenantId, operation, { mode: 'shared' });
          if (!outcome.executed && outcome.reason === 'busy') {
            throw new Error('Tenant lifecycle is busy; delivery must retry.');
          }
        }),
    },
    {
      provide: RealtimeDeliveryConsumer,
      inject: [RealtimeDeliveryHandler],
      useFactory: (handler: RealtimeDeliveryHandler) =>
        new RealtimeDeliveryConsumer(
          process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672',
          handler,
          undefined,
          featureFlag(process.env.REALTIME_DELIVERY_ENABLED, true),
        ),
    },
  ],
})
export class AppModule {}
