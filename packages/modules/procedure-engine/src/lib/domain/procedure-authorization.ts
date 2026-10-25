import {
  PROCEDURE_STAGE_ORDER,
  type ProcedureInstance,
  type ProcedureRaciAssignment,
  type ProcedureRaciRole,
  type ProcedureRuntimeAction,
  type ProcedureRuntimeAuthorization,
} from '@enterprise-platform/contracts-procedure-engine';
import { isFinanceStepWaiting } from './procedure-finance-step.js';
import { editableAttributeKeys, returnTargetStepIds } from './procedure-runtime-flow.js';

export interface ProcedureActor {
  tenantId: string;
  userId: string;
  membershipId: string;
  displayName: string;
  /** Can design and publish definitions, and see the process matrix. */
  canDesign: boolean;
  canPublish: boolean;
  canCreateInstances: boolean;
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

/** Phân công này có cho phép `actor` KHỞI TẠO quy trình (vai S) hay không. */
export function canStartWithAssignment(
  assignment: ProcedureRaciAssignment,
  actor: ProcedureActor,
): boolean {
  if (assignment.role !== 'S') return false;
  return assignment.subjectType === 'everyone' || matchesProcedureAssignment(assignment, actor);
}

export function matchesProcedureAssignment(
  assignment: ProcedureRaciAssignment,
  actor: ProcedureActor,
): boolean {
  if (assignment.subjectType === 'user') return assignment.subjectId === actor.userId;
  // "Toàn bộ nhân viên" chỉ cho phép khởi tạo (xem `canStartWithAssignment`); không cấp quyền
  // đọc hay hành động trên hồ sơ của người khác nên không bao giờ khớp ở đây.
  if (assignment.subjectType === 'everyone') return false;
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
 *
 * Phân công vai S không tính: S chỉ là tập người ĐƯỢC PHÉP khởi tạo (có thể là cả phòng ban
 * hoặc "Toàn bộ nhân viên"). Người khởi tạo thật đã được tính qua `initiatedBy`; nếu tính cả S
 * thì đơn cá nhân lộ ra cho mọi thành viên các đơn vị được gán ở bước đầu.
 */
export function isProcedureParticipant(
  instance: ProcedureInstance,
  actor: ProcedureActor,
): boolean {
  // Đơn đã xoá biến mất với mọi người, kể cả quản trị: đây là cửa chung của mọi lần đọc đơn.
  if (instance.deletion) return false;
  if (actor.isOverride) return true;
  if (instance.initiatedBy === actor.userId) return true;
  if (
    instance.steps.some((step) =>
      step.assignments.some(
        (assignment) => assignment.role !== 'S' && matchesProcedureAssignment(assignment, actor),
      ),
    )
  ) {
    return true;
  }
  if ((instance.delegations ?? []).some((item) => item.delegatedTo === actor.userId)) return true;
  return (instance.subtasks ?? []).some((subtask) => subtask.assigneeId === actor.userId);
}

/**
 * Người này giữ `role` ở BẤT KỲ bước nào của đơn — trực tiếp qua phân công (chức danh, đơn vị qua
 * trưởng đơn vị, leo thang) hoặc được uỷ quyền vai đó. Khác `myRoles` (chỉ bước hiện tại): quyền gắn
 * với cả đơn như xoá đơn, đổi công việc liên kết.
 *
 * Phân công "quản lý của người khởi tạo" chỉ thành chức danh cụ thể khi bước đó đã tới, nên trước đó
 * chưa khớp ai.
 */
export function holdsProcedureRole(
  instance: ProcedureInstance,
  actor: ProcedureActor,
  role: ProcedureRaciRole,
): boolean {
  if (
    instance.steps.some((step) =>
      step.assignments.some(
        (assignment) => assignment.role === role && matchesProcedureAssignment(assignment, actor),
      ),
    )
  ) {
    return true;
  }
  return (instance.delegations ?? []).some(
    (delegation) => delegation.delegatedTo === actor.userId && delegation.roles.includes(role),
  );
}

/** Trạng thái còn xoá được đơn: chưa hoàn thành. Đơn đã hoàn thành dùng "Huỷ hiệu lực". */
const DELETABLE_STATUSES: readonly ProcedureInstance['status'][] = ['running', 'cancelled', 'rejected'];

/** Đơn còn được bổ sung tài liệu: đang chạy, hoặc đã hoàn thành (bổ sung chứng từ sau). */
const SUPPLEMENTABLE_STATUSES: readonly ProcedureInstance['status'][] = ['running', 'completed'];

/** Công việc Workspace đang gắn với đơn; rỗng khi đơn không gắn dự án hoặc liên kết chưa xong. */
export function linkedWorkItemId(instance: ProcedureInstance): string | undefined {
  if (instance.workspaceLink?.status === 'linked') return instance.workspaceLink.workItemId;
  if (instance.sourceType === 'workspace_work_item') return instance.sourceId;
  return undefined;
}

/**
 * Đơn đã có lượt duyệt ở nút C hoặc nút A (hành động "approve", kể cả quản trị duyệt thay). Tính cả lượt
 * duyệt đã bị trả về sau đó: chỉ cần một nút C/A đã pass là đơn không còn là bản nháp của người submit.
 */
export function hasProcedureApproval(instance: ProcedureInstance): boolean {
  return instance.activity.some((entry) => entry.action === 'approve');
}

/**
 * Xoá đơn, khi đơn chưa hoàn thành và chưa bị xoá:
 *  - người giữ vai A của đơn, hoặc quản trị — lúc nào cũng được;
 *  - người submit (người khởi tạo) — chỉ trước khi nút C hay nút A đầu tiên pass.
 */
export function canDeleteProcedureInstance(instance: ProcedureInstance, actor: ProcedureActor): boolean {
  if (instance.deletion || !DELETABLE_STATUSES.includes(instance.status)) return false;
  if (actor.isOverride || holdsProcedureRole(instance, actor, 'A')) return true;
  return instance.initiatedBy === actor.userId && !hasProcedureApproval(instance);
}

/**
 * Đổi công việc liên kết: cùng người được xoá đơn; đơn phải đang gắn một công việc (không đang chờ
 * Workspace trả lời) và chưa bị huỷ hiệu lực.
 */
export function canRelinkProcedureWorkspace(
  instance: ProcedureInstance,
  actor: ProcedureActor,
): boolean {
  if (instance.deletion || instance.status === 'reversed') return false;
  if (instance.workspaceLink?.status === 'pending' || !linkedWorkItemId(instance)) return false;
  return actor.isOverride || holdsProcedureRole(instance, actor, 'A');
}

/**
 * Bổ sung tài liệu: người tham gia đơn trừ người xem. "Người xem" là người chỉ có mặt nhờ vai I (hoặc
 * chỉ thuộc tập được phép khởi tạo S); ai có vai khác, là người khởi tạo, được uỷ quyền, được giao đầu
 * việc hay là quản trị thì bổ sung được.
 */
export function canSupplementProcedureInstance(
  instance: ProcedureInstance,
  actor: ProcedureActor,
): boolean {
  if (instance.deletion || !SUPPLEMENTABLE_STATUSES.includes(instance.status)) return false;
  if (actor.isOverride || instance.initiatedBy === actor.userId) return true;
  if (
    instance.steps.some((step) =>
      step.assignments.some(
        (assignment) =>
          assignment.role !== 'S' &&
          assignment.role !== 'I' &&
          matchesProcedureAssignment(assignment, actor),
      ),
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
    // Vai S (người khởi tạo) của hồ sơ đã tạo chỉ dành riêng cho CHÍNH NGƯỜI KHỞI TẠO hồ sơ này;
    // bất kỳ người nào khác (dù có cùng chức danh, phòng ban hay phân công khởi tạo) đều không được
    // thao tác trên hồ sơ của người khác.
    if (assignment.role === 'S') {
      if (
        instance.initiatedBy === actor.userId &&
        (assignment.subjectType === 'everyone' || matchesProcedureAssignment(assignment, actor))
      ) {
        matchingRoles.add('S');
      }
      continue;
    }
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
  // Trả về chỉ tới bước trên ĐƯỜNG ĐÃ ĐI, không theo vị trí trong mảng bước: khi
  // có nhánh, bước đứng trước theo thứ tự có thể là bước của nhánh không đi.
  const returnTargets = current ? returnTargetStepIds(instance) : [];
  const canReturn = returnTargets.length > 0;

  if (instance.status === 'running' && actor.isOverride && current) {
    actions.add('comment');
    actions.add('cancel');
    actions.add('reject');
    if (canReturn) actions.add('return');
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
        if (canReturn) actions.add('return');
        break;
      case 'A':
        actions.add('comment');
        actions.add('approve');
        actions.add('reject');
        if (canReturn) actions.add('return');
        break;
      case 'I':
        break;
    }
  }

  // Bước Tài chính đang chờ: bước chỉ đóng khi Tài chính báo đã ghi sổ. Không ai —
  // kể cả quản trị override — được hoàn thành/duyệt bằng tay, nếu không hồ sơ sẽ
  // hoàn tất mà tiền chưa được ghi sổ. Trả về, huỷ, trao đổi vẫn giữ nguyên.
  if (isFinanceStepWaiting(current)) {
    actions.delete('complete');
    actions.delete('approve');
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
    // Nhập thuộc tính là một phần của việc làm bước, nên đi cùng quyền hành động
    // ở pha hiện tại chứ không mở cho mọi người trong hồ sơ.
    editableAttributeKeys:
      actions.has('complete') || actions.has('approve') ? editableAttributeKeys(instance) : [],
    returnTargetStepIds: actions.has('return') ? returnTargets : [],
    canDelete: canDeleteProcedureInstance(instance, actor),
    canRelinkWorkspace: canRelinkProcedureWorkspace(instance, actor),
    canSupplement: canSupplementProcedureInstance(instance, actor),
  };
}

export interface FinanceStepActorCheck {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly viaDelegation?: boolean;
  readonly viaEscalation?: boolean;
}

/**
 * Người này có được ghi sổ / trả hồ sơ ở bước Tài chính không — đúng luật dùng cho
 * mọi bước khác: khớp phân công R (chức danh, đơn vị qua trưởng đơn vị, leo thang)
 * hoặc được uỷ quyền vai R cho bước này. Gọi vào lúc người đó thao tác, với chức
 * danh hiện tại của họ, nên người vừa bổ nhiệm được, người vừa chuyển đi thì không.
 */
export function evaluateFinanceStepActor(
  instance: ProcedureInstance,
  stepInstanceId: string,
  activation: number,
  actor: ProcedureActor,
): FinanceStepActorCheck {
  if (instance.status !== 'running') return { allowed: false, reason: 'Hồ sơ đã kết thúc.' };
  const step = instance.steps.find((candidate) => candidate.id === stepInstanceId);
  if (!step || !step.integration || step.integration.module !== 'finance') {
    return { allowed: false, reason: 'Không phải bước Tài chính của hồ sơ.' };
  }
  if (instance.currentStepId !== step.id || !isFinanceStepWaiting(step)) {
    return { allowed: false, reason: 'Bước Tài chính không còn ở lượt xử lý.' };
  }
  if (step.financeVoucher?.activation !== activation) {
    return { allowed: false, reason: 'Yêu cầu thuộc một lần kích hoạt cũ của bước.' };
  }
  let escalated = false;
  const direct = step.assignments.some((assignment) => {
    if (assignment.role !== 'R' || !matchesProcedureAssignment(assignment, actor)) return false;
    escalated = escalated || matchesByEscalation(assignment, actor);
    return true;
  });
  if (direct) return { allowed: true, ...(escalated ? { viaEscalation: true } : {}) };
  const delegated = (instance.delegations ?? []).some(
    (delegation) =>
      delegation.delegatedTo === actor.userId &&
      (!delegation.stepInstanceId || delegation.stepInstanceId === step.id) &&
      delegation.roles.includes('R'),
  );
  if (delegated) return { allowed: true, viaDelegation: true };
  return { allowed: false, reason: 'Người này không phụ trách bước Tài chính của hồ sơ.' };
}
