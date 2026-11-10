import { CATEGORIES } from '@enterprise-platform/shared-brand-icon';
import type { CategoryFilter, LibraryView, StatusFilter } from './library-filters';

/** Số icon mỗi trang cho phép chọn; bội của 12 để lưới 2, 3, 4, 6 cột đều không lẻ hàng cuối. */
export const PAGE_SIZE_OPTIONS: readonly number[] = [12, 24, 48, 96];
export const DEFAULT_PAGE_SIZE = 24;

/** Cỡ trang hợp lệ gần nhất; giá trị lạ (từ bộ nhớ cũ hoặc bị sửa tay) thì dùng mặc định. */
export function normalizePageSize(value: unknown): number {
  return typeof value === 'number' && PAGE_SIZE_OPTIONS.includes(value) ? value : DEFAULT_PAGE_SIZE;
}

export interface PageSlice<T> {
  readonly items: T[];
  /** Trang hiện tại, đã kẹp vào [1, pages]. */
  readonly page: number;
  readonly pages: number;
  readonly pageSize: number;
  readonly total: number;
  /** Thứ tự (từ 1) của icon đầu và cuối trang; 0 khi không có icon nào. */
  readonly from: number;
  readonly to: number;
}

/** Cắt một trang. Trang vượt cuối (xoá bớt icon, đổi bộ lọc) được kẹp về trang cuối thay vì ra trang trống. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const size = normalizePageSize(pageSize);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1));
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pages,
    pageSize: size,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

/** Đổi cỡ trang mà vẫn giữ icon đầu trang đang xem nằm trong trang mới, để người dùng không bị nhảy mất chỗ. */
export function pageAfterSizeChange(page: number, oldSize: number, newSize: number): number {
  const firstIndex = (Math.max(1, page) - 1) * normalizePageSize(oldSize);
  return Math.floor(firstIndex / normalizePageSize(newSize)) + 1;
}

export type PageToken = number | 'gap-start' | 'gap-end';

/**
 * Các nút số trang: luôn có trang đầu và cuối, quanh trang hiện tại có một trang mỗi bên, chỗ hở là dấu "…".
 * Tối đa 7 ô nên thanh phân trang không đổi độ rộng khi chuyển trang.
 */
export function pageWindow(page: number, pages: number): PageToken[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap-end', pages];
  if (page >= pages - 3) return [1, 'gap-start', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, 'gap-start', page - 1, page, page + 1, 'gap-end', pages];
}

/* ---------- Ghi nhớ trong phiên (sessionStorage) ---------- */

export const MEMORY_KEY = 'svndts-brand-library-memory-v1';
/** Số tổ hợp bộ lọc được nhớ trang; vượt thì bỏ tổ hợp cũ nhất (ô tìm gõ từng chữ sinh ra nhiều tổ hợp). */
export const MEMORY_LIMIT = 24;

export type FilterState = Pick<LibraryView, 'query' | 'category' | 'status'>;

export interface LibraryMemory {
  readonly filters: FilterState;
  /** Trang đang xem theo từng tổ hợp bộ lọc + sắp xếp, theo thứ tự cũ đến mới. */
  readonly pages: Readonly<Record<string, number>>;
  /** Vị trí cuộn trong khung icon. */
  readonly scrollTop: number;
}

export const EMPTY_MEMORY: LibraryMemory = {
  filters: { query: '', category: 'all', status: 'all' },
  pages: {},
  scrollTop: 0,
};

/** Khoá của một tổ hợp bộ lọc + sắp xếp + cỡ trang; cỡ trang nằm trong khoá vì số trang đổi theo cỡ trang. */
export function pageKey(view: LibraryView, pageSize: number): string {
  return [view.category, view.status, view.sort, pageSize, view.query.trim().toLowerCase()].join('|');
}

/** Ghi nhớ trang của một tổ hợp; tổ hợp vừa dùng được đưa về cuối, vượt giới hạn thì bỏ tổ hợp cũ nhất. */
export function rememberPage(
  pages: Readonly<Record<string, number>>,
  key: string,
  page: number,
  limit: number = MEMORY_LIMIT,
): Record<string, number> {
  const rest = { ...pages };
  delete rest[key];
  const entries = Object.entries(rest);
  const kept = page > 1 ? [...entries, [key, page] as [string, number]] : entries;
  return Object.fromEntries(kept.slice(-limit));
}

const CATEGORY_VALUES: readonly string[] = ['all', ...CATEGORIES];
const STATUS_VALUES: readonly string[] = ['all', 'draft', 'published'];

/** Đọc bộ nhớ đã lưu, bỏ mọi trường sai kiểu; dữ liệu hỏng thì coi như chưa có gì. */
export function parseMemory(raw: unknown): LibraryMemory {
  if (typeof raw !== 'object' || raw === null) return EMPTY_MEMORY;
  const data = raw as Record<string, unknown>;
  const filters = (typeof data.filters === 'object' && data.filters !== null ? data.filters : {}) as Record<string, unknown>;
  const pages: Record<string, number> = {};
  if (typeof data.pages === 'object' && data.pages !== null) {
    for (const [key, value] of Object.entries(data.pages as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isInteger(value) && value > 1) pages[key] = value;
    }
  }
  return {
    filters: {
      query: typeof filters.query === 'string' ? filters.query.slice(0, 200) : '',
      category: (CATEGORY_VALUES.includes(filters.category as string) ? filters.category : 'all') as CategoryFilter,
      status: (STATUS_VALUES.includes(filters.status as string) ? filters.status : 'all') as StatusFilter,
    },
    pages: Object.fromEntries(Object.entries(pages).slice(-MEMORY_LIMIT)),
    scrollTop: typeof data.scrollTop === 'number' && Number.isFinite(data.scrollTop) ? Math.max(0, data.scrollTop) : 0,
  };
}

export function readMemory(): LibraryMemory {
  try {
    const raw = window.sessionStorage.getItem(MEMORY_KEY);
    return raw ? parseMemory(JSON.parse(raw)) : EMPTY_MEMORY;
  } catch {
    return EMPTY_MEMORY;
  }
}

export function writeMemory(memory: LibraryMemory): void {
  try {
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Trình duyệt chặn sessionStorage: bỏ qua, chỉ mất việc nhớ chỗ đang xem.
  }
}
