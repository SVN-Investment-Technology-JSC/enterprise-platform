import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { TenantProvisioningProcessor } from './tenant-provisioning.processor';
import { TENANT_CORE_MIGRATIONS, tenantModuleMigrations } from './tenant-migrations';

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM provisioning registry replay', () => {
  const name = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const root = resolve(__dirname, '../../../../..');
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let processor: TenantProvisioningProcessor;
  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Local DB required');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = '/' + name;
    pool = createPostgresPool(url.toString());
    processor = new TenantProvisioningProcessor(
      url.toString(),
      tenantModuleMigrations,
      TENANT_CORE_MIGRATIONS,
    );
    jest
      .spyOn(
        processor as unknown as {
          readMigration(path: string): Promise<string>;
        },
        'readMigration',
      )
      .mockImplementation((path) =>
        readFile(resolve(root, 'migrations', path), 'utf8'),
      );
    for (const path of [
      '0001-integration.sql',
    ]) {
      await pool.query(
        await readFile(resolve(root, 'migrations/tenant', path), 'utf8'),
      );
    }
  });
  afterAll(async () => {
    await pool?.end();
    await processor?.close();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(name))
        throw new Error('Invalid test DB');
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  }, 30_000);
  it('uses registry order and skips already recorded versions without changing checksums', async () => {
    // Exercise the same migration transaction/checksum implementation as the
    // provisioner without dispatching jobs or touching the platform database.
    const runner = processor as unknown as {
      migrate: (
        db: typeof pool,
        module: string,
        version: string,
        path: string,
      ) => Promise<void>;
    };
    const run = async () => {
      for (const migration of TENANT_CORE_MIGRATIONS) {
        await runner.migrate(pool, 'tenant-core', migration.version, migration.path);
      }
      for (const migration of tenantModuleMigrations('hrm')) {
        await runner.migrate(pool, 'hrm', migration.version, migration.path);
      }
    };
    await run();
    const before = await pool.query(
      `SELECT * FROM integration_schema.schema_migrations ORDER BY module_key,version`,
    );
    await run();
    const after = await pool.query(
      `SELECT * FROM integration_schema.schema_migrations ORDER BY module_key,version`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rowCount).toBe(TENANT_CORE_MIGRATIONS.length + tenantModuleMigrations('hrm').length);
    await expect(
      pool.query(
        'SELECT nationality FROM hrm_schema.employee_directory LIMIT 1',
      ),
    ).resolves.toBeDefined();
    await expect(
      pool.query('SELECT * FROM hrm_schema.employee_family_members LIMIT 1'),
    ).resolves.toBeDefined();
  });
});
