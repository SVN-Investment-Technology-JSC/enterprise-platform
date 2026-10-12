import {
  PROCEDURE_INSTANCE_ADJUSTMENT_REQUESTED,
  PROCEDURE_INSTANCE_REVERSED,
  type ProcedureInstance,
  type ProcedureInstanceReversedPayload,
} from '@enterprise-platform/contracts-procedure-engine';
import { resolveFinalActorId } from '../domain/procedure-progress.js';

export interface ProcedureNotificationEvent {
  readonly type:
    | 'procedure.assignment.created'
    | 'procedure.instance.completed'
    | typeof PROCEDURE_INSTANCE_REVERSED
    | typeof PROCEDURE_INSTANCE_ADJUSTMENT_REQUESTED;
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

/**
 * Các vai đang đến lượt ở bước hiện tại mà KHÔNG phải gán thẳng cho người (đơn vị, chức danh).
 * Worker giải chúng thành người dùng bằng sơ đồ tổ chức; module này không đọc được sơ đồ.
 *
 * Bỏ vai S: gán S cho đơn vị nghĩa là "ai trong đơn vị cũng khởi tạo được hồ sơ", còn người nộp đơn
 * đã chính là người khởi tạo. Báo cho cả đơn vị mỗi khi có đơn mới chỉ là thông báo thừa.
 */
export function procedureStepOrganizationAssignments(
  instance: ProcedureInstance,
): readonly { subjectType: string; subjectId: string; role: string }[] {
  const step = instance.steps.find((candidate) => candidate.id === instance.currentStepId);
  if (!step) return [];
  return step.assignments
    .filter(
      (assignment) =>
        assignment.subjectType !== 'user' &&
        assignment.role !== 'S' &&
        (!step.currentRoleStage || assignment.role === step.currentRoleStage),
    )
    .map((assignment) => ({
      subjectType: assignment.subjectType,
      subjectId: assignment.subjectId,
      role: assignment.role,
    }));
}

/** Đường mở form tạo đơn điền sẵn từ hồ sơ bị huỷ hiệu lực. */
export function adjustmentLaunchUrl(instanceId: string): string {
  return `/modules/procedure?adjustFrom=${encodeURIComponent(instanceId)}#workspace`;
}

/**
 * Người giữ vai S ở mọi bước của hồ sơ — những người được lập hồ sơ điều chỉnh.
 * Gán thẳng cho người thì trả id người; gán cho đơn vị/chức danh thì để worker
 * giải bằng sơ đồ tổ chức (module này không đọc được sơ đồ).
 */
function submitters(instance: ProcedureInstance) {
  const userIds = new Set<string>();
  const assignments: { subjectType: string; subjectId: string; role: string }[] = [];
  for (const step of instance.steps) {
    for (const assignment of step.assignments) {
      if (assignment.role !== 'S') continue;
      if (assignment.subjectType === 'user') userIds.add(assignment.subjectId);
      else
        assignments.push({
          subjectType: assignment.subjectType,
          subjectId: assignment.subjectId,
          role: 'S',
        });
    }
  }
  return { userIds: [...userIds], assignments };
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
      const assignments = procedureStepOrganizationAssignments(instance);
      if (step && (assigneeUserIds.length > 0 || assignments.length > 0)) {
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
            assignments,
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

    // Huỷ hiệu lực: module liên kết tự hoàn tác; người khởi tạo và người theo dõi được báo.
    if (prior?.status === 'completed' && instance.status === 'reversed' && instance.reversal) {
      const workItemId =
        instance.workspaceLink?.workItemId ??
        (instance.sourceType === 'workspace_work_item' ? instance.sourceId : undefined);
      const reversed: ProcedureInstanceReversedPayload = {
        instanceId: instance.id,
        instanceCode: instance.code,
        title: instance.title,
        definitionId: instance.definitionId,
        sourceType: instance.sourceType,
        sourceId: instance.sourceId,
        workItemId,
        projectId: instance.workspaceLink?.projectId,
        reason: instance.reversal.reason,
        reversedBy: instance.reversal.reversedBy,
        reversedByName: instance.reversal.reversedByName,
        adjustmentRequested: instance.reversal.adjustmentRequested,
      };
      events.push({
        type: PROCEDURE_INSTANCE_REVERSED,
        aggregateType: 'procedure-instance',
        aggregateId: instance.id,
        payload: {
          ...reversed,
          requesterUserId: instance.initiatedBy,
          recipientUserIds: instance.observerIds ?? [],
          actorUserId: instance.reversal.reversedBy,
        },
      });
      // Đơn HRM: HRM tự báo người gửi đơn kèm form đơn mới điền sẵn (đơn là của
      // HRM); Quy trình không mở hồ sơ điều chỉnh thay cho đơn.
      if (instance.reversal.adjustmentRequested && instance.sourceType !== 'hrm_request') {
        const s = submitters(instance);
        events.push({
          type: PROCEDURE_INSTANCE_ADJUSTMENT_REQUESTED,
          aggregateType: 'procedure-instance',
          aggregateId: instance.id,
          payload: {
            instanceId: instance.id,
            instanceCode: instance.code,
            title: `Cần lập hồ sơ điều chỉnh cho ${instance.code} · ${instance.title}`,
            definitionId: instance.definitionId,
            reason: instance.reversal.reason,
            assigneeUserIds: s.userIds,
            assignments: s.assignments,
            launchUrl: adjustmentLaunchUrl(instance.id),
            actorUserId: instance.reversal.reversedBy,
          },
        });
      }
    }
  }
  return events;
}
