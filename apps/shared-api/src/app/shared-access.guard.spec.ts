import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import {
  StorageSecrets,
  TenantStorageRouter,
  type StreamingStorage,
} from '@enterprise-platform/module-shared';
import { SharedAccessGuard } from './shared-access.guard';

const secrets = StorageSecrets.fromSecret('khoa-goc-du-dai-cho-test-0123456789abcdef');
const router = new TenantStorageRouter(
  { storageSettings: { get: async () => undefined, save: async () => undefined } },
  { secrets, platform: {} as StreamingStorage },
);

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
    const guard = new SharedAccessGuard({ register } as unknown as TenantDatabaseRegistry, router);
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

describe('SharedAccessGuard route chuyển tiếp tệp', () => {
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

  const ticket = (operation: 'get' | 'put', expiresIn = 300) =>
    secrets.signTicket({ t: 't9', k: 'tenants/t9/shared/a/v1-x.pdf', o: operation, e: Math.floor(Date.now() / 1000) + expiresIn });

  function setup(method: string, token: string, registered = false) {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ database: { tenantId: 't9' } }) });
    const register = jest.fn();
    const require = jest.fn(() => {
      if (!registered) throw new Error('chưa đăng ký');
      return { tenantId: 't9' };
    });
    const guard = new SharedAccessGuard({ register, require } as unknown as TenantDatabaseRegistry, router);
    const request = { path: `/api/shared/v1/files/${token}`, method, headers: {}, cookies: {}, sharedActor: undefined };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, context, request, register };
  }

  it('phiếu hợp lệ thì mở DB của tenant trong phiếu, không cần phiên đăng nhập hay CSRF, không gắn actor', async () => {
    const { guard, context, request, register } = setup('PUT', ticket('put'));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ tenantId: 't9' });
    expect(request.sharedActor).toBeUndefined();
  });

  it('DB đã đăng ký thì không hỏi lại Platform', async () => {
    const { guard, context, register } = setup('GET', ticket('get'), true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('phiếu sai chữ ký, hết hạn, hay dùng sai thao tác thì 403', async () => {
    const forged = ticket('get').replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'));
    for (const [method, token] of [
      ['GET', forged],
      ['GET', ticket('get', -10)],
      ['GET', ticket('put')],
      ['DELETE', ticket('get')],
    ] as const) {
      const { guard, context } = setup(method, token);
      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    }
  });
});
