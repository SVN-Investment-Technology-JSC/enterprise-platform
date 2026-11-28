import {
  PROCEDURE_INSTANCE_ADJUSTMENT_REQUESTED,
  PROCEDURE_INSTANCE_REVERSED,
  type ProcedureInstance,
  type ProcedureInstanceReversedPayload,
} from '@enterprise-platform/contracts-procedure-engine';
import { MAX_MENTION_RECIPIENTS } from '../domain/procedure-mentions.js';
import { resolveFinalActorId } from '../domain/procedure-progress.js';

export interface ProcedureNotificationEvent {
  readonly type:
    | 'procedure.assignment.created'
    | 'procedure.step.processed'
    | 'procedure.instance.completed'
    | 'procedure.mention.created'
    | typeof PROCEDURE_INSTANCE_RELINKED
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

/**
 * Thông báo "bạn được nhắc" cho từng trao đổi MỚI có nhắc tên người.
 *
 * Chỉ nhìn các mục `comment` chưa có ở bản trước, nên sửa/ghi lại hồ sơ không báo lại những lần nhắc cũ.
 * Không báo cho chính người gửi. `mentions` là id người dùng (giao diện đã mở rộng chức danh/đơn vị
 * thành từng người), nên không cần giải sơ đồ tổ chức ở đây.
 */
export function procedureMentionEvents(
  prior: ProcedureInstance | undefined,
  instance: ProcedureInstance,
): readonly ProcedureNotificationEvent[] {
  const known = new Set((prior?.activity ?? []).map((entry) => entry.id));
  const events: ProcedureNotificationEvent[] = [];
  for (const entry of instance.activity) {
    if (known.has(entry.id) || entry.action !== 'comment' || !entry.mentions?.length) continue;
    const recipients = [...new Set(entry.mentions)]
      .filter((userId) => userId && userId !== entry.actorId)
      .slice(0, MAX_MENTION_RECIPIENTS);
    if (recipients.length === 0) continue;
    const body = (entry.comment ?? '').replace(/\s+/g, ' ').trim();
    events.push({
      type: 'procedure.mention.created',
      aggregateType: 'procedure-instance',
      aggregateId: instance.id,
      payload: {
        mentionId: entry.id,
        threadId: instance.id,
        instanceId: instance.id,
        instanceCode: instance.code,
        mentionedUserIds: recipients,
        actorUserId: entry.actorId,
        // Kèm tên người gửi và mã hồ sơ: thông báo là thứ duy nhất người được nhắc nhìn thấy trước khi mở.
        excerpt: `${entry.actorName} · ${instance.code}: ${body}`.slice(0, 160),
        deepLink: `/procedures/instances/${instance.id}`,
        sourceType: 'procedure_comment',
      },
    });
  }
  return events;
}

/**
 * Người tạo hồ sơ: người khởi tạo và, khi có người tạo hộ, cả người tạo hộ. Hai bên đều là "người tạo quy trình" nên đều
 * muốn biết hồ sơ của mình đã đi tới đâu.
 */
function creatorUserIds(instance: ProcedureInstance): readonly string[] {
  return [...new Set([instance.initiatedBy, instance.createdOnBehalfBy?.userId].filter((id): id is string => Boolean(id)))];
}

/** Những thao tác xử lý đáng báo người tạo hồ sơ (trao đổi không tính). */
const PROCESSING_ACTIONS: readonly string[] = ['complete', 'approve', 'return', 'withdraw'];

/**
 * Báo người tạo hồ sơ MỖI LẦN hồ sơ ĐANG CHẠY được xử lý ở một bước: người này duyệt hay xác nhận, trả lại, hoặc hoàn
 * duyệt. Xong một pha trong bước (vd Kế toán kiểm tra xong, chờ Kế toán trưởng duyệt) cũng báo, không chỉ khi cả bước xong.
 *
 * - Căn cứ vào các mục nhật ký MỚI so với bản trước, nên một lần lưu có nhiều thao tác thì báo từng thao tác và lưu lại
 *   hồ sơ không đổi gì thì không báo lại.
 * - Thao tác làm hồ sơ kết thúc (bước cuối, từ chối, huỷ) đã có thông báo "Quy trình đã kết thúc" riêng: bỏ qua ở đây.
 * - Người tạo chính là người vừa thao tác thì không tự báo cho mình.
 * - Hồ sơ vừa đến lượt một vai mới (sang bước mới, hay sang pha kế trong cùng bước) mà người tạo là người giữ vai đó thì
 *   họ đã nhận "Đến lượt bạn xử lý": không báo trùng.
 */
export function procedureStepProcessedEvents(
  prior: ProcedureInstance | undefined,
  instance: ProcedureInstance,
): readonly ProcedureNotificationEvent[] {
  if (!prior || prior.status !== 'running' || instance.status !== 'running') return [];
  const known = new Set(prior.activity.map((entry) => entry.id));
  const fresh = instance.activity
    .filter((entry) => !known.has(entry.id) && PROCESSING_ACTIONS.includes(entry.action))
    .reverse();
  if (fresh.length === 0) return [];

  const creators = creatorUserIds(instance);
  // Tới lượt vai mới (sang bước mới, hay sang vai kế trong cùng bước) thì người giữ vai đó đã nhận thông báo giao việc.
  const nextAssignees = turnChanged(prior, instance) ? new Set(procedureStepRecipientUserIds(instance)) : new Set<string>();
  const priorStatus = new Map(prior.steps.map((step) => [step.id, step.status]));
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const events: ProcedureNotificationEvent[] = [];
  for (const entry of fresh) {
    const recipients = creators.filter((userId) => userId !== entry.actorId && !nextAssignees.has(userId));
    if (recipients.length === 0) continue;
    const step = instance.steps.find((candidate) => candidate.id === entry.stepInstanceId);
    if (!step) continue;
    const kind =
      entry.action === 'return'
        ? 'return'
        : entry.action === 'withdraw'
          ? 'withdraw'
          : step.status === 'completed' && priorStatus.get(step.id) !== 'completed'
            ? 'step'
            : 'stage';
    const waitingStage = current?.currentRoleStage;
    events.push({
      type: 'procedure.step.processed',
      aggregateType: 'procedure-instance',
      aggregateId: instance.id,
      payload: {
        instanceId: instance.id,
        instanceCode: instance.code,
        title: instance.title,
        kind,
        stepInstanceId: step.id,
        stepName: step.name,
        // Bước hồ sơ đang ở sau thao tác này: bước kế tiếp (xong bước), bước được trả về, hay chính bước này.
        ...(current ? { currentStepName: current.name } : {}),
        ...(kind === 'stage' ? { waiting: waitingStage === 'A' || waitingStage === 'C' ? 'duyệt' : 'thực hiện' } : {}),
        actorName: entry.actorName,
        recipientUserIds: recipients,
        actorUserId: entry.actorId,
      },
    });
  }
  return events;
}

/** Hồ sơ vừa được đổi sang dự án / công việc khác (Workspace đã tạo xong công việc mới). */
export const PROCEDURE_INSTANCE_RELINKED = 'procedure.instance.relinked';

/**
 * Báo người tạo hồ sơ (và người tạo hộ) khi hồ sơ được đổi dự án / công việc liên kết: liên kết đang chờ đổi
 * (`replacesWorkItemId`) vừa thành `linked`. Báo lúc Workspace đã đổi xong chứ không phải lúc gửi yêu cầu, để bị
 * từ chối thì không có thông báo sai. Không báo cho chính người đổi.
 */
export function procedureRelinkedEvents(
  prior: ProcedureInstance | undefined,
  instance: ProcedureInstance,
): readonly ProcedureNotificationEvent[] {
  const requested = prior?.workspaceLink;
  const link = instance.workspaceLink;
  if (requested?.status !== 'pending' || !requested.replacesWorkItemId || link?.status !== 'linked') return [];
  const actorId = requested.requestedBy;
  const recipients = creatorUserIds(instance).filter((userId) => userId !== actorId);
  if (recipients.length === 0) return [];
  const request = instance.activity.find((entry) => entry.action === 'relink' && entry.actorId === actorId);
  return [
    {
      type: PROCEDURE_INSTANCE_RELINKED,
      aggregateType: 'procedure-instance',
      aggregateId: instance.id,
      payload: {
        instanceId: instance.id,
        instanceCode: instance.code,
        title: instance.title,
        projectId: link.projectId,
        projectCode: link.projectCode,
        ...(link.projectName ? { projectName: link.projectName } : {}),
        ...(link.workItemCode ? { workItemCode: link.workItemCode } : {}),
        ...(request?.actorName ? { actorName: request.actorName } : {}),
        recipientUserIds: recipients,
        actorUserId: actorId,
      },
    },
  ];
}

/** Vai đang đến lượt ở bước hiện tại; vắng khi hồ sơ không có bước đang chạy. */
function currentStage(instance: ProcedureInstance): string | undefined {
  return instance.steps.find((step) => step.id === instance.currentStepId)?.currentRoleStage ?? undefined;
}

/**
 * Hồ sơ vừa đến lượt một vai mới: sang bước khác, hoặc vẫn bước đó nhưng sang vai kế tiếp (vd Kế toán kiểm tra (R) xong
 * thì tới Kế toán trưởng duyệt (A)), hoặc bị trả / hoàn duyệt về đúng vai trước trong cùng bước.
 */
function turnChanged(prior: ProcedureInstance | undefined, instance: ProcedureInstance): boolean {
  if (!prior) return true;
  return prior.currentStepId !== instance.currentStepId || currentStage(prior) !== currentStage(instance);
}

export function procedureNotificationEvents(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): readonly ProcedureNotificationEvent[] {
  const previous = new Map(before.map((instance) => [instance.id, instance]));
  const events: ProcedureNotificationEvent[] = [];
  for (const instance of after) {
    const prior = previous.get(instance.id);
    events.push(...procedureMentionEvents(prior, instance));
    events.push(...procedureStepProcessedEvents(prior, instance));
    events.push(...procedureRelinkedEvents(prior, instance));
    // Báo người giữ vai đang đến lượt mỗi khi tới lượt vai mới, kể cả đổi vai trong cùng một bước.
    if (instance.status === 'running' && instance.currentStepId && turnChanged(prior, instance)) {
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
          // Hồ sơ bị thay do "Đổi quy trình": công việc được giữ, bên nhận không áp kết quả huỷ lên công việc.
          ...(instance.replacedByInstanceId ?? instance.deletion?.replacedByInstanceId
            ? { replacedByInstanceId: instance.replacedByInstanceId ?? instance.deletion?.replacedByInstanceId }
            : {}),
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
