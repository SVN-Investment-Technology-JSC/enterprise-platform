/**
 * Thao tác sửa cấu trúc rẽ nhánh trên ma trận RCSI — hàm thuần.
 *
 * Mọi thao tác trả về trọn bộ `steps` + `gateways` mới để gửi lên như cách ma
 * trận vẫn làm (thay cả bản nháp). Thứ tự `order` luôn được đánh lại liền mạch
 * theo cấu trúc: trục chính → các bước của từng nhánh → điểm hợp, vì luật công
 * bố yêu cầu thứ tự hiển thị khớp đường chạy.
 */
import {
  buildFlowIndex,
  type CreateProcedureStepInput,
  type ProcedureBranchDefinition,
  type ProcedureDefinition,
  type ProcedureGatewayDefinition,
  type ProcedureStepDefinition,
} from '@enterprise-platform/contracts-procedure-engine';

export interface FlowRowInfo {
  /** Nhánh chứa bước này, nếu có. */
  readonly branch?: {
    gateway: ProcedureGatewayDefinition;
    branch: ProcedureBranchDefinition;
    branchIndex: number;
    /** Chữ cái của nhánh (A, B, C…), liên tục qua các điểm rẽ nhánh. */
    letter: string;
    /** Bước cuối của nhánh — ô "Thêm bước vào nhánh" đứng ngay sau nó. */
    isLast: boolean;
  };
  /** Gateway đứng ngay sau bước này, nếu có. */
  readonly gatewayAfter?: ProcedureGatewayDefinition;
  /** Bước này là điểm hợp của các gateway nào. */
  readonly joinOf: readonly ProcedureGatewayDefinition[];
  /**
   * Số hiển thị: trục chính đếm 1, 2, 3… bỏ qua bước trong nhánh; bước trong
   * nhánh là chữ nhánh + vị trí trong nhánh (A1, A2, B1). Số `order` phẳng
   * (1..n) khiến điểm hợp mang số 8 dù chỉ là bước thứ 2 trên đường chạy.
   */
  readonly label: string;
}

function letterOf(index: number): string {
  const base = String.fromCharCode(65 + (index % 26));
  return index < 26 ? base : `${base}${Math.floor(index / 26) + 1}`;
}

/** Chữ cái của từng nhánh, theo thứ tự điểm rẽ nhánh trên trục chính. Khoá: `gatewayId:branchIndex`. */
export function branchLetters(definition: ProcedureDefinition): Map<string, string> {
  const gateways = definition.gateways ?? [];
  const index = buildFlowIndex(definition.steps, gateways);
  const letters = new Map<string, string>();
  let counter = 0;
  for (const stepId of index.trunk) {
    const gateway = index.gatewayAfter.get(stepId);
    if (!gateway) continue;
    for (let branchIndex = 0; branchIndex < gateway.branches.length; branchIndex += 1) {
      letters.set(`${gateway.id}:${branchIndex}`, letterOf(counter));
      counter += 1;
    }
  }
  return letters;
}

export function flowRowInfo(definition: ProcedureDefinition): Map<string, FlowRowInfo> {
  const gateways = definition.gateways ?? [];
  const index = buildFlowIndex(definition.steps, gateways);
  const letters = branchLetters(definition);
  const trunkNumber = new Map(index.trunk.map((stepId, position) => [stepId, position + 1]));
  const info = new Map<string, FlowRowInfo>();
  for (const step of definition.steps) {
    const position = index.branchOf.get(step.id);
    const branchIndex = position ? position.gateway.branches.indexOf(position.branch) : -1;
    const letter = position ? letters.get(`${position.gateway.id}:${branchIndex}`) ?? '?' : '';
    const indexInBranch = position ? position.branch.stepIds.indexOf(step.id) : -1;
    info.set(step.id, {
      branch: position
        ? {
            gateway: position.gateway,
            branch: position.branch,
            branchIndex,
            letter,
            isLast: indexInBranch === position.branch.stepIds.length - 1,
          }
        : undefined,
      gatewayAfter: index.gatewayAfter.get(step.id),
      joinOf: gateways.filter(
        (gateway) => index.trunk[index.trunk.indexOf(gateway.afterStepId) + 1] === step.id,
      ),
      label: position ? `${letter}${indexInBranch + 1}` : String(trunkNumber.get(step.id) ?? step.order),
    });
  }
  return info;
}

function nextKey(existing: readonly string[], prefix: string): string {
  const taken = new Set(existing.map((key) => key.toUpperCase()));
  let counter = existing.length + 1;
  while (taken.has(`${prefix}${counter}`)) counter += 1;
  return `${prefix}${counter}`;
}

/**
 * Sắp lại bước theo cấu trúc rồi đánh `order` 1..n.
 *
 * Trục chính theo `order` cũ; ngay sau bước đặt gateway là các bước của từng
 * nhánh theo thứ tự nhánh và thứ tự trong nhánh. Tham chiếu bước trong gateway
 * có thể là id (bước đã có) hoặc key (bước vừa thêm, chưa có id).
 */
function renumber(
  steps: readonly CreateProcedureStepInput[],
  refOf: (step: CreateProcedureStepInput) => string,
  gateways: readonly ProcedureGatewayDefinition[],
): CreateProcedureStepInput[] {
  const byRef = new Map(steps.map((step) => [refOf(step), step]));
  const inBranch = new Set(gateways.flatMap((gateway) => gateway.branches.flatMap((branch) => branch.stepIds)));
  const trunk = [...steps].filter((step) => !inBranch.has(refOf(step))).sort((left, right) => left.order - right.order);
  const ordered: CreateProcedureStepInput[] = [];
  const placed = new Set<string>();
  for (const step of trunk) {
    ordered.push(step);
    placed.add(refOf(step));
    const gateway = gateways.find((item) => item.afterStepId === refOf(step));
    if (!gateway) continue;
    for (const branch of gateway.branches) {
      for (const ref of branch.stepIds) {
        const branchStep = byRef.get(ref);
        if (branchStep && !placed.has(ref)) {
          ordered.push(branchStep);
          placed.add(ref);
        }
      }
    }
  }
  // Bước mồ côi (nhánh của gateway không còn điểm đặt): giữ lại ở cuối, luật công bố sẽ báo.
  for (const step of [...steps].sort((left, right) => left.order - right.order)) {
    if (!placed.has(refOf(step))) ordered.push(step);
  }
  return ordered.map((step, index) => ({ ...step, order: index + 1 }));
}

export interface FlowChange {
  readonly steps: CreateProcedureStepInput[];
  readonly gateways: ProcedureGatewayDefinition[];
}

function refResolver(definition: ProcedureDefinition) {
  const idByKey = new Map(definition.steps.map((step) => [step.key, step.id]));
  return (step: CreateProcedureStepInput) => idByKey.get(step.key) ?? step.key;
}

/** Thêm điểm rẽ nhánh sau một bước, sẵn một nhánh có điều kiện và nhánh "Ngược lại". */
export function addGateway(
  definition: ProcedureDefinition,
  afterStepId: string,
  toInput: (step: ProcedureStepDefinition) => CreateProcedureStepInput,
): FlowChange {
  const gateways = definition.gateways ?? [];
  const gateway: ProcedureGatewayDefinition = {
    id: '',
    key: nextKey(gateways.map((item) => item.key), 'G'),
    name: 'Điểm rẽ nhánh',
    type: 'exclusive',
    afterStepId,
    branches: [
      { id: '', key: 'N1', label: 'Nhánh 1', isDefault: false, condition: { combinator: 'and', rules: [] }, stepIds: [] },
      { id: '', key: 'MAC_DINH', label: 'Ngược lại', isDefault: true, stepIds: [] },
    ],
  };
  return { steps: definition.steps.map(toInput), gateways: [...gateways, gateway] };
}

/**
 * Xoá điểm rẽ nhánh. Các bước trong nhánh KHÔNG bị xoá mà trở thành bước chạy
 * tuần tự trên trục chính — xoá luôn bước là mất phân vai người dùng đã dựng.
 */
export function removeGateway(
  definition: ProcedureDefinition,
  gatewayId: string,
  toInput: (step: ProcedureStepDefinition) => CreateProcedureStepInput,
): FlowChange {
  return {
    steps: definition.steps.map(toInput),
    gateways: (definition.gateways ?? []).filter((gateway) => gateway.id !== gatewayId),
  };
}

export function replaceGateway(
  definition: ProcedureDefinition,
  next: ProcedureGatewayDefinition,
  toInput: (step: ProcedureStepDefinition) => CreateProcedureStepInput,
): FlowChange {
  const gateways = (definition.gateways ?? []).map((gateway) => (gateway.id === next.id ? next : gateway));
  return { steps: renumber(definition.steps.map(toInput), refResolver(definition), gateways), gateways };
}

export interface BranchTarget {
  readonly gatewayId: string;
  readonly branchId: string;
}

/** Nhánh đang chứa một bước, nếu có. */
export function branchOfStep(definition: ProcedureDefinition, stepId: string): BranchTarget | undefined {
  for (const gateway of definition.gateways ?? []) {
    for (const branch of gateway.branches) {
      if (branch.stepIds.includes(stepId)) return { gatewayId: gateway.id, branchId: branch.id };
    }
  }
  return undefined;
}

/**
 * Chuyển một bước vào cuối một nhánh, hoặc về trục chính (`target` = null).
 *
 * Về trục chính thì bước được đặt ngay SAU điểm hợp của nhánh cũ, không phải
 * chen giữa bước đặt gateway và điểm hợp — chen vào đó sẽ biến nó thành điểm
 * hợp mới và đổi đường chạy của mọi nhánh.
 */
export function moveStepToBranch(
  definition: ProcedureDefinition,
  stepId: string,
  target: BranchTarget | null,
  toInput: (step: ProcedureStepDefinition) => CreateProcedureStepInput,
): FlowChange {
  const index = buildFlowIndex(definition.steps, definition.gateways);
  const previous = index.branchOf.get(stepId);
  const gateways = (definition.gateways ?? []).map((gateway) => ({
    ...gateway,
    branches: gateway.branches.map((branch) => {
      const stepIds = branch.stepIds.filter((id) => id !== stepId);
      return gateway.id === target?.gatewayId && branch.id === target.branchId
        ? { ...branch, stepIds: [...stepIds, stepId] }
        : { ...branch, stepIds };
    }),
  }));

  let trunkOrder: number | undefined;
  if (!target && previous) {
    const joinId = index.trunk[index.trunk.indexOf(previous.gateway.afterStepId) + 1];
    const join = definition.steps.find((step) => step.id === joinId);
    trunkOrder = join ? join.order + 0.5 : Number.MAX_SAFE_INTEGER;
  }
  const steps = definition.steps.map((step) => {
    const input = toInput(step);
    return step.id === stepId && trunkOrder !== undefined ? { ...input, order: trunkOrder } : input;
  });
  return { steps: renumber(steps, refResolver(definition), gateways), gateways };
}

/**
 * Thêm một bước mới vào cuối một nhánh. Nhánh tham chiếu bước mới bằng `key`
 * (chưa có id); server đổi key thành id khi lưu.
 */
export function addStepToBranch(
  definition: ProcedureDefinition,
  target: BranchTarget,
  name: string,
  toInput: (step: ProcedureStepDefinition) => CreateProcedureStepInput,
): FlowChange {
  const key = nextKey(definition.steps.map((step) => step.key), 'B');
  const gateways = (definition.gateways ?? []).map((gateway) => ({
    ...gateway,
    branches: gateway.branches.map((branch) =>
      gateway.id === target.gatewayId && branch.id === target.branchId
        ? { ...branch, stepIds: [...branch.stepIds, key] }
        : branch,
    ),
  }));
  const steps: CreateProcedureStepInput[] = [
    ...definition.steps.map(toInput),
    { key, order: Number.MAX_SAFE_INTEGER, name, assignments: [] },
  ];
  return { steps: renumber(steps, refResolver(definition), gateways), gateways };
}

/**
 * Xoá một bước và dọn mọi tham chiếu tới nó: khỏi nhánh, khỏi điểm quay về của C,
 * và gỡ gateway đặt ngay sau nó (gateway đó không còn chỗ đứng).
 */
export function removeFlowStep(
  definition: ProcedureDefinition,
  stepId: string,
  toInput: (step: ProcedureStepDefinition) => CreateProcedureStepInput,
): FlowChange {
  const gateways = (definition.gateways ?? [])
    .filter((gateway) => gateway.afterStepId !== stepId)
    .map((gateway) => ({
      ...gateway,
      branches: gateway.branches.map((branch) => ({
        ...branch,
        stepIds: branch.stepIds.filter((id) => id !== stepId),
      })),
    }));
  const steps = definition.steps
    .filter((step) => step.id !== stepId)
    .map((step) => {
      const input = toInput(step);
      return {
        ...input,
        assignments: input.assignments.map((assignment) =>
          assignment.fixedRollbackStepId === stepId
            ? { ...assignment, fixedRollbackStepId: undefined }
            : assignment,
        ),
      };
    });
  return { steps: renumber(steps, refResolver(definition), gateways), gateways };
}
