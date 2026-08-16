import type {
  CreateOrganizationUnitRequest,
  TenantOrganizationSnapshot,
  UpdateOrganizationUnitRequest,
} from '@enterprise-platform/contracts-organization';

const ROOT = '/api/platform/v1/tenant-organization';

function csrf(): string {
  if (typeof document === 'undefined') return '';
  return decodeURIComponent(document.cookie.split('; ').find((part) => part.startsWith('ep_csrf='))?.slice(8) ?? '');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type':'application/json', ...(init.method && init.method !== 'GET' ? {'x-csrf-token':csrf()} : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Platform Organization trả về HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const loadOrganization = () => request<TenantOrganizationSnapshot>('/snapshot', { cache:'no-store' });
export const createOrganizationUnit = (input: CreateOrganizationUnitRequest) => request('/units', { method:'POST',body:JSON.stringify(input) });
export const updateOrganizationUnit = (id: string, input: UpdateOrganizationUnitRequest) => request(`/units/${id}`, { method:'PATCH',body:JSON.stringify(input) });
export const deleteOrganizationUnit = (id: string) => request(`/units/${id}`, { method:'DELETE' });
