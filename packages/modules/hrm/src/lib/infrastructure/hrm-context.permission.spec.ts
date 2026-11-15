import type { Request } from 'express';
import type { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import type { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { jwtVerify } from 'jose';
import { HrmContextService } from './hrm-context.service';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('./hrm-procedure-api.js', () => ({ fetchActionableProcedureInstanceIds: jest.fn() }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const principal = { kind: 'tenant-user', tenantId: 'tenant-a', userId: 'user-a', sessionId: 'session-a' };
const withPermissions = (permissions: string[]) =>
  ({ principal: { ...principal, permissions } as unknown as AuthenticatedPrincipal });

describe('HrmContextService.has: quyền bao hàm (SEC-BE019-04)', () => {
  const service = new HrmContextService({} as PlatformIdentityService, {} as PostgresPoolRegistry);

  it('quyền quản lý kéo theo quyền xem tương ứng', () => {
    expect(service.has(withPermissions(['hrm.salary.manage']), 'hrm.salary.read')).toBe(true);
    expect(service.has(withPermissions(['hrm.employee.manage']), 'hrm.employee.sensitive')).toBe(true);
    expect(service.has(withPermissions(['hrm.payroll.finalize']), 'hrm.payroll.read')).toBe(true);
  });

  it('hrm.manage và tenant.manage có mọi quyền HRM', () => {
    expect(service.has(withPermissions(['hrm.manage']), 'hrm.payroll.pay')).toBe(true);
    expect(service.has(withPermissions(['tenant.manage']), 'hrm.employee.sensitive')).toBe(true);
  });

  it('không có quyền thì không suy ra', () => {
    expect(service.has(withPermissions(['hrm.salary.read']), 'hrm.salary.manage')).toBe(false);
    expect(service.has(withPermissions(['hrm.payroll.configure']), 'hrm.payroll.read')).toBe(false);
    expect(service.has(withPermissions(['hrm.request.approve']), 'hrm.request.read')).toBe(false);
    expect(service.has(withPermissions([]), 'hrm.read')).toBe(false);
  });
});

describe('HrmContextService.getContext: giữ quyết định trong request', () => {
  const identity = { decide: jest.fn() };
  const pools = { forTenant: jest.fn() };
  const service = new HrmContextService(
    identity as unknown as PlatformIdentityService,
    pools as unknown as PostgresPoolRegistry,
  );
  const pool = { query: jest.fn() };
  const request = () => ({ method: 'GET', headers: { authorization: 'Bearer token-a' } }) as Request;

  beforeEach(() => {
    jest.clearAllMocks();
    (jwtVerify as jest.Mock).mockResolvedValue({ payload: { principal } });
    pools.forTenant.mockResolvedValue(pool);
    identity.decide.mockImplementation(async ({ permission }: { permission: string }) =>
      ['hrm.read', 'hrm.self.read', 'hrm.payroll.read'].includes(permission)
        ? {
            allowed: true,
            database: { tenantId: 'tenant-a' },
            principal: { ...principal, permissions: ['hrm.read', 'hrm.self.read', 'hrm.payroll.read'] },
          }
        : { allowed: false, code: 'PERMISSION_DENIED' },
    );
  });

  it('guard và handler cùng kiểm một quyền: chỉ hỏi Platform một lần', async () => {
    const req = request();
    await service.getContext(req, 'hrm.payroll.read'); // guard
    const handler = await service.getContext(req, 'hrm.payroll.read'); // handler
    await service.getContext(req, 'hrm.read');
    expect(identity.decide).toHaveBeenCalledTimes(1);
    expect(handler.pool).toBe(pool);
    expect(handler.tenantId).toBe('tenant-a');
  });

  it('quyền chưa có vẫn hỏi Platform và bị từ chối', async () => {
    const req = request();
    await service.getContext(req, 'hrm.read');
    await expect(service.getContext(req, 'hrm.payroll.pay')).rejects.toMatchObject({
      response: { code: 'PERMISSION_DENIED' },
    });
    expect(identity.decide).toHaveBeenCalledTimes(2);
  });

  it('không dùng chung quyết định giữa hai request', async () => {
    await service.getContext(request(), 'hrm.read');
    await service.getContext(request(), 'hrm.read');
    expect(identity.decide).toHaveBeenCalledTimes(2);
  });

  it('quyết định bị từ chối không được giữ lại', async () => {
    const req = request();
    await expect(service.getContext(req, 'hrm.payroll.pay')).rejects.toBeDefined();
    await expect(service.getContext(req, 'hrm.payroll.pay')).rejects.toBeDefined();
    expect(identity.decide).toHaveBeenCalledTimes(2);
  });

  it('vẫn kiểm CSRF ở mọi lần gọi', async () => {
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf' },
      cookies: { ep_access: 'token-a', ep_csrf: 'csrf' },
    } as unknown as Request;
    await service.getContext(req, 'hrm.read');
    (req.headers as Record<string, string>)['x-csrf-token'] = 'other';
    await expect(service.getContext(req, 'hrm.read')).rejects.toThrow('CSRF');
  });
});
