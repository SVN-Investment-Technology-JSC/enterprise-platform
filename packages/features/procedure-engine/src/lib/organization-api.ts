import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';

const ROOT = '/api/procedure/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type':'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Platform Organization trả về HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const loadOrganization = () =>
  request<TenantOrganizationContext>('/organization-context', { cache: 'no-store' });
