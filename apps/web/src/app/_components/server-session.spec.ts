import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  loadServerSession,
  platformRedirect,
  rootDestination,
  tenantRedirect,
  type ServerSession,
} from './server-session';

const tenantPrincipal = {
  kind: 'tenant-user',
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'nv@example.com',
  displayName: 'Nhân viên',
  roles: [],
  permissions: [],
  tenantId: 'tenant-1',
  tenantSlug: 'example-tenant',
  membershipId: 'membership-1',
} as AuthenticatedPrincipal;
const platformPrincipal = { ...tenantPrincipal, kind: 'platform-admin' } as unknown as AuthenticatedPrincipal;

const authenticated = (principal: AuthenticatedPrincipal): ServerSession => ({ status: 'authenticated', principal });
const unauthenticated: ServerSession = { status: 'unauthenticated' };
const unavailable: ServerSession = { status: 'unavailable' };

function reply(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('loadServerSession', () => {
  it('gửi cookie của request và trả principal khi phiên hợp lệ', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, tenantPrincipal));
    await expect(loadServerSession('ep_access=t', 'http://api', fetchImpl)).resolves.toEqual(authenticated(tenantPrincipal));
    expect(fetchImpl).toHaveBeenCalledWith('http://api/api/auth/v1/me', { headers: { cookie: 'ep_access=t' }, cache: 'no-store' });
  });

  it.each([401, 403])('coi %s là chưa đăng nhập', async (status) => {
    await expect(loadServerSession('', 'http://api', jest.fn().mockResolvedValue(reply(status)))).resolves.toEqual(unauthenticated);
  });

  it('không ném lỗi khi dịch vụ đăng nhập lỗi hoặc không gọi được', async () => {
    await expect(loadServerSession('', 'http://api', jest.fn().mockResolvedValue(reply(502)))).resolves.toEqual(unavailable);
    await expect(loadServerSession('', 'http://api', jest.fn().mockRejectedValue(new Error('ECONNREFUSED')))).resolves.toEqual(unavailable);
  });
});

describe('chuyển hướng theo phiên', () => {
  // SEC-UI023-01, SEC-UI023-02
  it('trang gốc: đã đăng nhập về trang chính, chưa đăng nhập về /login', () => {
    expect(rootDestination(authenticated(tenantPrincipal))).toBe('/dashboard');
    expect(rootDestination(authenticated(platformPrincipal))).toBe('/platform');
    expect(rootDestination(unauthenticated)).toBe('/login');
    expect(rootDestination(unavailable)).toBe('/login');
  });

  // SEC-UI023-04
  it('layout Platform: chỉ Platform Admin ở lại, phiên hỏng về đăng nhập quản trị', () => {
    expect(platformRedirect(authenticated(platformPrincipal))).toBeUndefined();
    expect(platformRedirect(authenticated(tenantPrincipal))).toBe('/dashboard');
    expect(platformRedirect(unauthenticated)).toBe('/login/admin');
    expect(platformRedirect(unavailable)).toBe('/login/admin');
  });

  // SEC-UI023-03
  it('layout tenant: phiên hỏng hoặc không hỏi được thì về /login', () => {
    expect(tenantRedirect(authenticated(tenantPrincipal))).toBeUndefined();
    expect(tenantRedirect(unauthenticated)).toBe('/login');
    expect(tenantRedirect(unavailable)).toBe('/login');
  });
});
