/**
 * Sắp xếp bảng Dự án theo cột (bấm tiêu đề cột): trong từng nhóm dự án, ô trống luôn xuống cuối dù tăng hay giảm dần.
 * Hàm thuần để kiểm thử; tên khách hàng và nhãn do nơi gọi tra giúp vì `ProjectSummary` chỉ có id.
 */
export const PROJECT_SORT_COLUMNS = ['project', 'customer', 'tags', 'status', 'startDate', 'endDate', 'progress'] as const;
export type ProjectSortColumn = (typeof PROJECT_SORT_COLUMNS)[number];
export type SortDirection = 'asc' | 'desc';

export interface ProjectColumnSort {
  readonly column: ProjectSortColumn;
  readonly direction: SortDirection;
}

/** Phần của một dự án mà các cột cần so sánh. */
export interface SortableProject {
  readonly name: string;
  readonly status: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly progressPercent?: number | null;
}

export interface ProjectSortLookups<P> {
  /** Tên khách hàng của dự án; rỗng khi chưa có. */
  readonly customerName: (project: P) => string;
  /** Tên các nhãn của dự án. */
  readonly tagNames: (project: P) => readonly string[];
  /** Thứ tự vòng đời của trạng thái (nhỏ trước): lập kế hoạch, đang chạy, tạm dừng, hoàn thành, huỷ. */
  readonly statusRank: (status: string) => number;
}

/** Nhận lại giá trị lưu trong bộ nhớ phiên: sai cột hoặc sai chiều thì bỏ (không sắp xếp theo cột). */
export function parseColumnSort(value: unknown): ProjectColumnSort | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { column, direction } = value as Record<string, unknown>;
  if (!PROJECT_SORT_COLUMNS.includes(column as ProjectSortColumn)) return undefined;
  if (direction !== 'asc' && direction !== 'desc') return undefined;
  return { column: column as ProjectSortColumn, direction };
}

/** Bấm tiêu đề: chưa sắp theo cột này → tăng dần; đang tăng dần → giảm dần; đang giảm dần → bỏ sắp xếp theo cột. */
export function nextColumnSort(current: ProjectColumnSort | undefined, column: ProjectSortColumn): ProjectColumnSort | undefined {
  if (current?.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : undefined;
}

const text = (a: string, b: string) => a.localeCompare(b, 'vi', { numeric: true });

/** Giá trị so sánh của một cột: `undefined` là ô trống (luôn xuống cuối). */
type Key = string | number | undefined;

function keyOf<P extends SortableProject>(column: ProjectSortColumn, project: P, lookups: ProjectSortLookups<P>): Key {
  switch (column) {
    case 'project':
      return project.name || undefined;
    case 'customer':
      return lookups.customerName(project) || undefined;
    case 'tags':
      // Theo nhãn đứng đầu theo chữ cái; chưa có nhãn là ô trống.
      return [...lookups.tagNames(project)].sort(text)[0] || undefined;
    case 'status':
      return lookups.statusRank(project.status);
    case 'startDate':
      return project.startDate || undefined;
    case 'endDate':
      return project.endDate || undefined;
    case 'progress':
      return project.progressPercent ?? 0;
  }
}

/**
 * So sánh hai dự án theo cột và chiều. Hai ô cùng giá trị trả 0 để nơi gọi dùng cách xếp mặc định làm tiêu chí phụ.
 */
export function compareByColumn<P extends SortableProject>(
  sort: ProjectColumnSort,
  lookups: ProjectSortLookups<P>,
  a: P,
  b: P,
): number {
  const left = keyOf(sort.column, a, lookups);
  const right = keyOf(sort.column, b, lookups);
  if (left === undefined || right === undefined) {
    // Ô trống xuống cuối ở cả hai chiều.
    return left === right ? 0 : left === undefined ? 1 : -1;
  }
  const order = typeof left === 'number' && typeof right === 'number' ? left - right : text(String(left), String(right));
  return sort.direction === 'asc' ? order : -order;
}
