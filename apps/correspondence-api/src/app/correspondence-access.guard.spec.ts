import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { CorrespondenceAccessGuard } from './correspondence-access.guard';

const verified = { principal: undefined as unknown };

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({ payload: { principal: verified.principal } })),
}));

describe('CorrespondenceAccessGuard', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function setup(
    decision: Record<string, unknown>,
    options: { path?: string; method?: string; csrf?: boolean } = {},
  ) {
    verified.principal = { kind: 'tenant-user', tenantId: 't1', userId: 'u1', sessionId: 's1' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => decision });
    const register = jest.fn();
    const guard = new CorrespondenceAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path: options.path ?? '/api/correspondence/v1/letters',
      method: options.method ?? 'GET',
      headers: { authorization: 'Bearer token', ...(options.csrf ? { 'x-csrf-token': 'c' } : {}) },
      cookies: { ep_csrf: 'c' },
      correspondenceActor: undefined as undefined | Record<string, unknown>,
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }

  const allowed = (permissions: string[], roles: string[] = []) => ({
    allowed: true,
    database: { tenantId: 't1' },
    principal: { tenantId: 't1', userId: 'u1', displayName: 'Người dùng', permissions, roles },
  });

  it('không có quyền Văn thư thì 403', async () => {
    const { guard, context } = setup({ allowed: false, code: 'ACCESS_DENIED' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('route nội bộ không nhận', async () => {
    const { guard, context } = setup(allowed([]), { path: '/api/correspondence/v1/internal/anything' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('ghi dữ liệu mà thiếu CSRF thì 403', async () => {
    const { guard, context } = setup(allowed(['correspondence.read']), { method: 'POST' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('dựng actor theo quyền: quản trị văn thư có mọi việc và cấu hình, không tự thành lãnh đạo', async () => {
    const { guard, context, request, register } = setup(allowed(['correspondence.manage']), { method: 'POST', csrf: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(request.correspondenceActor).toMatchObject({
      canRegister: true,
      canCreateOutgoing: true,
      canPublish: true,
      canArchive: true,
      canReadAll: true,
      canReadConfidential: true,
      canReadReports: true,
      canConfigure: true,
      canDirect: false,
    });
  });

  it('quyền chỉ đạo cấp đích danh; quản trị tenant làm việc văn thư nhưng không là lãnh đạo', async () => {
    const leader = setup(allowed(['correspondence.letter.direct']));
    await leader.guard.canActivate(leader.context);
    expect(leader.request.correspondenceActor).toMatchObject({
      canRegister: false,
      canCreateOutgoing: false,
      canDirect: true,
      canConfigure: false,
      canReadAll: false,
      canReadReports: false,
    });
    const drafter = setup(allowed(['correspondence.outgoing.create']));
    await drafter.guard.canActivate(drafter.context);
    expect(drafter.request.correspondenceActor).toMatchObject({ canCreateOutgoing: true, canRegister: false, canPublish: false });
    const admin = setup(allowed([], ['tenant-admin']));
    await admin.guard.canActivate(admin.context);
    expect(admin.request.correspondenceActor).toMatchObject({ isTenantAdmin: true, canRegister: true, canDirect: false });
  });
});
