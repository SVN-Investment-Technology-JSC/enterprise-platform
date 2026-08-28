import type { Asset } from '@enterprise-platform/contracts-inventory';

export interface AssetTreeNode {
  readonly asset: Asset;
  readonly depth: number;
  /** Có nhánh con hay không — để biết chỗ nào cần mũi tên sổ/thu. */
  readonly hasChildren: boolean;
  /** Nhánh đang mở hay đang thu. Node không có con luôn là `false`. */
  readonly expanded: boolean;
}

/**
 * Dựng cây theo parentId, phẳng hoá thành danh sách kèm độ sâu để render.
 *
 * Ba điều dữ liệu thật bắt phải xử lý:
 *  - parentId có thể trỏ tới tài sản không nằm trong danh sách trả về (bị lọc
 *    quyền, hoặc đã xoá). Node đó vẫn phải hiện ở gốc, không được biến mất
 *  - parentId có thể là null chứ không phải undefined
 *  - node khớp tìm kiếm phải kéo theo toàn bộ tổ tiên, nếu không kết quả nằm
 *    lơ lửng không rõ thuộc thiết bị nào
 *
 * Tách khỏi component để kiểm được bằng dữ liệu thật, không cần trình duyệt.
 */
export function buildAssetTree(
  assets: readonly Asset[],
  visibleIds: ReadonlySet<string>,
  /**
   * Nhánh đang THU. Mặc định mọi nhánh đều mở: cây thiết bị chỉ vài cấp, và mở
   * sẵn thì người dùng thấy ngay toàn cảnh thay vì phải bấm từng cấp.
   */
  collapsed: ReadonlySet<string> = new Set(),
): AssetTreeNode[] {
  const present = new Set(assets.map((asset) => asset.id));
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const childrenOf = new Map<string, Asset[]>();
  const roots: Asset[] = [];

  for (const asset of assets) {
    const parentId = asset.parentId ?? undefined;
    if (parentId && present.has(parentId)) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(asset);
      childrenOf.set(parentId, siblings);
    } else {
      roots.push(asset);
    }
  }

  const keep = new Set<string>();
  for (const asset of assets) {
    if (!visibleIds.has(asset.id)) continue;
    let cursor: Asset | undefined = asset;
    while (cursor && !keep.has(cursor.id)) {
      keep.add(cursor.id);
      const parentId: string | undefined = cursor.parentId ?? undefined;
      cursor = parentId ? byId.get(parentId) : undefined;
    }
  }

  const byCode = (a: Asset, b: Asset) => a.code.localeCompare(b.code, 'vi');
  const flat: AssetTreeNode[] = [];
  const emit = (asset: Asset, depth: number) => {
    if (!keep.has(asset.id)) return;
    const children = (childrenOf.get(asset.id) ?? []).filter((child) => keep.has(child.id));
    const isCollapsed = collapsed.has(asset.id);
    flat.push({
      asset,
      depth,
      hasChildren: children.length > 0,
      expanded: children.length > 0 && !isCollapsed,
    });
    // Nhánh đang thu thì không phát con ra — đó chính là ý nghĩa của "thu gọn".
    if (isCollapsed) return;
    for (const child of children.sort(byCode)) emit(child, depth + 1);
  };
  for (const root of roots.sort(byCode)) emit(root, 0);

  return flat;
}
