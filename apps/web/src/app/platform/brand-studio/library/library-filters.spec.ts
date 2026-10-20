import { createDocument, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import {
  DEFAULT_VIEW,
  applyView,
  facetCounts,
  filterIcons,
  foldText,
  formatShortDate,
  isViewFiltered,
  matchesQuery,
  sortIcons,
  type LibraryView,
} from './library-filters';

const make = (overrides: Partial<IconDocument>): IconDocument => createDocument(overrides);

const docs: IconDocument[] = [
  make({ id: 'a', name: 'Kho Dự phòng', description: 'Biểu tượng kho vật tư', category: 'module', status: 'published', tags: ['kho', 'vật tư'], updatedAt: '2026-10-01T00:00:00.000Z' }),
  make({ id: 'b', name: 'Bảo trì', description: 'Lịch bảo trì thiết bị', category: 'module', status: 'draft', tags: ['thiết bị'], updatedAt: '2026-10-05T00:00:00.000Z' }),
  make({ id: 'c', name: 'Đám mây', description: '', category: 'system', status: 'published', tags: [], updatedAt: '2026-09-20T00:00:00.000Z' }),
  make({ id: 'd', name: 'Logo chính', description: 'Dấu hiệu thương hiệu', category: 'brand', status: 'draft', tags: ['logo'], updatedAt: '2026-10-05T00:00:00.000Z' }),
  make({ id: 'e', name: 'ếch Xanh', description: 'Tuỳ biến', category: 'custom', status: 'draft', tags: [], updatedAt: 'không phải ngày' }),
];

const view = (patch: Partial<LibraryView>): LibraryView => ({ ...DEFAULT_VIEW, ...patch });
const ids = (list: readonly IconDocument[]) => list.map((doc) => doc.id);

describe('foldText', () => {
  it('bỏ dấu, hạ chữ thường, gộp khoảng trắng', () => {
    expect(foldText('  Kho   DỰ Phòng ')).toBe('kho du phong');
    expect(foldText('Đường Đi')).toBe('duong di');
    expect(foldText('ếch')).toBe('ech');
  });
});

describe('matchesQuery', () => {
  it('ô tìm trống thì khớp mọi icon', () => {
    expect(docs.every((doc) => matchesQuery(doc, ''))).toBe(true);
    expect(docs.every((doc) => matchesQuery(doc, '   '))).toBe(true);
  });

  it('tìm không dấu theo tên', () => {
    expect(ids(docs.filter((doc) => matchesQuery(doc, 'kho du phong')))).toEqual(['a']);
    expect(ids(docs.filter((doc) => matchesQuery(doc, 'DAM MAY')))).toEqual(['c']);
  });

  it('tìm theo mô tả và nhãn', () => {
    expect(ids(docs.filter((doc) => matchesQuery(doc, 'lich bao tri')))).toEqual(['b']);
    expect(ids(docs.filter((doc) => matchesQuery(doc, 'logo')))).toEqual(['d']);
    expect(ids(docs.filter((doc) => matchesQuery(doc, 'vat tu')))).toEqual(['a']);
  });

  it('nhiều từ phải cùng xuất hiện, không cần liền nhau hay đúng thứ tự', () => {
    expect(matchesQuery(docs[0], 'phong kho')).toBe(true);
    expect(matchesQuery(docs[0], 'kho bao')).toBe(false);
  });
});

describe('filterIcons', () => {
  it('lọc theo danh mục và trạng thái', () => {
    expect(ids(filterIcons(docs, view({ category: 'module' })))).toEqual(['a', 'b']);
    expect(ids(filterIcons(docs, view({ status: 'published' })))).toEqual(['a', 'c']);
    expect(ids(filterIcons(docs, view({ category: 'module', status: 'draft' })))).toEqual(['b']);
  });

  it('kết hợp ô tìm với bộ lọc', () => {
    expect(ids(filterIcons(docs, view({ query: 'bao tri', status: 'published' })))).toEqual([]);
    expect(ids(filterIcons(docs, view({ query: 'bao tri', status: 'draft' })))).toEqual(['b']);
  });
});

describe('sortIcons', () => {
  it('"mới sửa" xếp mới nhất trước, cùng mốc thì theo tên, ngày hỏng xuống cuối', () => {
    expect(ids(sortIcons(docs, 'updated'))).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('theo tên A-Z, bỏ qua dấu và hoa thường', () => {
    expect(ids(sortIcons(docs, 'name'))).toEqual(['b', 'c', 'e', 'a', 'd']);
  });

  it('không làm đổi mảng gốc', () => {
    const before = ids(docs);
    sortIcons(docs, 'name');
    expect(ids(docs)).toEqual(before);
  });
});

describe('applyView', () => {
  it('lọc rồi sắp xếp', () => {
    expect(ids(applyView(docs, view({ category: 'module', sort: 'name' })))).toEqual(['b', 'a']);
  });
});

describe('facetCounts', () => {
  it('đếm danh mục theo trạng thái và ô tìm đang chọn, đếm trạng thái theo danh mục đang chọn', () => {
    const counts = facetCounts(docs, view({ status: 'draft' }));
    expect(counts.category).toEqual({ all: 3, brand: 1, module: 1, system: 0, custom: 1 });
    expect(counts.status).toEqual({ all: 5, draft: 3, published: 2 });

    const byCategory = facetCounts(docs, view({ category: 'module' }));
    expect(byCategory.status).toEqual({ all: 2, draft: 1, published: 1 });
  });

  it('con số trên nút khớp số icon hiện ra khi bấm nút', () => {
    const base = view({ query: 'bao', status: 'draft' });
    const counts = facetCounts(docs, base);
    expect(counts.category.module).toBe(filterIcons(docs, { ...base, category: 'module' }).length);
    expect(counts.category.all).toBe(filterIcons(docs, { ...base, category: 'all' }).length);
  });
});

describe('isViewFiltered', () => {
  it('chỉ true khi có ô tìm, danh mục hoặc trạng thái (sắp xếp không tính)', () => {
    expect(isViewFiltered(DEFAULT_VIEW)).toBe(false);
    expect(isViewFiltered(view({ sort: 'name' }))).toBe(false);
    expect(isViewFiltered(view({ query: ' ' }))).toBe(false);
    expect(isViewFiltered(view({ query: 'a' }))).toBe(true);
    expect(isViewFiltered(view({ category: 'brand' }))).toBe(true);
    expect(isViewFiltered(view({ status: 'draft' }))).toBe(true);
  });
});

describe('formatShortDate', () => {
  it('định dạng ngày/tháng/năm', () => {
    expect(formatShortDate(new Date(2026, 9, 5, 12).toISOString())).toBe('05/10/2026');
  });

  it('chuỗi ngày hỏng trả dấu gạch', () => {
    expect(formatShortDate('abc')).toBe('-');
  });
});
