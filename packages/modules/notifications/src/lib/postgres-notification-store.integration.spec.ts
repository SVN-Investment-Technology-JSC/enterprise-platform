import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PostgresNotificationStore } from './postgres-notification-store.js';

const integration = process.env.NOTIFICATIONS_TEST_ADMIN_URL
  ? describe
  : describe.skip;

integration('PostgresNotificationStore', () => {
  const databaseName = `notification_test_${randomUUID().replace(/-/g, '')}`;
  const userId = randomUUID();
  const tenantId = randomUUID();
  let admin: Pool;
  let pool: Pool;
  let store: PostgresNotificationStore;

  beforeAll(async () => {
    const configuredUrl = process.env.NOTIFICATIONS_TEST_ADMIN_URL;
    if (!configuredUrl) throw new Error('NOTIFICATIONS_TEST_ADMIN_URL is required');
    const adminUrl = new URL(configuredUrl);
    if (!['localhost', '127.0.0.1'].includes(adminUrl.hostname)) {
      throw new Error('Use a local disposable PostgreSQL server');
    }
    admin = new Pool({ connectionString: adminUrl.toString() });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    adminUrl.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: adminUrl.toString() });
    const root = resolve(__dirname, '../../../../..');
    for (const path of [
      'migrations/tenant/core/0001-core-schema.sql',
      'migrations/tenant/core/0008-notifications.sql',
    ]) {
      await pool.query(await readFile(resolve(root, path), 'utf8'));
    }
    await pool.query(
      `INSERT INTO core_schema.users
        (id, username, full_name, email, password_hash)
       VALUES ($1, 'notification-user', 'Notification User',
         'notification@test.local', 'test')`,
      [userId],
    );
    store = new PostgresNotificationStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
    if (!/^notification_test_[a-f0-9]{32}$/.test(databaseName)) {
      throw new Error('Unsafe test database name');
    }
    await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin?.end();
  });

  const event = (eventId = randomUUID()) => ({
    id: eventId,
    tenantId,
    userId,
    type: 'workspace.work-item.assigned',
    version: 1,
    occurredAt: new Date().toISOString(),
    sourceType: 'workspace_work_item',
    sourceId: randomUUID(),
    title: 'Bạn có công việc mới',
    body: 'Công việc đã được giao cho bạn.',
    deepLink: '/workspace/work-items/42',
    data: { workItemId: '42' },
  });

  const policy = {
    module: 'workspace' as const,
    category: 'assignment',
    priority: 'actionable' as const,
    feedEnabled: true,
    toastEnabled: true,
  };

  it('creates one notification and ignores redelivery atomically', async () => {
    const input = event();
    const first = await store.process(input, policy);
    const duplicate = await store.process(input, policy);

    expect(first.status).toBe('created');
    if (first.status !== 'created') throw new Error('Expected a created notification');
    expect(first.sequence).toBe(1);
    expect(duplicate).toEqual({ status: 'duplicate' });
    await expect(store.summary(userId)).resolves.toEqual({
      unreadCount: 1,
      lastSequence: 1,
    });
  });

  it('rolls back inbox ownership when a later statement fails', async () => {
    const input = event();
    await expect(
      store.process({ ...input, userId: randomUUID() }, policy),
    ).rejects.toThrow();

    const inbox = await pool.query(
      `SELECT 1 FROM notification_schema.inbox_messages
       WHERE consumer = 'notification-worker' AND event_id = $1`,
      [input.id],
    );
    expect(inbox.rowCount).toBe(0);
  });

  it('aggregates within a window and emits one sequence per mutation', async () => {
    const source = randomUUID();
    const first = event();
    const second = { ...event(), sourceId: source };
    const aggregatePolicy = {
      ...policy,
      aggregationKey: 'workspace:mentions',
      aggregationWindowMinutes: 15,
    };

    const created = await store.process(
      { ...first, sourceId: source },
      aggregatePolicy,
    );
    const updated = await store.process(second, aggregatePolicy);

    expect(created.status).toBe('created');
    expect(updated.status).toBe('updated');
    if (created.status !== 'created' || updated.status !== 'updated') {
      throw new Error('Expected aggregation to create and then update');
    }
    expect(updated.notification?.aggregateCount).toBe(2);
    expect(updated.sequence).toBe(created.sequence + 1);
  });

  it('supports read, unread, read-all, listing, preferences and sync gaps', async () => {
    const created = await store.process(event(), policy);
    if (created.status !== 'created') throw new Error('Expected a created notification');
    const id = created.notification?.id;
    expect(id).toBeDefined();
    if (!id) throw new Error('Expected notification id');

    await store.setRead(tenantId, userId, id, true);
    expect((await store.list(userId, { unread: true })).items).toHaveLength(0);
    await store.setRead(tenantId, userId, id, false);
    await store.readAll(tenantId, userId);
    expect((await store.summary(userId)).unreadCount).toBe(0);

    await store.setPreferences(userId, [
      { ...policy, module: 'workspace', category: 'assignment' },
    ]);
    expect(await store.preferences(userId)).toContainEqual({
      ...policy,
      module: 'workspace',
      category: 'assignment',
    });

    const current = await store.summary(userId);
    expect((await store.sync(userId, current.lastSequence)).events).toEqual([]);
    expect((await store.sync(userId, -1)).resetRequired).toBe(true);
  });

  it('expires unread rows without leaving the summary counter stale', async () => {
    const before = await store.summary(userId);
    const created = await store.process(event(), policy);
    if (created.status !== 'created') throw new Error('Expected a created notification');
    await pool.query(
      `UPDATE notification_schema.notifications
          SET expires_at = now() - interval '1 second'
        WHERE id = $1`,
      [created.notification.id],
    );

    await expect(store.removeExpired(tenantId)).resolves.toEqual(
      expect.objectContaining({ notifications: 1 }),
    );
    await expect(store.summary(userId)).resolves.toEqual({
      unreadCount: before.unreadCount,
      lastSequence: created.sequence + 1,
    });
  });
});
