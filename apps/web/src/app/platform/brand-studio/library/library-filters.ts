import {
  CATEGORIES,
  type IconCategory,
  type IconDocument,
  type IconStatus,
} from '@enterprise-platform/shared-brand-icon';

export type CategoryFilter = 'all' | IconCategory;
export type StatusFilter = 'all' | IconStatus;
export type SortKey = 'updated' | 'name';
export type ViewMode = 'grid' | 'list';

export interface LibraryView {
  readonly query: string;
  readonly category: CategoryFilter;
  readonly status: StatusFilter;
  readonly sort: SortKey;
}

export const DEFAULT_VIEW: LibraryView = { query: '', category: 'all', status: 'all', sort: 'updated' };

export const STATUS_LABELS: Record<IconStatus, string> = { draft: 'Nháp', published: 'Phát hành' };
export const STATUSES: readonly IconStatus[] = ['draft', 'published'];

export const SORT_LABELS: Record<SortKey, string> = { updated: 'Mới sửa', name: 'Tên A-Z' };

/** Bỏ dấu tiếng Việt, hạ chữ thường, gộp khoảng trắng: "Kho Dự Phòng" và "kho du phong" cho cùng kết quả. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mọi từ trong ô tìm phải xuất hiện (không phân biệt dấu) trong tên, mô tả hoặc nhãn của icon. */
export function matchesQuery(doc: IconDocument, query: string): boolean {
  const tokens = foldText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = foldText([doc.name, doc.description, ...doc.tags].join(' '));
  return tokens.every((token) => haystack.includes(token));
}

const matchesCategory = (doc: IconDocument, category: CategoryFilter) => category === 'all' || doc.category === category;
const matchesStatus = (doc: IconDocument, status: StatusFilter) => status === 'all' || doc.status === status;

export function filterIcons(docs: readonly IconDocument[], view: Pick<LibraryView, 'query' | 'category' | 'status'>): IconDocument[] {
  return docs.filter(
    (doc) => matchesCategory(doc, view.category) && matchesStatus(doc, view.status) && matchesQuery(doc, view.query),
  );
}

const timeOf = (iso: string): number => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
};

/** Sắp xếp không làm đổi mảng gốc. "Mới sửa" xếp mới nhất lên đầu; hai icon cùng mốc thì theo tên để thứ tự ổn định. */
export function sortIcons(docs: readonly IconDocument[], sort: SortKey): IconDocument[] {
  const byName = (a: IconDocument, b: IconDocument) =>
    a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  const list = [...docs];
  if (sort === 'name') return list.sort(byName);
  return list.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt) || byName(a, b));
}

export function applyView(docs: readonly IconDocument[], view: LibraryView): IconDocument[] {
  return sortIcons(filterIcons(docs, view), view.sort);
}

export interface FacetCounts {
  readonly category: Record<CategoryFilter, number>;
  readonly status: Record<StatusFilter, number>;
}

/**
 * Số icon cho từng nút lọc. Mỗi nhóm đếm theo các bộ lọc còn lại (ô tìm, và nhóm kia), nên con số trên nút
 * luôn khớp với số icon sẽ hiện ra khi bấm nút đó.
 */
export function facetCounts(docs: readonly IconDocument[], view: Pick<LibraryView, 'query' | 'category' | 'status'>): FacetCounts {
  const category = { all: 0, brand: 0, module: 0, system: 0, custom: 0 } as Record<CategoryFilter, number>;
  const status = { all: 0, draft: 0, published: 0 } as Record<StatusFilter, number>;
  for (const doc of docs) {
    if (!matchesQuery(doc, view.query)) continue;
    if (matchesStatus(doc, view.status)) {
      category.all += 1;
      category[doc.category] += 1;
    }
    if (matchesCategory(doc, view.category)) {
      status.all += 1;
      status[doc.status] += 1;
    }
  }
  return { category, status };
}

export const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', ...CATEGORIES];

export function isViewFiltered(view: LibraryView): boolean {
  return view.query.trim() !== '' || view.category !== 'all' || view.status !== 'all';
}

/** Ngày giờ ngắn gọn cho danh sách: "20/10/2026". Chuỗi ngày hỏng thì trả về dấu gạch. */
export function formatShortDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '-';
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
