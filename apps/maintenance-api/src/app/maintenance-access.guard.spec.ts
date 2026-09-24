import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { MaintenanceAccessGuard } from './maintenance-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({ payload: { principal: {
    kind: 'tenant-user', userId: 'user', sessionId: 'session', tenantId: 'tenant',
    permissions: ['maintenance.manage'],
  } } })),
}));

describe('maintenance module capabilities', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  function setup(permissions: string[], path: string, method = 'POST') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({
        allowed: true, database: { tenantId: 'tenant' },
        principal: { tenantId: 'tenant', userId: 'user', displayName: 'User', permissions },
      }),
    });
    const register = jest.fn();
    const guard = new MaintenanceAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path: '/api/maintenance/v1' + path, method,
      headers: { authorization: 'Bearer token', 'x-csrf-token': 'csrf' },
      cookies: { ep_csrf: 'csrf' },
      maintenanceActor: undefined as undefined | { canManage: boolean; canHandleOccurrences: boolean },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }
  it('ignores stale elevated JWT claims and rejects a read-only mutation', async () => {
    const { guard, context, register } = setup(['maintenance.read'], '/schedules');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(register).not.toHaveBeenCalled();
  });
  it('allows narrow operations without granting management', async () => {
    const { guard, context, request } = setup(['maintenance.read', 'maintenance.occurrence.manage'], '/occurrences/incidents');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.maintenanceActor).toMatchObject({ canManage: false, canHandleOccurrences: true });
  });
  it('rejects management for a narrow operator', async () => {
    const { guard, context } = setup(['maintenance.read', 'maintenance.occurrence.manage'], '/schedules');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });
  it('allows read requests without write capabilities', async () => {
    const { guard, context, request } = setup(['maintenance.read'], '/schedules', 'GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.maintenanceActor).toMatchObject({ canManage: false, canHandleOccurrences: false });
  });
});
