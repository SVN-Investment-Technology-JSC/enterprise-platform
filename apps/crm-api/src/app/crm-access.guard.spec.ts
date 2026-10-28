import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { CrmAccessGuard } from './crm-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  // JWT cũ mang quyền cao hơn: guard phải theo access-decision, không theo claim trong token.
  jwtVerify: jest.fn(async () => ({
    payload: {
      principal: {
        kind: 'tenant-user',
        userId: 'user',
        sessionId: 'session',
        tenantId: 'tenant',
        permissions: ['crm.manage'],
      },
    },
  })),
}));

type Actor = Record<string, unknown>;

describe('CrmAccessGuard', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  function setup(options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    decision?: Record<string, unknown>;
  }) {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => options.decision ?? { database: { tenantId: 't1' } },
    });
    global.fetch = fetch;
    const register = jest.fn();
    const guard = new CrmAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path: options.path.startsWith('/api/') ? options.path : '/api/crm/v1' + options.path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      cookies: options.cookies ?? {},
      crmActor: undefined as undefined | Actor,
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register, fetch };
  }

  /** Người dùng có phiên hợp lệ và CSRF đúng; Platform trả `decision`. */
  function user(permissions: string[], path = '/status', method = 'GET', extra: Record<string, unknown> = {}) {
    return setup({
      path,
      method,
      headers: { authorization: 'Bearer token', 'x-csrf-token': 'csrf' },
      cookies: { ep_csrf: 'csrf' },
      decision: {
        allowed: true,
        database: { tenantId: 'tenant' },
        principal: { tenantId: 'tenant', userId: 'user', displayName: 'Người dùng', permissions, roles: [] },
        ...extra,
      },
    });
  }

  it('health check đi qua không cần danh tính', async () => {
    const { guard, context, fetch } = setup({ path: '/api/crm/health/live' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('chỉ có crm.read: vào được, mọi cờ ghi tắt, hỏi Platform đúng module và quyền', async () => {
    const { guard, context, request, register, fetch } = user(['crm.read']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ tenantId: 'tenant' });
    const body = JSON.parse((fetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ moduleKey: 'crm', permission: 'crm.read', tenantId: 'tenant' });
    expect(request.crmActor).toEqual({
      tenantId: 'tenant',
      userId: 'user',
      displayName: 'Người dùng',
      isTenantAdmin: false,
      canReadAll: false,
      canWriteOpportunity: false,
      canWriteQuote: false,
      canApproveQuote: false,
      canWriteOrder: false,
      canWriteContract: false,
      canWriteReceivable: false,
      canWriteWarranty: false,
      canReadReport: false,
      canManage: false,
    });
  });

  it('nhân viên kinh doanh: chỉ bật đúng cờ được cấp, không kéo theo xem toàn bộ', async () => {
    const { guard, context, request } = user(['crm.opportunity.write', 'crm.quote.write', 'crm.order.write']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.crmActor).toMatchObject({
      canWriteOpportunity: true,
      canWriteQuote: true,
      canWriteOrder: true,
      canApproveQuote: false,
      canReadAll: false,
      canManage: false,
    });
  });

  it('crm.manage kéo theo xem toàn bộ nhưng không kéo theo quyền ghi nghiệp vụ', async () => {
    const { guard, context, request } = user(['crm.manage']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.crmActor).toMatchObject({ canManage: true, canReadAll: true, canWriteQuote: false });
  });

  it('quản trị tenant có mọi cờ', async () => {
    const { guard, context, request } = user([], '/status', 'GET', {
      principal: { tenantId: 'tenant', userId: 'user', displayName: 'QT', permissions: [], roles: ['tenant-admin'] },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    const actor = request.crmActor as Actor;
    expect(Object.entries(actor).filter(([key, value]) => key.startsWith('can') && value !== true)).toEqual([]);
  });

  it('Platform từ chối thì 403 với thông báo tiếng Việt và không đăng ký database', async () => {
    const { guard, context, register } = user([], '/status', 'GET', {
      allowed: false,
      code: 'PERMISSION_DENIED',
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'PERMISSION_DENIED', message: 'Không được phép truy cập CRM.' },
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('request ghi thiếu CSRF thì 403 trước khi hỏi Platform', async () => {
    const { guard, context, fetch } = setup({
      path: '/customers',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('không có phiên thì 401', async () => {
    const { guard, context } = setup({ path: '/status' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
  });

  describe('route nội bộ', () => {
    beforeEach(() => {
      process.env.INTERNAL_SERVICE_TOKEN = 'dung';
    });
    const internal = (headers: Record<string, string>) =>
      setup({ path: '/internal/customers', headers });

    it('thiếu hoặc sai service token thì 401', async () => {
      const missing = internal({ 'x-tenant-id': 't1' });
      await expect(missing.guard.canActivate(missing.context)).rejects.toMatchObject({ status: 401 });
      const wrong = internal({ 'x-service-token': 'sai', 'x-tenant-id': 't1' });
      await expect(wrong.guard.canActivate(wrong.context)).rejects.toMatchObject({ status: 401 });
    });

    it('chưa cấu hình INTERNAL_SERVICE_TOKEN thì từ chối cả header rỗng', async () => {
      delete process.env.INTERNAL_SERVICE_TOKEN;
      const { guard, context } = internal({ 'x-service-token': '', 'x-tenant-id': 't1' });
      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
    });

    it('thiếu tenant thì 403', async () => {
      const { guard, context } = internal({ 'x-service-token': 'dung' });
      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    });

    it('token và tenant đúng thì cho qua với actor hệ thống không có quyền nào', async () => {
      const { guard, context, request, register } = internal({ 'x-service-token': 'dung', 'x-tenant-id': 't1' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(register).toHaveBeenCalledWith({ tenantId: 't1' });
      const actor = request.crmActor as Actor;
      expect(actor).toMatchObject({ tenantId: 't1', isTenantAdmin: false });
      expect(Object.entries(actor).filter(([key, value]) => key.startsWith('can') && value !== false)).toEqual([]);
    });

    it('route người dùng không nhận service token: thiếu CSRF thì 403', async () => {
      const { guard, context } = setup({
        path: '/customers',
        method: 'POST',
        headers: { 'x-service-token': 'dung', 'x-tenant-id': 't1' },
      });
      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    });
  });
});
