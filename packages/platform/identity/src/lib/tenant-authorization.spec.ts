import { TenantAuthorizationService, uuid } from './tenant-authorization.js';
import type { createPostgresPool } from '@enterprise-platform/adapter-database';

describe('Tenant authorization cache', () => {
  let revision: string;
  let active: boolean;
  let modules: string[];
  let actions: string[];
  let clock: number;
  let query: jest.Mock;
  let service: TenantAuthorizationService;
  beforeEach(() => {
    revision = '1';
    active = true;
    modules = ['procedure-engine'];
    actions = ['core.users.read', 'tenant.manage'];
    clock = 0;
    query = jest.fn(async (sql: string) => {
      if (sql.includes('s.revision'))
        return { rows: active ? [{ revision }] : [] };
      if (sql.includes('SELECT r.key'))
        return { rows: [{ key: 'custom-role' }] };
      if (sql.includes('pa.action_key'))
        return { rows: actions.map((key) => ({ key })) };
      if (sql.includes('rm.module_key'))
        return { rows: modules.map((key) => ({ key })) };
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
    expect(query).toHaveBeenCalledTimes(4);
    expect(await service.resolve('tenant-a', 'user')).toEqual(first);
    expect(query).toHaveBeenCalledTimes(5);
  });
  it('separates HRM module admission, calculation, finalization and payment and revokes immediately', async () => {
    modules = ['hrm'];
    actions = ['hrm.payroll.calculate'];
    const access = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'hrm',
        'hrm.payroll.calculate',
      ),
    ).toBe(true);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'hrm',
        'hrm.payroll.read',
      ),
    ).toBe(true);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'hrm',
        'hrm.payroll.finalize',
      ),
    ).toBe(false);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'hrm',
        'hrm.payroll.pay',
      ),
    ).toBe(false);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'hrm',
        'hrm.employee.read',
      ),
    ).toBe(false);
    revision = '2';
    actions = ['hrm.self.read'];
    const revoked = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        revoked,
        'hrm',
        'hrm.payroll.calculate',
      ),
    ).toBe(false);
    revision = '3';
    modules = [];
    actions = ['hrm.manage'];
    const noModule = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        noModule,
        'hrm',
        'hrm.payroll.pay',
      ),
    ).toBe(false);
  });
  it('invalidates on revision change, including changes from another replica', async () => {
    const first = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        first,
        'procedure-engine',
        'module.access',
      ),
    ).toBe(true);
    modules = [];
    revision = '2';
    const next = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        next,
        'procedure-engine',
        'module.access',
      ),
    ).toBe(false);
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
    expect(query).toHaveBeenCalledTimes(8);
    clock = 30_001;
    await service.resolve('tenant-a', 'user');
    expect(query).toHaveBeenCalledTimes(12);
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
  it('rejects arbitrary actions even with wildcard module access', async () => {
    modules = ['*'];
    const access = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'procedure-engine',
        'platform.manage',
      ),
    ).toBe(false);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'unknown',
        'module.access',
      ),
    ).toBe(false);
  });
  it('validates IDs before database access', () => {
    expect(() => uuid('not-a-uuid')).toThrow();
  });

  it('does not turn module admission into action grants', async () => {
    modules = ['*'];
    const access = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'procedure-engine',
        'module.access',
      ),
    ).toBe(true);
    for (const [module, permission] of [
      ['inventory', 'inventory.read'],
      ['inventory', 'inventory.manage'],
      ['maintenance', 'maintenance.occurrence.manage'],
      ['procedure-engine', 'procedure.definition.manage'],
    ])
      expect(
        service.allowsModule('tenant-a', 'user', access, module, permission),
      ).toBe(false);
  });

  it('requires BOTH module admission and the correct action namespace', async () => {
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
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'inventory',
        'inventory.manage',
      ),
    ).toBe(false);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'procedure-engine',
        'inventory.manage',
      ),
    ).toBe(false);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'procedure-engine',
        'procedure.instance.create',
      ),
    ).toBe(true);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        access,
        'procedure-engine',
        'procedure.definition.manage',
      ),
    ).toBe(false);
  });

  it('revokes a cached module action after a permission revision changes', async () => {
    modules = ['inventory'];
    actions = ['inventory.read', 'inventory.transaction.write'];
    const first = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        first,
        'inventory',
        'inventory.transaction.write',
      ),
    ).toBe(true);
    actions = ['inventory.read'];
    revision = '2';
    const next = await service.resolve('tenant-a', 'user');
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        next,
        'inventory',
        'inventory.transaction.write',
      ),
    ).toBe(false);
    expect(
      service.allowsModule(
        'tenant-a',
        'user',
        next,
        'inventory',
        'inventory.read',
      ),
    ).toBe(true);
  });
});
