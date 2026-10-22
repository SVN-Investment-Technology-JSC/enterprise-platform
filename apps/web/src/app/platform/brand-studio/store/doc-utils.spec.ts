import { createDocument, createPresetDocuments, createShape, type BrandIconSummary } from '@enterprise-platform/shared-brand-icon';
import { contentKey, findLocalOnly, makeCopy, presetDocs, sameContent } from './doc-utils';

const rect = (x = 4) => createShape({ type: 'rect', x, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' });

function summary(id: string, status: BrandIconSummary['status'] = 'draft'): BrandIconSummary {
  return {
    id,
    slug: id,
    name: id,
    category: 'custom',
    status,
    tags: [],
    currentVersion: 1,
    publishedVersion: null,
    hasUnpublishedChanges: false,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('contentKey / sameContent', () => {
  it('bỏ qua trạng thái và ngày giờ nhưng thấy được khác biệt về hình', () => {
    const base = createDocument({ id: 'a', name: 'A', shapes: [rect()] });

    expect(sameContent(base, { ...base, status: 'published', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2001-01-01T00:00:00.000Z' })).toBe(true);
    expect(sameContent(base, { ...base, name: 'B' })).toBe(false);
    expect(sameContent(base, { ...base, shapes: [rect(5)] })).toBe(false);
  });

  it('không phụ thuộc thứ tự khoá của đối tượng', () => {
    const base = createDocument({ id: 'a', name: 'A', shapes: [rect()] });
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as typeof base;

    expect(contentKey(reordered)).toBe(contentKey(base));
  });
});

describe('makeCopy', () => {
  it('đặt mã mới, thêm nhãn vào tên, về nháp và đổi danh mục chính thức thành tuỳ biến', () => {
    const source = createDocument({ id: 'goc', name: 'Gốc', category: 'brand', status: 'published', shapes: [rect()] });

    const copy = makeCopy(source);
    const mine = makeCopy(source, 'bản của tôi');

    expect(copy.id).not.toBe('goc');
    expect(copy.name).toBe('Gốc (bản sao)');
    expect(copy.status).toBe('draft');
    expect(copy.category).toBe('custom');
    expect(copy.shapes).toEqual(source.shapes);
    expect(mine.name).toBe('Gốc (bản của tôi)');
  });

  it('cắt tên quá dài về 80 ký tự', () => {
    expect(makeCopy(createDocument({ id: 'x', name: 'n'.repeat(80) })).name).toHaveLength(80);
  });
});

describe('findLocalOnly', () => {
  it('icon chưa có trên máy chủ thì tính, icon đã có (kể cả đã lưu trữ) thì không', () => {
    const docs = [createDocument({ id: 'moi', name: 'Mới' }), createDocument({ id: 'da-co', name: 'Đã có' }), createDocument({ id: 'cu', name: 'Cũ' })];
    const summaries = new Map([summary('da-co'), summary('cu', 'archived')].map((item) => [item.id, item]));

    expect(findLocalOnly(docs, summaries).map((doc) => doc.id)).toEqual(['moi']);
  });

  it('icon mẫu còn nguyên bản gốc thì không tính, dù mã lớp hình được sinh lại mỗi lần chạy', () => {
    // Bản lưu từ phiên trước: cùng hình nhưng mã lớp hình khác bản vừa tạo trong phiên này.
    expect(findLocalOnly(createPresetDocuments(), new Map())).toEqual([]);
    expect(findLocalOnly(presetDocs(), new Map())).toEqual([]);
  });

  it('icon mẫu đã đổi hình thì tính dù bỏ qua mã lớp hình', () => {
    const [first] = createPresetDocuments();
    const moved = { ...first, shapes: first.shapes.map((shape, index) => (index === 0 ? { ...shape, opacity: 0.4 } : shape)) };

    expect(findLocalOnly([moved], new Map()).map((doc) => doc.id)).toEqual([first.id]);
  });

  it('icon mẫu đã sửa nội dung hoặc đổi trạng thái thì tính', () => {
    const [first, second] = createPresetDocuments();
    const edited = { ...first, name: `${first.name} đã sửa` };
    const flipped = { ...second, status: second.status === 'published' ? ('draft' as const) : ('published' as const) };

    expect(findLocalOnly([edited, flipped], new Map()).map((doc) => doc.id)).toEqual([first.id, second.id]);
  });
});
