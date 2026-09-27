/**
 * Cấu trúc luồng của một quy trình có rẽ nhánh — hàm thuần, dùng chung cho
 * server và UI.
 *
 * "Trục chính" (trunk) là các bước không thuộc nhánh nào, chạy theo `order`. Mỗi
 * gateway đứng ngay sau một bước trục chính; nhánh của nó là một dãy bước riêng
 * và mọi nhánh hợp về bước trục chính kế tiếp (điểm hợp). Không có gateway nào
 * thì trục chính chính là toàn bộ các bước — đúng hành vi tuyến tính cũ.
 */
import type {
  ProcedureBranchDefinition,
  ProcedureGatewayDefinition,
} from './procedure-flow.types.js';

export interface ProcedureFlowStep {
  readonly id: string;
  readonly order: number;
}

export interface ProcedureBranchPosition {
  readonly gateway: ProcedureGatewayDefinition;
  readonly branch: ProcedureBranchDefinition;
  readonly index: number;
}

export interface ProcedureFlowIndex {
  /** Id bước trục chính, theo thứ tự chạy. */
  readonly trunk: readonly string[];
  readonly branchOf: ReadonlyMap<string, ProcedureBranchPosition>;
  readonly gatewayAfter: ReadonlyMap<string, ProcedureGatewayDefinition>;
  readonly gateways: readonly ProcedureGatewayDefinition[];
  readonly stepIds: ReadonlySet<string>;
}

/** Điểm tới kế tiếp: một bước, hoặc kết thúc quy trình. */
export type ProcedureFlowTarget = string | null;

export function buildFlowIndex(
  steps: readonly ProcedureFlowStep[],
  gateways: readonly ProcedureGatewayDefinition[] | undefined,
): ProcedureFlowIndex {
  const list = gateways ?? [];
  const branchOf = new Map<string, ProcedureBranchPosition>();
  const gatewayAfter = new Map<string, ProcedureGatewayDefinition>();
  for (const gateway of list) {
    // Gateway trùng điểm đặt: giữ cái đầu tiên. Luật công bố báo lỗi trường hợp này.
    if (!gatewayAfter.has(gateway.afterStepId)) gatewayAfter.set(gateway.afterStepId, gateway);
    for (const branch of gateway.branches) {
      branch.stepIds.forEach((stepId, index) => {
        if (!branchOf.has(stepId)) branchOf.set(stepId, { gateway, branch, index });
      });
    }
  }
  const trunk = [...steps]
    .filter((step) => !branchOf.has(step.id))
    .sort((left, right) => left.order - right.order)
    .map((step) => step.id);
  return {
    trunk,
    branchOf,
    gatewayAfter,
    gateways: list,
    stepIds: new Set(steps.map((step) => step.id)),
  };
}

export function firstFlowStepId(index: ProcedureFlowIndex): ProcedureFlowTarget {
  return index.trunk[0] ?? null;
}

export function nextTrunkStepId(index: ProcedureFlowIndex, stepId: string): ProcedureFlowTarget {
  const position = index.trunk.indexOf(stepId);
  if (position < 0) return null;
  return index.trunk[position + 1] ?? null;
}

/** Điểm hợp của một gateway: bước trục chính kế tiếp sau bước đặt gateway. */
export function gatewayJoinStepId(
  index: ProcedureFlowIndex,
  gateway: ProcedureGatewayDefinition,
): ProcedureFlowTarget {
  return nextTrunkStepId(index, gateway.afterStepId);
}

export function branchEntryStepId(
  index: ProcedureFlowIndex,
  gateway: ProcedureGatewayDefinition,
  branch: ProcedureBranchDefinition,
): ProcedureFlowTarget {
  return branch.stepIds[0] ?? gatewayJoinStepId(index, gateway);
}

/**
 * Bước kế tiếp của một bước KHÔNG có gateway đứng sau: bước sau trong nhánh,
 * điểm hợp nếu đã là bước cuối nhánh, hoặc bước trục chính kế tiếp.
 */
export function sequentialNextStepId(index: ProcedureFlowIndex, stepId: string): ProcedureFlowTarget {
  const position = index.branchOf.get(stepId);
  if (position) {
    return (
      position.branch.stepIds[position.index + 1] ?? gatewayJoinStepId(index, position.gateway)
    );
  }
  return nextTrunkStepId(index, stepId);
}

/** Mọi điểm tới có thể có sau một bước — dùng cho kiểm tra cấu trúc lúc công bố. */
export function possibleNextStepIds(index: ProcedureFlowIndex, stepId: string): ProcedureFlowTarget[] {
  const gateway = index.gatewayAfter.get(stepId);
  if (!gateway) return [sequentialNextStepId(index, stepId)];
  const targets = gateway.branches.map((branch) => branchEntryStepId(index, gateway, branch));
  return [...new Set(targets)];
}

/**
 * Tập bước chắc chắn đã đi qua trước khi tới `stepId`, trên MỌI đường từ bước
 * đầu (dominator, không gồm chính nó).
 *
 * Đây là thước đo đúng cho hai luật: điều kiện chỉ được dùng thuộc tính của bước
 * đã chắc chắn có giá trị, và C chỉ được cấu hình quay về một bước chắc chắn đã
 * đi qua. "Đứng trước theo order" không còn đủ khi có nhánh.
 */
export function dominatorStepIds(index: ProcedureFlowIndex, stepId: string): Set<string> {
  const first = firstFlowStepId(index);
  const all = [...index.stepIds];
  const predecessors = new Map<string, string[]>(all.map((id) => [id, []]));
  for (const id of all) {
    for (const target of possibleNextStepIds(index, id)) {
      if (target && predecessors.has(target)) predecessors.get(target)?.push(id);
    }
  }

  const dominators = new Map<string, Set<string>>();
  for (const id of all) dominators.set(id, id === first ? new Set([id]) : new Set(all));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of all) {
      if (id === first) continue;
      const preds = (predecessors.get(id) ?? []).filter((pred) => reachable(index).has(pred));
      let next: Set<string>;
      if (!preds.length) {
        next = new Set([id]);
      } else {
        next = new Set(dominators.get(preds[0] as string));
        for (const pred of preds.slice(1)) {
          const other = dominators.get(pred) ?? new Set<string>();
          for (const candidate of [...next]) if (!other.has(candidate)) next.delete(candidate);
        }
        next.add(id);
      }
      const current = dominators.get(id) ?? new Set<string>();
      if (next.size !== current.size || [...next].some((candidate) => !current.has(candidate))) {
        dominators.set(id, next);
        changed = true;
      }
    }
  }
  const result = new Set(dominators.get(stepId) ?? []);
  result.delete(stepId);
  return result;
}

const reachableCache = new WeakMap<ProcedureFlowIndex, Set<string>>();

/** Các bước đi tới được từ bước đầu theo mọi nhánh. */
export function reachable(index: ProcedureFlowIndex): Set<string> {
  const cached = reachableCache.get(index);
  if (cached) return cached;
  const seen = new Set<string>();
  const first = firstFlowStepId(index);
  const queue = first ? [first] : [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id) || !index.stepIds.has(id)) continue;
    seen.add(id);
    for (const target of possibleNextStepIds(index, id)) if (target) queue.push(target);
  }
  reachableCache.set(index, seen);
  return seen;
}

/** True nếu đi theo cấu trúc từ bước đầu mà quay lại một bước đã qua. */
export function hasFlowCycle(index: ProcedureFlowIndex): boolean {
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): boolean => {
    const mark = state.get(id);
    if (mark === 'visiting') return true;
    if (mark === 'done') return false;
    state.set(id, 'visiting');
    for (const target of possibleNextStepIds(index, id)) {
      if (target && index.stepIds.has(target) && visit(target)) return true;
    }
    state.set(id, 'done');
    return false;
  };
  const first = firstFlowStepId(index);
  return first ? visit(first) : false;
}

/**
 * Số bước còn lại tính từ sau `fromStepId`, để ước lượng tiến độ.
 *
 * `decided(gateway)` trả nhánh đã chọn nếu gateway đã được đánh giá; chưa đánh
 * giá thì nhảy thẳng tới điểm hợp (không đếm bước của nhánh nào) và đánh dấu kết
 * quả là ước lượng.
 */
export function countRemainingSteps(
  index: ProcedureFlowIndex,
  fromStepId: string | null,
  decided: (gateway: ProcedureGatewayDefinition) => ProcedureBranchDefinition | undefined,
): { remaining: number; isEstimate: boolean } {
  let remaining = 0;
  let isEstimate = false;
  const seen = new Set<string>();
  let cursor: ProcedureFlowTarget = fromStepId;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const gateway = index.gatewayAfter.get(cursor);
    let next: ProcedureFlowTarget;
    if (gateway) {
      const branch = decided(gateway);
      if (branch) {
        next = branchEntryStepId(index, gateway, branch);
      } else {
        // Chưa biết đi nhánh nào: tính theo nhánh NGẮN nhất (cận dưới), rồi nhảy
        // tới điểm hợp. Bỏ qua hẳn các bước nhánh thì tổng bị ước lượng quá thấp
        // — đơn mới hiện "0/~1" dù nhánh nào cũng còn ít nhất một bước duyệt.
        isEstimate = true;
        remaining += Math.min(...gateway.branches.map((branch) => branch.stepIds.length));
        next = gatewayJoinStepId(index, gateway);
      }
    } else {
      next = sequentialNextStepId(index, cursor);
    }
    if (next) remaining += 1;
    cursor = next;
  }
  return { remaining, isEstimate };
}
