import type {
  CreateMaintenanceAssetRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceWorkspace,
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
    const tenantSlug = window.location.pathname.match(/^\/t\/([^/]+)/)?.[1];
    window.location.assign(tenantSlug ? `/t/${tenantSlug}/login` : '/');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Không thể hoàn tất yêu cầu bảo trì.');
  }
  return response.json() as Promise<T>;
}

export const loadMaintenanceWorkspace = () => request<MaintenanceWorkspace>('/workspace');
export const createMaintenanceAsset = (input: CreateMaintenanceAssetRequest) => request('/assets', { method: 'POST', body: JSON.stringify(input) });
export const createMaintenanceSchedule = (input: CreateMaintenanceScheduleRequest) => request('/schedules', { method: 'POST', body: JSON.stringify(input) });
export const updateMaintenanceSchedule = (id: string, input: UpdateMaintenanceScheduleRequest) => request(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
