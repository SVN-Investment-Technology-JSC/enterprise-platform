/**
 * HRM Client API Configuration & Utilities
 * Standardized across Enterprise Platform modules
 */

export const HRM_API_ROOT = '/api/hrm/v1';
export const PLATFORM_AUTH_API_ROOT = '/api/auth/v1';
export const HRM_PERMISSIONS_INVALIDATED_EVENT =
  'hrm:permissions-invalidated';

export class HrmApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HrmApiError';
  }
}

export function hrmApiUrl(path: string): string {
  return `${HRM_API_ROOT}${path.startsWith('/') ? path : `/${path}`}`;
}

export function platformAuthApiUrl(path: string): string {
  return `${PLATFORM_AUTH_API_ROOT}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function downloadHrmExport(path: string) {
  const { data } = await hrmFetch<{ data: { filename: string; csv: string } }>(
    path,
  );
  const url = URL.createObjectURL(
    new Blob([data.csv], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = data.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((part) => part.startsWith('ep_csrf='))
      ?.split('=')[1] ?? ''
  );
}

export async function hrmFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = hrmApiUrl(path);
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
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    if (
      response.status === 403 &&
      path !== '/capabilities' &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new Event(HRM_PERMISSIONS_INVALIDATED_EVENT));
    }
    throw new HrmApiError(
      body.message ??
        (response.status === 403
          ? 'Bạn không còn quyền thực hiện thao tác này.'
          : `Yêu cầu thất bại (${response.status})`),
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
      body,
    );
  }

  return response.json() as Promise<T>;
}

export type EmployeeOption = { value: string; label: string; department?: string | null; userId?: string | null };
const EMPLOYEE_OPTIONS_TTL_MS = 30_000;
const employeeOptionsCache = new Map<string, { at: number; promise: Promise<EmployeeOption[]> }>();

/**
 * Danh sách nhân viên cho ô chọn: dùng chung giữa các màn trong 30 giây (và gộp các lần gọi đồng thời),
 * để mỗi lần tải lại danh sách không phải phân trang lại toàn bộ nhân viên. `fresh` bỏ qua bộ nhớ đệm.
 */
export function hrmEmployeeOptions(includeInactive = false, fresh = false): Promise<EmployeeOption[]> {
  const key = includeInactive ? 'all' : 'active';
  const cached = employeeOptionsCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < EMPLOYEE_OPTIONS_TTL_MS) return cached.promise;
  const promise = loadEmployeeOptions(includeInactive);
  employeeOptionsCache.set(key, { at: Date.now(), promise });
  // Lỗi không được giữ lại trong bộ nhớ đệm.
  promise.catch(() => {
    if (employeeOptionsCache.get(key)?.promise === promise) employeeOptionsCache.delete(key);
  });
  return promise;
}

async function loadEmployeeOptions(includeInactive: boolean) {
  const options: EmployeeOption[] = [];
  let page = 1;
  while (true) {
    const result = await hrmFetch<{
      data: { employeeId: string; employeeCode: string; fullName: string; department?: string | null; userId?: string | null }[];
      meta?: { total: number };
    }>(`/employee-options?page=${page}&page_size=100${includeInactive ? '&include_inactive=1' : ''}`);
    const rows = result?.data ?? [];
    options.push(
      ...rows.map((e) => ({
        value: e.employeeId,
        label: `${e.employeeCode} · ${e.fullName}`,
        department: e.department ?? null,
        userId: e.userId ?? null,
      })),
    );
    const total = result?.meta?.total ?? rows.length;
    if (options.length >= total || !rows.length) break;
    page++;
  }
  return options;
}
