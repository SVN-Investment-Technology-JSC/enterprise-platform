import type {
  CreateOrganizationUnitRequest,
  OrganizationMember,
  OrganizationUnit,
  TenantOrganizationContext,
  UpdateOrganizationUnitRequest,
} from '@enterprise-platform/contracts-organization';

const ROOT = '/api/procedure/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Platform Organization trả về HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const loadOrganization = () =>
  request<TenantOrganizationContext>('/organization-context', { cache: 'no-store' });

export const createOrganizationUnit = (body: CreateOrganizationUnitRequest) =>
  request<OrganizationUnit>('/organization/units', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateOrganizationUnit = (unitId: string, body: UpdateOrganizationUnitRequest) =>
  request<OrganizationUnit>(`/organization/units/${unitId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deleteOrganizationUnit = (unitId: string) =>
  request<{ success: boolean }>(`/organization/units/${unitId}`, {
    method: 'DELETE',
  });

export const assignOrganizationMember = (body: {
  userId: string;
  unitId: string;
  positionName?: string;
  isHead?: boolean;
}) =>
  request<OrganizationMember>('/organization/members/assign', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateOrganizationMember = (
  membershipId: string,
  body: {
    unitId?: string;
    positionName?: string;
    isHead?: boolean;
  },
) =>
  request<OrganizationMember>(`/organization/members/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const removeOrganizationMember = (membershipId: string) =>
  request<{ success: boolean }>(`/organization/members/${membershipId}`, {
    method: 'DELETE',
  });

export const loadPlatformUsers = () =>
  request<Array<{ id: string; email: string; displayName: string; role: string }>>(
    '/organization/available-users',
    { cache: 'no-store' },
  );

