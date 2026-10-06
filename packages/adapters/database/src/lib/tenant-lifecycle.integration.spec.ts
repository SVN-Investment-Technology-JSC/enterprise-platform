import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { withActiveTenant } from './tenant-lifecycle.js';

const databaseUrl = process.env.TENANT_LIFECYCLE_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests('tenant lifecycle PostgreSQL locks', () => {
  let database: Pool;
  let tenants: Pool;
  let tenantId: string;

  beforeAll(() => {
    database = new Pool({ connectionString: databaseUrl, max: 4 });
    // Use real PostgreSQL locks on unique keys without creating or modifying tenants.
    tenants = {
      connect: async () => {
        const client = await database.connect();
        return {
          query: (sql: string, parameters: string[]) => sql.includes('FROM tenancy_schema.tenants')
            ? Promise.resolve({ rowCount: 1, rows: [{}] })
            : client.query(sql, parameters),
          on: client.on.bind(client),
          off: client.off.bind(client),
          release: client.release.bind(client),
        };
      },
    } as unknown as Pool;
  });
  beforeEach(() => { tenantId = randomUUID(); });
  afterAll(async () => { await database.end(); });

  it('allows two normal operations for the same tenant concurrently', async () => {
    const outer = await withActiveTenant(
      tenants,
      tenantId,
      async () => withActiveTenant(tenants, tenantId, async () => 'delivered', { mode: 'shared' }),
      { mode: 'shared' },
    );
    expect(outer).toEqual({ executed: true, value: { executed: true, value: 'delivered' } });
  });

  it('keeps the default exclusive lock out while a normal operation runs', async () => {
    const outer = await withActiveTenant(
      tenants,
      tenantId,
      async () => withActiveTenant(tenants, tenantId, async () => 'provisioned'),
      { mode: 'shared' },
    );
    expect(outer).toEqual({ executed: true, value: { executed: false, reason: 'busy' } });
  });

  it('prevents deletion from acquiring its exclusive lock while an operation runs', async () => {
    const deletion = await database.connect();
    const key = `tenant-lifecycle:${tenantId}`;
    try {
      await withActiveTenant(tenants, tenantId, async () => {
        const result = await deletion.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key]);
        expect(result.rows[0].locked).toBe(false);
      }, { mode: 'shared' });
      const result = await deletion.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key]);
      expect(result.rows[0].locked).toBe(true);
    } finally {
      await deletion.query('SELECT pg_advisory_unlock_all()');
      deletion.release();
    }
  });

  it('does not execute an operation while deletion holds the exclusive lock', async () => {
    const deletion = await database.connect();
    const operation = jest.fn();
    try {
      await deletion.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`tenant-lifecycle:${tenantId}`]);
      expect(await withActiveTenant(tenants, tenantId, operation, { mode: 'shared' })).toEqual({ executed: false, reason: 'busy' });
      expect(operation).not.toHaveBeenCalled();
    } finally {
      await deletion.query('SELECT pg_advisory_unlock_all()');
      deletion.release();
    }
  });

  it('releases the lifecycle lock when the operation fails', async () => {
    await expect(withActiveTenant(tenants, tenantId, async () => { throw new Error('connection interrupted'); }, { mode: 'shared' }))
      .rejects.toThrow('connection interrupted');
    const deletion = await database.connect();
    try {
      const result = await deletion.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`tenant-lifecycle:${tenantId}`]);
      expect(result.rows[0].locked).toBe(true);
    } finally {
      await deletion.query('SELECT pg_advisory_unlock_all()');
      deletion.release();
    }
  });
});
