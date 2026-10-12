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

describe('PlatformIdentityController change password', () => {
  const principal = {
    kind: 'tenant-user',
    userId: 'user-1',
    sessionId: 'session-1',
    email: 'member@savina.com',
  } as AuthenticatedPrincipal;
  const request = (csrf = 'csrf') => ({
    ip: '10.0.0.2',
    headers: { 'x-csrf-token': csrf },
    cookies: { ep_access: 'access', ep_csrf: 'csrf' },
  }) as never;

  it('changes the password of the signed-in principal', async () => {
    const changeOwnPassword = jest.fn().mockResolvedValue({ revokedSessions: 2 });
    const controller = new PlatformIdentityController({
      verifyAccessToken: jest.fn().mockResolvedValue(principal),
      changeOwnPassword,
    } as unknown as PlatformIdentityService);
    const input = { currentPassword: 'old-password-1', newPassword: 'new-password-12' };

    await expect(controller.changePassword(input, request())).resolves.toEqual({ revokedSessions: 2 });
    expect(changeOwnPassword).toHaveBeenCalledWith(principal, input);
  });

  it('rejects a request without a matching CSRF token', async () => {
    const changeOwnPassword = jest.fn();
    const controller = new PlatformIdentityController({
      verifyAccessToken: jest.fn().mockResolvedValue(principal),
      changeOwnPassword,
    } as unknown as PlatformIdentityService);

    await expect(
      controller.changePassword({ currentPassword: 'a', newPassword: 'b' }, request('other')),
    ).rejects.toMatchObject({ status: 401 });
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it('returns 429 after repeated wrong current passwords', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const { AuthRateLimiter } = await import('./auth-rate-limiter.js');
    const limiter = new AuthRateLimiter({
      enabled: true,
      emailRule: { max: 2, windowMs: 60_000 },
      ipRule: { max: 50, windowMs: 60_000 },
      maxKeys: 100,
    });
    const changeOwnPassword = jest
      .fn()
      .mockRejectedValue(new BadRequestException('Mật khẩu hiện tại không đúng.'));
    const controller = new PlatformIdentityController(
      {
        verifyAccessToken: jest.fn().mockResolvedValue(principal),
        changeOwnPassword,
      } as unknown as PlatformIdentityService,
      limiter,
    );
    const input = { currentPassword: 'wrong', newPassword: 'new-password-12' };

    await expect(controller.changePassword(input, request())).rejects.toMatchObject({ status: 400 });
    await expect(controller.changePassword(input, request())).rejects.toMatchObject({ status: 400 });
    await expect(controller.changePassword(input, request())).rejects.toMatchObject({ status: 429 });
    expect(changeOwnPassword).toHaveBeenCalledTimes(2);
  });
});
