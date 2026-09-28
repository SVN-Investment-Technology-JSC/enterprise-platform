import { authFetch, getCsrfToken, refreshSession } from './auth-fetch';

describe('authFetch & refreshSession', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'ep_csrf=test-csrf-token',
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('getCsrfToken parses ep_csrf from document.cookie', () => {
    expect(getCsrfToken()).toBe('test-csrf-token');
  });

  test('refreshSession sends POST with x-csrf-token and returns true on 200', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
    } as unknown as Response);
    global.fetch = mockFetch;

    const success = await refreshSession();
    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/v1/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-csrf-token': 'test-csrf-token',
      },
    });
  });

  test('authFetch automatically attaches x-csrf-token on POST if missing', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
    } as unknown as Response);
    global.fetch = mockFetch;

    await authFetch('/api/test', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('test-csrf-token');
  });

  test('authFetch transparently retries on 401 when refresh succeeds', async () => {
    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/v1/refresh') {
        // Refresh call succeeds and sets a new csrf token in cookie
        document.cookie = 'ep_csrf=new-rotated-csrf';
        return Promise.resolve({
          status: 200,
          ok: true,
        } as unknown as Response);
      }

      callCount++;
      if (callCount === 1) {
        // First call fails with 401
        return Promise.resolve({
          status: 401,
          ok: false,
        } as unknown as Response);
      }

      // Retried call succeeds with 200
      return Promise.resolve({
        status: 200,
        ok: true,
      } as unknown as Response);
    });
    global.fetch = mockFetch;

    const res = await authFetch('/api/procedure/v1/workspace');

    expect(res.status).toBe(200);
    // 1 original call + 1 refresh call + 1 retried call = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/auth/v1/refresh');
  });

  test('multiple concurrent 401 calls share a single refresh request', async () => {
    let refreshCalls = 0;
    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/v1/refresh') {
        refreshCalls++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ status: 200, ok: true } as unknown as Response);
          }, 10);
        });
      }

      // Initial calls return 401, retry calls return 200
      const isRetry = refreshCalls > 0;
      return Promise.resolve({
        status: isRetry ? 200 : 401,
        ok: isRetry,
      } as unknown as Response);
    });
    global.fetch = mockFetch;

    // Trigger 3 concurrent requests
    const [res1, res2, res3] = await Promise.all([
      authFetch('/api/data1'),
      authFetch('/api/data2'),
      authFetch('/api/data3'),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
    // Refresh should only have been called ONCE
    expect(refreshCalls).toBe(1);
  });

  test('authFetch returns 401 if refresh fails', async () => {
    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/v1/refresh') {
        return Promise.resolve({
          status: 401,
          ok: false,
        } as unknown as Response);
      }

      return Promise.resolve({
        status: 401,
        ok: false,
      } as unknown as Response);
    });
    global.fetch = mockFetch;

    const res = await authFetch('/api/procedure/v1/workspace');

    expect(res.status).toBe(401);
    // 1 original call + 1 refresh call = 2 calls (no infinite retry)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
