import {
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
  WORK_ITEM_PROCEDURE_REQUESTED,
  WORK_ITEM_START_REJECTED_EVENT,
  type WorkItemProcedureLinkedPayload,
  type WorkItemProcedureLinkRejectedPayload,
  type WorkItemProcedureRequestedPayload,
} from '../domain/procedure-workspace-link.js';
import type { ProcedureEngineApplication } from './procedure-engine.application.js';

/** Sự kiện từ module Workspace mà Quy trình xử lý. */
export const PROCEDURE_WORKSPACE_EVENT_TYPES = [
  WORK_ITEM_PROCEDURE_REQUESTED,
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
] as const;

/** Phát một sự kiện tích hợp qua outbox của Quy trình. */
export type ProcedureIntegrationEmitter = (
  tenantId: string,
  input: { type: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
) => Promise<void>;

/**
 * Xử lý sự kiện của Workspace bên phía Quy trình.
 *
 * Mở hồ sơ đi qua đúng ứng dụng Quy trình với danh nghĩa người tạo công việc
 * (kiểm vai S như khi họ tự bấm). Lỗi nghiệp vụ báo lại Workspace bằng sự
 * kiện; lỗi hạ tầng ném ra để worker xử lý lại sự kiện.
 */
export class ProcedureWorkspaceEvents {
  constructor(
    private readonly procedures: ProcedureEngineApplication,
    private readonly emit: ProcedureIntegrationEmitter,
  ) {}

  async handle(tenantId: string, type: string, payload: unknown): Promise<void> {
    if (type === WORK_ITEM_PROCEDURE_REQUESTED) {
      const request = payload as WorkItemProcedureRequestedPayload;
      const outcome = await this.procedures.startForWorkspaceWorkItem(tenantId, request);
      // Mở được thì sự kiện "đã mở" được store phát cùng transaction tạo hồ sơ.
      if (!outcome.ok) {
        await this.emit(tenantId, {
          type: WORK_ITEM_START_REJECTED_EVENT,
          aggregateType: 'workspace-work-item',
          aggregateId: request.workItemId,
          payload: { workItemId: request.workItemId, reason: outcome.reason },
        });
      }
    } else if (type === WORK_ITEM_PROCEDURE_LINKED) {
      const linked = payload as WorkItemProcedureLinkedPayload;
      await this.procedures.applyWorkspaceLinkResult(tenantId, {
        instanceId: linked.instanceId,
        linked: {
          workItemId: linked.workItemId,
          workItemCode: linked.workItemCode,
          projectCode: linked.projectCode,
        },
      });
    } else if (type === WORK_ITEM_PROCEDURE_LINK_REJECTED) {
      const rejected = payload as WorkItemProcedureLinkRejectedPayload;
      await this.procedures.applyWorkspaceLinkResult(tenantId, {
        instanceId: rejected.instanceId,
        rejected: rejected.reason,
      });
    }
  }
}
