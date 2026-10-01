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

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await consumer.close();
  await publisher.close();
  await pools.closeAll();
  await platform.end();
}

process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));

consumer
  .start(async (event) => {
    const outcome = await processor.handle(event);
    if (outcome.status === 'tenant-inactive') {
      console.info('Notification event ignored for inactive tenant.', {
        tenantId: event.tenantId,
        eventId: event.id,
      });
    }
  })
  .then(() => console.info('Notification worker is consuming domain events.'))
  .catch(async (error) => {
    console.error(
      'Notification worker failed to start.',
      error instanceof Error ? error.message : error,
    );
    await close();
    process.exitCode = 1;
  });
