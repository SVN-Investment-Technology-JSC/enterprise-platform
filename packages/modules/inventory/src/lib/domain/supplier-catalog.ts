import {
  isSupplierCatalogEnforced,
  type LegacySupplierCandidate,
  type SupplierInputMode,
} from '@enterprise-platform/contracts-inventory';
import { SupplierNotInCatalogError } from './inventory.error.js';

/**
 * Khóa so sánh nhà cung cấp: bỏ dấu tiếng Việt, không phân biệt hoa thường, dấu câu và khoảng trắng thừa
 * đều thành một khoảng trắng.
 *
 * "Công ty A", "CÔNG TY A ", "Cong ty A." cùng một khóa. Viết tắt ("Cty A") KHÔNG được coi là cùng, vì
 * đoán viết tắt dễ gộp nhầm hai nhà khác nhau; việc đó để người dùng chọn từ danh mục.
 *
 * Đây là nơi duy nhất định nghĩa "hai nhà cung cấp trùng nhau" của Kho. Chỗ nào cần so sánh (danh mục,
 * kiểm khi ghi, nhập từ dữ liệu cũ, về sau là định danh lô) đều gọi hàm này.
 */
export function normalizeSupplierKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Quy tắc nhập nhà cung cấp của một tenant tại thời điểm ghi.
 *
 * `enforced` chỉ đúng khi chọn `CATALOG_ONLY` VÀ danh mục không rỗng. Danh mục rỗng thì cho nhập tự do:
 * mặc định của tenant là `CATALOG_ONLY` nên nếu rỗng mà vẫn chặn thì mọi lần nhập kho có nhà cung cấp ở
 * tenant hiện có sẽ lỗi ngay sau khi nâng cấp.
 */
export interface SupplierPolicy {
  readonly enforced: boolean;
  /**
   * Trả tên chuẩn của nhà cung cấp.
   * - Trống: `undefined`.
   * - Có hiệu lực chặn: tên trong danh mục khớp sau chuẩn hóa; không khớp thì ném
   *   `SUPPLIER_NOT_IN_CATALOG`.
   * - Không chặn: chính chữ người dùng nhập (đã cắt khoảng trắng hai đầu).
   * `prefix` đứng trước thông báo lỗi, ví dụ "Dòng 2: ".
   */
  resolve(raw: string | null | undefined, prefix?: string): string | undefined;
  /** Hai chữ có cùng khóa so sánh không. */
  sameSupplier(a: string | null | undefined, b: string | null | undefined): boolean;
}

export function buildSupplierPolicy(
  catalog: readonly string[],
  mode: SupplierInputMode,
): SupplierPolicy {
  const byKey = new Map<string, string>();
  for (const name of catalog) {
    const key = normalizeSupplierKey(name);
    // Trùng khóa thì giữ tên đứng trước: danh mục đã được chuẩn hóa khi lưu nên chỉ xảy ra với dữ liệu cũ.
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  const enforced = isSupplierCatalogEnforced([...byKey.values()], mode);
  return {
    enforced,
    resolve(raw, prefix = '') {
      const trimmed = raw?.trim();
      if (!trimmed) return undefined;
      if (!enforced) return trimmed;
      const canonical = byKey.get(normalizeSupplierKey(trimmed));
      if (!canonical) throw new SupplierNotInCatalogError(trimmed, prefix);
      return canonical;
    },
    sameSupplier: (a, b) => {
      const keyA = normalizeSupplierKey(a);
      return keyA !== '' && keyA === normalizeSupplierKey(b);
    },
  };
}

export interface LegacySupplierValue {
  readonly name: string;
  readonly source: 'MATERIAL' | 'LOT' | 'TRANSACTION';
  readonly count: number;
}

/**
 * Gộp các giá trị nhà cung cấp chữ tự do đang có trong dữ liệu thành danh sách đề xuất cho danh mục.
 *
 * Mỗi nhóm là một khóa chuẩn hóa; tên đề xuất là cách viết được dùng nhiều nhất (hòa thì xếp theo chữ cái
 * để kết quả ổn định). Nhóm đã có trong danh mục được đánh dấu `inCatalog` chứ không bỏ đi, để người duyệt
 * thấy dữ liệu cũ đã được phủ bởi mục nào.
 */
export function groupLegacySuppliers(
  values: readonly LegacySupplierValue[],
  catalog: readonly string[],
): LegacySupplierCandidate[] {
  const inCatalog = new Set(catalog.map((name) => normalizeSupplierKey(name)));
  interface Group {
    variants: Map<string, number>;
    material: number;
    lot: number;
    transaction: number;
  }
  const groups = new Map<string, Group>();
  for (const value of values) {
    const name = value.name.trim();
    const key = normalizeSupplierKey(name);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { variants: new Map(), material: 0, lot: 0, transaction: 0 };
      groups.set(key, group);
    }
    group.variants.set(name, (group.variants.get(name) ?? 0) + value.count);
    if (value.source === 'MATERIAL') group.material += value.count;
    else if (value.source === 'LOT') group.lot += value.count;
    else group.transaction += value.count;
  }
  const candidates: LegacySupplierCandidate[] = [];
  for (const [key, group] of groups) {
    const ranked = [...group.variants.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'),
    );
    candidates.push({
      name: ranked[0][0],
      variants: ranked.map(([variant]) => variant),
      materialCount: group.material,
      lotCount: group.lot,
      transactionCount: group.transaction,
      inCatalog: inCatalog.has(key),
    });
  }
  return candidates.sort(
    (a, b) =>
      b.materialCount + b.lotCount + b.transactionCount -
        (a.materialCount + a.lotCount + a.transactionCount) || a.name.localeCompare(b.name, 'vi'),
  );
}
