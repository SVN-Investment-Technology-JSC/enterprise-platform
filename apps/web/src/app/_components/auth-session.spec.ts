import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { principalHome, restoreAuthenticatedSession } from './auth-session';

describe('auth session recovery', () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const tenantPrincipal: AuthenticatedPrincipal = {
    kind: 'tenant-user',
    userId: 'user-1',
    sessionId: 'session-1',
    email: 'admin@example.com',
    displayName: 'Tenant Admin',
    roles: ['tenant-admin'],
    permissions: [],
    tenantId: 'tenant-1',
    tenantSlug: 'example-tenant',
    membershipId: 'membership-1',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    document.cookie = 'ep_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('uses the current access token when it is still valid', async () => {
    fetchMock.mockResolvedValueOnce(response(200, tenantPrincipal));

    await expect(restoreAuthenticatedSession()).resolves.toEqual(tenantPrincipal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired access token while the login session is active', async () => {
    document.cookie = 'ep_csrf=csrf-token; path=/';
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { principal: tenantPrincipal }));

    await expect(restoreAuthenticatedSession()).resolves.toEqual(tenantPrincipal);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/v1/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-csrf-token': 'csrf-token' },
    });
  });

  it('keeps an anonymous user on the login or portal chooser page', async () => {
    fetchMock.mockResolvedValueOnce(response(401));

    await expect(restoreAuthenticatedSession()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes each principal kind to its own authenticated home', () => {
    expect(principalHome(tenantPrincipal)).toBe('/t/example-tenant');
    expect(principalHome({ ...tenantPrincipal, kind: 'platform-admin' })).toBe('/platform');
  });
});

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
