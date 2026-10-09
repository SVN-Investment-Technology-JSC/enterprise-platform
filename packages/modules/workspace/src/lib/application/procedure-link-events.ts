import {
  PROCEDURE_INSTANCE_REVERSED,
  PROCEDURE_STARTED_FOR_WORK_ITEM,
  PROCEDURE_WORK_ITEM_START_REJECTED,
  PROCEDURE_WORKSPACE_LINK_REQUESTED,
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
  type ProcedureInstanceReversedPayload,
  type ProcedureLinkRequestedPayload,
  type ProcedureStartedForWorkItemPayload,
  type ProcedureWorkItemStartRejectedPayload,
} from '../domain/workspace-procedure-link.js';
import { WorkspaceError, WorkspaceSchemaNotReadyError } from '../domain/workspace.error.js';
import type { FinanceService } from './finance.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';
import type { WorkItemService } from './work-item.service.js';

/** Sự kiện từ module Quy trình mà Workspace xử lý. */
export const WORKSPACE_PROCEDURE_EVENT_TYPES = [
  PROCEDURE_WORKSPACE_LINK_REQUESTED,
  PROCEDURE_STARTED_FOR_WORK_ITEM,
  PROCEDURE_WORK_ITEM_START_REJECTED,
  PROCEDURE_INSTANCE_REVERSED,
] as const;

/**
 * Xử lý sự kiện của Quy trình bên phía Workspace.
 *
 * Mọi thao tác ghi đi qua service của chính Workspace, dưới danh nghĩa người
 * yêu cầu, nên luật vai trò dự án (thành viên mới tạo được việc, giao việc
 * người khác cần quản lý, chi phí cần quyền tài chính) giữ nguyên như khi họ
 * tự thao tác trên giao diện. Lỗi nghiệp vụ được báo lại Quy trình bằng sự
 * kiện; lỗi hạ tầng ném ra để worker xử lý lại sự kiện.
 */
export class WorkspaceProcedureEvents {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly workItems: WorkItemService,
    private readonly finance: FinanceService,
  ) {}

  async handle(tenantId: string, type: string, payload: unknown): Promise<void> {
    if (type === PROCEDURE_WORKSPACE_LINK_REQUESTED) {
      await this.onLinkRequested(tenantId, payload as ProcedureLinkRequestedPayload);
    } else if (type === PROCEDURE_STARTED_FOR_WORK_ITEM) {
      const started = payload as ProcedureStartedForWorkItemPayload;
      await this.store.procedureRequest.markStarted(tenantId, started);
    } else if (type === PROCEDURE_INSTANCE_REVERSED) {
      // Hồ sơ gắn công việc bị huỷ hiệu lực → công việc huỷ hiệu lực theo.
      const reversed = payload as ProcedureInstanceReversedPayload;
      if (!reversed.workItemId) return;
      await this.workItems.reverseForProcedure(tenantId, reversed.workItemId, {
        instanceCode: reversed.instanceCode,
        reason: reversed.reason,
        reversedBy: reversed.reversedBy,
        reversedByName: reversed.reversedByName,
        adjustmentRequested: reversed.adjustmentRequested,
      });
    } else if (type === PROCEDURE_WORK_ITEM_START_REJECTED) {
      const rejected = payload as ProcedureWorkItemStartRejectedPayload;
      await this.store.procedureRequest.markRejected(tenantId, rejected.workItemId, rejected.reason);
    }
  }

  /**
   * Hồ sơ điều chỉnh gắn dự án: công việc mới nối về công việc đã huỷ hiệu lực,
   * nếu công việc đó còn hợp lệ (cùng dự án, đã huỷ hiệu lực). Không thì bỏ
   * qua liên kết, công việc mới vẫn được tạo.
   */
  private async adjustmentTarget(
    tenantId: string,
    request: ProcedureLinkRequestedPayload,
  ): Promise<string | undefined> {
    if (!request.adjustmentOfWorkItemId) return undefined;
    const original = await this.store.workItem.findById(tenantId, request.adjustmentOfWorkItemId);
    if (!original || original.projectId !== request.projectId || !original.reversal) return undefined;
    const open = (await this.store.workItem.listByProject(tenantId, original.projectId)).some(
      (node) => node.adjustmentOfId === original.id && node.status !== 'cancelled',
    );
    return open ? undefined : original.id;
  }

  /** Hồ sơ vừa mở có gắn dự án: tạo công việc "Theo quy trình" rồi báo mã về. */
  private async onLinkRequested(tenantId: string, request: ProcedureLinkRequestedPayload): Promise<void> {
    // Sự kiện đến lại (worker xử lý lại): công việc đã có thì chỉ báo lại mã.
    const existing = await this.store.externalRef.findByExternalId(
      tenantId,
      'procedure-engine',
      request.instanceId,
    );
    if (existing) {
      const [item, project] = await Promise.all([
        this.store.workItem.findById(tenantId, existing.entityId),
        this.store.project.findById(tenantId, existing.projectId),
      ]);
      if (item && project) {
        await this.store.integration.emit(tenantId, {
          type: WORK_ITEM_PROCEDURE_LINKED,
          aggregateType: 'workspace-work-item',
          aggregateId: item.id,
          payload: {
            instanceId: request.instanceId,
            workItemId: item.id,
            workItemCode: item.code,
            projectId: project.id,
            projectCode: project.code,
          },
        });
      }
      return;
    }

    const actor: WorkspaceActor = {
      tenantId,
      userId: request.requestedBy,
      displayName: request.requestedBy,
      isTenantAdmin: request.requestedByIsTenantAdmin === true,
      canManage: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    const draft = request.workItem ?? {};
    try {
      const item = await this.workItems.create(
        actor,
        {
          projectId: request.projectId,
          title: request.title,
          description: draft.description,
          itemType: draft.itemType === 'milestone' ? 'milestone' : 'task',
          executionType: 'procedure',
          priority: draft.priority,
          assigneeUserId: draft.assigneeUserId,
          plannedStart: draft.plannedStart,
          plannedEnd: draft.plannedEnd,
          estimateHours: draft.estimateHours,
          adjustmentOfId: await this.adjustmentTarget(tenantId, request),
        },
        {
          instanceId: request.instanceId,
          instanceCode: request.instanceCode,
          instanceStatus: request.instanceStatus,
        },
      );
      if (draft.estimatedCost !== undefined) {
        // Chi phí ghi qua đúng luật tài chính; người không có quyền thì bỏ qua
        // phần chi phí, công việc và liên kết vẫn giữ.
        await this.finance
          .updateItemCost(actor, item.id, { estimatedCost: draft.estimatedCost })
          .catch((error: unknown) => {
            if (!(error instanceof WorkspaceError)) throw error;
          });
      }
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error instanceof WorkspaceSchemaNotReadyError) {
        throw error;
      }
      await this.store.integration.emit(tenantId, {
        type: WORK_ITEM_PROCEDURE_LINK_REJECTED,
        aggregateType: 'procedure-instance',
        aggregateId: request.instanceId,
        payload: { instanceId: request.instanceId, reason: error.message },
      });
    }
  }
}
