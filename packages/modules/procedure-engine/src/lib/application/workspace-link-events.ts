import {
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
  WORK_ITEM_PROCEDURE_REQUESTED,
  WORK_ITEM_REVERSED,
  WORK_ITEM_START_REJECTED_EVENT,
  INSTANCE_REVERSAL_FAILED,
  HRM_REQUEST_REVERSED,
  PROJECT_REQUEST_REVERSAL_REQUESTED,
  type HrmRequestReversedPayload,
  type ProjectRequestReversalRequestedPayload,
  type WorkItemReversedPayload,
  type WorkItemProcedureLinkedPayload,
  type WorkItemProcedureLinkRejectedPayload,
  type WorkItemProcedureRequestedPayload,
} from '../domain/procedure-workspace-link.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import type { ProcedureEngineApplication } from './procedure-engine.application.js';

/** Sự kiện từ module Workspace mà Quy trình xử lý. */
export const PROCEDURE_WORKSPACE_EVENT_TYPES = [
  WORK_ITEM_PROCEDURE_REQUESTED,
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
  WORK_ITEM_REVERSED,
  PROJECT_REQUEST_REVERSAL_REQUESTED,
  HRM_REQUEST_REVERSED,
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
    } else if (type === WORK_ITEM_REVERSED) {
      // Workspace đã hỏi trước (reversal-check) nên thường huỷ được. Bị chặn
      // giữa chừng (vừa mở hồ sơ vật tư) là lỗi nghiệp vụ: thử lại không hết,
      // nên bỏ qua thay vì để worker lặp vô hạn.
      const reversed = payload as WorkItemReversedPayload;
      if (!reversed.instanceId) return;
      await this.reverseOrReport(tenantId, reversed.instanceId, {
        reason: `Công việc ${reversed.workItemCode} bị huỷ hiệu lực: ${reversed.reason}`,
        createAdjustment: reversed.createAdjustment,
        reversedBy: reversed.reversedBy,
        reversedByName: reversed.reversedByName,
        origin: { workItemId: reversed.workItemId, label: `công việc ${reversed.workItemCode}` },
      });
    } else if (type === HRM_REQUEST_REVERSED) {
      // Đơn đã huỷ ở HRM (HRM hỏi trước rồi mới huỷ): huỷ hồ sơ theo. Không lập
      // điều chỉnh ở đây — đơn là của HRM.
      const reversed = payload as HrmRequestReversedPayload;
      if (!reversed?.instanceId) return;
      await this.reverseOrReport(tenantId, reversed.instanceId, {
        reason: `Đơn HRM bị huỷ hiệu lực: ${reversed.reason}`,
        createAdjustment: false,
        reversedBy: reversed.reversedBy,
        origin: { label: 'đơn HRM' },
      });
    } else if (type === PROJECT_REQUEST_REVERSAL_REQUESTED) {
      // Đơn từ của dự án chạy qua Quy trình: huỷ hồ sơ, HRM tự huỷ đơn theo
      // (procedure.instance.reversed). Đơn không qua Quy trình do HRM nhận.
      const requested = payload as ProjectRequestReversalRequestedPayload;
      if (!requested.instanceId) return;
      await this.reverseOrReport(tenantId, requested.instanceId, {
        reason: `Đơn ${requested.code} của dự án bị huỷ hiệu lực: ${requested.reason}`,
        createAdjustment: requested.createAdjustment,
        reversedBy: requested.requestedBy,
        reversedByName: requested.requestedByName,
        origin: { projectRequestId: requested.projectRequestId, label: `đơn ${requested.code}` },
      });
    } else if (type === WORK_ITEM_PROCEDURE_LINK_REJECTED) {
      const rejected = payload as WorkItemProcedureLinkRejectedPayload;
      await this.procedures.applyWorkspaceLinkResult(tenantId, {
        instanceId: rejected.instanceId,
        rejected: rejected.reason,
      });
    }
  }

  /**
   * Module khác đã kiểm trước nên thường huỷ được. Bị chặn giữa chừng là lỗi
   * nghiệp vụ, thử lại không hết: báo người yêu cầu đối soát thay vì để worker
   * lặp vô hạn hay im lặng lệch dữ liệu.
   */
  private async reverseOrReport(
    tenantId: string,
    instanceId: string,
    input: {
      readonly reason: string;
      readonly createAdjustment: boolean;
      readonly reversedBy: string;
      readonly reversedByName?: string;
      readonly origin: { readonly workItemId?: string; readonly projectRequestId?: string; readonly label: string };
    },
  ): Promise<void> {
    try {
      await this.procedures.reverseForService(tenantId, instanceId, input);
    } catch (error) {
      if (!(error instanceof ProcedureEngineError)) throw error;
      await this.emit(tenantId, {
        type: INSTANCE_REVERSAL_FAILED,
        aggregateType: 'procedure-instance',
        aggregateId: instanceId,
        payload: {
          instanceId,
          reason: error.message,
          originLabel: input.origin.label,
          ...(input.origin.workItemId ? { workItemId: input.origin.workItemId } : {}),
          ...(input.origin.projectRequestId ? { projectRequestId: input.origin.projectRequestId } : {}),
          recipientUserIds: [input.reversedBy],
        },
      });
    }
  }
}
