import {
  PostgresPoolRegistry,
  createPostgresPool,
} from '@enterprise-platform/adapter-database';
import {
  RabbitMqConsumer,
  RabbitMqPublisher,
} from '@enterprise-platform/adapter-events';
import {
  DEFAULT_NOTIFICATION_POLICIES,
  NotificationPolicyRegistry,
} from '@enterprise-platform/module-notifications';
import { NotificationProcessor } from './app/notification-processor';
import { PostgresNotificationTenantRuntimeRegistry } from './app/notification-runtime';
import {
  createNotificationOperationalServer,
  featureFlag,
  NotificationConsumerRuntime,
  NotificationWorkerOperational,
  operationalLog,
} from './app/notification-operational';

try {
  process.loadEnvFile?.('.env');
} catch {
  // Runtime environments may inject configuration directly.
}

const rabbitUrl =
  process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672';
const platform = createPostgresPool(
  process.env.PLATFORM_DATABASE_URL ??
    'postgresql://platform:platform@localhost:55432/platform',
  { max: 4, application_name: 'enterprise-platform:notification-worker' },
);
const pools = new PostgresPoolRegistry(undefined, {
  maxPools: Number(process.env.NOTIFICATION_MAX_TENANT_POOLS ?? 24),
  maxConnectionsPerPool: Number(
    process.env.NOTIFICATION_TENANT_POOL_SIZE ?? 4,
  ),
});
const publisher = new RabbitMqPublisher(rabbitUrl);
const runtimes = new PostgresNotificationTenantRuntimeRegistry(
  platform,
  pools,
  publisher,
);
const policies = new NotificationPolicyRegistry(DEFAULT_NOTIFICATION_POLICIES);
const processor = new NotificationProcessor(runtimes, policies);
const consumer = new RabbitMqConsumer(rabbitUrl, {
  queue: 'notifications.domain.v1',
  bindings: [...new Set(DEFAULT_NOTIFICATION_POLICIES.map((item) => item.eventType))],
  prefetch: Number(process.env.NOTIFICATION_CONSUMER_PREFETCH ?? 16),
});
const consumerEnabled = featureFlag(
  process.env.NOTIFICATION_CONSUMER_ENABLED,
  true,
);
const consumerRuntime = new NotificationConsumerRuntime(
  consumer,
  consumerEnabled,
);
const operational = new NotificationWorkerOperational(platform, consumerRuntime);
const operationalServer = createNotificationOperationalServer(operational);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await consumerRuntime.close();
  if (operationalServer.listening) {
    await new Promise<void>((resolve, reject) => {
      operationalServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await publisher.close();
  await pools.closeAll();
  await platform.end();
}

process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3340);
  await new Promise<void>((resolve, reject) => {
    operationalServer.once('error', reject);
    operationalServer.listen(port, '0.0.0.0', resolve);
  });
  await consumerRuntime.start(async (event) => {
    try {
      const outcome = await processor.handle(event);
      operational.processed(outcome.status, event.occurredAt);
      if (outcome.status === 'tenant-inactive') {
        operationalLog('info', 'notification_event_tenant_inactive', {
          tenantId: event.tenantId,
          eventId: event.id,
        });
      }
    } catch (error) {
      operational.failed('processing');
      throw error;
    }
  });
  operationalLog('info', 'notification_worker_started', {
    port,
    consumerEnabled,
  });
}

bootstrap().catch(async (error) => {
  operationalLog('error', 'notification_worker_start_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  await close();
  process.exitCode = 1;
});
