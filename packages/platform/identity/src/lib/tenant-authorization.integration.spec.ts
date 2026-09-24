import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { TenantAuthorizationService } from './tenant-authorization.js';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}

// Opt-in: creates and drops ONLY randomly named rbac_test_* databases.
const integration = process.env.RBAC_TEST_ADMIN_URL ? describe : describe.skip;
integration('Tenant RBAC PostgreSQL integration', () => {
  const names: string[] = [];
  const pools = new Map<string, ReturnType<typeof createPostgresPool>>();
  const adminId = randomUUID();
  const userId = randomUUID();
  const secondAdmin = randomUUID();
  let server: ReturnType<typeof createPostgresPool>;
  let service: TenantAuthorizationService;
  let migration: string;
  beforeAll(async () => {
    const databaseUrl = process.env.RBAC_TEST_ADMIN_URL;
    if (!databaseUrl) throw new Error('RBAC_TEST_ADMIN_URL is required');
    const url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error(
        'Integration tests require a local disposable PostgreSQL server.',
      );
    server = createPostgresPool(url.toString());
    const base = await readFile(
      resolve(
        process.cwd(),
        '../../../migrations/tenant/core/0001-core-schema.sql',
      ),
      'utf8',
    );
    migration = await readFile(
      resolve(
        process.cwd(),
        '../../../migrations/tenant/core/0005-tenant-rbac.sql',
      ),
      'utf8',
    );
    const compatibility = await readFile(
      resolve(
        process.cwd(),
        '../../../migrations/tenant/core/0005-tenant-rbac-legacy-compat.sql',
      ),
      'utf8',
    );
    for (const tenant of ['a', 'b']) {
      const name = 'rbac_test_' + randomUUID().replace(/-/g, '');
      await server.query(`CREATE DATABASE "${name}"`);
      names.push(name);
      const target = new URL(url);
      target.pathname = '/' + name;
      const pool = createPostgresPool(target.toString());
      pools.set(tenant, pool);
      await pool.query(base);
      for (const [id, role] of [
        [adminId, 'tenant-admin'],
        [userId, 'tenant-user'],
        [secondAdmin, 'tenant-admin'],
      ])
        await pool.query(
          'INSERT INTO core_schema.users(id,email,full_name,password_hash,system_role) VALUES($1,$2,$3,$4,$5)',
          [id, id + '@test.local', role, 'test-only-hash', role],
        );
      await pool.query(compatibility);
      await pool.query(migration);
      await pool.query(compatibility); // Already-normalized DB is also a no-op.
    }
    service = new TenantAuthorizationService(async (tenant, operation) => {
      const pool = pools.get(tenant);
      if (!pool) throw new Error('Unknown tenant');
      return operation(pool);
    });
  }, 30_000);
  afterAll(async () => {
    await Promise.all([...pools.values()].map((p) => p.end()));
    if (server) {
      for (const name of names) {
        if (!/^rbac_test_[a-f0-9]{32}$/.test(name))
          throw new Error('Unsafe test database name');
        await server.query(`DROP DATABASE "${name}"`);
      }
      await server.end();
    }
  }, 30_000);

  it('backfills old admins and users but never gives tenant.manage to regular users', async () => {
    expect((await service.resolve('a', adminId)).roles).toContain(
      'tenant-admin',
    );
    const access = await service.resolve('a', userId);
    expect(access.moduleKeys).toContain('*');
    expect(access.permissions).not.toContain('tenant.manage');
  });
  it('performs permission/role CRUD, assignment, union and cache revocation', async () => {
    const p = await service.savePermission('a', adminId, {
      name: 'Readers',
      actionKeys: ['core.users.read'],
    });
    const q = await service.savePermission('a', adminId, {
      name: 'Editors',
      actionKeys: ['core.organization.update'],
    });
    const r = await service.saveRole(
      'a',
      adminId,
      {
        name: 'Read role',
        permissionIds: [p.id],
        moduleKeys: ['procedure-engine'],
      },
      ['procedure-engine'],
    );
    const t = await service.saveRole(
      'a',
      adminId,
      { name: 'Edit role', permissionIds: [q.id], moduleKeys: [] },
      [],
    );
    await service.assignRoles('a', adminId, userId, [r.id, t.id]);
    const warm = await service.resolve('a', userId);
    expect(warm.permissions.sort()).toEqual([
      'core.organization.update',
      'core.users.read',
    ]);
    expect(
      service.allowsModule(
        'a',
        userId,
        warm,
        'procedure-engine',
        'module.access',
      ),
    ).toBe(true);
    await expect(
      service.remove('a', adminId, 'roles', r.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.remove('a', adminId, 'permissions', p.id),
    ).rejects.toMatchObject({ status: 409 });
    await service.savePermission(
      'a',
      adminId,
      { actionKeys: ['core.organization.read'] },
      p.id,
    );
    expect((await service.resolve('a', userId)).permissions).not.toContain(
      'core.users.read',
    );
    await service.saveRole(
      'a',
      adminId,
      { moduleKeys: [] },
      ['procedure-engine'],
      r.id,
    );
    const revoked = await service.resolve('a', userId);
    expect(
      service.allowsModule(
        'a',
        userId,
        revoked,
        'procedure-engine',
        'module.access',
      ),
    ).toBe(false);
    await service.assignRoles('a', adminId, userId, []);
    await service.remove('a', adminId, 'roles', r.id);
    await service.remove('a', adminId, 'roles', t.id);
    await service.remove('a', adminId, 'permissions', p.id);
    await service.remove('a', adminId, 'permissions', q.id);
    expect((await service.resolve('a', userId)).permissions).toEqual([]);
  });
  it('does not restore revoked roles when migration is rerun', async () => {
    await required(pools.get('a')).query(migration);
    expect((await service.userRoles('a', userId)).roleIds).toEqual([]);
    expect((await service.resolve('b', userId)).moduleKeys).toEqual(['*']);
  });
  it('rejects cross-tenant role/permission IDs and rolls back the write', async () => {
    const foreign = await service.savePermission('b', adminId, {
      name: 'Foreign',
      actionKeys: ['core.users.read'],
    });
    await expect(
      service.saveRole(
        'a',
        adminId,
        { name: 'Invalid', permissionIds: [foreign.id], moduleKeys: [] },
        [],
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await service.listRoles('a')).some((r) => r.name === 'Invalid'),
    ).toBe(false);
    await expect(
      service.savePermission(
        'a',
        adminId,
        { name: 'Foreign edit', actionKeys: ['core.users.read'] },
        foreign.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects admin-only operations by non-admin and unsupported actions', async () => {
    await expect(
      service.savePermission('a', userId, {
        name: 'Escalation',
        actionKeys: ['core.users.read'],
      }),
    ).rejects.toMatchObject({ status: 403 });
    for (const key of [
      'tenant.manage',
      'platform.manage',
      'procedure.approve',
      '*',
    ])
      await expect(
        service.savePermission('a', adminId, { name: key, actionKeys: [key] }),
      ).rejects.toMatchObject({ status: 400 });
  });
  it('protects system roles and blocks new legacy-role assignments', async () => {
    const roles = await service.listRoles('a');
    const admin = required(roles.find((r) => r.key === 'tenant-admin'));
    const legacy = required(roles.find((r) => r.key === 'legacy-tenant-user'));
    await expect(
      service.remove('a', adminId, 'roles', admin.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.saveRole('a', adminId, { name: 'Changed' }, [], admin.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assignRoles('a', adminId, userId, [legacy.id]),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('serializes concurrent admin removal and leaves an active admin', async () => {
    const results = await Promise.allSettled([
      service.assignRoles('a', adminId, adminId, []),
      service.assignRoles('a', secondAdmin, secondAdmin, []),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const remaining = await required(pools.get('a')).query(
      "SELECT ur.user_id FROM core_schema.user_roles ur JOIN core_schema.roles r ON r.id=ur.role_id WHERE r.key='tenant-admin'",
    );
    expect(remaining.rowCount).toBe(1);
    const actor = remaining.rows[0].user_id as string;
    await expect(
      service.mutate('a', actor, async (client) => {
        await client.query(
          "UPDATE core_schema.users SET status='disabled' WHERE id=$1",
          [actor],
        );
        await service.assertAdminRemains(client);
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.resolve('a', actor)).roles).toContain('tenant-admin');
  });
  it('persists module permissions and immediately revokes grants across replicas', async () => {
    const p = await service.savePermission('b', adminId, {
      name: 'Module operations',
      actionKeys: ['inventory.manage', 'maintenance.read', 'procedure.instance.create'],
    });
    const modules = ['inventory', 'maintenance', 'procedure-engine'];
    const r = await service.saveRole('b', adminId, { name: 'Operator', permissionIds: [p.id], moduleKeys: modules }, modules);
    await service.assignRoles('b', adminId, userId, [r.id]);
    const replica = new TenantAuthorizationService(async (tenant, operation) => operation(required(pools.get(tenant))));
    const before = await replica.resolve('b', userId);
    expect(replica.allowsModule('b', userId, before, 'inventory', 'inventory.transaction.write')).toBe(true);
    expect(replica.allowsModule('b', userId, before, 'maintenance', 'maintenance.manage')).toBe(false);
    expect(replica.allowsModule('b', userId, before, 'procedure-engine', 'procedure.definition.manage')).toBe(false);
    await service.savePermission('b', adminId, { name: 'Module operations', actionKeys: ['inventory.read'] }, p.id);
    const after = await replica.resolve('b', userId);
    expect(after.authorizationRevision).not.toBe(before.authorizationRevision);
    expect(replica.allowsModule('b', userId, after, 'inventory', 'inventory.transaction.write')).toBe(false);
    expect(replica.allowsModule('b', userId, after, 'inventory', 'inventory.read')).toBe(true);
    expect(replica.allowsModule('b', userId, after, 'procedure-engine', 'procedure.instance.create')).toBe(false);
    await service.assignRoles('b', adminId, userId, []);
  });
  it('does not let a delegated user editor take over a disabled admin account', async () => {
    const actor = (await service.resolve('a', adminId)).roles.includes(
      'tenant-admin',
    )
      ? adminId
      : secondAdmin;
    const p = await service.savePermission('a', actor, {
      name: 'User editor',
      actionKeys: ['core.users.update'],
    });
    const r = await service.saveRole(
      'a',
      actor,
      { name: 'Delegated editor', permissionIds: [p.id], moduleKeys: [] },
      [],
    );
    await service.assignRoles('a', actor, userId, [r.id]);
    const disabledAdminId = randomUUID();
    await required(pools.get('a')).query(
      "INSERT INTO core_schema.users(id,email,full_name,password_hash,system_role,status,is_active) VALUES($1,$2,'Disabled admin','test-only-hash','tenant-admin','disabled',false)",
      [disabledAdminId, disabledAdminId + '@test.local'],
    );
    await required(pools.get('a')).query(
      "INSERT INTO core_schema.user_roles SELECT $1,id FROM core_schema.roles WHERE key='tenant-admin'",
      [disabledAdminId],
    );
    await expect(
      service.mutate(
        'a',
        userId,
        (client) => service.protectAdmin(client, disabledAdminId, userId),
        'core.users.update',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('records before/after authorization changes without secrets', async () => {
    const audit = await required(pools.get('a')).query(
      'SELECT operation,before_data,after_data FROM core_schema.authorization_audit',
    );
    expect(audit.rowCount).toBeGreaterThan(5);
    expect(JSON.stringify(audit.rows)).not.toContain('password_hash');
  });
});
