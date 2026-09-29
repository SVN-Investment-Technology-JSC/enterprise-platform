import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { ProcedureActor } from '@enterprise-platform/module-procedure-engine';
import type { TenantOrganizationContextClient } from './tenant-organization-context.client';
import { ProcedureAccessGuard } from './procedure-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({ payload: { principal: {
    kind: 'tenant-user', userId: 'user', sessionId: 'session', tenantId: 'tenant', roles: ['tenant-admin'],
  } } })),
}));

describe('Procedure capability mapping', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  it.each([
    [[], false, false, false, false],
    [['procedure.definition.manage'], true, false, false, false],
    [['procedure.definition.publish'], false, true, false, false],
    [['procedure.instance.create'], false, false, true, false],
    [['procedure.instance.override'], false, false, false, true],
  ])('maps only fresh action grants: %j', async (permissions, canDesign, canPublish, canCreateInstances, isOverride) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      allowed: true, database: { tenantId: 'tenant' },
      principal: { tenantId: 'tenant', userId: 'user', membershipId: 'user', permissions, roles: [] },
    }) });
    const guard = new ProcedureAccessGuard(
      { register: jest.fn() } as unknown as TenantDatabaseRegistry,
      { load: jest.fn(async () => ({ membershipSubjects: {}, units: [], members: [] })) } as unknown as TenantOrganizationContextClient,
    );
    const request = { method: 'GET', path: '/api/procedure/v1/workspace', headers: { authorization: 'Bearer token' }, procedureActor: undefined as ProcedureActor | undefined };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.procedureActor).toMatchObject({ canDesign, canPublish, canCreateInstances, isOverride });
  });
});
