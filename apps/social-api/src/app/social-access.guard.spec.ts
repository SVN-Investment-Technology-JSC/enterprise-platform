import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { SocialAccessGuard } from './social-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe('SocialAccessGuard thực thi social.read / social.post.write (SEC-BE068-01)', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup(permissions: string[], roles: string[] = ['tenant-user']) {
    jest.spyOn(ModuleAccess.prototype, 'requireCsrfForMutation').mockImplementation(() => undefined);
    jest.spyOn(ModuleAccess.prototype, 'tenantUser').mockResolvedValue({
      kind: 'tenant-user',
      userId: 'u1',
      tenantId: 't1',
    } as never);
    jest.spyOn(ModuleAccess.prototype, 'decision').mockResolvedValue({
      allowed: true,
      database: { tenantId: 't1' },
      principal: { tenantId: 't1', userId: 'u1', displayName: 'Người thử', roles, permissions },
    } as never);
    const register = jest.fn();
    const guard = new SocialAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path: '/api/social/v1/feed',
      method: 'GET',
      headers: {},
      cookies: {},
      socialActor: undefined as undefined | Record<string, unknown>,
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }

  it('không có quyền Mạng nội bộ nào thì 403', async () => {
    const { guard, context, register } = setup(['hrm.read']);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(register).not.toHaveBeenCalled();
  });

  it('chỉ có social.read: cho qua, không được đăng bài', async () => {
    const { guard, context, request } = setup(['social.read']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.socialActor).toMatchObject({ canRead: true, canWrite: false, canModerate: false, canManage: false });
  });

  it('có social.post.write: đọc và đăng bài được', async () => {
    const { guard, context, request } = setup(['social.read', 'social.post.write']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.socialActor).toMatchObject({ canRead: true, canWrite: true });
  });

  it('social.manage bao hàm đọc, viết, kiểm duyệt', async () => {
    const { guard, context, request } = setup(['social.manage']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.socialActor).toMatchObject({ canRead: true, canWrite: true, canModerate: true, canManage: true });
  });

  it('quản trị tenant có mọi quyền dù không giữ action social', async () => {
    const { guard, context, request } = setup([], ['tenant-user', 'tenant-admin']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.socialActor).toMatchObject({ isTenantAdmin: true, canRead: true, canWrite: true });
  });
});
