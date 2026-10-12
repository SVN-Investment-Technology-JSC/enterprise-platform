/**
 * Dự án Workspace cho trường "Dự án liên kết" của đơn từ.
 *
 * Đọc qua API của Workspace bằng chính phiên người dùng — HRM không đọc bảng
 * của Workspace. Kiểu dữ liệu khai tại chỗ: gói `feature-hrm` không phụ thuộc
 * hợp đồng của module khác.
 */

const API = '/api/workspace/v1';
/** Trần số dòng mỗi trang, khớp `MAX_PAGE_SIZE` của Workspace. */
const PAGE_SIZE = 60;
const MAX_PAGES = 20;

/** Vai trò được gửi đơn cho dự án — cùng luật Workspace kiểm khi nhận đơn. */
const SUBMITTER_ROLES = new Set(['owner', 'manager', 'member']);
const CLOSED_STATUSES = new Set(['completed', 'cancelled']);

export interface LinkableProject {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

interface ProjectRow extends LinkableProject {
  readonly myRole?: string;
}

/**
 * Dự án người dùng **tham gia** và còn mở — cùng logic ô "Dự án liên quan"
 * bên Quy trình. Workspace chưa bật hoặc lỗi mạng thì trả mảng rỗng: đơn vẫn
 * gửi được, chỉ là không gắn dự án.
 */
export async function loadLinkableProjects(): Promise<LinkableProject[]> {
  const rows: ProjectRow[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await fetch(
        `${API}/projects?page=${page}&pageSize=${PAGE_SIZE}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!response.ok) return [];
      const body = (await response.json()) as {
        items?: ProjectRow[];
        total?: number;
      };
      const items = body.items ?? [];
      rows.push(...items);
      if (items.length === 0 || rows.length >= (body.total ?? 0)) break;
    }
  } catch {
    return [];
  }
  return rows
    .filter((row) => row.myRole && SUBMITTER_ROLES.has(row.myRole))
    .filter((row) => !CLOSED_STATUSES.has(row.status))
    .map(({ id, code, name, status }) => ({ id, code, name, status }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

/** Nhãn dự án thống nhất mọi nơi: `EVN - Điện lực Miền Trung`. */
export function projectLabel(project: {
  readonly code?: string | null;
  readonly name?: string | null;
}): string {
  return [project.code, project.name].filter(Boolean).join(' - ');
}

export const PROJECT_STATUS_LABEL: Readonly<Record<string, string>> = {
  planning: 'Đang lập kế hoạch',
  active: 'Đang triển khai',
  on_hold: 'Tạm dừng',
};

/** Trạng thái đăng ký đơn sang Workspace, cho ô chi tiết đơn. */
export const PROJECT_LINK_STATUS_LABEL: Readonly<Record<string, string>> = {
  REGISTERING: 'Đang gửi sang Workspace',
  REGISTERED: 'Đã ghi nhận',
  REJECTED: 'Workspace từ chối',
};
