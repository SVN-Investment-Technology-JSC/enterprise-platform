/**
 * Trí nhớ của trang danh sách "Dự án": mở một dự án rồi quay lại thì danh sách vẫn như người dùng đã để (nhóm nào đang mở,
 * đang xem "Đang làm" hay "Lưu trữ", bộ lọc, cách sắp xếp) và biết mình vừa từ dự án nào quay về.
 *
 * Trang danh sách bị gỡ khỏi cây giao diện khi mở một dự án, nên trạng thái này không thể nằm trong `useState` của nó.
 * Giữ ở bộ nhớ của mô-đun (sống suốt phiên làm việc trong trang) và sao lưu sang `sessionStorage` để F5 cũng không mất.
 */

import { EMPTY_PROJECT_FILTER, type ProjectFilter } from './project-filter.model';

const STORAGE_KEY = 'workspace.projects-list.v1';

/** Dấu "vừa xem" chỉ còn giá trị chừng này (ms) sau lúc mở dự án: quay lại muộn hơn thì không còn là "vừa". */
export const RETURN_MARK_TTL_MS = 30 * 60 * 1000;

export type ProjectListScope = 'active' | 'archived';
export type ProjectListSort = 'name' | 'code' | 'updated';

export interface ProjectListMemory {
  readonly scope: ProjectListScope;
  /** Tên các nhóm dự án đang mở. */
  readonly expanded: readonly string[];
  readonly statusFilter: string;
  readonly typeFilter: string;
  readonly tagFilter: string;
  readonly customerFilter: string;
  readonly sortKey: ProjectListSort;
  readonly projectFilter: ProjectFilter;
}

const DEFAULTS: ProjectListMemory = {
  scope: 'active',
  expanded: [],
  statusFilter: '',
  typeFilter: '',
  tagFilter: '',
  customerFilter: '',
  sortKey: 'name',
  projectFilter: EMPTY_PROJECT_FILTER,
};

interface Stored {
  readonly list: ProjectListMemory;
  readonly opened?: { readonly id: string; readonly at: number };
}

let cache: Stored | undefined;

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

/** Đọc lại từ `sessionStorage` và vá những trường lạ hay thiếu (bản cũ, dữ liệu hỏng) về mặc định. */
function parse(raw: string | null): Stored {
  if (!raw) return { list: DEFAULTS };
  try {
    const value = JSON.parse(raw) as Partial<Stored> & { list?: Partial<ProjectListMemory> };
    const list: Partial<ProjectListMemory> = value.list ?? {};
    return {
      list: {
        scope: list.scope === 'archived' ? 'archived' : 'active',
        expanded: Array.isArray(list.expanded) ? list.expanded.filter((entry) => typeof entry === 'string') : [],
        statusFilter: text(list.statusFilter),
        typeFilter: text(list.typeFilter),
        tagFilter: text(list.tagFilter),
        customerFilter: text(list.customerFilter),
        sortKey: list.sortKey === 'code' || list.sortKey === 'updated' ? list.sortKey : 'name',
        projectFilter: { ...EMPTY_PROJECT_FILTER, ...(list.projectFilter ?? {}) },
      },
      opened:
        value.opened && typeof value.opened.id === 'string' && typeof value.opened.at === 'number'
          ? { id: value.opened.id, at: value.opened.at }
          : undefined,
    };
  } catch {
    return { list: DEFAULTS };
  }
}

function load(): Stored {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage có thể bị chặn (chế độ riêng tư): chỉ giữ trong bộ nhớ.
  }
  cache = parse(raw);
  return cache;
}

function persist(next: Stored): void {
  cache = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // bỏ qua nếu không ghi được.
  }
}

export function readProjectListMemory(): ProjectListMemory {
  return load().list;
}

export function writeProjectListMemory(list: ProjectListMemory): void {
  persist({ ...load(), list });
}

/** Ghi nhận người dùng vừa mở dự án này từ danh sách. */
export function markProjectOpened(projectId: string): void {
  persist({ ...load(), opened: { id: projectId, at: Date.now() } });
}

/**
 * Dự án người dùng vừa mở từ danh sách, nếu còn "mới". Không đổi trạng thái (an toàn khi React gọi hàm khởi tạo hai lần ở chế độ
 * dev); gọi `clearReturnedProject` sau khi đã lấy để các lần vào trang danh sách sau không bị đánh dấu lại.
 */
export function peekReturnedProject(now = Date.now()): string | undefined {
  const opened = load().opened;
  return opened && now - opened.at <= RETURN_MARK_TTL_MS ? opened.id : undefined;
}

export function clearReturnedProject(): void {
  const stored = load();
  if (stored.opened) persist({ ...stored, opened: undefined });
}

/** Chỉ để kiểm thử: xoá trí nhớ. */
export function resetProjectListMemoryForTests(): void {
  cache = undefined;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // bỏ qua.
  }
}
