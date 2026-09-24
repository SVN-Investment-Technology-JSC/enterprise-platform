import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { InventoryAccessGuard } from './inventory-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({ payload: { principal: {
    kind: 'tenant-user', userId: 'user', sessionId: 'session', tenantId: 'tenant',
    permissions: ['inventory.manage'],
  } } })),
}));

describe('inventory module capabilities', () => {
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
    const guard = new InventoryAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path: '/api/inventory/v1' + path, method,
      headers: { authorization: 'Bearer token', 'x-csrf-token': 'csrf' },
      cookies: { ep_csrf: 'csrf' },
      inventoryActor: undefined as undefined | { canManage: boolean; canWriteTransactions: boolean },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }
  it('ignores stale elevated JWT claims and rejects a read-only mutation', async () => {
    const { guard, context, register } = setup(['inventory.read'], '/materials');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(register).not.toHaveBeenCalled();
  });
  it('allows narrow operations without granting management', async () => {
    const { guard, context, request } = setup(['inventory.read', 'inventory.transaction.write'], '/receipts');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.inventoryActor).toMatchObject({ canManage: false, canWriteTransactions: true });
  });
  it('rejects management for a narrow operator', async () => {
    const { guard, context } = setup(['inventory.read', 'inventory.transaction.write'], '/materials');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });
  it('allows read requests without write capabilities', async () => {
    const { guard, context, request } = setup(['inventory.read'], '/materials', 'GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.inventoryActor).toMatchObject({ canManage: false, canWriteTransactions: false });
  });
});
