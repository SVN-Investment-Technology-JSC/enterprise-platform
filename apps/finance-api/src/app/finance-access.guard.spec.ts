import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { FinanceAccessGuard } from './finance-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({
    payload: {
      principal: {
        kind: 'tenant-user',
        userId: 'user',
        sessionId: 'session',
        tenantId: 'tenant',
        // Quyền trong JWT không được tin: guard chỉ dùng quyền do Platform trả về.
        permissions: ['finance.manage'],
      },
    },
  })),
}));

describe('FinanceAccessGuard', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function setup(decision: Record<string, unknown>, path = '/api/finance/v1/vouchers', method = 'GET') {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => decision });
    const register = jest.fn();
    const guard = new FinanceAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path,
      method,
      headers: { authorization: 'Bearer token', 'x-csrf-token': 'csrf' },
      cookies: { ep_csrf: 'csrf' },
      financeActor: undefined as undefined | { userId: string; permissions: readonly string[] },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }

  const allowed = (permissions: string[]) => ({
    allowed: true,
    database: { tenantId: 'tenant' },
    principal: { tenantId: 'tenant', userId: 'user', displayName: 'Kế toán', permissions },
  });

  it('cho vào module và dựng actor từ quyền Platform trả về, kể cả khi chỉ có quyền lập phiếu', async () => {
    const { guard, context, request, register } = setup(allowed(['finance.receipt.create']));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ tenantId: 'tenant' });
    expect(request.financeActor).toMatchObject({ userId: 'user', tenantId: 'tenant', permissions: ['finance.receipt.create'] });
  });

  it('hỏi Platform bằng probe module.access cho đúng module finance', async () => {
    const { guard, context } = setup(allowed(['finance.read']));
    await guard.canActivate(context);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body).toMatchObject({ moduleKey: 'finance', permission: 'module.access' });
  });

  it('từ chối khi Platform không cho vào module và không đăng ký database', async () => {
    const { guard, context, register } = setup({ allowed: false, code: 'MODULE_NOT_ENTITLED' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(register).not.toHaveBeenCalled();
  });

  it('thao tác ghi cần CSRF; probe sức khoẻ không cần đăng nhập', async () => {
    const noCsrf = setup(allowed(['finance.manage']), '/api/finance/v1/vouchers', 'POST');
    noCsrf.request.headers['x-csrf-token'] = 'sai';
    await expect(noCsrf.guard.canActivate(noCsrf.context)).rejects.toMatchObject({ status: 403 });
    const health = setup(allowed([]), '/api/finance/health/ready');
    await expect(health.guard.canActivate(health.context)).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
