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

export interface PlatformUser {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
}

export interface PlatformCoreOrganizationSnapshot {
  readonly trees: { id: string; code: string; name: string; isPrimary: boolean }[];
  readonly nodeTypes: { id: string; code: string; name: string; category: 'unit' | 'position' }[];
  readonly nodes: { id: string; treeId: string; parentId?: string; nodeTypeId: string; code: string; name: string }[];
  readonly assignments: { id: string; nodeId: string; userId: string; isPrimary: boolean }[];
  readonly users: PlatformUser[];
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  return decodeURIComponent(
    document.cookie
      .split('; ')
      .find((row) => row.startsWith('ep_csrf='))
      ?.split('=')[1] ?? '',
  );
}

export const loadOrganization = () =>
  request<TenantOrganizationContext>('/organization-context', { cache: 'no-store' });

export async function loadCoreSnapshot(): Promise<PlatformCoreOrganizationSnapshot | undefined> {
  try {
    const res = await fetch('/api/platform/v1/tenant-organization/core-snapshot', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return undefined;
    return (await res.json()) as PlatformCoreOrganizationSnapshot;
  } catch {
    return undefined;
  }
}

export async function createOrganizationNode(data: {
  treeId: string;
  parentId?: string | null;
  nodeTypeId: string;
  code: string;
  name: string;
  description?: string;
}): Promise<void> {
  const res = await fetch('/api/platform/v1/tenant-organization/nodes', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken(),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(msg ?? `Không thể tạo đơn vị (HTTP ${res.status}).`);
  }
}

export async function assignOrganizationMember(data: {
  nodeId: string;
  userId: string;
  isPrimary?: boolean;
  note?: string;
}): Promise<void> {
  const res = await fetch('/api/platform/v1/tenant-organization/assignments', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken(),
    },
    body: JSON.stringify({ ...data, status: 'active' }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(msg ?? `Không thể phân bổ nhân sự (HTTP ${res.status}).`);
  }
}
