import type { AuthenticatedPrincipal, TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { Request } from 'express';
import { ModuleAccess } from './module-access';

function request(overrides: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}): Request {
  return {
    path: overrides.path ?? '/api/workspace/v1/projects',
    method: overrides.method ?? 'GET',
    headers: overrides.headers ?? {},
    cookies: overrides.cookies ?? {},
  } as unknown as Request;
}

const tenantUser = {
  kind: 'tenant-user',
  sessionId: 's1',
  tenantId: 't1',
  userId: 'u1',
} as unknown as TenantUserPrincipal;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe('ModuleAccess', () => {
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;
  afterEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  describe('requireCsrfForMutation', () => {
    const access = new ModuleAccess({ moduleKey: 'workspace', verifyToken: async () => tenantUser });

    it('GET không cần CSRF', () => {
      expect(() => access.requireCsrfForMutation(request({}))).not.toThrow();
    });

    it('POST thiếu hoặc lệch token thì 403 CSRF_INVALID', () => {
      expect(() => access.requireCsrfForMutation(request({ method: 'POST' }))).toThrow();
      expect(() =>
        access.requireCsrfForMutation(
          request({ method: 'POST', headers: { 'x-csrf-token': 'a' }, cookies: { ep_csrf: 'b' } }),
        ),
      ).toThrow();
    });

    it('POST khớp cookie thì qua', () => {
      expect(() =>
        access.requireCsrfForMutation(
          request({ method: 'POST', headers: { 'x-csrf-token': 'a' }, cookies: { ep_csrf: 'a' } }),
        ),
      ).not.toThrow();
    });
  });

  describe('tenantUser', () => {
    it('không có token thì 401', async () => {
      const access = new ModuleAccess({ moduleKey: 'workspace', verifyToken: async () => tenantUser });
      await expect(access.tenantUser(request({}))).rejects.toMatchObject({ status: 401 });
    });

    it('Platform Admin bị chặn', async () => {
      const admin = { kind: 'platform-admin' } as unknown as AuthenticatedPrincipal;
      const access = new ModuleAccess({ moduleKey: 'workspace', verifyToken: async () => admin });
      await expect(
        access.tenantUser(request({ headers: { authorization: 'Bearer x' } })),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('token hỏng thì 401, không lộ lỗi của thư viện', async () => {
      const access = new ModuleAccess({
        moduleKey: 'workspace',
        verifyToken: async () => {
          throw new Error('JWSSignatureVerificationFailed');
        },
      });
      await expect(
        access.tenantUser(request({ cookies: { ep_access: 'x' } })),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('decision', () => {
    it('gửi đúng moduleKey và hỏi lại Platform mỗi lượt', async () => {
      const fetcher = jest.fn(async () => jsonResponse({ allowed: true }));
      const access = new ModuleAccess({
        moduleKey: 'inventory',
        fetcher: fetcher as unknown as typeof fetch,
        verifyToken: async () => tenantUser,
      });
      await access.decision(tenantUser, 'inventory.read');
      await access.decision(tenantUser, 'inventory.read');
      // Không cache: thu quyền hay tắt module phải có hiệu lực ngay lượt sau.
      expect(fetcher).toHaveBeenCalledTimes(2);
      const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(JSON.parse(String(init.body))).toMatchObject({ moduleKey: 'inventory' });
    });

    it('Platform lỗi thì 503 và không cache', async () => {
      const fetcher = jest.fn(async () => jsonResponse({}, 500));
      const access = new ModuleAccess({
        moduleKey: 'workspace',
        fetcher: fetcher as unknown as typeof fetch,
        verifyToken: async () => tenantUser,
      });
      await expect(access.decision(tenantUser, 'workspace.read')).rejects.toMatchObject({
        status: 503,
      });
      await expect(access.decision(tenantUser, 'workspace.read')).rejects.toMatchObject({
        status: 503,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('authorizeService', () => {
    const database = { tenantId: 't1' };
    const make = () => {
      const fetcher = jest.fn(async () => jsonResponse({ database }));
      return {
        fetcher,
        access: new ModuleAccess({
          moduleKey: 'workspace',
          fetcher: fetcher as unknown as typeof fetch,
          verifyToken: async () => tenantUser,
        }),
      };
    };

    it('INTERNAL_SERVICE_TOKEN chưa đặt thì từ chối, kể cả header rỗng', async () => {
      delete process.env.INTERNAL_SERVICE_TOKEN;
      const { access } = make();
      await expect(
        access.authorizeService(request({ headers: { 'x-service-token': '' } })),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('sai token thì 401', async () => {
      process.env.INTERNAL_SERVICE_TOKEN = 'dung';
      const { access } = make();
      await expect(
        access.authorizeService(request({ headers: { 'x-service-token': 'sai' } })),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('thiếu x-tenant-id thì 403', async () => {
      process.env.INTERNAL_SERVICE_TOKEN = 'dung';
      const { access } = make();
      await expect(
        access.authorizeService(request({ headers: { 'x-service-token': 'dung' } })),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('đúng thì trả tenant và database của đúng module', async () => {
      process.env.INTERNAL_SERVICE_TOKEN = 'dung';
      const { access, fetcher } = make();
      const caller = await access.authorizeService(
        request({ headers: { 'x-service-token': 'dung', 'x-tenant-id': ' t1 ' } }),
      );
      expect(caller).toEqual({ tenantId: 't1', database });
      expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toContain(
        '/t1?moduleKey=workspace',
      );
    });
  });
});
