import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { resolveFinalActorId } from '../domain/procedure-progress.js';

export interface ProcedureNotificationEvent {
  readonly type: 'procedure.assignment.created' | 'procedure.instance.completed';
  readonly aggregateType: 'procedure-instance';
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function procedureStepRecipientUserIds(
  instance: ProcedureInstance,
): readonly string[] {
  const step = instance.steps.find((candidate) => candidate.id === instance.currentStepId);
  if (!step) return [];
  const fixed = step.assignments
    .filter(
      (assignment) =>
        assignment.subjectType === 'user' &&
        (!step.currentRoleStage || assignment.role === step.currentRoleStage),
    )
    .map((assignment) => assignment.subjectId);
  const resolved = (step.resolutions ?? [])
    .filter((resolution) => resolution.resolvedTo.subjectType === 'user')
    .map((resolution) => resolution.resolvedTo.subjectId);
  return [...new Set([...fixed, ...resolved])];
}

export function procedureNotificationEvents(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): readonly ProcedureNotificationEvent[] {
  const previous = new Map(before.map((instance) => [instance.id, instance]));
  const events: ProcedureNotificationEvent[] = [];
  for (const instance of after) {
    const prior = previous.get(instance.id);
    if (
      instance.status === 'running' &&
      instance.currentStepId &&
      prior?.currentStepId !== instance.currentStepId
    ) {
      const step = instance.steps.find(
        (candidate) => candidate.id === instance.currentStepId,
      );
      const assigneeUserIds = procedureStepRecipientUserIds(instance);
      if (step && assigneeUserIds.length > 0) {
        events.push({
          type: 'procedure.assignment.created',
          aggregateType: 'procedure-instance',
          aggregateId: instance.id,
          payload: {
            instanceId: instance.id,
            instanceCode: instance.code,
            stepInstanceId: step.id,
            title: `${instance.title} · ${step.name}`,
            assigneeUserIds,
            actorUserId: instance.activity[0]?.actorId,
            slaDueAt: step.slaDueAt,
          },
        });
      }
    }

    if (prior?.status === 'running' && instance.status !== 'running') {
      events.push({
        type: 'procedure.instance.completed',
        aggregateType: 'procedure-instance',
        aggregateId: instance.id,
        payload: {
          instanceId: instance.id,
          instanceCode: instance.code,
          title: instance.title,
          status: instance.status,
          requesterUserId: instance.initiatedBy,
          recipientUserIds: instance.observerIds ?? [],
          sourceType: instance.sourceType,
          sourceId: instance.sourceId,
          completedAt: instance.completedAt,
          actorId: resolveFinalActorId(instance),
        },
      });
    }
  }
  return events;
}
