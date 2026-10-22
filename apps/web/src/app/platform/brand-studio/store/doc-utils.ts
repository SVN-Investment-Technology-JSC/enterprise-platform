import {
  createPresetDocuments,
  normalizeDocument,
  type BrandIconSummary,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { freshId } from './local-store';

/** Khoá bất biến trong thân bản: sắp xếp khoá đối tượng để hai bản cùng nội dung luôn ra cùng chuỗi. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stable(record[key])]),
    );
  }
  return value;
}

const VOLATILE_FIELDS: ReadonlySet<string> = new Set(['status', 'createdAt', 'updatedAt']);

/**
 * Nội dung vẽ của icon, không tính trạng thái và ngày giờ. Chuẩn hoá trước để bản trong localStorage, bản từ
 * máy chủ và bản mẫu so sánh được với nhau (chúng đi qua `normalizeDocument` ở mỗi nơi một lần).
 */
export function contentKey(doc: IconDocument, options: { readonly ignoreShapeIds?: boolean } = {}): string {
  const clean = normalizeDocument(doc) ?? doc;
  const content: Record<string, unknown> = Object.fromEntries(Object.entries(clean).filter(([key]) => !VOLATILE_FIELDS.has(key)));
  if (options.ignoreShapeIds) {
    content.shapes = clean.shapes.map((shape) => Object.fromEntries(Object.entries(shape).filter(([key]) => key !== 'id')));
  }
  return JSON.stringify(stable(content));
}

/**
 * Hai bản có cùng nội dung vẽ không. `ignoreShapeIds` dành cho icon mẫu: mã lớp hình của icon mẫu được sinh ngẫu
 * nhiên mỗi lần chạy nên bản đã lưu từ phiên trước luôn khác mã so với bản vừa tạo, dù hình giống hệt.
 */
export function sameContent(a: IconDocument, b: IconDocument, options: { readonly ignoreShapeIds?: boolean } = {}): boolean {
  return contentKey(a, options) === contentKey(b, options);
}

/**
 * Bản sao thành icon nháp mới (tên thêm " (bản sao)" hoặc nhãn khác); danh mục thương hiệu và phân hệ đổi thành
 * tuỳ biến vì hai danh mục đó dành cho icon chính thức.
 */
export function makeCopy(source: IconDocument, label = 'bản sao'): IconDocument {
  const now = new Date().toISOString();
  return {
    ...source,
    id: freshId(),
    name: `${source.name} (${label})`.slice(0, 80),
    category: source.category === 'brand' || source.category === 'module' ? 'custom' : source.category,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

let presets: readonly IconDocument[] | null = null;

/** Icon mẫu của mã nguồn; tạo một lần và dùng lại để các bản chụp giữ nguyên tham chiếu. */
export function presetDocs(): readonly IconDocument[] {
  presets ??= createPresetDocuments();
  return presets;
}

/**
 * Icon chỉ có trong trình duyệt: chưa có trên máy chủ dù là bản lưu trữ. Icon mẫu chỉ tính khi người dùng đã sửa
 * (nội dung hoặc trạng thái khác bản gốc), nếu không thì máy chủ không cần giữ bản sao.
 */
export function findLocalOnly(
  localDocs: readonly IconDocument[],
  summaries: ReadonlyMap<string, BrandIconSummary>,
): IconDocument[] {
  const originals = new Map(presetDocs().map((doc) => [doc.id, doc]));
  return localDocs.filter((doc) => {
    if (summaries.has(doc.id)) return false;
    const original = originals.get(doc.id);
    if (!original) return true;
    return doc.status !== original.status || !sameContent(doc, original, { ignoreShapeIds: true });
  });
}
