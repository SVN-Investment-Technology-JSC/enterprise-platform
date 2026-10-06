import { PostgresNotificationTenantRuntimeRegistry } from './notification-runtime';

describe('tenant notification maintenance', () => {
  it.each([true, false])('holds the lifecycle guard and only drains an active tenant (%s)', async (active) => {
    const platformClient = {
      query: jest.fn(async (sql: string) => sql.includes('pg_try_advisory_lock')
        ? { rows: [{ locked: true }], rowCount: 1 } : { rows: [], rowCount: active ? 1 : 0 }),
      on: jest.fn(), off: jest.fn(), release: jest.fn(),
    };
    const platform = {
      connect: async () => platformClient,
      query: jest.fn().mockResolvedValue({ rows: [{ tenant_id: 'tenant-a', database_name: 'tenant-a', host: 'db', port: 5432, secret_ref: 'env:TENANT_DB_PASSWORD', ssl: false, config_version: 1 }] }),
    };
    const query = jest.fn(async (sql: string) => sql.includes('to_regclass')
      ? { rows: [{ notifications: true, outbox: true }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const pool = { query, connect: async () => ({ query, release: jest.fn() }) };
    const pools = { forTenant: jest.fn().mockResolvedValue(pool), closeTenant: jest.fn() };
    const registry = new PostgresNotificationTenantRuntimeRegistry(platform as never, pools as never, { publish: jest.fn() });
    await registry.maintain('tenant-a', { schedule: false, cleanup: false }, new Date());
    expect(pools.forTenant).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(query.mock.calls.some(([sql]) => sql.includes('WHERE published_at IS NULL'))).toBe(active);
    expect(platformClient.release).toHaveBeenCalled();
  });
});
