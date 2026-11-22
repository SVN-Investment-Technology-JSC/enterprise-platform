import { seedPlatform, SUPER_ADMIN_ID } from './seed-platform';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createFakePool(options: { superAdminExists: boolean }) {
  const queries: RecordedQuery[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/SELECT id FROM identity_schema\.users/.test(sql)) {
        return { rows: options.superAdminExists ? [{ id: SUPER_ADMIN_ID }] : [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client) };
  return { pool: pool as unknown as Parameters<typeof seedPlatform>[0], queries };
}

const findAll = (queries: RecordedQuery[], pattern: RegExp) => queries.filter((query) => pattern.test(query.sql));
const usersWrites = (queries: RecordedQuery[]) => findAll(queries, /(INSERT INTO|UPDATE) identity_schema\.users/);
const modulesUpsert = (queries: RecordedQuery[]) =>
  findAll(queries, /INSERT INTO module_registry_schema\.modules \(id, key, name, description, launch_url, icon, version\) VALUES/);

describe('seedPlatform', () => {
  it('OPS003-02: seeding again with an existing Super Admin does not touch password or status', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await seedPlatform(pool, { SEED_SUPERADMIN_PASSWORD: 'secret-from-env' });

    expect(usersWrites(queries)).toHaveLength(0);
    expect(queries.some((query) => query.params.length > 0 && JSON.stringify(query.params).includes('scrypt$'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('OPS003-02: module catalogue upsert only refreshes key, launch_url and version', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await seedPlatform(pool, {});

    const [upsert] = modulesUpsert(queries);
    expect(upsert).toBeDefined();
    const conflictClause = upsert.sql.slice(upsert.sql.indexOf('ON CONFLICT'));
    expect(conflictClause).toBe(
      'ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, launch_url = EXCLUDED.launch_url, version = EXCLUDED.version',
    );
    for (const column of ['name', 'description', 'icon', 'status']) {
      expect(conflictClause).not.toMatch(new RegExp(`\\b${column}\\s*=`));
    }
  });

  it('OPS003-03: an empty database gets Super Admin, both roles, permissions and every module', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: false });
    await seedPlatform(pool, { SEED_SUPERADMIN_PASSWORD: 'first-password' });

    const [insertUser] = findAll(queries, /INSERT INTO identity_schema\.users/);
    expect(insertUser.sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(insertUser.sql).not.toContain('DO UPDATE');
    expect(insertUser.params[0]).toBe(SUPER_ADMIN_ID);
    expect(String(insertUser.params[1])).toMatch(/^scrypt\$/);

    const [roles] = findAll(queries, /INSERT INTO authorization_schema\.roles/);
    expect(roles.sql).toContain("'platform-admin'");
    expect(roles.sql).toContain("'tenant-admin'");
    expect(findAll(queries, /INSERT INTO authorization_schema\.permissions/)).toHaveLength(1);
    expect(findAll(queries, /INSERT INTO authorization_schema\.user_roles/)).toHaveLength(1);
    const [modules] = modulesUpsert(queries);
    for (const key of ['procedure-engine', 'maintenance', 'inventory', 'workspace', 'hrm', 'assistant', 'finance', 'shared']) {
      expect(modules.sql).toContain(`'${key}'`);
    }
  });

  it('OPS003-04: SEED_SUPERADMIN_RESET_PASSWORD=true resets the password and reactivates the account', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await seedPlatform(pool, { SEED_SUPERADMIN_PASSWORD: 'new-password', SEED_SUPERADMIN_RESET_PASSWORD: 'true' });

    const updates = findAll(queries, /UPDATE identity_schema\.users/);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('password_hash = $2');
    expect(updates[0].sql).toContain("status = 'active'");
    expect(updates[0].params[0]).toBe(SUPER_ADMIN_ID);
    expect(String(updates[0].params[1])).toMatch(/^scrypt\$/);
  });

  it('OPS003-04: reset without a password fails and names both variables', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await expect(seedPlatform(pool, { SEED_SUPERADMIN_RESET_PASSWORD: 'true' })).rejects.toThrow(
      /SEED_SUPERADMIN_PASSWORD.*SEED_SUPERADMIN_RESET_PASSWORD=true/,
    );
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('OPS003-05: missing password is fine when Super Admin already exists', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await expect(seedPlatform(pool, {})).resolves.toBeUndefined();
    expect(usersWrites(queries)).toHaveLength(0);
  });

  it('OPS003-06: missing password when Super Admin must be created fails with the variable name', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: false });
    await expect(seedPlatform(pool, {})).rejects.toThrow(/SEED_SUPERADMIN_PASSWORD/);
    expect(usersWrites(queries)).toHaveLength(0);
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('OPS003-07: missing module rows are inserted again with their Vietnamese names', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await seedPlatform(pool, {});

    const [modules] = modulesUpsert(queries);
    expect(modules.sql).toContain("'hrm', 'HRM & Chấm công'");
    expect(modules.sql).toContain("'finance', 'Tài chính'");
    expect(modules.sql).toContain("'shared', 'Hệ dùng chung'");
    // The legacy hrm id migration block is kept before the upsert.
    const doBlock = queries.findIndex((query) => query.sql.includes("'hrm-temp'"));
    expect(doBlock).toBeGreaterThan(-1);
    expect(doBlock).toBeLessThan(queries.indexOf(modules));
  });

  it('OPS003-08: permissions and role links are still inserted with DO NOTHING', async () => {
    const { pool, queries } = createFakePool({ superAdminExists: true });
    await seedPlatform(pool, {});

    const [permissions] = findAll(queries, /INSERT INTO authorization_schema\.permissions/);
    expect(permissions.sql).toContain("'hrm.read'");
    expect(permissions.sql).toContain("'workspace.read'");
    expect(permissions.sql.trim().endsWith('ON CONFLICT (id) DO NOTHING')).toBe(true);
    const [rolePermissions] = findAll(queries, /INSERT INTO authorization_schema\.role_permissions/);
    expect(rolePermissions.sql.trim().endsWith('ON CONFLICT DO NOTHING')).toBe(true);
  });
});
