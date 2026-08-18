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
    if (actor.organizationUnitIds.includes(assignment.subjectId)) return true;
    // Escalation: the assigned unit has no head, so its nearest headed ancestor
    // answers for it.
    if (!actor.orgUnits) return false;
    const escalated = resolveEscalatedUnitId(assignment.subjectId, actor.orgUnits);
    return escalated !== assignment.subjectId && actor.organizationUnitIds.includes(escalated);
  }
  return actor.positionIds.includes(assignment.subjectId);
}

/** True when the actor only matches because responsibility escalated to them. */
export function matchesByEscalation(
  assignment: ProcedureRaciAssignment,
  actor: ProcedureActor,
): boolean {
  if (assignment.subjectType !== 'organization_unit' || !actor.orgUnits) return false;
  if (actor.organizationUnitIds.includes(assignment.subjectId)) return false;
  const escalated = resolveEscalatedUnitId(assignment.subjectId, actor.orgUnits);
  return escalated !== assignment.subjectId && actor.organizationUnitIds.includes(escalated);
}

export function runtimeStages(
  assignments: ProcedureRaciAssignment[],
): ProcedureRaciRole[] {
  return PROCEDURE_STAGE_ORDER.filter((role) =>
    assignments.some((assignment) => assignment.role === role),
  );
}

export interface DelegationRecord {
  readonly fromActorId: string;
  readonly toActorId: string;
  readonly role: ProcedureRaciRole;
  readonly reason?: string;
  readonly delegatedAt: string;
}

// Delegation tracking: activity_logs and actions.metadata store delegation details
// When user with R/A/C delegates to another user, record:
// - action: 'approve' | 'complete' with delegatedTo in metadata
// - activityLog.summary: "Delegated approval to [user] - [reason]"
// This enables audit trail and future notification routing
export function buildDelegationMetadata(
  fromActorId: string,
  toActorId: string,
  reason?: string,
): Record<string, unknown> {
  return {
    delegated: true,
    fromActorId,
    toActorId,
    reason: reason ?? 'Manual delegation',
    delegatedAt: new Date().toISOString(),
  };
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

  return {
    myRoles,
    currentRoleStage: stage,
    availableActions: [...actions],
    canManageSubtasks:
      actor.isOverride || (stage === 'E' && myRoles.includes('E')),
    isOverride: actor.isOverride,
    isEscalated: escalated,
  };
}
