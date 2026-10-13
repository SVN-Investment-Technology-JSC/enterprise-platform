import { CLOSED_WORK_ITEM_STATUSES, type WorkItemStatus } from '@enterprise-platform/contracts-workspace';

/** Phần thông tin cần để cuộn tiến độ; không cần cả bản ghi công việc. */
export interface ProgressNode {
  readonly id: string;
  readonly parentId?: string | null;
  readonly status: WorkItemStatus;
  readonly progressPercent: number;
  /** Trọng số khi tính bình quân. Thiếu thì lấy trung bình các việc có ước lượng. */
  readonly estimateHours?: number | null;
}

/**
 * Trả hàm tính trọng số cho node lá.
 *
 * Việc không có ước lượng nặng bằng **trung bình** các việc lá có ước lượng
 * trong cùng tập node. Nếu để trọng số 1, hai việc 80 giờ đã xong sẽ đẩy dự án
 * lên ~98% dù 13/15 việc chưa làm. Không việc nào có ước lượng thì mọi việc
 * nặng như nhau.
 */
function leafWeigher(nodes: readonly ProgressNode[]): (node: ProgressNode) => number {
  const parents = new Set(nodes.map((node) => node.parentId).filter(Boolean) as string[]);
  let sum = 0;
  let count = 0;
  for (const node of nodes) {
    if (parents.has(node.id) || node.status === 'cancelled') continue;
    const hours = node.estimateHours;
    if (hours && hours > 0) {
      sum += hours;
      count += 1;
    }
  }
  const fallback = count === 0 ? 1 : sum / count;
  return (node) => {
    const hours = node.estimateHours;
    return hours && hours > 0 ? hours : fallback;
  };
}

export function isClosed(status: WorkItemStatus): boolean {
  return CLOSED_WORK_ITEM_STATUSES.includes(status);
}

/**
 * Tính lại tiến độ cho mọi node không phải lá.
 *
 * Quy tắc: tiến độ của một node là bình quân tiến độ các node **lá** bên dưới
 * nó, lấy `estimate_hours` làm trọng số. Dùng node lá chứ không dùng con trực
 * tiếp, để một nhánh sâu không bị đánh đồng trọng số với một việc lẻ.
 *
 * Việc `cancelled` bị loại khỏi phép tính: nó không còn là phần việc phải làm,
 * nên để lại sẽ kéo tiến độ xuống vĩnh viễn.
 *
 * Trả về map chỉ chứa những node có thay đổi, để lời gọi UPDATE không đụng
 * vào các dòng không cần sửa.
 */
export function rollUpProgress(nodes: readonly ProgressNode[]): Map<string, number> {
  const childrenByParent = new Map<string, ProgressNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }

  const weightOf = leafWeigher(nodes);
  const changed = new Map<string, number>();
  const computed = new Map<string, { progress: number; weight: number }>();

  // Hậu thứ tự: con phải xong trước cha. Đệ quy có nhớ tránh duyệt lại nhánh
  // dùng chung và tránh tràn ngăn xếp ở cây 10 cấp.
  const visit = (node: ProgressNode): { progress: number; weight: number } => {
    const cached = computed.get(node.id);
    if (cached) return cached;

    const children = (childrenByParent.get(node.id) ?? []).filter(
      (child) => child.status !== 'cancelled',
    );

    if (children.length === 0) {
      const leaf = { progress: node.progressPercent, weight: weightOf(node) };
      computed.set(node.id, leaf);
      return leaf;
    }

    let weighted = 0;
    let total = 0;
    for (const child of children) {
      const result = visit(child);
      weighted += result.progress * result.weight;
      total += result.weight;
    }

    const progress = total === 0 ? 0 : Math.round(weighted / total);
    const result = { progress, weight: total };
    computed.set(node.id, result);
    if (progress !== node.progressPercent) changed.set(node.id, progress);
    return result;
  };

  for (const node of nodes) visit(node);
  return changed;
}

/**
 * Các node cha cần tự chuyển sang `done` vì mọi việc con đã hoàn thành.
 *
 * Quy tắc: một node có con sẽ tự hoàn thành khi **toàn bộ** việc con (bỏ việc
 * đã huỷ) đều đã hoàn thành — tính đệ quy xuống tới lá. Việc đã huỷ không tính
 * là phần việc còn phải làm, nên một cha mà mọi con còn lại đều xong vẫn được
 * coi là xong; nhưng một cha mà **mọi** con đều đã huỷ thì không tự hoàn thành
 * (không còn việc nào để "hoàn thành").
 *
 * Chỉ trả về những cha hiện chưa `done` và chưa `cancelled`, tức là những node
 * thật sự cần đổi trạng thái.
 */
export function autoCompleteParents(nodes: readonly ProgressNode[]): Set<string> {
  const childrenByParent = new Map<string, ProgressNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }

  const result = new Set<string>();
  // Có nhớ: cây dùng chung nhánh không bị duyệt lại, và cây sâu không tràn ngăn xếp.
  const completed = new Map<string, boolean>();

  const isSubtreeComplete = (node: ProgressNode): boolean => {
    const cached = completed.get(node.id);
    if (cached !== undefined) return cached;

    const children = (childrenByParent.get(node.id) ?? []).filter(
      (child) => child.status !== 'cancelled',
    );

    // Node lá (không còn con hiệu lực): hoàn thành khi trạng thái là `done`.
    if (children.length === 0) {
      const done = node.status === 'done';
      completed.set(node.id, done);
      return done;
    }

    const allDone = children.every((child) => isSubtreeComplete(child));
    completed.set(node.id, allDone);
    // Node có con mà cả cây con đã xong, nhưng bản thân chưa đóng → cần flip.
    if (allDone && node.status !== 'done' && node.status !== 'cancelled') {
      result.add(node.id);
    }
    return allDone;
  };

  for (const node of nodes) isSubtreeComplete(node);
  return result;
}

/**
 * Tiến độ tổng của dự án: bình quân có trọng số trên toàn bộ node lá.
 *
 * Tính lại từ lá thay vì lấy bình quân các node gốc, để kết quả không phụ
 * thuộc vào việc cây được chia thành mấy nhánh ở cấp một.
 */
export function projectProgress(nodes: readonly ProgressNode[]): number {
  const parents = new Set(nodes.map((node) => node.parentId).filter(Boolean) as string[]);
  const leaves = nodes.filter(
    (node) => !parents.has(node.id) && node.status !== 'cancelled',
  );
  if (leaves.length === 0) return 0;
  const weightOf = leafWeigher(nodes);

  let weighted = 0;
  let total = 0;
  for (const leaf of leaves) {
    const weight = weightOf(leaf);
    weighted += leaf.progressPercent * weight;
    total += weight;
  }
  return total === 0 ? 0 : Math.round(weighted / total);
}

/**
 * Quá hạn: còn đang mở VÀ hạn đã trôi qua.
 *
 * Việc đóng muộn KHÔNG tính là quá hạn — nó đã xong, và đếm nó vào sẽ khiến
 * con số quá hạn không bao giờ giảm.
 */
export function isOverdue(
  node: { readonly status: WorkItemStatus; readonly plannedEnd?: string | null },
  today: string,
): boolean {
  if (isClosed(node.status)) return false;
  if (!node.plannedEnd) return false;
  return node.plannedEnd < today;
}
