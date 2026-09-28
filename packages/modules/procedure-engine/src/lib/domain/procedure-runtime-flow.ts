/**
 * Máy trạng thái giữa các bước của một hồ sơ: đi tiếp, rẽ nhánh, hợp nhánh, trả
 * về và tiến độ — tính trên luật đã CHỤP vào hồ sơ (`instance.flow`), không đọc
 * lại định nghĩa.
 *
 * Hồ sơ không có `flow` (mở trước khi có rẽ nhánh) được coi là tuyến tính: trục
 * chính là toàn bộ bước theo `order`, đúng như `currentIndex + 1` trước đây.
 */
import {
  PROCEDURE_STAGE_ORDER,
  attributeValueKey,
  buildFlowIndex,
  countRemainingSteps,
  firstFlowStepId,
  selectGatewayBranch,
  sequentialNextStepId,
  branchEntryStepId,
  type ProcedureAssignmentResolution,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeLookup,
  type ProcedureAttributeRef,
  type ProcedureBranchDefinition,
  type ProcedureFlowIndex,
  type ProcedureGatewayDecision,
  type ProcedureGatewayDefinition,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureManagerChainLink,
  type ProcedurePathEntry,
  type ProcedureRaciAssignment,
  type ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineError } from './procedure-engine.error.js';

// Không import từ procedure-authorization: file đó import ngược lại file này.
function runtimeStages(assignments: readonly ProcedureRaciAssignment[]): ProcedureRaciRole[] {
  return PROCEDURE_STAGE_ORDER.filter((role) => assignments.some((assignment) => assignment.role === role));
}

// ------------------------------------------------------------------ Cấu trúc

export function instanceFlowIndex(instance: ProcedureInstance): ProcedureFlowIndex {
  return buildFlowIndex(
    instance.steps.map((step) => ({ id: step.definitionStepId, order: step.order })),
    instance.flow?.gateways,
  );
}

export function stepByDefinitionId(
  instance: ProcedureInstance,
  definitionStepId: string | null,
): ProcedureInstanceStep | undefined {
  if (!definitionStepId) return undefined;
  return instance.steps.find((step) => step.definitionStepId === definitionStepId);
}

/** Bước đầu tiên của hồ sơ theo luồng (bước trục chính có order nhỏ nhất). */
export function firstInstanceStep(instance: ProcedureInstance): ProcedureInstanceStep | undefined {
  return stepByDefinitionId(instance, firstFlowStepId(instanceFlowIndex(instance)));
}

// ------------------------------------------------------------------ Đường đi

/**
 * Đường đi của hồ sơ; hồ sơ cũ chưa có thì dựng lại một lần từ trạng thái bước.
 *
 * Hồ sơ cũ luôn tuyến tính, nên đường đi chính là các bước đã từng được mở, theo
 * `order`. Không có dữ liệu thì không bịa: bước chưa mở không vào đường đi.
 */
function derivedPath(instance: ProcedureInstance): ProcedurePathEntry[] {
  return [...instance.steps]
    .filter(
      (step) =>
        step.id === instance.currentStepId ||
        (step.status !== 'pending' && step.status !== 'skipped'),
    )
    .sort((left, right) => left.order - right.order)
    .map((step) => ({ stepInstanceId: step.id, enteredAt: step.startedAt ?? instance.startedAt }));
}

/** Gắn đường đi vào hồ sơ (chỉ gọi trong transaction, trước khi ghi). */
export function ensurePath(instance: ProcedureInstance): ProcedurePathEntry[] {
  if (!instance.path) instance.path = derivedPath(instance);
  return instance.path;
}

/** Đọc đường đi còn hiệu lực mà không sửa hồ sơ — dùng được cả ở chỗ chỉ đọc. */
export function livePath(instance: ProcedureInstance): ProcedurePathEntry[] {
  return (instance.path ?? derivedPath(instance)).filter((entry) => !entry.supersededAt);
}

// ------------------------------------------------------------------ Thuộc tính

export function attributeDefinitionFor(
  instance: ProcedureInstance,
  ref: ProcedureAttributeRef,
): ProcedureAttributeDefinition | undefined {
  if (ref.scope === 'process') {
    return instance.flow?.attributes.find((attribute) => attribute.code === ref.code);
  }
  return stepByDefinitionId(instance, ref.stepId)?.attributes?.find(
    (attribute) => attribute.code === ref.code,
  );
}

export function instanceAttributeLookup(instance: ProcedureInstance): ProcedureAttributeLookup {
  return (ref) => instance.attributeValues?.[attributeValueKey(ref)]?.value;
}

/** Mọi thuộc tính có thể nhập ở hồ sơ, kèm khoá lưu giá trị. */
export function instanceAttributeSlots(
  instance: ProcedureInstance,
): { key: string; ref: ProcedureAttributeRef; definition: ProcedureAttributeDefinition; step?: ProcedureInstanceStep }[] {
  const slots: { key: string; ref: ProcedureAttributeRef; definition: ProcedureAttributeDefinition; step?: ProcedureInstanceStep }[] = [];
  for (const definition of instance.flow?.attributes ?? []) {
    const ref: ProcedureAttributeRef = { scope: 'process', code: definition.code };
    slots.push({ key: attributeValueKey(ref), ref, definition });
  }
  for (const step of instance.steps) {
    for (const definition of step.attributes ?? []) {
      const ref: ProcedureAttributeRef = { scope: 'step', stepId: step.definitionStepId, code: definition.code };
      slots.push({ key: attributeValueKey(ref), ref, definition, step });
    }
  }
  return slots;
}

/** Thuộc tính cấp quy trình đã được một quyết định rẽ nhánh (còn hiệu lực) dùng tới. */
function consumedProcessCodes(instance: ProcedureInstance): Set<string> {
  const codes = new Set<string>();
  for (const decision of instance.decisions ?? []) {
    if (decision.supersededAt) continue;
    for (const input of decision.inputs) if (input.ref.scope === 'process') codes.add(input.ref.code);
  }
  return codes;
}

/**
 * Khoá thuộc tính được nhập lúc này, với người ĐANG giữ pha hiện tại.
 *
 * - Thuộc tính của bước hiện tại: nhập được suốt khi bước còn mở (chờ chốt Q11).
 * - Thuộc tính cấp quy trình: nhập được cho tới khi một điểm rẽ nhánh đã dùng nó
 *   để quyết định — đổi sau đó thì nhật ký quyết định không còn khớp dữ liệu.
 */
export function editableAttributeKeys(instance: ProcedureInstance): string[] {
  if (instance.status !== 'running') return [];
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  if (!current || (current.status !== 'active' && current.status !== 'ready')) return [];
  const consumed = consumedProcessCodes(instance);
  const keys: string[] = [];
  for (const definition of instance.flow?.attributes ?? []) {
    if (!consumed.has(definition.code)) keys.push(attributeValueKey({ scope: 'process', code: definition.code }));
  }
  for (const definition of current.attributes ?? []) {
    keys.push(attributeValueKey({ scope: 'step', stepId: current.definitionStepId, code: definition.code }));
  }
  return keys;
}

// ------------------------------------------------------------------ Người duyệt động

export interface ProcedureManagerContext {
  /** Chuỗi chức danh từ chức danh của người khởi tạo leo lên gốc; rỗng = không có quản lý. */
  readonly chain: readonly ProcedureManagerChainLink[];
}

/**
 * Thay các assignment `initiator_manager` của bước bằng chủ thể cụ thể.
 *
 * Chạy lúc bước được KÍCH HOẠT, không phải lúc mở hồ sơ: tổ chức có thể đổi
 * trong lúc hồ sơ chạy, và người duyệt phải là người đang giữ chức danh khi tới
 * lượt. Bản gốc được cất ở `dynamicAssignments` để trả về thì phân giải lại.
 */
export function resolveDynamicAssignments(
  instance: ProcedureInstance,
  step: ProcedureInstanceStep,
  managers: ProcedureManagerContext | undefined,
  now: string,
): void {
  const originals = step.dynamicAssignments ?? step.assignments.filter((item) => item.subjectType === 'initiator_manager');
  if (!originals.length) return;
  step.dynamicAssignments = originals.map((item) => structuredClone(item));

  const resolved = new Map<string, { assignment: ProcedureRaciAssignment; log: ProcedureAssignmentResolution }>();
  for (const original of originals) {
    // Chức danh trống thì leo tiếp; chức danh mà người giữ duy nhất chính là
    // người khởi tạo cũng leo tiếp — không ai tự duyệt đơn của mình (chờ chốt Q6b).
    const link = (managers?.chain ?? []).find(
      (candidate) =>
        candidate.holderUserIds.length > 0 &&
        candidate.holderUserIds.some((userId) => userId !== instance.initiatedBy),
    );
    const target = link
      ? { subjectType: 'position' as const, subjectId: link.positionId, label: link.positionName }
      : original.managerFallback
        ? {
            subjectType: original.managerFallback.subjectType,
            subjectId: original.managerFallback.subjectId,
            label: original.managerFallback.subjectLabel,
          }
        : undefined;
    if (!target) {
      throw new ProcedureEngineError(
        'conflict',
        `Bước “${step.name}” không tìm được quản lý trực tiếp của người khởi tạo và chưa cấu hình người dự phòng.`,
      );
    }
    resolved.set(original.id, {
      assignment: {
        ...original,
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        subjectLabel: target.label,
        managerFallback: undefined,
      },
      log: {
        assignmentId: original.id,
        rule: 'initiator_manager',
        initiatorPositionId: instance.initiatorPositionId,
        chain: (managers?.chain ?? []).map((item) => ({
          positionId: item.positionId,
          positionName: item.positionName,
          holderCount: item.holderUserIds.length,
        })),
        resolvedTo: { subjectType: target.subjectType, subjectId: target.subjectId, label: target.label },
        usedFallback: !link,
        resolvedAt: now,
      },
    });
  }

  step.assignments = step.assignments.map((assignment) => resolved.get(assignment.id)?.assignment ?? assignment);
  step.resolutions = [...(step.resolutions ?? []), ...[...resolved.values()].map((item) => item.log)];
}

/** Đưa bước về assignment động chưa phân giải, để lần kích hoạt sau phân giải lại. */
export function restoreDynamicAssignments(step: ProcedureInstanceStep): void {
  if (!step.dynamicAssignments?.length) return;
  const originals = new Map(step.dynamicAssignments.map((item) => [item.id, item]));
  step.assignments = step.assignments.map((assignment) => structuredClone(originals.get(assignment.id) ?? assignment));
}

export function needsManagerChain(instance: ProcedureInstance): boolean {
  return instance.steps.some((step) =>
    (step.dynamicAssignments ?? step.assignments).some((item) => item.subjectType === 'initiator_manager'),
  );
}

// ------------------------------------------------------------------ Kích hoạt / đi tiếp

export interface ProcedureFlowContext {
  readonly now: string;
  readonly nextId: () => string;
  readonly managers?: ProcedureManagerContext;
  /** Gọi khi bước bắt đầu (đặt SLA...). Giữ ở application để máy trạng thái không biết SLA. */
  readonly onStepStarted?: (step: ProcedureInstanceStep) => void;
}

function stageStatus(stage: ProcedureRaciRole | null): ProcedureInstanceStep['status'] {
  return stage === 'C' || stage === 'A' ? 'ready' : 'active';
}

export function activateStep(
  instance: ProcedureInstance,
  step: ProcedureInstanceStep,
  context: ProcedureFlowContext,
  viaDecisionId?: string,
): void {
  resolveDynamicAssignments(instance, step, context.managers, context.now);
  const stage = runtimeStages(step.assignments)[0] ?? null;
  step.currentRoleStage = stage;
  step.status = stageStatus(stage);
  step.startedAt = context.now;
  step.completedAt = undefined;
  context.onStepStarted?.(step);
  instance.currentStepId = step.id;
  ensurePath(instance).push({ stepInstanceId: step.id, enteredAt: context.now, viaDecisionId });
}

function markBranchSteps(
  instance: ProcedureInstance,
  gateway: ProcedureGatewayDefinition,
  chosen: ProcedureBranchDefinition | undefined,
  status: 'skipped' | 'pending',
): void {
  for (const branch of gateway.branches) {
    if (chosen && branch.id === chosen.id) continue;
    for (const definitionStepId of branch.stepIds) {
      const step = stepByDefinitionId(instance, definitionStepId);
      if (!step) continue;
      // 'returned' cũng tính: bước bị trả về nằm ở nhánh cũ, lần đi lại chọn nhánh
      // khác thì nó không còn là việc sắp tới nữa.
      if (status === 'skipped' && (step.status === 'pending' || step.status === 'returned')) {
        step.status = 'skipped';
      }
      if (status === 'pending' && step.status === 'skipped') step.status = 'pending';
    }
  }
}

function decisionFor(instance: ProcedureInstance, gatewayId: string): ProcedureGatewayDecision | undefined {
  return [...(instance.decisions ?? [])].reverse().find((item) => item.gatewayId === gatewayId && !item.supersededAt);
}

/**
 * Bước hiện tại vừa xong pha cuối: đánh giá rẽ nhánh (nếu có), mở bước kế tiếp
 * hoặc kết thúc hồ sơ. Trả về quyết định vừa ra, nếu có.
 */
export function moveToNextStep(
  instance: ProcedureInstance,
  current: ProcedureInstanceStep,
  context: ProcedureFlowContext,
): ProcedureGatewayDecision | undefined {
  const index = instanceFlowIndex(instance);
  const gateway = index.gatewayAfter.get(current.definitionStepId);
  let targetDefinitionId: string | null;
  let decision: ProcedureGatewayDecision | undefined;

  if (gateway) {
    const selection = selectGatewayBranch(gateway, instanceAttributeLookup(instance));
    if (!selection) {
      throw new ProcedureEngineError('conflict', `Điểm rẽ nhánh “${gateway.name}” không có nhánh mặc định.`);
    }
    decision = {
      id: context.nextId(),
      gatewayId: gateway.id,
      gatewayName: gateway.name,
      afterStepInstanceId: current.id,
      chosenBranchId: selection.branch.id,
      chosenBranchLabel: selection.branch.label,
      usedDefault: selection.usedDefault,
      evaluatedAt: context.now,
      inputs: selection.inputs,
      branchResults: selection.branchResults,
    };
    instance.decisions = [...(instance.decisions ?? []), decision];
    markBranchSteps(instance, gateway, selection.branch, 'skipped');
    targetDefinitionId = branchEntryStepId(index, gateway, selection.branch);
  } else {
    targetDefinitionId = sequentialNextStepId(index, current.definitionStepId);
  }

  const next = stepByDefinitionId(instance, targetDefinitionId);
  if (!next) {
    instance.status = 'completed';
    instance.currentStepId = undefined;
    instance.completedAt = context.now;
  } else {
    activateStep(instance, next, context, decision?.id);
  }
  recomputeProgress(instance);
  return decision;
}

// ------------------------------------------------------------------ Trả về

/**
 * Các bước người đang giữ pha hiện tại được trả hồ sơ về.
 *
 * Chỉ là bước trên ĐƯỜNG ĐÃ ĐI (còn hiệu lực), trước bước hiện tại. C có điểm
 * quay về cố định từ lúc thiết kế nên chỉ có đúng điểm đó — và luật công bố đã
 * bảo đảm điểm đó luôn nằm trên mọi đường tới bước này.
 */
export function returnTargetStepIds(instance: ProcedureInstance): string[] {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  if (!current) return [];
  const path = livePath(instance);
  const position = path.findIndex((entry) => entry.stepInstanceId === current.id);
  const before = (position < 0 ? path : path.slice(0, position)).map((entry) => entry.stepInstanceId);
  const earlier = [...new Set(before)].filter((id) => id !== current.id);

  if (current.currentRoleStage === 'C') {
    const fixed = current.assignments.find(
      (assignment) => assignment.role === 'C' && assignment.fixedRollbackStepId,
    )?.fixedRollbackStepId;
    if (fixed) {
      const target = stepByDefinitionId(instance, fixed);
      return target && earlier.includes(target.id) ? [target.id] : [];
    }
  }
  return earlier;
}

/**
 * Trả hồ sơ về một bước đã đi qua.
 *
 * Chỉ các bước trên đường đi SAU điểm quay về bị làm lại; nhánh không đi và bước
 * chưa tới không bị đụng. Đoạn đường cũ và quyết định cũ không bị xoá mà đánh
 * dấu `supersededAt`, để lịch sử vẫn cho thấy hồ sơ từng đi đường nào.
 */
export function returnToStep(
  instance: ProcedureInstance,
  targetStepInstanceId: string,
  context: ProcedureFlowContext,
  resetStepWork: (step: ProcedureInstanceStep) => void,
  stopClock: (step: ProcedureInstanceStep) => void,
): void {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  if (!current) throw new ProcedureEngineError('conflict', 'Không có bước đang xử lý.');
  const target = instance.steps.find((step) => step.id === targetStepInstanceId);
  if (!target) throw new ProcedureEngineError('not_found', 'Không tìm thấy bước muốn trả về.');

  const path = ensurePath(instance);
  const live = path.filter((entry) => !entry.supersededAt);
  const targetPosition = live.map((entry) => entry.stepInstanceId).lastIndexOf(target.id);
  const currentPosition = live.map((entry) => entry.stepInstanceId).lastIndexOf(current.id);
  if (targetPosition < 0 || targetPosition >= currentPosition) {
    throw new ProcedureEngineError('validation', 'Chỉ trả về được một bước đã đi qua trước bước hiện tại.');
  }

  const rewound = live.slice(targetPosition);
  const rewoundIds = new Set(rewound.map((entry) => entry.stepInstanceId));
  for (const entry of rewound) {
    entry.supersededAt = context.now;
    const step = instance.steps.find((candidate) => candidate.id === entry.stepInstanceId);
    if (!step || step.id === target.id) continue;
    // Bước bị trả về giữ trạng thái 'returned' để người đọc biết vì sao nó quay
    // lại; các bước sau nó về 'pending'.
    step.status = step.id === current.id ? 'returned' : 'pending';
    step.startedAt = undefined;
    step.completedAt = undefined;
    stopClock(step);
    restoreDynamicAssignments(step);
    step.currentRoleStage = runtimeStages(step.assignments)[0] ?? null;
    resetStepWork(step);
  }

  // Quyết định được đưa ra SAU điểm quay về (kể cả ngay tại nó) hết hiệu lực:
  // lần đi lại sẽ đánh giá lại trên giá trị mới.
  const index = instanceFlowIndex(instance);
  for (const decision of instance.decisions ?? []) {
    if (decision.supersededAt || !rewoundIds.has(decision.afterStepInstanceId)) continue;
    decision.supersededAt = context.now;
    const gateway = index.gateways.find((item) => item.id === decision.gatewayId);
    if (gateway) markBranchSteps(instance, gateway, undefined, 'pending');
  }

  restoreDynamicAssignments(target);
  resetStepWork(target);
  activateStep(instance, target, context);
  recomputeProgress(instance);
}

// ------------------------------------------------------------------ Tiến độ

export function recomputeProgress(instance: ProcedureInstance): void {
  const live = livePath(instance);
  const completed = live.filter((entry) =>
    instance.steps.some((step) => step.id === entry.stepInstanceId && step.status === 'completed'),
  ).length;
  if (instance.status !== 'running' || !instance.currentStepId) {
    instance.progress = { completed, total: Math.max(completed, live.length), isEstimate: false };
    return;
  }
  const index = instanceFlowIndex(instance);
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const decided = (gateway: ProcedureGatewayDefinition) => {
    const decision = decisionFor(instance, gateway.id);
    return decision ? gateway.branches.find((branch) => branch.id === decision.chosenBranchId) : undefined;
  };
  const { remaining, isEstimate } = countRemainingSteps(index, current?.definitionStepId ?? null, decided);
  instance.progress = { completed, total: live.length + remaining, isEstimate };
}
