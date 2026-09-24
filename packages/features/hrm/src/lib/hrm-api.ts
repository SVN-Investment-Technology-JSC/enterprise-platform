/**
 * HRM Client API Configuration & Utilities
 * Standardized across Enterprise Platform modules
 */

export const HRM_API_ROOT = '/api/hrm/v1';

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.split('; ').find((part) => part.startsWith('ep_csrf='))?.split('=')[1] ?? '';
}

export async function hrmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/') ? `${HRM_API_ROOT}${path}` : `${HRM_API_ROOT}/${path}`;
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': getCsrfToken(),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Yêu cầu thất bại (${response.status})`);
  }

  return response.json() as Promise<T>;
}
