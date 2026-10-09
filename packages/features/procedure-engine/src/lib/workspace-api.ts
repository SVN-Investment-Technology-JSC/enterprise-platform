import { authFetch } from '@enterprise-platform/shared-ui';

/**
 * **Đọc** dữ liệu Workspace từ trình duyệt, bằng chính phiên người dùng.
 *
 * Chỉ có lời gọi GET: dự án người dùng tham gia, thành viên, danh bạ, quyền
 * tài chính. Quy trình không ghi gì sang Workspace — công việc của đơn gắn dự
 * án do Workspace tự tạo khi nhận sự kiện `procedure.instance.workspace_link_requested`.
 *
 * Kiểu dữ liệu khai tại chỗ thay vì import `contracts-workspace`: gói
 * `feature-procedure-engine` không phụ thuộc vào hợp đồng của module khác.
 */

const API = '/api/workspace/v1';

/** Trần số dòng mỗi trang, khớp `MAX_PAGE_SIZE` của Workspace. */
const PAGE_SIZE = 60;
const MAX_PAGES = 20;

/** Vai trò dự án được tạo công việc (Workspace yêu cầu tối thiểu `member`). */
const WRITER_ROLES = new Set(['owner', 'manager', 'member']);

/** Giao việc cho người khác cần `manager` trở lên, khớp quy tắc ở Workspace. */
const ASSIGNER_ROLES = new Set(['owner', 'manager']);

/** Dự án đã đóng thì không nhận việc mới. */
const CLOSED_STATUSES = new Set(['completed', 'cancelled']);

export const WORK_ITEM_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Thấp' },
  { value: 'normal', label: 'Bình thường' },
  { value: 'high', label: 'Cao' },
  { value: 'urgent', label: 'Khẩn cấp' },
] as const;

export type WorkItemPriority = (typeof WORK_ITEM_PRIORITY_OPTIONS)[number]['value'];

/**
 * Loại công việc mở được theo quy trình. Không có "Nhóm công việc": Workspace
 * chỉ coi nhóm là vỏ chứa việc con, không cho nó chạy theo quy trình.
 */
export const WORK_ITEM_TYPE_OPTIONS = [
  { value: 'task', label: 'Công việc' },
  { value: 'milestone', label: 'Cột mốc' },
] as const;

export type WorkItemType = (typeof WORK_ITEM_TYPE_OPTIONS)[number]['value'];

export interface RelatedProject {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Được giao việc cho người khác, không chỉ cho chính mình. */
  readonly canAssignOthers: boolean;
}

export interface ProjectPerson {
  readonly userId: string;
  readonly displayName: string;
}

/** Các trường của form tạo công việc bên Workspace, trừ tên (lấy từ tên đơn). */
export interface ProjectWorkItemInput {
  readonly projectId: string;
  readonly itemType?: WorkItemType;
  readonly description?: string;
  readonly priority?: WorkItemPriority;
  readonly assigneeUserId?: string;
  readonly plannedStart?: string;
  readonly plannedEnd?: string;
  readonly estimateHours?: number;
  readonly estimatedCost?: number;
}

interface ProjectRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status?: string;
  readonly myRole?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    // Workspace trả thông điệp tiếng Việt kèm mã lỗi; chuyển nguyên.
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Workspace trả về HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

/**
 * Dự án mà người này **tham gia** và còn tạo được việc.
 *
 * Quản trị tenant thấy mọi dự án ở Workspace, nhưng danh sách này chỉ lấy dự
 * án có `myRole` — tức đúng các dự án họ là thành viên. Workspace chưa bật
 * hoặc lỗi mạng thì trả mảng rỗng: vẫn tạo được đơn, chỉ là không gắn dự án.
 */
export async function loadRelatedProjects(): Promise<RelatedProject[]> {
  const rows: ProjectRow[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await request<{ items?: ProjectRow[]; total?: number }>(
        `/projects?page=${page}&pageSize=${PAGE_SIZE}`,
        { cache: 'no-store' },
      );
      const items = body.items ?? [];
      rows.push(...items);
      if (items.length === 0 || rows.length >= (body.total ?? 0)) break;
    }
  } catch {
    return [];
  }
  return rows
    .filter((row) => row.myRole && WRITER_ROLES.has(row.myRole))
    .filter((row) => !row.status || !CLOSED_STATUSES.has(row.status))
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      canAssignOthers: ASSIGNER_ROLES.has(row.myRole ?? ''),
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

/**
 * Người dùng có được nhập chi phí trong dự án này không.
 *
 * Workspace chỉ gửi `finance` trong chi tiết dự án (không có ở danh sách) và
 * chỉ cho người được xem tài chính — dựa vào sự có mặt của nó, như form công
 * việc bên đó, thay vì tự suy từ vai trò.
 */
export async function loadProjectFinanceEnabled(projectId: string): Promise<boolean> {
  try {
    const project = await request<{ finance?: unknown }>(`/projects/${projectId}`, {
      cache: 'no-store',
    });
    return Boolean(project.finance);
  } catch {
    return false;
  }
}

/** Thành viên dự án kèm tên hiển thị, cho ô "Người phụ trách". */
export async function loadProjectPeople(projectId: string): Promise<ProjectPerson[]> {
  const [members, directory] = await Promise.all([
    request<{ items?: { userId: string }[] }>(`/projects/${projectId}/members`, {
      cache: 'no-store',
    }),
    request<{ people?: ProjectPerson[] }>('/directory', { cache: 'no-store' }).catch(() => ({
      people: [] as ProjectPerson[],
    })),
  ]);
  const names = new Map((directory.people ?? []).map((person) => [person.userId, person.displayName]));
  return (members.items ?? []).map((member) => ({
    userId: member.userId,
    displayName: names.get(member.userId) ?? member.userId,
  }));
}

/** Định dạng số tiền khi gõ: chỉ giữ chữ số, chèn chấm ngăn nghìn. */
export function formatVndInput(value: string): string {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Đọc lại số tiền đã định dạng; rỗng nghĩa là không nhập. */
export function parseVndInput(value: string): number | undefined {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : undefined;
}

/**
 * Tên hồ sơ gắn công việc: `[mã dự án]-[mã công việc]-[tên]`, ví dụ
 * `EVN-CV013-Mua cáp Anten`.
 *
 * Mã công việc bỏ gạch nối (mã cũ `CV-012` → `CV012`). Workspace ghép cùng
 * format khi mở hồ sơ từ công việc (`procedureTitleFor`) — giữ hai nơi khớp
 * nhau.
 */
export function procedureNameFor(projectCode: string, itemCode: string, name: string): string {
  return [projectCode, itemCode.replace(/-/g, ''), name].filter(Boolean).join('-');
}
