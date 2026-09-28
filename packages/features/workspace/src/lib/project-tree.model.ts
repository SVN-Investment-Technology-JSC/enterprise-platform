import { MAX_WORK_ITEM_DEPTH, type WorkItem } from '@enterprise-platform/contracts-workspace';

/** Một dòng đã phẳng hoá, sẵn sàng để render. */
export interface TreeRow {
  readonly item: WorkItem;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

/**
 * Dựng cây từ danh sách phẳng rồi phẳng hoá lại theo đúng thứ tự hiển thị.
 *
 * Server đã trả `depth`, nhưng cây vẫn được dựng lại ở đây: `depth` chỉ nói
 * node nằm ở cấp mấy, không nói nó đứng sau node nào. Thứ tự hiển thị phải
 * suy ra từ quan hệ cha con cộng `sortOrder`.
 *
 * Xử lý:
 *  - `parentId` trỏ vào node không có trong danh sách thì coi như node gốc,
 *    để một bộ lọc ở phía trên không làm mất nguyên nhánh
 *  - Lọc tìm kiếm giữ lại toàn bộ chuỗi tổ tiên của node khớp
 *  - Nhánh đang thu gọn thì bỏ qua toàn bộ con cháu
 */
export function buildWorkItemTree(
  items: readonly WorkItem[],
  visibleIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow[] {
  const present = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenOf = new Map<string, WorkItem[]>();
  const roots: WorkItem[] = [];

  for (const item of items) {
    const parentId = item.parentId && present.has(item.parentId) ? item.parentId : undefined;
    if (parentId) {
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(item);
      else childrenOf.set(parentId, [item]);
    } else {
      roots.push(item);
    }
  }

  // Giữ lại tổ tiên của mọi node khớp bộ lọc, nếu không nhánh sẽ mất gốc và
  // không hiển thị được.
  const keep = new Set<string>();
  for (const item of items) {
    if (!visibleIds.has(item.id)) continue;
    let cursor: WorkItem | undefined = item;
    while (cursor && !keep.has(cursor.id)) {
      keep.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }

  const bySortOrder = (a: WorkItem, b: WorkItem) =>
    a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'vi');

  const rows: TreeRow[] = [];
  const emit = (item: WorkItem, depth: number) => {
    if (!keep.has(item.id)) return;
    const children = (childrenOf.get(item.id) ?? []).filter((child) => keep.has(child.id));
    const isCollapsed = collapsed.has(item.id);
    rows.push({
      item,
      depth,
      hasChildren: children.length > 0,
      expanded: children.length > 0 && !isCollapsed,
    });
    if (isCollapsed) return;
    for (const child of [...children].sort(bySortOrder)) emit(child, depth + 1);
  };

  for (const root of [...roots].sort(bySortOrder)) emit(root, 0);
  return rows;
}

/** Id của những node khớp từ khoá. Từ khoá rỗng nghĩa là hiện tất cả. */
export function matchWorkItems(items: readonly WorkItem[], search: string): Set<string> {
  const needle = search.trim().toLowerCase();
  if (!needle) return new Set(items.map((item) => item.id));
  return new Set(
    items
      .filter(
        (item) =>
          item.title.toLowerCase().includes(needle) ||
          item.code.toLowerCase().includes(needle),
      )
      .map((item) => item.id),
  );
}

/** Node và toàn bộ con cháu; dùng để chặn thao tác tự trỏ vào nhánh của mình. */
export function branchOf(items: readonly WorkItem[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const siblings = childrenOf.get(item.parentId);
    if (siblings) siblings.push(item.id);
    else childrenOf.set(item.parentId, [item.id]);
  }

  const branch = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (branch.has(child)) continue;
      branch.add(child);
      queue.push(child);
    }
  }
  return branch;
}

/**
 * Những node nhận được `itemId` làm con mới.
 *
 * Loại chính nhánh của nó (sẽ tạo vòng lặp), cha hiện tại (không đổi gì) và
 * mọi node mà đặt nhánh vào sẽ vượt `MAX_WORK_ITEM_DEPTH` cấp — cùng luật với
 * `assertMoveAllowed` ở server, để hộp thoại không mời người dùng chọn một đích
 * chắc chắn bị từ chối. Server vẫn kiểm lại.
 */
export function moveTargets(items: readonly WorkItem[], itemId: string): WorkItem[] {
  const moving = items.find((item) => item.id === itemId);
  if (!moving) return [];
  const branch = branchOf(items, itemId);
  let height = 0;
  for (const item of items) {
    if (branch.has(item.id)) height = Math.max(height, item.depth - moving.depth);
  }
  return items.filter(
    (item) =>
      !branch.has(item.id) &&
      item.id !== moving.parentId &&
      item.depth + 1 + height <= MAX_WORK_ITEM_DEPTH - 1,
  );
}
