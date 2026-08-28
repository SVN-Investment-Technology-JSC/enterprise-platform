import {
  PROCEDURE_STAGE_ORDER,
  type ProcedureInstance,
  type ProcedureRaciAssignment,
  type ProcedureRaciRole,
  type ProcedureRuntimeAction,
  type ProcedureRuntimeAuthorization,
} from '@enterprise-platform/contracts-procedure-engine';

export interface ProcedureActor {
  tenantId: string;
  userId: string;
  membershipId: string;
  displayName: string;
  /** Can design and publish definitions, and see the process matrix. */
  canDesign: boolean;
  /**
   * Can act on any step regardless of RACI assignment. Deliberately separate
   * from the ability to act at all: if every actor were an override, the RACI
   * assignments would never constrain anyone.
   */
  isOverride: boolean;
  organizationUnitIds: readonly string[];
  positionIds: readonly string[];
  /**
   * Org units of the tenant, keyed by id. Present when the caller can supply the
   * organization snapshot; escalation is skipped when absent.
   */
  orgUnits?: ReadonlyMap<string, ProcedureOrgUnit>;
}

export interface ProcedureOrgUnit {
  readonly parentId?: string;
  /** False when the unit has no head, which is what triggers escalation. */
  readonly hasHead: boolean;
  /** 'unit' là đơn vị, 'position' là chức danh. Người chỉ gắn được vào 'position'. */
  readonly category?: 'unit' | 'position';
  /**
   * Node chức danh phụ trách nằm ngay dưới đơn vị này.
   *
   * Gán một vai cho đơn vị nghĩa là giao cho người giữ chức danh này. Không thể
   * khớp trực tiếp bằng id đơn vị: người được bổ nhiệm vào node chức danh chứ
   * không phải vào node đơn vị, nên `organizationUnitIds` của họ không bao giờ
   * chứa id đơn vị.
   */
  readonly headPositionIds?: readonly string[];
  /**
   * Mọi node chức danh nằm dưới đơn vị này, kể cả cấp sâu.
   *
   * Chỉ vai S dùng tới: gán S cho một đơn vị nghĩa là ai trong đơn vị cũng khởi
   * tạo được hồ sơ, khác với các vai còn lại vốn dồn về trưởng đơn vị.
   */
  readonly memberPositionIds?: readonly string[];
}

/**
 * Những id thật sự đại diện cho một chủ thể được gán.
 *
 * Gán vào chức danh thì chính nó. Gán vào đơn vị thì tuỳ vai:
 *  - S: mọi thành viên trong đơn vị, vì ai cũng có thể là người khởi tạo.
 *  - Còn lại: chức danh phụ trách đơn vị, vì đó là người chịu trách nhiệm.
 */
function actingSubjectIds(
  subjectId: string,
  units: ReadonlyMap<string, ProcedureOrgUnit> | undefined,
  role: ProcedureRaciRole,
): readonly string[] {
  const unit = units?.get(subjectId);
  if (!unit || unit.category !== 'unit') return [subjectId];
  const targets = role === 'S' ? unit.memberPositionIds ?? [] : unit.headPositionIds ?? [];
  return targets.length > 0 ? [subjectId, ...targets] : [subjectId];
}

/**
 * Walks up from a unit that has no head until it finds one that does.
 *
 * A step assigned to a headless unit would otherwise be unactionable, so
 * responsibility rises to the nearest ancestor that actually has a head.
 * Returns the original id when the unit has a head, or when no ancestor does.
 */
export function resolveEscalatedUnitId(
  unitId: string,
  units: ReadonlyMap<string, ProcedureOrgUnit>,
): string {
  const seen = new Set<string>([unitId]);
  let currentId = unitId;

  while (true) {
    const unit = units.get(currentId);
    if (!unit || unit.hasHead) return currentId;

    const parentId = unit.parentId;
    // Stop at the root, and guard against a cycle in the stored hierarchy.
    if (!parentId || seen.has(parentId)) return currentId;

    seen.add(parentId);
    currentId = parentId;
  }
}

export function matchesProcedureAssignment(
  assignment: ProcedureRaciAssignment,
  actor: ProcedureActor,
): boolean {
  if (assignment.subjectType === 'user') return assignment.subjectId === actor.userId;
  if (assignment.subjectType === 'organization_unit') {
    // Gán cho đơn vị thì mặc định giao cho trưởng đơn vị đó; gán thẳng cho một
    // chức danh thì khớp chính chức danh ấy.
    const acting = actingSubjectIds(assignment.subjectId, actor.orgUnits, assignment.role);
    if (acting.some((id) => actor.organizationUnitIds.includes(id))) return true;
    // Escalation: the assigned unit has no head, so its nearest headed ancestor
    // answers for it.
    if (!actor.orgUnits) return false;
    const escalated = resolveEscalatedUnitId(assignment.subjectId, actor.orgUnits);
    if (escalated === assignment.subjectId) return false;
    return actingSubjectIds(escalated, actor.orgUnits, assignment.role).some((id) =>
      actor.organizationUnitIds.includes(id),
    );
  }
  return actor.positionIds.includes(assignment.subjectId);
}

/** True when the actor only matches because responsibility escalated to them. */
export function matchesByEscalation(
  assignment: ProcedureRaciAssignment,
  actor: ProcedureActor,
): boolean {
  if (assignment.subjectType !== 'organization_unit' || !actor.orgUnits) return false;
  // Khớp qua trưởng đơn vị là định tuyến bình thường, không phải leo trách nhiệm.
  const acting = actingSubjectIds(assignment.subjectId, actor.orgUnits, assignment.role);
  if (acting.some((id) => actor.organizationUnitIds.includes(id))) return false;
  const escalated = resolveEscalatedUnitId(assignment.subjectId, actor.orgUnits);
  if (escalated === assignment.subjectId) return false;
  return actingSubjectIds(escalated, actor.orgUnits, assignment.role).some((id) =>
    actor.organizationUnitIds.includes(id),
  );
}

export function runtimeStages(
  assignments: ProcedureRaciAssignment[],
): ProcedureRaciRole[] {
  return PROCEDURE_STAGE_ORDER.filter((role) =>
    assignments.some((assignment) => assignment.role === role),
  );
}

/**
 * Người này có mặt trong hồ sơ hay không.
 *
 * Rộng hơn hẳn quyền hành động: giữ vai trò ở BẤT KỲ bước nào (kể cả I), được uỷ
 * quyền, được giao đầu việc E(x), là người khởi tạo, hoặc là quản trị override.
 * Đây là ranh giới của "được đọc" — dòng trao đổi và tệp đính kèm của hồ sơ chỉ
 * người trong hồ sơ mới xem được, quản trị thấy mọi hồ sơ nên đương nhiên thấy.
 *
 * Dùng chung cho getWorkspace, đọc feed và liệt kê tệp, để ba nơi không trôi
 * khỏi nhau — một hồ sơ đã hiện ra trong danh sách thì tệp của nó cũng phải mở.
 */
export function isProcedureParticipant(
  instance: ProcedureInstance,
  actor: ProcedureActor,
): boolean {
  if (actor.isOverride) return true;
  if (instance.initiatedBy === actor.userId) return true;
  if (
    instance.steps.some((step) =>
      step.assignments.some((assignment) => matchesProcedureAssignment(assignment, actor)),
    )
  ) {
    return true;
  }
  if ((instance.delegations ?? []).some((item) => item.delegatedTo === actor.userId)) return true;
  return (instance.subtasks ?? []).some((subtask) => subtask.assigneeId === actor.userId);
}

export function deriveProcedureAuthorization(
  instance: ProcedureInstance,
  actor: ProcedureActor,
): ProcedureRuntimeAuthorization {
  const currentIndex = instance.steps.findIndex(
    (step) => step.id === instance.currentStepId,
  );
  const current = currentIndex >= 0 ? instance.steps[currentIndex] : undefined;
  const stage = current?.currentRoleStage ?? null;
  const matchingRoles = new Set<ProcedureRaciRole>();
  let escalated = false;
  for (const assignment of current?.assignments ?? []) {
    if (matchesProcedureAssignment(assignment, actor)) {
      matchingRoles.add(assignment.role);
      if (matchesByEscalation(assignment, actor)) escalated = true;
    }
  }

  // Roles handed over by someone who held them. Scoped to a step when the
  // delegation names one, otherwise it covers the whole instance.
  const directRoleCount = matchingRoles.size;
  for (const delegation of instance.delegations ?? []) {
    if (delegation.delegatedTo !== actor.userId) continue;
    if (delegation.stepInstanceId && delegation.stepInstanceId !== current?.id) continue;
    for (const role of delegation.roles) matchingRoles.add(role);
  }
  const delegated = matchingRoles.size > directRoleCount;
  const myRoles = [...matchingRoles];
  const actions = new Set<ProcedureRuntimeAction>();
  const isActive = current?.status === 'active';
  const isReady = current?.status === 'ready';

  if (instance.status === 'running' && actor.isOverride && current) {
    actions.add('comment');
    actions.add('cancel');
    actions.add('reject');
    if (currentIndex > 0) actions.add('return');
    if (isReady) actions.add('approve');
    if (isActive) actions.add('complete');
  } else if (
    instance.status === 'running' &&
    current &&
    stage &&
    myRoles.includes(stage)
  ) {
    switch (stage) {
      case 'S':
      case 'R':
      case 'E':
        actions.add('comment');
        actions.add('complete');
        break;
      case 'C':
        actions.add('comment');
        actions.add('approve');
        if (currentIndex > 0) actions.add('return');
        break;
      case 'A':
        actions.add('comment');
        actions.add('approve');
        actions.add('reject');
        if (currentIndex > 0) actions.add('return');
        break;
      case 'I':
        break;
    }
  }

  // Đầu việc của chính người này ở bước hiện tại. Người được vai trò E phân công
  // không giữ vai trò RACI nào, nên đây là đường duy nhất để họ thấy phần việc
  // của mình và được phép đánh dấu xong.
  const mySubtaskIds = (instance.subtasks ?? [])
    .filter(
      (subtask) =>
        subtask.stepInstanceId === current?.id && subtask.assigneeId === actor.userId,
    )
    .map((subtask) => subtask.id);

  return {
    myRoles,
    currentRoleStage: stage,
    availableActions: [...actions],
    canManageSubtasks:
      actor.isOverride || (stage === 'E' && myRoles.includes('E')),
    isOverride: actor.isOverride,
    isDelegated: delegated,
    isEscalated: escalated,
    mySubtaskIds,
    canReadFeed: isProcedureParticipant(instance, actor),
    // Hồ sơ đã đóng là bản ghi kiểm toán: đọc được, không thêm được nữa.
    canComment: instance.status === 'running' && isProcedureParticipant(instance, actor),
  };
}
