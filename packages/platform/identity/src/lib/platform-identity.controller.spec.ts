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

describe('PlatformIdentityController rate limiting', () => {
  it('returns 429 after repeated failures and still allows a valid login for another email', async () => {
    const { UnauthorizedException } = await import('@nestjs/common');
    const { AuthRateLimiter } = await import('./auth-rate-limiter.js');
    const limiter = new AuthRateLimiter({
      enabled: true,
      emailRule: { max: 2, windowMs: 60_000 },
      ipRule: { max: 50, windowMs: 60_000 },
      maxKeys: 100,
    });
    const login = jest
      .fn()
      .mockRejectedValue(new UnauthorizedException('Email hoặc mật khẩu không đúng.'));
    const controller = new PlatformIdentityController(
      { login } as unknown as PlatformIdentityService,
      limiter,
    );
    const response = { cookie: jest.fn() } as unknown as Response;
    const req = { ip: '10.0.0.1' } as never;
    const input = { email: 'a@x.com', password: 'bad', portal: 'tenant' } as LoginRequest;
    await expect(controller.login(input, response, req)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.login(input, response, req)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.login(input, response, req)).rejects.toMatchObject({ status: 429 });
    expect(login).toHaveBeenCalledTimes(2);
    login.mockResolvedValue({
      principal: { kind: 'tenant-user' },
      accessToken: 'a',
      refreshToken: 'r',
      csrfToken: 'c',
    });
    await expect(
      controller.login({ ...input, email: 'b@x.com' }, response, req),
    ).resolves.toMatchObject({ redirectTo: '/dashboard' });
  });
});
