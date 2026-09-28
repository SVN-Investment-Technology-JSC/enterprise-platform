import { MAX_WORK_ITEM_DEPTH } from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from './workspace.error.js';

/**
 * Hình dạng tối thiểu mà các quy tắc cây cần biết.
 *
 * Cố ý KHÔNG dùng kiểu `WorkItem` đầy đủ: quy tắc chỉ quan tâm quan hệ cha con
 * nên nhận đúng phần đó, và test dựng dữ liệu giả gọn hơn nhiều.
 */
export interface TreeNode {
  readonly id: string;
  readonly parentId?: string | null;
  readonly depth?: number;
  readonly sortOrder?: number;
}

/** Quan hệ phụ thuộc, dùng cho kiểm tra chu trình của đồ thị. */
export interface DependencyEdge {
  readonly predecessorId: string;
  readonly successorId: string;
}

/**
 * Độ sâu của một node mới khi đặt dưới `parent`.
 *
 * Node gốc có depth 0, nên cây 10 cấp chạy từ 0 tới 9 — khớp đúng ràng buộc
 * CHECK trong migration.
 */
export function depthFor(parent: TreeNode | undefined): number {
  if (!parent) return 0;
  return (parent.depth ?? 0) + 1;
}

/** Ném lỗi nếu độ sâu vượt giới hạn. */
export function assertDepthWithinLimit(depth: number): void {
  if (depth > MAX_WORK_ITEM_DEPTH - 1) {
    throw new WorkspaceValidationError(
      `Cây công việc tối đa ${MAX_WORK_ITEM_DEPTH} cấp.`,
    );
  }
}

/** Tập id của một node và toàn bộ hậu duệ của nó. */
export function descendantsOf(nodes: readonly TreeNode[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else childrenByParent.set(node.parentId, [node.id]);
  }

  const collected = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    // `shift()` trên mảng vài nghìn phần tử vẫn rẻ hơn nhiều so với một lần
    // truy vấn đệ quy xuống database, nên không cần cấu trúc hàng đợi riêng.
    const current = queue.shift() as string;
    for (const child of childrenByParent.get(current) ?? []) {
      if (collected.has(child)) continue;
      collected.add(child);
      queue.push(child);
    }
  }
  return collected;
}

/**
 * Di chuyển `nodeId` xuống dưới `newParentId` có tạo vòng lặp không.
 *
 * Vòng lặp xảy ra khi node đích chính là nó, hoặc là một hậu duệ của nó —
 * lúc đó nhánh sẽ tự trỏ vào chính mình và mọi truy vấn cây sẽ chạy vô tận.
 */
export function wouldCreateCycle(
  nodes: readonly TreeNode[],
  nodeId: string,
  newParentId: string | null | undefined,
): boolean {
  if (!newParentId) return false;
  if (newParentId === nodeId) return true;
  return descendantsOf(nodes, nodeId).has(newParentId);
}

/** Kiểm tra di chuyển hợp lệ, ném lỗi có mã máy đọc được nếu không. */
export function assertMoveAllowed(
  nodes: readonly TreeNode[],
  nodeId: string,
  newParent: TreeNode | undefined,
): void {
  if (wouldCreateCycle(nodes, nodeId, newParent?.id)) {
    throw new WorkspaceValidationError(
      'Không thể di chuyển: sẽ tạo vòng lặp trong cây công việc.',
    );
  }

  // Nhánh được mang theo cả hậu duệ, nên phải kiểm độ sâu của node SÂU NHẤT
  // trong nhánh chứ không chỉ node đang kéo.
  const moving = descendantsOf(nodes, nodeId);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const current = byId.get(nodeId)?.depth ?? 0;
  let deepest = 0;
  for (const id of moving) {
    deepest = Math.max(deepest, (byId.get(id)?.depth ?? 0) - current);
  }
  assertDepthWithinLimit(depthFor(newParent) + deepest);
}

/** Vị trí kế tiếp trong danh sách anh em cùng cha. */
export function nextSortOrder(
  nodes: readonly TreeNode[],
  parentId: string | null | undefined,
): number {
  const siblings = nodes.filter((node) => (node.parentId ?? null) === (parentId ?? null));
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((node) => node.sortOrder ?? 0)) + 1;
}

/**
 * Thêm cạnh phụ thuộc có tạo chu trình không.
 *
 * Đồ thị phụ thuộc phải là DAG. Nếu không, hai công việc sẽ cùng chờ nhau và
 * không việc nào hoàn thành được.
 */
export function dependencyWouldCycle(
  edges: readonly DependencyEdge[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;

  // Đi xuôi từ `successorId`: nếu tới được `predecessorId` thì cạnh mới khép
  // vòng.
  const nextOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = nextOf.get(edge.predecessorId);
    if (list) list.push(edge.successorId);
    else nextOf.set(edge.predecessorId, [edge.successorId]);
  }

  const seen = new Set<string>();
  const queue = [successorId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === predecessorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(nextOf.get(current) ?? []));
  }
  return false;
}
