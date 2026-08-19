import type {
  CreateMaintenanceScheduleRequest,
  MaintenanceMatrix,
  MaintenanceWorkspace,
  SaveMaintenanceMatrixRequest,
  SaveMaintenanceMatrixResult,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';

const API = '/api/maintenance/v1';

function csrf(): string {
  return document.cookie.split('; ').find((part) => part.startsWith('ep_csrf='))?.split('=')[1] ?? '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf(), ...init?.headers },
  });
  if (response.status === 401) {
    window.location.assign(`/tenant/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.hash)}`);
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Không thể hoàn tất yêu cầu bảo trì.');
  }
  return response.json() as Promise<T>;
}

export const loadMaintenanceWorkspace = () => request<MaintenanceWorkspace>('/workspace');
export const createMaintenanceSchedule = (input: CreateMaintenanceScheduleRequest) => request('/schedules', { method: 'POST', body: JSON.stringify(input) });
export const updateMaintenanceSchedule = (id: string, input: UpdateMaintenanceScheduleRequest) => request(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
/** Assets live in Inventory now, so a schedule references them by code only. */
export const runMaintenanceScheduler = () => request<{ generated: number }>('/scheduler/run', { method: 'POST', body: '{}' });

/** Trang chủ doanh nghiệp của người đang đăng nhập, để nút quay lại trỏ đúng chỗ. */
export function loadMaintenanceMatrix(): Promise<MaintenanceMatrix> {
  return request<MaintenanceMatrix>('/matrix', { cache: 'no-store' });
}

export function saveMaintenanceMatrix(
  input: SaveMaintenanceMatrixRequest,
): Promise<SaveMaintenanceMatrixResult> {
  return request<SaveMaintenanceMatrixResult>('/matrix', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Tên đơn vị lấy từ sơ đồ tổ chức của lõi, để hiện cột “Đơn vị phụ trách”. */
export async function loadOrganizationUnitNames(): Promise<ReadonlyMap<string, string>> {
  try {
    const response = await fetch('/api/platform/v1/tenant-organization/snapshot', {
      credentials: 'include',
    });
    if (!response.ok) return new Map();
    const snapshot = (await response.json()) as {
      units?: { id: string; name: string }[];
    };
    return new Map((snapshot.units ?? []).map((unit) => [unit.id, unit.name]));
  } catch {
    return new Map();
  }
}

export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await fetch('/api/auth/v1/me', { credentials: 'include' });
    if (!response.ok) return '/';
    const principal = (await response.json()) as { tenantSlug?: string };
    return principal.tenantSlug ? `/t/${principal.tenantSlug}` : '/';
  } catch {
    return '/';
  }
}
