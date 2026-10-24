import {
  PostgresPoolRegistry,
  createPostgresPool,
  withActiveTenant,
} from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { createClient } from 'redis';
import { HttpTypingRecipientsClient, RealtimeChatTyping } from './realtime-chat-typing';
import { HttpCoreChatTypingClient, RealtimeCoreChatTyping } from './realtime-core-chat-typing';
import { RealtimePresence, RedisPresenceStore } from './realtime-presence';
import { RealtimePresenceController } from './realtime-presence.controller';
import { HttpProcedureAccessClient, RealtimeProcedureRooms } from './realtime-procedure-rooms';
import { HttpSocialGroupAccessClient, RealtimeSocialRooms } from './realtime-social-rooms';
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
  controllers: [RealtimeNotificationsController, RealtimeHealthController, RealtimePresenceController],
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
      // "Đang nhập": hỏi workspace-api ai là người nhận bằng cookie của người gõ.
      provide: RealtimeChatTyping,
      useFactory: () =>
        new RealtimeChatTyping(
          new HttpTypingRecipientsClient(
            process.env.WORKSPACE_INTERNAL_URL ?? 'http://localhost:3337',
          ),
          featureFlag(process.env.REALTIME_TYPING_ENABLED, true),
        ),
    },
    {
      // "Đang nhập" của chat core: hỏi core API (cùng địa chỉ với xác thực) ai là người nhận bằng cookie của người gõ.
      provide: RealtimeCoreChatTyping,
      useFactory: () =>
        new RealtimeCoreChatTyping(
          new HttpCoreChatTypingClient(process.env.PLATFORM_INTERNAL_URL ?? 'http://localhost:3333'),
          featureFlag(process.env.REALTIME_TYPING_ENABLED, true),
        ),
    },
    {
      // Trạng thái trực tuyến dùng chung giữa các replica, giữ trong Valkey.
      provide: RealtimePresence,
      inject: [REALTIME_REDIS_CLIENT],
      useFactory: (redis: ReturnType<typeof createClient>) =>
        new RealtimePresence(
          new RedisPresenceStore(redis),
          featureFlag(process.env.REALTIME_PRESENCE_ENABLED, true),
        ),
    },
    {
      // Phòng theo hồ sơ cho trao đổi quy trình: kiểm quyền vào phòng bằng cookie của người dùng.
      provide: RealtimeProcedureRooms,
      useFactory: () =>
        new RealtimeProcedureRooms(
          new HttpProcedureAccessClient(
            process.env.PROCEDURE_INTERNAL_URL ?? 'http://localhost:3334',
          ),
          featureFlag(process.env.REALTIME_PROCEDURE_ROOMS_ENABLED, true),
        ),
    },
    {
      // Phòng theo nhóm Mạng nội bộ: kiểm tư cách thành viên bằng cookie của người dùng.
      provide: RealtimeSocialRooms,
      useFactory: () =>
        new RealtimeSocialRooms(
          new HttpSocialGroupAccessClient(
            process.env.SOCIAL_INTERNAL_URL ?? 'http://localhost:3343',
          ),
          featureFlag(process.env.REALTIME_SOCIAL_ROOMS_ENABLED, true),
        ),
    },
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
