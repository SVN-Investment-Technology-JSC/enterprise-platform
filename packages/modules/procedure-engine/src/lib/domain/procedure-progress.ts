import type {
  ProcedureInstance,
  ProcedureInstanceProgress,
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
      roleTitle: step.assignments.map((a) => a.subjectLabel || a.role).join(', '),
    })),
    activity: instance.activity,
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
