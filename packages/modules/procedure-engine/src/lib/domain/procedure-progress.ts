import type {
  ProcedureInstance,
  ProcedureInstanceProgress,
  ProcedureInstanceStepOverview,
  ProcedureInstanceStepOverviewGateway,
  ProcedureInstanceStep,
  ProcedureInstanceStatusEntry,
  ProcedureInstanceStepChangedPayload,
} from '@enterprise-platform/contracts-procedure-engine';

/** Nguồn được phát sự kiện step_changed: chỉ đơn HRM, tránh ồn cho Bảo trì / thủ công. */
export const STEP_CHANGED_SOURCE_TYPES: readonly string[] = ['hrm_request'];

/** Nhãn người xử lý ở pha hiện tại của bước hiện tại. */
export function currentAssigneeLabels(instance: ProcedureInstance): string[] {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  if (!current) return [];
  return [
    ...new Set(
      current.assignments
        .filter((assignment) => !current.currentRoleStage || assignment.role === current.currentRoleStage)
        .map((assignment) => assignment.subjectLabel?.trim())
        .filter((label): label is string => !!label),
    ),
  ];
}

/**
 * Số thứ tự tăng dần theo hồ sơ: mỗi hành động ghi một dòng nhật ký (unshift),
 * nên độ dài nhật ký không bao giờ giảm và khác nhau giữa hai giao dịch.
 */
export function instanceSequence(instance: ProcedureInstance): number {
  return Math.max(1, instance.activity.length);
}

/** Dấu vân tay vị trí hiện tại; đổi nghĩa là bước hoặc pha RACI đã đổi. */
export function stepPositionKey(instance: ProcedureInstance): string {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  return `${instance.status}|${instance.currentStepId ?? ''}|${current?.currentRoleStage ?? ''}`;
}

/**
 * Hồ sơ cần phát step_changed trong giao dịch này: đang chạy, nguồn thuộc danh sách,
 * và vị trí (bước / pha RACI) khác trước giao dịch — hoặc vừa được tạo.
 */
export function instancesWithStepChange(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): ProcedureInstance[] {
  const previous = new Map(before.map((item) => [item.id, stepPositionKey(item)]));
  return after.filter(
    (instance) =>
      instance.status === 'running' &&
      !!instance.sourceType &&
      STEP_CHANGED_SOURCE_TYPES.includes(instance.sourceType) &&
      previous.get(instance.id) !== stepPositionKey(instance),
  );
}

export function buildStepChangedPayload(
  instance: ProcedureInstance,
  occurredAt: string,
): ProcedureInstanceStepChangedPayload {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  return {
    instanceId: instance.id,
    instanceCode: instance.code,
    sourceType: instance.sourceType,
    sourceId: instance.sourceId,
    stepId: current?.id,
    stepName: current?.name,
    assignees: currentAssigneeLabels(instance),
    status: instance.status,
    sequence: instanceSequence(instance),
    occurredAt,
  };
}

export function buildInstanceStatusEntry(instance: ProcedureInstance): ProcedureInstanceStatusEntry {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const assignees = currentAssigneeLabels(instance);
  return {
    instanceId: instance.id,
    instanceCode: instance.code,
    status: instance.status,
    currentStepId: current?.id,
    currentStepName: current?.name,
    currentAssigneeName: assignees.length ? assignees.join(', ') : undefined,
    completedAt: instance.completedAt,
    lastActorId: instance.activity[0]?.actorId,
    sequence: instanceSequence(instance),
  };
}

/** Vai chỉ để nhận thông tin / làm đầu việc, không phải người xử lý bước. */
const NON_HANDLER_ROLES: readonly string[] = ['I', 'E'];

/**
 * Nhãn "người xử lý" của một bước:
 *  - Bước chỉ có vai S: danh sách S chỉ là tập người được phép khởi tạo, nên hiện người khởi tạo thật.
 *  - Bước đã xong: người đã duyệt/hoàn thành thật (từ nhật ký), nếu có.
 *  - Còn lại: phân công của pha đang xử lý (hoặc mọi vai xử lý khi chưa có pha), bỏ I/E/S, khử trùng lặp.
 */
export function stepRoleTitle(instance: ProcedureInstance, step: ProcedureInstanceStep): string {
  const handlers = step.assignments.filter(
    (assignment) => assignment.role !== 'S' && !NON_HANDLER_ROLES.includes(assignment.role),
  );
  if (!handlers.length) {
    return step.assignments.some((assignment) => assignment.role === 'S') ? initiatorName(instance) : '';
  }
  // Bước đã chốt (duyệt, từ chối, trả lại): hiện người thật đã quyết định, không liệt kê các chức danh được giao.
  const decisionActions = DECISION_ACTIONS_BY_STATUS[step.status];
  if (decisionActions) {
    const actors = actualActorNames(instance, step, decisionActions);
    if (actors.length) return actors.join(', ');
  }
  const stage = step.currentRoleStage;
  const scoped = stage && handlers.some((assignment) => assignment.role === stage)
    ? handlers.filter((assignment) => assignment.role === stage)
    : handlers;
  return unique(scoped.map((assignment) => assignment.subjectLabel?.trim() || assignment.role)).join(', ');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function initiatorName(instance: ProcedureInstance): string {
  const entry =
    instance.activity.find((item) => item.action === 'start' && item.actorName?.trim()) ??
    instance.activity.find((item) => item.actorId === instance.initiatedBy && item.actorName?.trim());
  return entry?.actorName.trim() || 'Người khởi tạo';
}

const DECISION_ACTIONS_BY_STATUS: Readonly<Record<string, readonly string[]>> = {
  completed: ['approve', 'complete'],
  rejected: ['reject'],
  returned: ['return'],
};

function actualActorNames(
  instance: ProcedureInstance,
  step: ProcedureInstanceStep,
  actions: readonly string[],
): string[] {
  return unique(
    instance.activity
      .filter(
        (entry) =>
          entry.stepInstanceId === step.id &&
          actions.includes(entry.action) &&
          entry.actorId !== SYSTEM_ACTOR_ID,
      )
      .map((entry) => entry.actorName?.trim() ?? '')
      .reverse(),
  );
}

export function buildInstanceProgress(instance: ProcedureInstance): ProcedureInstanceProgress {
  const entry = buildInstanceStatusEntry(instance);
  return {
    instanceId: entry.instanceId,
    instanceCode: entry.instanceCode,
    status: entry.status,
    currentStepId: instance.currentStepId,
    currentStepName: entry.currentStepName,
    currentAssigneeName: entry.currentAssigneeName,
    completedAt: instance.completedAt,
    steps: instance.steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      order: step.order,
      currentRoleStage: step.currentRoleStage,
      slaHours: step.slaHours,
      slaDueAt: step.slaDueAt,
      completedAt: step.completedAt,
      roleTitle: stepRoleTitle(instance, step),
    })),
    activity: instance.activity,
  };
}

/** Số dòng nhật ký tối đa trong `buildInstanceStepOverview`. */
export const STEP_OVERVIEW_MAX_EVENTS = 50;

/** Loại nhật ký chỉ mang văn bản tự do; không đưa ra ngoài module. */
const FREE_TEXT_ACTIONS: readonly string[] = ['comment'];

/**
 * Điểm rẽ nhánh của hồ sơ, đổi id bước định nghĩa sang id bước của hồ sơ. Chỉ lấy id, nhãn, cờ mặc định
 * và nhánh đã chọn; không bao giờ lấy điều kiện, giá trị đầu vào hay kết quả đánh giá.
 */
function buildOverviewGateways(instance: ProcedureInstance): ProcedureInstanceStepOverviewGateway[] {
  const byDefinitionId = new Map<string, string>();
  for (const step of instance.steps) {
    if (step.definitionStepId && !byDefinitionId.has(step.definitionStepId)) {
      byDefinitionId.set(step.definitionStepId, step.id);
    }
  }
  const result: ProcedureInstanceStepOverviewGateway[] = [];
  for (const gateway of instance.flow?.gateways ?? []) {
    const afterStepId = byDefinitionId.get(gateway.afterStepId);
    if (!afterStepId) continue;
    let latest: { chosenBranchId: string; evaluatedAt: string } | undefined;
    for (const decision of instance.decisions ?? []) {
      if (decision.gatewayId !== gateway.id || decision.supersededAt) continue;
      if (!latest || decision.evaluatedAt >= latest.evaluatedAt) {
        latest = { chosenBranchId: decision.chosenBranchId, evaluatedAt: decision.evaluatedAt };
      }
    }
    const chosenBranchId = latest?.chosenBranchId;
    result.push({
      id: gateway.id,
      name: gateway.name,
      afterStepId,
      ...(chosenBranchId ? { chosenBranchId } : {}),
      branches: gateway.branches.map((branch) => ({
        id: branch.id,
        label: branch.label,
        isDefault: branch.isDefault,
        stepIds: branch.stepIds
          .map((definitionStepId) => byDefinitionId.get(definitionStepId))
          .filter((id): id is string => !!id),
      })),
    });
  }
  return result;
}

/**
 * Các bước và nhật ký đã lọc của hồ sơ, cho Workspace vẽ đường đi. Chỉ chép từng trường cần,
 * không spread đối tượng nguồn để trường mới của hồ sơ không vô tình lộ ra.
 */
export function buildInstanceStepOverview(instance: ProcedureInstance): ProcedureInstanceStepOverview {
  const completedCount = instance.steps.filter((step) => step.status === 'completed').length;
  const progress = instance.progress
    ? { completed: instance.progress.completed, total: instance.progress.total }
    : { completed: completedCount, total: instance.steps.length };
  const gateways = buildOverviewGateways(instance);
  return {
    instanceId: instance.id,
    instanceCode: instance.code,
    status: instance.status,
    currentStepId: instance.currentStepId,
    completedAt: instance.completedAt,
    progress,
    steps: instance.steps.map((step) => ({
      id: step.id,
      name: step.name,
      order: step.order,
      status: step.status,
      roleStage: step.currentRoleStage,
      assigneeLabel: stepRoleTitle(instance, step),
      slaHours: step.slaHours,
      slaDueAt: step.slaDueAt,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
    })),
    ...(gateways.length > 0 ? { gateways } : {}),
    events: instance.activity
      .filter((entry) => !FREE_TEXT_ACTIONS.includes(entry.action))
      .slice(0, STEP_OVERVIEW_MAX_EVENTS)
      .map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorName: entry.actorName,
        createdAt: entry.createdAt,
        stepId: entry.stepInstanceId,
      })),
  };
}

/**
 * Người thực hiện hành động quyết định cuối (approve/reject/complete/cancel/return) của hồ sơ.
 * activity xếp mới nhất trước; bỏ qua nhật ký hệ thống (rẽ nhánh, tự hoàn thành) và bình luận
 * để không mất dấu người duyệt thật. Không có hành động người thì rơi về mục mới nhất.
 */
export function resolveFinalActorId(instance: Pick<ProcedureInstance, 'activity'>): string | undefined {
  const decisive = ['approve', 'reject', 'complete', 'cancel', 'return'];
  const human = instance.activity.find(
    (entry) => decisive.includes(entry.action) && entry.actorId && entry.actorId !== SYSTEM_ACTOR_ID,
  );
  return human?.actorId ?? instance.activity[0]?.actorId;
}
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
