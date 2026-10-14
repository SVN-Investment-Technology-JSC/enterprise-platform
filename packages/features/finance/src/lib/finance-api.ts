/** Client API Tài chính: cùng quy ước với các module khác (cookie phiên + CSRF double-submit). */

export const FINANCE_API_ROOT = '/api/finance/v1';
export const FINANCE_PERMISSIONS_INVALIDATED_EVENT = 'finance:permissions-invalidated';

export class FinanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** Danh sách lỗi chi tiết (ví dụ từng điều kiện gửi duyệt chưa đạt). */
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'FinanceApiError';
  }
}

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.split('; ').find((part) => part.startsWith('ep_csrf='))?.split('=')[1] ?? '';
}

/** Chuỗi query bỏ qua giá trị rỗng/undefined. */
export function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export async function financeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${FINANCE_API_ROOT}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': getCsrfToken(),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') window.location.assign('/');
    throw new FinanceApiError('Phiên đăng nhập đã hết hạn.', 401);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string | string[]; code?: string; details?: string[] };
    if (response.status === 403 && path !== '/capabilities' && typeof window !== 'undefined')
      window.dispatchEvent(new Event(FINANCE_PERMISSIONS_INVALIDATED_EVENT));
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new FinanceApiError(
      message ?? (response.status === 403 ? 'Bạn không còn quyền thực hiện thao tác này.' : `Yêu cầu thất bại (${response.status})`),
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
      Array.isArray(body.details) ? body.details : [],
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const financePost = <T>(path: string, body?: unknown) =>
  financeFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const financePut = <T>(path: string, body: unknown) =>
  financeFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const financeDelete = (path: string) => financeFetch<void>(path, { method: 'DELETE' });

/** Thông báo lỗi cho người dùng: gộp lỗi chi tiết (nếu có) sau câu chính. */
export function financeErrorMessage(error: unknown, fallback = 'Không thực hiện được thao tác.'): string {
  if (error instanceof FinanceApiError) return error.details.length > 1 ? error.details.join('\n') : error.message;
  return error instanceof Error ? error.message : fallback;
}
