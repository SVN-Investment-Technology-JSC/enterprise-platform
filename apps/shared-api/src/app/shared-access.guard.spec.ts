import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { SharedAccessGuard } from './shared-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe('SharedAccessGuard route nội bộ', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'dung';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  function setup(headers: Record<string, string>, path = '/api/shared/v1/internal/storage/capacity-check') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ database: { tenantId: 't1' } }),
    });
    const register = jest.fn();
    const guard = new SharedAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path,
      method: 'POST',
      headers,
      cookies: {},
      sharedActor: undefined as undefined | Record<string, unknown>,
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }

  it('thiếu hoặc sai service token thì 401', async () => {
    const missing = setup({ 'x-tenant-id': 't1' });
    await expect(missing.guard.canActivate(missing.context)).rejects.toMatchObject({ status: 401 });
    const wrong = setup({ 'x-service-token': 'sai', 'x-tenant-id': 't1' });
    await expect(wrong.guard.canActivate(wrong.context)).rejects.toMatchObject({ status: 401 });
  });

  it('chưa cấu hình INTERNAL_SERVICE_TOKEN thì từ chối cả header rỗng', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const { guard, context } = setup({ 'x-service-token': '', 'x-tenant-id': 't1' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
  });

  it('thiếu tenant thì 403', async () => {
    const { guard, context } = setup({ 'x-service-token': 'dung' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('token và tenant đúng thì cho qua với actor hệ thống không có quyền nào', async () => {
    const { guard, context, request, register } = setup({ 'x-service-token': 'dung', 'x-tenant-id': 't1' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(request.sharedActor).toMatchObject({
      tenantId: 't1',
      isTenantAdmin: false,
      canManage: false,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    });
  });

  it('route người dùng không nhận service token: thiếu CSRF thì 403', async () => {
    const { guard, context } = setup({ 'x-service-token': 'dung', 'x-tenant-id': 't1' }, '/api/shared/v1/folders');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });
});
