import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';

let recoveryInFlight: Promise<AuthenticatedPrincipal | undefined> | undefined;

function cookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const encoded = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

async function readPrincipal(response: Response): Promise<AuthenticatedPrincipal | undefined> {
  if (!response.ok) return undefined;
  return response.json() as Promise<AuthenticatedPrincipal>;
}

async function readRefreshPrincipal(response: Response): Promise<AuthenticatedPrincipal | undefined> {
  if (!response.ok) return undefined;
  const payload = await response.json() as { principal?: AuthenticatedPrincipal };
  return payload.principal;
}

async function recoverSession(): Promise<AuthenticatedPrincipal | undefined> {
  const current = await fetch('/api/auth/v1/me', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const principal = await readPrincipal(current);
  if (principal || current.status !== 401) return principal;

  const csrfToken = cookie('ep_csrf');
  if (!csrfToken) return undefined;

  const refreshed = await fetch('/api/auth/v1/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'x-csrf-token': csrfToken },
  });
  return readRefreshPrincipal(refreshed);
}

export function restoreAuthenticatedSession(): Promise<AuthenticatedPrincipal | undefined> {
  recoveryInFlight ??= recoverSession()
    .catch(() => undefined)
    .finally(() => {
      recoveryInFlight = undefined;
    });
  return recoveryInFlight;
}

export function principalHome(principal: AuthenticatedPrincipal): string {
  return principal.kind === 'platform-admin'
    ? '/platform'
    : `/t/${principal.tenantSlug}`;
}
