import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import amqp from 'amqplib';
import { io, type Socket } from 'socket.io-client';
import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { RabbitMqConsumer, RabbitMqPublisher, buildRetryQueueDefinitions } from '@enterprise-platform/adapter-events';
import { DEFAULT_NOTIFICATION_POLICIES, NotificationPolicyRegistry } from '@enterprise-platform/module-notifications';
import type { NotificationRecord, RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { NotificationProcessor } from './notification-processor';
import { PostgresNotificationTenantRuntimeRegistry } from './notification-runtime';
import { PostgresNotificationScheduleSource } from './notification-schedule-source';

const enabled = process.env.NOTIFICATIONS_E2E_ENABLED === 'true';
(enabled ? describe : describe.skip)('local notification pipeline acceptance', () => {
  it('delivers domain events through PostgreSQL, RabbitMQ and the deployed gateway, and drains read-all without another domain event', async () => {
    const required = (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`${key} is required for the local E2E fixture.`);
      return value;
    };
    const platformUrl = required('NOTIFICATIONS_E2E_PLATFORM_DATABASE_URL');
    const tenantUrl = required('NOTIFICATIONS_E2E_TENANT_DATABASE_URL');
    for (const url of [platformUrl, tenantUrl]) {
      if (!['localhost', '127.0.0.1', 'platform-db', 'tenant-db'].includes(new URL(url).hostname)) {
        throw new Error('This fixture may only run against local disposable development infrastructure.');
      }
    }
    const authUrl = required('NOTIFICATIONS_E2E_AUTH_URL');
    const realtimeUrl = required('NOTIFICATIONS_E2E_REALTIME_URL');
    const rabbitUrl = required('RABBITMQ_TEST_URL');
    const slug = required('NOTIFICATIONS_E2E_TENANT_SLUG');
    const platform = new Pool({ connectionString: platformUrl });
    const tenant = new Pool({ connectionString: tenantUrl });
    const pools = new PostgresPoolRegistry({ resolve: () => tenantUrl });
    const publisher = new RabbitMqPublisher(rabbitUrl);
    const fixtureId = randomUUID();
    const eventType = `test.notification.pipeline.${fixtureId}`;
    const queue = `test.notification.pipeline.${fixtureId}`;
    const consumer = new RabbitMqConsumer(rabbitUrl, { queue, bindings: [eventType], prefetch: 8 });
    const cleanupConnection = await amqp.connect(rabbitUrl);
    const cleanup = await cleanupConnection.createChannel();
    const clients: Socket[] = [];
    let tenantId: string | undefined;
    let created = false;
    const password = randomBytes(24).toString('base64url');
    const salt = randomBytes(16).toString('base64url');
    const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('base64url')}`;
    const email = `notification.e2e.${fixtureId.replace(/-/g, '')}@${slug}.local`;
    try {
      const selected = await platform.query<{ id: string; database_name: string }>(
        `SELECT t.id, d.database_name FROM tenancy_schema.tenants t
          JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id
         WHERE t.slug = $1 AND t.status = 'active' AND d.status = 'active'`, [slug]);
      tenantId = selected.rows[0]?.id;
      if (!tenantId || new URL(tenantUrl).pathname.slice(1) !== selected.rows[0].database_name) {
        throw new Error('Fixture tenant database does not match the active tenant registry.');
      }
      await tenant.query(`INSERT INTO core_schema.users
        (id, username, full_name, email, password_hash, system_role, status, is_active)
        VALUES ($1,$2,'Notification E2E fixture',$2,$3,'tenant-user','active',true)`, [fixtureId, email, hash]);
      created = true;
      await tenant.query(`INSERT INTO core_schema.user_roles(user_id,role_id)
        SELECT $1,id FROM core_schema.roles WHERE key = 'tenant-user'`, [fixtureId]);
      const login = await fetch(`${authUrl}/api/auth/v1/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, portal: 'tenant' }),
      });
      expect(login.status).toBe(200);
      const cookies = login.headers.getSetCookie();
      const cookieValue = (name: string) => cookies.map((value) => value.split(';')[0]).find((value) => value.startsWith(`${name}=`));
      const access = cookieValue('ep_access');
      const csrf = cookieValue('ep_csrf');
      if (!access || !csrf) throw new Error('Fixture login did not return session and CSRF cookies.');
      const cookie = `${access}; ${csrf}`;
      const origin = 'http://127.0.0.1:8080';
      const connect = async () => {
        const client = io(realtimeUrl, { path: '/realtime/socket.io', transports: ['websocket'],
          reconnection: false, extraHeaders: { cookie, origin } });
        clients.push(client);
        await once(client, 'session.ready');
        return client;
      };
      const first = await connect();
      const second = await connect();
      const runtime = new PostgresNotificationTenantRuntimeRegistry(platform, pools, publisher);
      const assignment = DEFAULT_NOTIFICATION_POLICIES.find((policy) => policy.eventType === 'workspace.work-item.assigned');
      if (!assignment) throw new Error('Assignment policy is unavailable.');
      const processor = new NotificationProcessor(runtime, new NotificationPolicyRegistry([{ ...assignment, eventType }]));
      await consumer.start((event) => processor.handle(event).then(() => undefined));
      // This also exercises the real module schemas used by the periodic scanner.
      await new PostgresNotificationScheduleSource(tenant).candidates(new Date());
      const latencies: number[] = [];
      const restLatencies: number[] = [];
      for (let index = 0; index < 100; index += 1) {
        const sourceId = randomUUID();
        const deliveries = Promise.all([once(first, 'notification.created'), once(second, 'notification.created')]);
        const start = performance.now();
        await publisher.publish({ id: randomUUID(), type: eventType, version: 1, tenantId,
          occurredAt: new Date().toISOString(), source: 'notification-e2e', correlationId: sourceId,
          payload: { workItemId: sourceId, title: `Fixture ${index}`, assigneeUserId: fixtureId } });
        const received = await deliveries as RealtimeEventEnvelope<{ notification: NotificationRecord }>[];
        expect(received.map((event) => event.data.notification.sourceId.split(':')[0])).toEqual([sourceId, sourceId]);
        latencies.push(performance.now() - start);
        const restStart = performance.now();
        const feed = await fetch(`${realtimeUrl}/api/realtime/v1/notifications?limit=20`, { headers: { cookie } });
        expect(feed.status).toBe(200);
        await feed.json();
        restLatencies.push(performance.now() - restStart);
      }
      const summaries = Promise.all([once(first, 'notification.summary-updated'), once(second, 'notification.summary-updated')]);
      const readAll = await fetch(`${realtimeUrl}/api/realtime/v1/notifications/read-all`, {
        method: 'POST', headers: { cookie, 'x-csrf-token': csrf.slice('ep_csrf='.length) },
      });
      expect(readAll.status).toBe(201);
      await runtime.maintain(tenantId, { schedule: false, cleanup: false }, new Date());
      const updates = await summaries as RealtimeEventEnvelope<{ summary: { unreadCount: number } }>[];
      expect(updates.map((event) => event.data.summary.unreadCount)).toEqual([0, 0]);
      const percentiles = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return Object.fromEntries([50, 95, 99].map((p) => [`p${p}`, Math.round(sorted[Math.ceil(sorted.length * p / 100) - 1] * 100) / 100]));
      };
      const delivery = percentiles(latencies);
      const rest = percentiles(restLatencies);
      console.info(JSON.stringify({ samples: 100, activeTabs: 2, domainToBrowserMs: delivery, notificationRestMs: rest }));
      expect(delivery.p95).toBeLessThan(2000);
      expect(rest.p95).toBeLessThan(300);
    } finally {
      for (const client of clients) client.disconnect();
      await consumer.close();
      await publisher.close();
      await cleanup.deleteQueue(queue);
      for (const retry of buildRetryQueueDefinitions(queue)) await cleanup.deleteQueue(retry.queue);
      await cleanup.close();
      await cleanupConnection.close();
      await pools.closeAll();
      if (created) {
        await platform.query('DELETE FROM identity_schema.tenant_auth_sessions WHERE tenant_id = $1 AND core_user_id = $2', [tenantId, fixtureId]);
        await tenant.query('DELETE FROM core_schema.users WHERE id = $1', [fixtureId]);
      }
      await tenant.end();
      await platform.end();
    }
  }, 90_000);
});

function once(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out waiting for ${event}`)); }, 10_000);
    const receive = (value: unknown) => { clearTimeout(timer); resolve(value); };
    socket.once(event, receive);
  });
}
