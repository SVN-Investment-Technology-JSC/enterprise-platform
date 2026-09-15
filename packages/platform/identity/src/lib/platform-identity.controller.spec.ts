import type { AuthenticatedPrincipal, LoginRequest } from '@enterprise-platform/contracts-identity';
import type { Response } from 'express';
import { PlatformIdentityController } from './platform-identity.controller';
import type { PlatformIdentityService } from './platform-identity.service';

jest.mock('./platform-identity.service', () => ({
  PlatformIdentityService: class PlatformIdentityService {},
}));

describe('PlatformIdentityController login routing', () => {
  const tenantPrincipal: AuthenticatedPrincipal = {
    kind: 'tenant-user',
    userId: 'user-1',
    sessionId: 'session-1',
    email: 'admin@savina.com',
    displayName: 'Savina Admin',
    roles: ['tenant-admin'],
    permissions: ['tenant.manage'],
    tenantId: 'tenant-1',
    tenantSlug: 'savina',
    membershipId: 'user-1',
  };

  it.each([
    [tenantPrincipal, '/dashboard'],
    [{ ...tenantPrincipal, kind: 'platform-admin' } as AuthenticatedPrincipal, '/platform'],
  ])('returns the correct home for $kind', async (principal, redirectTo) => {
    const identity = {
      login: jest.fn().mockResolvedValue({
        principal,
        accessToken: 'access',
        refreshToken: 'refresh',
        csrfToken: 'csrf',
      }),
    } as unknown as PlatformIdentityService;
    const response = { cookie: jest.fn() } as unknown as Response;
    const controller = new PlatformIdentityController(identity);
    const input: LoginRequest = {
      email: principal.email,
      password: 'password',
      portal: principal.kind === 'platform-admin' ? 'platform' : 'tenant',
    };

    await expect(controller.login(input, response)).resolves.toEqual({
      principal,
      redirectTo,
    });
    expect(response.cookie).toHaveBeenCalledTimes(3);
  });
});
