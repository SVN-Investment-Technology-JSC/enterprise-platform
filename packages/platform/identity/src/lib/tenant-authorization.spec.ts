import { TenantAuthorizationService, uuid } from './tenant-authorization.js';
import type { createPostgresPool } from '@enterprise-platform/adapter-database';

describe('Tenant authorization cache', () => {
  let revision: string;
  let active: boolean;
  let roles: string[];
  let actions: string[];
  let clock: number;
  let query: jest.Mock;
  let service: TenantAuthorizationService;
  const allows = (
    access: Awaited<ReturnType<TenantAuthorizationService['resolve']>>,
    module: string,
    permission: string,
  ) => service.allowsModule('tenant-a', 'user', access, module, permission);
  beforeEach(() => {
    revision = '1';
    active = true;
    roles = ['custom-role'];
    actions = ['core.users.read', 'tenant.manage'];
    clock = 0;
    query = jest.fn(async (sql: string) => {
      if (sql.includes('s.revision'))
        return {
          rows: active
            ? [{ revision, id: 'user', email: 'u@x.vn', fullName: 'User', systemRole: 'tenant-user' }]
            : [],
        };
      if (sql.includes('SELECT r.key'))
        return { rows: roles.map((key) => ({ key })) };
      if (sql.includes('pa.action_key'))
        return { rows: actions.map((key) => ({ key })) };
      throw new Error(sql);
    });
    service = new TenantAuthorizationService(
      async (_tenant, operation) =>
        operation({ query } as unknown as ReturnType<
          typeof createPostgresPool
        >),
      () => clock,
    );
  });
  it('reuses computed permissions but checks the DB fence on every hit', async () => {
    const first = await service.resolve('tenant-a', 'user');
    expect(first.permissions).toEqual(['core.users.read']);
    expect(query).toHaveBeenCalledTimes(3);
    expect(await service.resolve('tenant-a', 'user')).toEqual(first);
    expect(query).toHaveBeenCalledTimes(4);
  });
  it('separates HRM admission, calculation, finalization and payment and revokes immediately', async () => {
    actions = ['hrm.payroll.calculate'];
    const access = await service.resolve('tenant-a', 'user');
    expect(access.moduleKeys).toContain('hrm');
    expect(allows(access, 'hrm', 'hrm.payroll.calculate')).toBe(true);
    expect(allows(access, 'hrm', 'hrm.payroll.read')).toBe(true);
    expect(allows(access, 'hrm', 'hrm.payroll.finalize')).toBe(false);
    expect(allows(access, 'hrm', 'hrm.payroll.pay')).toBe(false);
    expect(allows(access, 'hrm', 'hrm.employee.read')).toBe(false);
    revision = '2';
    actions = ['hrm.self.read'];
    const revoked = await service.resolve('tenant-a', 'user');
    expect(allows(revoked, 'hrm', 'hrm.payroll.calculate')).toBe(false);
    revision = '3';
    actions = ['core.users.read'];
    const noHrm = await service.resolve('tenant-a', 'user');
    expect(noHrm.moduleKeys).not.toContain('hrm');
    expect(allows(noHrm, 'hrm', 'hrm.payroll.pay')).toBe(false);
    expect(allows(noHrm, 'hrm', 'module.access')).toBe(false);
  });
  it('invalidates on revision change, including changes from another replica', async () => {
    actions = ['procedure.access'];
    const first = await service.resolve('tenant-a', 'user');
    expect(allows(first, 'procedure-engine', 'module.access')).toBe(true);
    actions = [];
    revision = '2';
    const next = await service.resolve('tenant-a', 'user');
    expect(allows(next, 'procedure-engine', 'module.access')).toBe(false);
  });
  it('returns the user profile from the same fence query, on hit and miss', async () => {
    const miss = await service.resolveWithUser('tenant-a', 'user');
    expect(miss.user).toEqual({ id: 'user', email: 'u@x.vn', fullName: 'User', systemRole: 'tenant-user' });
    expect(query).toHaveBeenCalledTimes(3);
    const hit = await service.resolveWithUser('tenant-a', 'user');
    expect(hit.user).toEqual(miss.user);
    expect(hit.access).toEqual(miss.access);
    expect(query).toHaveBeenCalledTimes(4);
  });
  it('rejects disabled users even with a warm allow cache', async () => {
    await service.resolve('tenant-a', 'user');
    active = false;
    await expect(service.resolve('tenant-a', 'user')).rejects.toMatchObject({
      status: 401,
    });
  });
  it('isolates cache keys by tenant and refreshes after TTL', async () => {
    await service.resolve('tenant-a', 'user');
    await service.resolve('tenant-b', 'user');
    expect(query).toHaveBeenCalledTimes(6);
    clock = 30_001;
    await service.resolve('tenant-a', 'user');
    expect(query).toHaveBeenCalledTimes(9);
  });
  it('does not leak mutable cached arrays to callers', async () => {
    const access = await service.resolve('tenant-a', 'user');
    access.permissions.push('tenant.manage');
    expect(
      (await service.resolve('tenant-a', 'user')).permissions,
    ).not.toContain('tenant.manage');
  });
  it('fails closed when revision lookup fails', async () => {
    await service.resolve('tenant-a', 'user');
    query.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.resolve('tenant-a', 'user')).rejects.toThrow(
      'DB unavailable',
    );
  });
  it('rejects arbitrary actions even for the tenant admin', async () => {
    roles = ['tenant-admin'];
    const access = await service.resolve('tenant-a', 'user');
    expect(access.moduleKeys).toContain('*');
    expect(allows(access, 'procedure-engine', 'platform.manage')).toBe(false);
    expect(allows(access, 'unknown', 'module.access')).toBe(false);
  });
  it('validates IDs before database access', () => {
    expect(() => uuid('not-a-uuid')).toThrow();
  });

  it('grants module admission only, not other actions, to a user with procedure.access', async () => {
    actions = ['procedure.access'];
    const access = await service.resolve('tenant-a', 'user');
    expect(access.moduleKeys).toEqual(expect.arrayContaining(['procedure-engine']));
    expect(allows(access, 'procedure-engine', 'module.access')).toBe(true);
    for (const [module, permission] of [
      ['inventory', 'inventory.read'],
      ['inventory', 'inventory.manage'],
      ['maintenance', 'maintenance.occurrence.manage'],
      ['procedure-engine', 'procedure.definition.manage'],
    ])
      expect(allows(access, module, permission)).toBe(false);
  });

  it('derives module admission from actions in the same namespace', async () => {
    actions = [
      'inventory.manage',
      'maintenance.manage',
      'procedure.instance.create',
    ];
    const access = await service.resolve('tenant-a', 'user');
    expect(access.permissions).toEqual(
      expect.arrayContaining([
        'inventory.read',
        'inventory.transaction.write',
        'maintenance.read',
        'maintenance.occurrence.manage',
      ]),
    );
    expect(access.moduleKeys).toEqual(
      expect.arrayContaining(['inventory', 'maintenance', 'procedure-engine']),
    );
    expect(access.moduleKeys).not.toContain('hrm');
    expect(allows(access, 'inventory', 'inventory.manage')).toBe(true);
    expect(allows(access, 'procedure-engine', 'inventory.manage')).toBe(false);
    expect(allows(access, 'procedure-engine', 'procedure.instance.create')).toBe(
      true,
    );
    expect(
      allows(access, 'procedure-engine', 'procedure.definition.manage'),
    ).toBe(false);
  });

  it('revokes a cached module action after a permission revision changes', async () => {
    actions = ['inventory.read', 'inventory.transaction.write'];
    const first = await service.resolve('tenant-a', 'user');
    expect(allows(first, 'inventory', 'inventory.transaction.write')).toBe(true);
    actions = ['inventory.read'];
    revision = '2';
    const next = await service.resolve('tenant-a', 'user');
    expect(allows(next, 'inventory', 'inventory.transaction.write')).toBe(false);
    expect(allows(next, 'inventory', 'inventory.read')).toBe(true);
  });
});
