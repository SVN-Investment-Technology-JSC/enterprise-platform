import { Injectable } from '@nestjs/common';
import type {
  ExecuteTaskActionDto,
  TaskActionResultDto,
  TaskActionType,
  TaskPageResult,
  TaskQueryOptions,
  TaskStatus,
  UniversalApprovalProvider,
  UniversalTaskDto,
} from '@enterprise-platform/contracts-task-approval';
import { parseTaskId } from '@enterprise-platform/contracts-task-approval';
import type {
  ProcedureInstance,
  ProcedureRuntimeAction,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';

export function mapProcedureInstanceToTaskDto(
  instance: ProcedureInstance,
  tenantId: string,
): UniversalTaskDto {
  const currentStep = instance.steps?.find((s) => s.id === instance.currentStepId);
  const isRunning = instance.status === 'running';
  const rawActions = instance.authorization?.availableActions ?? [];
  const canAct = isRunning && rawActions.some((a) => a !== 'comment');

  // Chuyển đổi các hành động được phép
  const availableActions: TaskActionType[] = [];
  if (canAct) {
    if (rawActions.includes('approve') || rawActions.includes('complete')) {
      availableActions.push('APPROVE');
    }
    if (rawActions.includes('reject')) {
      availableActions.push('REJECT');
    }
    if (rawActions.includes('return')) {
      availableActions.push('RETURN');
    }
  }

  // Giải quyết trạng thái chuẩn: nếu đã hoàn thành/từ chối/huỷ thì availableActions = []
  let status: TaskStatus = 'PENDING';
  if (instance.status === 'completed') {
    status = 'APPROVED';
  } else if (
    instance.status === 'rejected' ||
    instance.status === 'cancelled' ||
    instance.status === 'reversed'
  ) {
    status = 'REJECTED';
  } else if (!canAct) {
    status = 'APPROVED';
  }

  const requesterName =
    instance.createdOnBehalfBy?.name ??
    instance.managerName ??
    instance.initiatedBy;

  const timelineSteps = (instance.steps ?? []).map((step, idx) => {
    let stepStatus: 'COMPLETED' | 'CURRENT' | 'WAITING' | 'REJECTED' = 'WAITING';
    if (step.status === 'completed') {
      stepStatus = 'COMPLETED';
    } else if (step.status === 'active' || step.status === 'ready' || step.id === instance.currentStepId) {
      stepStatus = 'CURRENT';
    } else if (step.status === 'rejected') {
      stepStatus = 'REJECTED';
    }

    const stepActivity = (instance.activity ?? []).find(
      (act) =>
        act.stepInstanceId === step.id &&
        (act.action === 'approve' ||
          act.action === 'complete' ||
          act.action === 'reject' ||
          act.action === 'return'),
    );

    return {
      stepId: step.id,
      stepName: step.name,
      status: stepStatus,
      actedAt: step.completedAt,
      assigneeName: stepActivity?.actorName,
      comment: stepActivity?.comment,
    };
  });

  return {
    taskId: `procedure:${instance.id}`,
    tenantId,
    sourceModule: 'procedure',
    entityType: 'PROCEDURE_INSTANCE',
    entityId: instance.id,
    title: instance.title,
    code: instance.code,
    requester: {
      userId: instance.initiatedBy,
      fullName: requesterName,
    },
    createdOnBehalf: Boolean(instance.createdOnBehalfBy),
    submitter: instance.createdOnBehalfBy
      ? {
          userId: instance.createdOnBehalfBy.userId,
          fullName: instance.createdOnBehalfBy.name,
        }
      : undefined,
    createdAt: instance.startedAt,
    priority: 'NORMAL',
    approvalMode: 'WORKFLOW',
    approvalOwner: 'procedure',
    workflowInstanceId: instance.id,
    stepId: instance.currentStepId,
    status,
    availableActions,
    detailUrl: `/modules/procedure#workspace/${encodeURIComponent(instance.id)}`,
    blocks: {
      summary: {
        badgeLabel:
          instance.status === 'running'
            ? 'Đang chờ xử lý'
            : instance.status === 'completed'
            ? 'Đã hoàn thành'
            : instance.status === 'reversed'
            ? 'Đã huỷ hiệu lực'
            : instance.status === 'cancelled'
            ? 'Đã huỷ'
            : 'Đã từ chối',
        badgeTone:
          instance.status === 'running'
            ? 'warning'
            : instance.status === 'completed'
            ? 'success'
            : 'danger',
        items: [
          { label: 'Quy trình', value: instance.definitionName || '—' },
          { label: 'Bước hiện tại', value: currentStep?.name || '—' },
          { label: 'Mã hồ sơ', value: instance.code },
          ...(instance.assetCode
            ? [{ label: 'Thiết bị / Tài sản', value: instance.assetCode }]
            : []),
          ...(instance.managerName
            ? [{ label: 'Người quản lý', value: instance.managerName }]
            : []),
        ],
      },
      attributes: {
        items: [
          { key: 'definitionName', label: 'Tên quy trình', value: instance.definitionName || '—' },
          { key: 'code', label: 'Mã hồ sơ', value: instance.code },
          ...(instance.startDueAt
            ? [{ key: 'startDueAt', label: 'Thời gian bắt đầu KH', value: instance.startDueAt }]
            : []),
          ...(instance.endDueAt
            ? [{ key: 'endDueAt', label: 'Thời hạn hoàn thành', value: instance.endDueAt }]
            : []),
        ],
      },
      timeline: {
        steps: timelineSteps,
      },
    },
  };
}

@Injectable()
export class ProcedureTaskApprovalService implements UniversalApprovalProvider {
  constructor(private readonly procedures: ProcedureEngineApplication) {}

  async getPendingTasks(
    tenantId: string,
    actorId: string,
    options?: TaskQueryOptions,
    actor?: ProcedureActor,
  ): Promise<TaskPageResult> {
    if (!actor) {
      throw new ProcedureEngineError('forbidden', 'Thiếu ngữ cảnh người dùng Procedure.');
    }

    const workspace = await this.procedures.getWorkspace(actor);
    const actionable = (workspace?.instances ?? []).filter(
      (item) =>
        item.status === 'running' &&
        item.authorization?.availableActions?.some((action) => action !== 'comment'),
    );

    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    const paged = actionable.slice(offset, offset + limit);

    return {
      items: paged.map((item) => mapProcedureInstanceToTaskDto(item, tenantId)),
      total: actionable.length,
      limit,
      offset,
    };
  }

  async getTaskDetail(
    tenantId: string,
    actorId: string,
    taskId: string,
    actor?: ProcedureActor,
  ): Promise<UniversalTaskDto> {
    if (!actor) {
      throw new ProcedureEngineError('forbidden', 'Thiếu ngữ cảnh người dùng Procedure.');
    }

    const instanceId = parseTaskId(taskId).entityId;
    const instance = await this.procedures.getInstance(actor, instanceId);
    return mapProcedureInstanceToTaskDto(instance, tenantId);
  }

  async executeAction(
    tenantId: string,
    actorId: string,
    taskId: string,
    dto: ExecuteTaskActionDto,
    actor?: ProcedureActor,
  ): Promise<TaskActionResultDto> {
    if (!actor) {
      throw new ProcedureEngineError('forbidden', 'Thiếu ngữ cảnh người dùng Procedure.');
    }

    const instanceId = parseTaskId(taskId).entityId;
    const instance = await this.procedures.getInstance(actor, instanceId);

    if (instance.status !== 'running') {
      throw new ProcedureEngineError(
        'conflict',
        `Hồ sơ đã ở trạng thái ${instance.status}, không thể thực hiện thêm thao tác.`,
      );
    }

    const available = instance.authorization?.availableActions ?? [];

    if (dto.action === 'REJECT' || dto.action === 'RETURN') {
      if (!dto.reason || !dto.reason.trim()) {
        throw new ProcedureEngineError(
          'validation',
          dto.action === 'REJECT'
            ? 'Bắt buộc nhập lý do từ chối hồ sơ.'
            : 'Bắt buộc nhập lý do yêu cầu làm lại hồ sơ.',
        );
      }
    }

    let runtimeAction: ProcedureRuntimeAction;
    if (dto.action === 'APPROVE') {
      if (available.includes('approve')) {
        runtimeAction = 'approve';
      } else if (available.includes('complete')) {
        runtimeAction = 'complete';
      } else {
        throw new ProcedureEngineError('forbidden', 'Bạn không có quyền phê duyệt bước này.');
      }
    } else if (dto.action === 'REJECT') {
      if (!available.includes('reject')) {
        throw new ProcedureEngineError('forbidden', 'Bạn không có quyền từ chối bước này.');
      }
      runtimeAction = 'reject';
    } else if (dto.action === 'RETURN') {
      if (!available.includes('return')) {
        throw new ProcedureEngineError('forbidden', 'Bạn không có quyền yêu cầu làm lại bước này.');
      }
      runtimeAction = 'return';
    } else {
      throw new ProcedureEngineError('validation', `Hành động không hợp lệ: ${dto.action}`);
    }

    const idempotencyKey =
      dto.idempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `pe-action-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

    const comment = dto.reason?.trim() || (dto as any).comment?.trim() || undefined;

    await this.procedures.applyAction(actor, instanceId, {
      action: runtimeAction,
      comment,
      idempotencyKey,
    });

    const newStatus: TaskStatus =
      dto.action === 'APPROVE' ? 'APPROVED' : dto.action === 'REJECT' ? 'REJECTED' : 'RETURNED';

    return {
      success: true,
      taskId: `procedure:${instance.id}`,
      action: dto.action,
      newStatus,
      completedAt: new Date().toISOString(),
      message:
        dto.action === 'APPROVE'
          ? 'Phê duyệt hồ sơ thành công.'
          : dto.action === 'REJECT'
          ? 'Đã từ chối hồ sơ quy trình.'
          : 'Đã yêu cầu làm lại hồ sơ quy trình.',
    };
  }
}
