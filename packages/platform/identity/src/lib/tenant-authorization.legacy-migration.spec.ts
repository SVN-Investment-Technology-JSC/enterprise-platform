import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import { TenantAuthorizationService } from './tenant-authorization.js';

const integration = process.env.RBAC_TEST_ADMIN_URL ? describe : describe.skip;
integration('Legacy tenant RBAC upgrade', () => {
  let server: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let name: string;
  let base: string;
  let legacy: string;
  let compat: string;
  let rbac: string;
  let service: TenantAuthorizationService;
  beforeAll(async () => {
    const databaseUrl = process.env.RBAC_TEST_ADMIN_URL;
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
    )
      throw new Error('Use a local disposable PostgreSQL server');
    server = createPostgresPool(databaseUrl);
    const migrations = resolve(
      process.cwd(),
      '../../../migrations/tenant/core',
    );
    [base, legacy, compat, rbac] = await Promise.all([
      readFile(resolve(migrations, '0001-core-schema.sql'), 'utf8'),
      readFile(
        resolve(process.cwd(), 'src/lib/fixtures/legacy-tenant-rbac.sql'),
        'utf8',
      ),
      readFile(
        resolve(migrations, '0005-tenant-rbac-legacy-compat.sql'),
        'utf8',
      ),
      readFile(resolve(migrations, '0005-tenant-rbac.sql'), 'utf8'),
    ]);
  });
  beforeEach(async () => {
    name = 'rbac_test_' + randomUUID().replace(/-/g, '');
    await server.query(`CREATE DATABASE "${name}"`);
    const url = new URL(process.env.RBAC_TEST_ADMIN_URL ?? '');
    url.pathname = '/' + name;
    pool = createPostgresPool(url.toString());
    await pool.query(base);
    await pool.query(legacy);
    service = new TenantAuthorizationService(async (_tenant, operation) =>
      operation(pool),
    );
  }, 30_000);
  afterEach(async () => {
    if (pool) await pool.end();
    if (!/^rbac_test_[a-f0-9]{32}$/.test(name))
      throw new Error('Unsafe test database name');
    await server.query(`DROP DATABASE "${name}"`);
  }, 30_000);
  afterAll(async () => {
    if (server) await server.end();
  });

  const upgrade = async () => {
    // Matches production: prerequisite and main migration each in a transaction.
    await inTransaction(pool, (client) => client.query(compat));
    await inTransaction(pool, (client) => client.query(rbac));
  };
  const userId = async (n: number) =>
    (
      await pool.query<{ id: string }>(
        'SELECT id FROM core_schema.users WHERE email=$1',
        [`user${n}@test.local`],
      )
    ).rows[0].id;

  it('reproduces 42703, preserves all 45 assignments and supports CRUD after upgrade', async () => {
    const before = (
      await pool.query('SELECT * FROM core_schema.user_roles ORDER BY user_id')
    ).rows;
    await expect(
      inTransaction(pool, (client) => client.query(rbac)),
    ).rejects.toMatchObject({ code: '42703' });
    await upgrade();
    expect(
      (
        await pool.query(
          'SELECT * FROM core_schema.user_roles ORDER BY user_id',
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM core_schema.rbac_legacy_archive WHERE source_table='role_permissions'",
        )
      ).rows[0].n,
    ).toBe(6);
    const admin = await userId(1);
    const ordinary = await userId(2);
    expect((await service.resolve('tenant', admin)).roles).toContain(
      'tenant-admin',
    );
    expect(
      (await service.resolve('tenant', ordinary)).permissions,
    ).not.toContain('tenant.manage');
    expect(
      (await service.resolve('tenant', await userId(46))).moduleKeys,
    ).toEqual([]);
    const roles = await service.listRoles('tenant');
    expect(roles.find((r) => r.key === 'tenant-admin')?.id).toBe(
      'b0000000-0000-4000-8000-000000000001',
    );
    expect(roles.every((r) => r.description === '')).toBe(true);
    const p = await service.savePermission('tenant', admin, {
      name: 'Read users',
      actionKeys: ['core.users.read'],
    });
    const r = await service.saveRole(
      'tenant',
      admin,
      { name: 'Reader', permissionIds: [p.id], moduleKeys: [] },
      [],
    );
    await service.assignRoles('tenant', admin, ordinary, [r.id]);
    expect((await service.resolve('tenant', ordinary)).permissions).toEqual([
      'core.users.read',
    ]);
    await service.assignRoles('tenant', admin, ordinary, []);
    await service.remove('tenant', admin, 'roles', r.id);
    await service.remove('tenant', admin, 'permissions', p.id);
    const archive = (
      await pool.query(
        'SELECT * FROM core_schema.rbac_legacy_archive ORDER BY id',
      )
    ).rows;
    await upgrade();
    expect(
      (
        await pool.query(
          'SELECT * FROM core_schema.rbac_legacy_archive ORDER BY id',
        )
      ).rows,
    ).toEqual(archive);
    expect((await service.userRoles('tenant', ordinary)).roleIds).toEqual([]);
  });

  it('maps custom Core actions without adding transitional roles or module access', async () => {
    const id = randomUUID();
    const ordinary = await userId(2);
    await pool.query(
      "INSERT INTO core_schema.roles(id,code,name) VALUES($1,'reader','Reader')",
      [id],
    );
    await pool.query(
      "INSERT INTO core_schema.role_permissions VALUES($1,'core.users.read')",
      [id],
    );
    await pool.query('DELETE FROM core_schema.user_roles WHERE user_id=$1', [
      ordinary,
    ]);
    await pool.query(
      'INSERT INTO core_schema.user_roles(user_id,role_id) VALUES($1,$2)',
      [ordinary, id],
    );
    await upgrade();
    const access = await service.resolve('tenant', ordinary);
    expect(access.permissions).toEqual(['core.users.read']);
    expect(access.moduleKeys).toEqual([]);
    expect((await service.userRoles('tenant', ordinary)).roleIds).toEqual([id]);
    expect((await service.listPermissions('tenant'))[0].actionKeys).toEqual([
      'core.users.read',
    ]);
  });

  it('fails closed on unmapped custom permission keys without modifying old data', async () => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO core_schema.roles(id,code,name) VALUES($1,'custom','Custom')",
      [id],
    );
    await pool.query(
      "INSERT INTO core_schema.role_permissions VALUES($1,'platform.manage')",
      [id],
    );
    await expect(upgrade()).rejects.toThrow(
      'require explicit mapping: platform.manage',
    );
    expect(
      (
        await pool.query(
          "SELECT to_regclass('core_schema.rbac_legacy_archive') AS archive",
        )
      ).rows[0].archive,
    ).toBeNull();
    expect(
      (await pool.query('SELECT code FROM core_schema.roles WHERE id=$1', [id]))
        .rows[0].code,
    ).toBe('custom');
    expect(
      (
        await pool.query(
          'SELECT permission_key FROM core_schema.role_permissions WHERE role_id=$1',
          [id],
        )
      ).rows[0].permission_key,
    ).toBe('platform.manage');
  });

  it('does not silently activate disabled roles', async () => {
    await pool.query(
      "UPDATE core_schema.roles SET status='disabled' WHERE code='legacy-tenant-user'",
    );
    await expect(upgrade()).rejects.toThrow('contains disabled roles');
    expect(
      (
        await pool.query(
          "SELECT status FROM core_schema.roles WHERE code='legacy-tenant-user'",
        )
      ).rows[0].status,
    ).toBe('disabled');
  });
});
