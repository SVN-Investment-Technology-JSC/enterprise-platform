import { CRM_API_ROOT, type CrmStatus } from '@enterprise-platform/contracts-crm';
import { authFetch } from '@enterprise-platform/shared-ui';

/** Lỗi API: thân lỗi đã có `code` và `message` tiếng Việt. */
export interface CrmApiError {
  readonly code?: string;
  readonly message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `authFetch` tự gắn cookie phiên, `x-csrf-token` và làm mới phiên một lần khi gặp 401.
  const response = await authFetch(`${CRM_API_ROOT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    window.location.assign('/');
    throw { code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập đã hết.' } satisfies CrmApiError;
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw body as CrmApiError;
  return body as T;
}

/** Lời nhắn lỗi để hiện thẳng cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  const message = (cause as CrmApiError | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export const loadCrmStatus = () => request<CrmStatus>('/status', { cache: 'no-store' });

/** Đường về Tenant Portal cho nút Trang chủ trên thanh bên. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    return response.ok ? '/applications' : '/';
  } catch {
    return '/';
  }
}
