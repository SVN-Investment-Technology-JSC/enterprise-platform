import {
  CLOSED_WORK_ITEM_STATUSES,
  type ProjectProgressMethod,
  type WorkItemProgressMethod,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from './workspace.error.js';

/** Phần thông tin cần để cuộn tiến độ; không cần cả bản ghi công việc. */
export interface ProgressNode {
  readonly id: string;
  readonly parentId?: string | null;
  readonly status: WorkItemStatus;
  /** Tiến độ tự tính đang lưu (`progress_percent`). */
  readonly progressPercent: number;
  /** Tiến độ nhập tay; có giá trị thì được dùng thay giá trị tự tính. */
  readonly manualPercent?: number | null;
  /** Trọng số khi tính bình quân. Thiếu thì lấy trung bình các việc có ước lượng. */
  readonly estimateHours?: number | null;
  /**
   * Có điều kiện hoàn thành bắt buộc (`all` hoặc `at_least`). Node này không tự hoàn thành khi con xong:
   * phải có người xác nhận từng điều kiện.
   */
  readonly requiresConfirmation?: boolean;
  /** Tỷ trọng người dùng đặt cho công việc gốc; chỉ dùng khi dự án tính theo `weighted_weight`. */
  readonly weight?: number | null;
  /** Ngày dự kiến `YYYY-MM-DD`; chỉ dùng khi dự án tính theo `weighted_days`. */
  readonly plannedStart?: string | null;
  readonly plannedEnd?: string | null;
  /** Cách tính tiến độ của công việc; `child_weight` làm việc cha tính theo tỷ trọng của các việc con. */
  readonly method?: WorkItemProgressMethod;
  /** Cách `child_weight`: chia đều cho các việc con, bỏ qua tỷ trọng của con. Mặc định chia đều. */
  readonly equalChildWeight?: boolean;
}

/**
 * Trọng số của từng việc con khi cha tính theo `child_weight`: chia đều thì mọi con nặng 1; không thì lấy `weight` của
 * con. Con chưa đặt tỷ trọng nặng bằng **trung bình** các con đã đặt (cùng tinh thần với trọng số giờ ước lượng); không
 * con nào đặt thì chia đều.
 */
function childWeights(parent: ProgressNode, children: readonly ProgressNode[]): Map<string, number> {
  const result = new Map<string, number>();
  if (parent.equalChildWeight !== false) {
    for (const child of children) result.set(child.id, 1);
    return result;
  }
  const defined = children
    .map((child) => child.weight)
    .filter((weight): weight is number => weight !== null && weight !== undefined && Number.isFinite(weight) && weight >= 0);
  const fallback = defined.length === 0 ? 1 : defined.reduce((sum, weight) => sum + weight, 0) / defined.length;
  for (const child of children) {
    const weight = child.weight;
    result.set(
      child.id,
      weight !== null && weight !== undefined && Number.isFinite(weight) && weight >= 0 ? weight : fallback,
    );
  }
  return result;
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

/** Tiến độ hiệu lực của một node (chưa làm tròn) và trọng số của nó khi cuộn lên cha. */
interface Evaluated {
  readonly progress: number;
  readonly weight: number;
}

/**
 * Tính tiến độ cho cả cây trong một lượt.
 *
 * Quy tắc: tiến độ tự tính của một node là bình quân tiến độ các node **lá** bên dưới nó, lấy `estimate_hours` làm
 * trọng số. Dùng node lá chứ không dùng con trực tiếp, để một nhánh sâu không bị đánh đồng trọng số với một việc lẻ.
 * Việc `cancelled` bị loại khỏi phép tính: nó không còn là phần việc phải làm, nên để lại sẽ kéo tiến độ xuống vĩnh
 * viễn.
 *
 * Node có tiến độ nhập tay (`manualPercent`) dùng giá trị đó thay cho giá trị tự tính khi cuộn lên cha và lên dự
 * án; trọng số vẫn là tổng trọng số các lá bên dưới.
 */
function evaluate(nodes: readonly ProgressNode[]) {
  const childrenByParent = new Map<string, ProgressNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }

  const weightOf = leafWeigher(nodes);
  const changed = new Map<string, number>();
  const computed = new Map<string, Evaluated>();

  // Hậu thứ tự: con phải xong trước cha. Đệ quy có nhớ tránh duyệt lại nhánh
  // dùng chung và tránh tràn ngăn xếp ở cây 10 cấp.
  const visit = (node: ProgressNode): Evaluated => {
    const cached = computed.get(node.id);
    if (cached) return cached;

    const children = (childrenByParent.get(node.id) ?? []).filter(
      (child) => child.status !== 'cancelled',
    );
    const manual = node.manualPercent ?? undefined;

    if (children.length === 0) {
      const leaf = { progress: manual ?? node.progressPercent, weight: weightOf(node) };
      computed.set(node.id, leaf);
      return leaf;
    }

    let weighted = 0;
    let total = 0;
    let plain = 0;
    // Trọng số của cả nhánh khi cuộn lên cha/dự án luôn là tổng trọng số lá (giờ ước lượng) bên dưới, kể cả khi nhánh này
    // tự tính theo tỷ trọng việc con: tỷ trọng con chỉ dùng để lấy bình quân bên trong nhánh, không được trộn thang với giờ.
    let leafWeight = 0;
    const own = node.method === 'child_weight' ? childWeights(node, children) : undefined;
    for (const child of children) {
      const result = visit(child);
      const weight = own ? (own.get(child.id) ?? 0) : result.weight;
      weighted += result.progress * weight;
      total += weight;
      leafWeight += result.weight;
      plain += result.progress;
    }

    // Tổng trọng số 0 (vd mọi tỷ trọng đặt 0): quay về bình quân thường để cha không kẹt ở 0% khi con đã xong.
    const auto = total === 0 ? (own ? plain / children.length : 0) : weighted / total;
    const result = { progress: manual ?? auto, weight: leafWeight };
    computed.set(node.id, result);
    if (Math.round(auto) !== node.progressPercent) changed.set(node.id, Math.round(auto));
    return result;
  };

  for (const node of nodes) visit(node);
  return { computed, changed };
}

/**
 * Tiến độ tự tính mới của các node cha (cột `progress_percent`).
 *
 * Trả về map chỉ chứa những node có thay đổi, để lời gọi UPDATE không đụng
 * vào các dòng không cần sửa.
 */
export function rollUpProgress(nodes: readonly ProgressNode[]): Map<string, number> {
  return evaluate(nodes).changed;
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

    const childrenDone = children.every((child) => isSubtreeComplete(child));
    // Node có điều kiện bắt buộc chưa `done` thì chưa tính là xong, kéo theo cả cha của nó: không tự lách điều kiện.
    const allDone = childrenDone && (!node.requiresConfirmation || node.status === 'done');
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

/** Số ngày lịch của một ngày `YYYY-MM-DD` tính từ mốc cố định; `undefined` khi không đọc được. */
function dayNumber(value: string | null | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return undefined;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? undefined : Math.floor(time / 86_400_000);
}

/** Số ngày thực hiện dự kiến của một công việc (cả ngày đầu và ngày cuối); `undefined` khi thiếu ngày. */
function plannedDays(node: ProgressNode): number | undefined {
  const start = dayNumber(node.plannedStart);
  const end = dayNumber(node.plannedEnd);
  if (start === undefined || end === undefined || end < start) return undefined;
  return end - start + 1;
}

/**
 * Trọng số của từng công việc gốc khi cuộn lên dự án, theo cách tính của dự án.
 *
 * Công việc gốc thiếu dữ liệu (chưa đặt tỷ trọng, hay thiếu ngày dự kiến) nặng bằng **trung bình** các việc gốc đã có
 * dữ liệu, cùng tinh thần với trọng số giờ ước lượng: để trọng số 0 thì việc chưa khai báo biến mất khỏi dự án, để 1
 * thì lệch hẳn khi các việc kia có trọng số lớn. Không việc nào có dữ liệu thì chia đều.
 */
function rootWeights(
  roots: readonly ProgressNode[],
  computed: ReadonlyMap<string, Evaluated>,
  method: ProjectProgressMethod,
): Map<string, number> {
  const result = new Map<string, number>();
  if (method === 'weighted_hours') {
    for (const root of roots) result.set(root.id, computed.get(root.id)?.weight ?? 0);
    return result;
  }
  if (method === 'avg_tasks') {
    for (const root of roots) result.set(root.id, 1);
    return result;
  }

  const raw = new Map<string, number | undefined>();
  for (const root of roots) {
    if (method === 'weighted_days') raw.set(root.id, plannedDays(root));
    else {
      const weight = root.weight;
      raw.set(root.id, weight !== null && weight !== undefined && Number.isFinite(weight) && weight >= 0 ? weight : undefined);
    }
  }
  const known = [...raw.values()].filter((value): value is number => value !== undefined);
  const fallback = known.length === 0 ? 1 : known.reduce((sum, value) => sum + value, 0) / known.length;
  for (const root of roots) result.set(root.id, raw.get(root.id) ?? fallback);
  return result;
}

/**
 * Tiến độ tổng của dự án, tính trên các công việc **gốc** (bỏ việc đã huỷ), theo cách tính đã chọn cho dự án:
 *  · `avg_tasks`       bình quân % tiến độ các công việc gốc;
 *  · `weighted_days`   bình quân theo số ngày thực hiện dự kiến;
 *  · `weighted_weight` bình quân theo tỷ trọng người dùng đặt;
 *  · `weighted_hours`  công thức cũ: trọng số là tổng trọng số giờ ước lượng của các lá dưới nhánh (mặc định để số
 *                      liệu của dự án có sẵn không đổi).
 *
 * Tiến độ của từng công việc gốc là tiến độ đã cuộn từ các việc con (nhánh có tiến độ nhập tay thì dùng giá trị nhập
 * tay). Tiến độ dự án tự tính, không có giá trị nhập tay riêng.
 *
 * Tổng trọng số bằng 0 (vd mọi tỷ trọng đặt 0) thì quay về bình quân thường, để dự án không kẹt ở 0% khi việc đã xong.
 */
export function projectProgress(
  nodes: readonly ProgressNode[],
  method: ProjectProgressMethod = 'weighted_hours',
): number {
  const ids = new Set(nodes.map((node) => node.id));
  const roots = nodes.filter(
    (node) => (!node.parentId || !ids.has(node.parentId)) && node.status !== 'cancelled',
  );
  if (roots.length === 0) return 0;
  const { computed } = evaluate(nodes);
  const weights = rootWeights(roots, computed, method);

  let weighted = 0;
  let total = 0;
  let plain = 0;
  let counted = 0;
  for (const root of roots) {
    const result = computed.get(root.id);
    if (!result) continue;
    const weight = weights.get(root.id) ?? 0;
    weighted += result.progress * weight;
    total += weight;
    plain += result.progress;
    counted += 1;
  }
  if (counted === 0) return 0;
  return Math.round(total === 0 ? plain / counted : weighted / total);
}

/**
 * Tiến độ dự kiến theo tiến trình thời gian: tăng đều từ ngày bắt đầu đến ngày kết thúc. Trước ngày bắt đầu là 0%,
 * sau ngày kết thúc là 100%; đang trong khoảng thì lấy số ngày đã qua (không tính hôm nay) chia tổng số ngày của cả
 * khoảng (tính cả hai đầu). Thiếu một trong hai ngày, hoặc ngày kết thúc trước ngày bắt đầu: không xác định.
 *
 * Cách làm khớp 1Office: dự án 20/10/2026 – 31/01/2027 (104 ngày) vào ngày 15/11/2026 hiện dự kiến 25% (26/104).
 */
export function expectedProgress(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string,
): number | undefined {
  const from = dayNumber(start);
  const to = dayNumber(end);
  const now = dayNumber(today);
  if (from === undefined || to === undefined || now === undefined || to < from) return undefined;
  if (now < from) return 0;
  if (now > to) return 100;
  return Math.round(((now - from) / (to - from + 1)) * 100);
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

/**
 * Tiến độ nhập tay gửi lên: `undefined` giữ nguyên, `null` (hoặc chuỗi rỗng) quay về tự tính, còn lại phải là số
 * nguyên 0–100.
 */
export function parseManualPercent(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new WorkspaceValidationError('Tiến độ phải là số nguyên từ 0 đến 100.');
  }
  return percent;
}
