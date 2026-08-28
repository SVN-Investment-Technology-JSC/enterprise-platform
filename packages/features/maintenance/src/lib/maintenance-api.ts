import type {
  CompleteMaintenanceOccurrenceRequest,
  CreateMaintenanceIncidentRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceSchedule,
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceOrganizationContext,
  MaintenanceOccurrence,
  MaintenanceMatrix,
  MaintenanceWorkspace,
  SaveMaintenanceMatrixRequest,
  SaveMaintenanceMatrixResult,
  MaintenanceSettingsKey,
  MaintenanceSettingsSnapshot,
  MaintenanceSettingsEntry,
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
    /**
     * Về trang chủ Platform, KHÔNG về `/tenant/login` — route đó không tồn tại
     * (trả 404), và slug tenant thì client không đọc được: nó nằm trong cookie
     * `ep_access` httpOnly, còn đường dẫn module (`/modules/...`) không mang
     * slug. Trang chủ sẽ đưa người dùng tới đúng chỗ đăng nhập.
     */
    window.location.assign('/');
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Không thể hoàn tất yêu cầu bảo trì.');
  }
  /**
   * 204 và mọi phản hồi rỗng: KHÔNG gọi `response.json()`.
   *
   * `json()` trên body rỗng ném `Unexpected end of JSON input`, nên thao tác đã
   * thành công ở server vẫn hiện ra như thất bại trên giao diện — đúng lỗi "xoá
   * phụ tùng báo lỗi dù đã xoá".
   */
  /**
   * 204 không có body: gọi `json()` sẽ ném lỗi phân tích cú pháp, làm một thao
   * tác đã thành công trông như thất bại — đúng lỗi "xoá vật tư tiêu chuẩn báo
   * lỗi dù đã xoá".
   *
   * Chỉ xét `status`, KHÔNG dùng `headers.get('content-length')` hay
   * `response.text()`: cả hai đều giả định một `Response` đầy đủ, trong khi
   * fetch giả lập ở test thường chỉ có `ok` và `json`. Đây cũng đúng khuôn mà
   * module Quy trình đã dùng từ trước.
   */
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const loadMaintenanceWorkspace = () => request<MaintenanceWorkspace>('/workspace');
export const createMaintenanceSchedule = (input: CreateMaintenanceScheduleRequest) => request('/schedules', { method: 'POST', body: JSON.stringify(input) });
export const updateMaintenanceSchedule = (id: string, input: UpdateMaintenanceScheduleRequest) => request(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
/** Assets live in Inventory now, so a schedule references them by code only. */
export const runMaintenanceScheduler = () => request<{ generated: number }>('/scheduler/run', { method: 'POST', body: '{}' });

/** Trang chủ doanh nghiệp của người đang đăng nhập, để nút quay lại trỏ đúng chỗ. */
/**
 * Ai đã thực hiện phiếu bảo trì, tra từ module Quy trình theo mã hồ sơ.
 *
 * Đọc bằng CHÍNH PHIÊN của người dùng qua gateway, không phải service token:
 * đây là dữ liệu của module Quy trình, và người xem chỉ nên thấy những hồ sơ họ
 * vốn đã có quyền thấy. Bảo trì không lưu bản sao tên người — lưu là có hai
 * nguồn sự thật, và bản sao sẽ lỗi thời ngay khi ai đó được thay người.
 *
 * Quy trình không đọc được thì trả map rỗng: lịch sử bảo trì vẫn phải xem được,
 * chỉ là thiếu cột người thực hiện.
 */
export async function loadPerformersByInstanceCode(): Promise<Map<string, string[]>> {
  try {
    const response = await fetch('/api/procedure/v1/workspace', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return new Map();
    const body = (await response.json()) as {
      instances?: {
        code: string;
        activity?: { action: string; actorName?: string }[];
        subtasks?: { assigneeName?: string }[];
      }[];
    };

    const map = new Map<string, string[]>();
    for (const instance of body.instances ?? []) {
      const names = new Set<string>();
      // Người được giao đầu việc là người thực sự làm; chủ vai chỉ duyệt.
      for (const subtask of instance.subtasks ?? []) {
        if (subtask.assigneeName) names.add(subtask.assigneeName);
      }
      // Chưa phân rã thì lấy người đã thao tác trạng thái, bỏ bình luận.
      //
      // Bỏ luôn diễn viên HỆ THỐNG: phiếu do Bảo trì sinh ra được mở dưới danh
      // nghĩa hệ thống, nên nếu không lọc thì cột "người thực hiện" của mọi
      // phiếu định kỳ đều ghi "Hệ thống (maintenance_occurrence)" — vô nghĩa với
      // người đọc và che mất tên người thật.
      if (names.size === 0) {
        for (const entry of instance.activity ?? []) {
          if (entry.action === 'comment') continue;
          const name = entry.actorName?.trim();
          if (!name || name.startsWith('Hệ thống')) continue;
          names.add(name);
        }
      }
      if (names.size > 0) map.set(instance.code, [...names]);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Bỏ qua đúng một lần bảo trì; lịch vẫn chạy tiếp ở chu kỳ sau. */
export function skipNextOccurrence(scheduleId: string): Promise<MaintenanceSchedule> {
  return request<MaintenanceSchedule>(`/schedules/${scheduleId}/skip`, { method: 'POST' });
}

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

export function loadMaintenanceHistory(
  filter: MaintenanceHistoryFilter = {},
): Promise<MaintenanceHistoryPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return request<MaintenanceHistoryPage>(
    `/occurrences/history${suffix ? `?${suffix}` : ''}`,
    { cache: 'no-store' },
  );
}

/** Đầu việc bảo trì mặc định của một thiết bị; Bảo trì đọc từ Kho, không lưu bản sao. */
export interface AssetTaskList {
  readonly assetCode: string;
  readonly assetName?: string;
  readonly tasks: readonly Record<string, unknown>[];
}

export function loadAssetTasks(assetCode: string): Promise<AssetTaskList> {
  // `no-store` như mọi lời gọi đọc khác của module: thiếu nó thì fetch tự cache,
  // và người dùng vừa sửa đầu việc bên Kho quay lại vẫn thấy danh sách cũ.
  return request<AssetTaskList>(`/assets/${encodeURIComponent(assetCode)}/tasks`, {
    cache: 'no-store',
  });
}

export function loadMaintenanceOccurrence(id: string): Promise<MaintenanceOccurrence> {
  return request<MaintenanceOccurrence>(`/occurrences/${id}`, { cache: 'no-store' });
}

export function createMaintenanceIncident(
  input: CreateMaintenanceIncidentRequest,
): Promise<MaintenanceOccurrence> {
  return request<MaintenanceOccurrence>('/occurrences/incidents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function completeMaintenanceOccurrence(
  id: string,
  note?: string,
): Promise<MaintenanceOccurrence> {
  return request<MaintenanceOccurrence>(`/occurrences/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ note } satisfies CompleteMaintenanceOccurrenceRequest),
  });
}

/** Nhân sự của tenant, cho ô chọn kỹ thuật viên chịu trách nhiệm. */
export async function loadTenantMembers(): Promise<
  readonly { userId: string; displayName: string }[]
> {
  try {
    const snapshot = await request<MaintenanceOrganizationContext>('/organization-context');
    return (snapshot.members ?? []).map(({ userId, displayName }) => ({ userId, displayName }));
  } catch {
    return [];
  }
}

/** Tên đơn vị lấy từ sơ đồ tổ chức của lõi, để hiện cột “Đơn vị phụ trách”. */
export async function loadOrganizationUnitNames(): Promise<ReadonlyMap<string, string>> {
  try {
    const snapshot = await request<MaintenanceOrganizationContext>('/organization-context');
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

/** Cấu hình module do tenant admin đặt; đọc mới mỗi lần vào màn cài đặt. */
export const loadMaintenanceSettings = () =>
  request<MaintenanceSettingsSnapshot>('/settings', { cache: 'no-store' });

export const saveMaintenanceSetting = (
  key: MaintenanceSettingsKey,
  value: unknown,
  expectedVersion: number,
) =>
  request<MaintenanceSettingsEntry<unknown>>(`/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, expectedVersion }),
  });

/** Gỡ hẳn thiết bị khỏi ma trận: xoá mọi lịch của nó. */
export const removeAssetFromMatrix = (assetCode: string) =>
  request<{ removed: number }>(`/matrix/${encodeURIComponent(assetCode)}`, { method: 'DELETE' });

/** Bảo trì ngay: đẩy hạn về hiện tại rồi chạy đúng đường sinh phiếu thường ngày. */
export const runMaintenanceNow = (assetCode: string) =>
  request<{ generated: number }>(`/matrix/${encodeURIComponent(assetCode)}/run`, {
    method: 'POST',
    body: '{}',
  });
