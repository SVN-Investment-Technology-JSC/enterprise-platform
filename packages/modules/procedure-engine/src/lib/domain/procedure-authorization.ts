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
  isOverride: boolean;
  organizationUnitIds: readonly string[];
  positionIds: readonly string[];
}

export function matchesProcedureAssignment(
  assignment: ProcedureRaciAssignment,
  actor: ProcedureActor,
): boolean {
  if (assignment.subjectType === 'user') return assignment.subjectId === actor.userId;
  if (assignment.subjectType === 'organization_unit') return actor.organizationUnitIds.includes(assignment.subjectId);
  return actor.positionIds.includes(assignment.subjectId);
}

export function runtimeStages(
  assignments: ProcedureRaciAssignment[],
): ProcedureRaciRole[] {
  return PROCEDURE_STAGE_ORDER.filter((role) =>
    assignments.some((assignment) => assignment.role === role),
  );
}

export interface EscalationContext {
  // Org hierarchy for escalation (manager lookup)
  readonly orgChart: Map<string, string>; // unitId -> managerId (organizationUnitId)
}

export interface EscalationResult {
  /** Assignment rewritten to point at the manager unit. */
  readonly assignment: ProcedureRaciAssignment;
  /** Unit the assignment originally pointed at, for the audit trail. */
  readonly originalSubjectId: string;
}

export function findEscalationTarget(
  assignment: ProcedureRaciAssignment,
  context?: EscalationContext,
): EscalationResult | null {
  // Escalation: if role holder unavailable, find manager in org hierarchy.
  // Escalation metadata is not carried on the assignment itself — the contract
  // has no such field, and the durable record belongs in actions.metadata /
  // activity_logs. Callers pass originalSubjectId through to those.
  if (!context?.orgChart || assignment.subjectType !== 'organization_unit') {
    return null; // Escalation only works for org units
  }

  const managerId = context.orgChart.get(assignment.subjectId);
  if (!managerId) {
    return null; // No manager found (top of hierarchy)
  }

  return {
    assignment: { ...assignment, subjectId: managerId },
    originalSubjectId: assignment.subjectId,
  };
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
  for (const assignment of current?.assignments ?? []) {
    if (matchesProcedureAssignment(assignment, actor)) {
      matchingRoles.add(assignment.role);
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
  };
}
