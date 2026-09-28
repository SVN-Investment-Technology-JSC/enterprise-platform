import type { Request } from 'express';
import type { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import type { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { jwtVerify } from 'jose';
import { HrmContextService } from './hrm-context.service';
jest.mock('@enterprise-platform/platform-identity', () => ({
  PlatformIdentityService: class {},
}));
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe('HRM authentication and tenant boundary', () => {
  const principal = {
    kind: 'tenant-user',
    tenantId: 'tenant-a',
    userId: 'user-a',
    sessionId: 'session-a',
  };
  const identity = { decide: jest.fn() },
    pools = { forTenant: jest.fn() };
  const service = new HrmContextService(
    identity as unknown as PlatformIdentityService,
    pools as unknown as PostgresPoolRegistry,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    (jwtVerify as jest.Mock).mockResolvedValue({ payload: { principal } });
  });
  it('rejects missing sessions and cookie mutations without matching CSRF', async () => {
    await expect(
      service.getContext({
        method: 'GET',
        headers: {},
        cookies: {},
      } as Request),
    ).rejects.toThrow('Missing authentication');
    await expect(
      service.getContext({
        method: 'POST',
        headers: {},
        cookies: { ep_access: 'test' },
      } as Request),
    ).rejects.toThrow('CSRF');
    expect(identity.decide).not.toHaveBeenCalled();
  });
  it('requires an active entitlement and permission before opening tenant storage', async () => {
    identity.decide.mockResolvedValue({
      allowed: false,
      code: 'ENTITLEMENT_DISABLED',
    });
    await expect(
      service.getContext(
        { method: 'GET', headers: { authorization: 'Bearer test' } } as Request,
        'hrm.manage',
      ),
    ).rejects.toThrow('permissions');
    expect(pools.forTenant).not.toHaveBeenCalled();
    expect(identity.decide).toHaveBeenCalledWith({
      ...{ sessionId: 'session-a', userId: 'user-a', tenantId: 'tenant-a' },
      moduleKey: 'hrm',
      permission: 'hrm.manage',
    });
  });
  it('uses only the verified principal tenant and the Core database decision', async () => {
    const database = { tenantId: 'tenant-a', databaseName: 'tenant_a' },
      pool = { query: jest.fn() };
    identity.decide.mockResolvedValue({ allowed: true, database });
    pools.forTenant.mockResolvedValue(pool);
    const result = await service.getContext({
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf', 'x-tenant-id': 'attacker' },
      cookies: { ep_access: 'test', ep_csrf: 'csrf' },
    } as unknown as Request);
    expect(result.tenantId).toBe('tenant-a');
    expect(pools.forTenant).toHaveBeenCalledWith(database);
  });
  it('scopes self-service to the linked employee using fresh permissions, not JWT grants', async () => {
    const pool = {
      query: jest.fn(async () => ({
        rows: [{ id: 'employee-a', full_name: 'Employee A' }],
      })),
    };
    identity.decide.mockResolvedValue({
      allowed: true,
      database: { tenantId: 'tenant-a' },
      principal: { ...principal, permissions: ['hrm.read', 'hrm.self.read'] },
    });
    pools.forTenant.mockResolvedValue(pool);
    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer test' },
    } as Request;
    expect((await service.scoped(req, 'hrm.request.read')).employeeId).toBe(
      'employee-a',
    );
    await expect(
      service.scoped(req, 'hrm.request.read', 'employee-b'),
    ).rejects.toThrow('bản thân');
  });
});
