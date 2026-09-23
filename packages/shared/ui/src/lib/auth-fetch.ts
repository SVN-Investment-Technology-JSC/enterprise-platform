/**
 * Auto Refresh Interceptor for browser client requests.
 *
 * Automatically intercepts HTTP 401 Unauthorized responses, attempts a single
 * deduplicated token refresh via `/api/auth/v1/refresh`, and retries the original
 * request transparently.
 */

let inFlightRefresh: Promise<boolean> | undefined;

/**
 * Extracts a cookie value by name from document.cookie safely.
 */
export function getCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const encoded = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('ep_csrf='))
    ?.slice('ep_csrf='.length);

  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Attempts to refresh the current session by calling `/api/auth/v1/refresh`.
 * Concurrent callers share the same in-flight promise to avoid multiple simultaneous refresh requests.
 */
export function refreshSession(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      const csrfToken = getCsrfToken();
      if (!csrfToken) return false;

      const response = await fetch('/api/auth/v1/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrfToken,
        },
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      inFlightRefresh = undefined;
    }
  })();

  return inFlightRefresh;
}

/**
 * Wrapper around `window.fetch` that automatically:
 * 1. Attaches `x-csrf-token` header on mutation requests (POST/PUT/PATCH/DELETE) if omitted.
 * 2. Uses `credentials: 'include'` by default so session cookies are forwarded.
 * 3. Catches HTTP 401 responses, performs a single shared refresh, and replays the original request.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url;

  const method = (init.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  const headers = new Headers(init.headers);
  if (isMutation && !headers.has('x-csrf-token')) {
    const csrfToken = getCsrfToken();
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const requestInit: RequestInit = {
    ...init,
    credentials: init.credentials ?? 'include',
    headers,
  };

  const response = await fetch(input, requestInit);

  const isAuthEndpoint =
    url.includes('/api/auth/v1/refresh') ||
    url.includes('/api/auth/v1/login') ||
    url.includes('/api/auth/v1/logout');

  if (response.status === 401 && !isAuthEndpoint) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const retryHeaders = new Headers(init.headers);
      if (isMutation) {
        const newCsrf = getCsrfToken();
        if (newCsrf) retryHeaders.set('x-csrf-token', newCsrf);
      }
      return fetch(input, {
        ...init,
        credentials: init.credentials ?? 'include',
        headers: retryHeaders,
      });
    }
  }

  return response;
}
