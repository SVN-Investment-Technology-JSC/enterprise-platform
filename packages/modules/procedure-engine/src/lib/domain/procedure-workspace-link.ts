import type {
  ProcedureInstance,
  ProcedureWorkspaceWorkItemDraft,
} from '@enterprise-platform/contracts-procedure-engine';

/**
 * Liên kết Quy trình ↔ Workspace đi hoàn toàn bằng sự kiện.
 *
 * Không module nào ghi vào dữ liệu của module kia: mỗi bên chỉ phát sự kiện
 * qua outbox của mình, và bên nhận tự kiểm quyền rồi tự ghi dữ liệu của mình.
 */

/** Quy trình → Workspace: hồ sơ vừa mở có gắn dự án, nhờ Workspace tạo công việc. */
export const WORKSPACE_LINK_REQUESTED_EVENT = 'procedure.instance.workspace_link_requested';
/** Quy trình → Workspace: đã mở hồ sơ cho một công việc "Theo quy trình". */
export const STARTED_FOR_WORK_ITEM_EVENT = 'procedure.instance.started_for_work_item';
/** Quy trình → Workspace: không mở được hồ sơ cho công việc (thiếu quyền, quy trình đổi…). */
export const WORK_ITEM_START_REJECTED_EVENT = 'procedure.instance.work_item_start_rejected';
/**
 * Quy trình → Workspace: đổi công việc liên kết của hồ sơ. Workspace tạo công việc mới ở dự án / công
 * việc cha đã chọn, chuyển tài liệu của công việc cũ sang, xoá công việc cũ, rồi trả `procedure_linked`
 * (hoặc `procedure_link_rejected`, khi đó Quy trình giữ nguyên liên kết cũ).
 */
export const WORKSPACE_RELINK_REQUESTED_EVENT = 'procedure.instance.workspace_relink_requested';
/** Quy trình → Workspace: hồ sơ bị xoá (xoá mềm); Workspace xoá công việc liên kết. */
export const INSTANCE_DELETED_EVENT = 'procedure.instance.deleted';
/**
 * Quy trình → Workspace: hồ sơ gắn dự án vừa có tệp đính kèm tải lên xong. Workspace tạo tài liệu trỏ
 * cùng tệp trong thư mục công việc của dự án.
 */
export const ATTACHMENT_ADDED_EVENT = 'procedure.instance.attachment_added';

/** Workspace → Quy trình: công việc "Theo quy trình" vừa tạo, nhờ Quy trình mở hồ sơ. */
export const WORK_ITEM_PROCEDURE_REQUESTED = 'workspace.work_item.procedure_requested';
/** Workspace → Quy trình: đã tạo công việc cho hồ sơ, kèm mã công việc. */
export const WORK_ITEM_PROCEDURE_LINKED = 'workspace.work_item.procedure_linked';
/** Workspace → Quy trình: từ chối tạo công việc cho hồ sơ. */
export const WORK_ITEM_PROCEDURE_LINK_REJECTED = 'workspace.work_item.procedure_link_rejected';
/** Workspace → Quy trình: công việc gắn hồ sơ bị huỷ hiệu lực, nhờ huỷ hiệu lực hồ sơ theo. */
export const WORK_ITEM_REVERSED = 'workspace.work_item.reversed';
/** Workspace → Quy trình/HRM: đơn từ của dự án được yêu cầu huỷ hiệu lực. */
export const PROJECT_REQUEST_REVERSAL_REQUESTED = 'workspace.project_request.reversal_requested';
/**
 * Quy trình → mọi bên: không huỷ hiệu lực được hồ sơ theo yêu cầu của module
 * khác dù đã qua kiểm trước (vd vừa mở hồ sơ vật tư). Báo người yêu cầu đối soát.
 */
export const INSTANCE_REVERSAL_FAILED = 'procedure.instance.reversal_failed';
/** HRM → Quy trình: đơn chạy qua quy trình bị huỷ hiệu lực ngay trong HRM. */
export const HRM_REQUEST_REVERSED = 'hrm.request.reversed';

/** Workspace → Quy trình: việc ngoài dự án "Theo quy trình" vừa tạo, nhờ mở hồ sơ. */
export const STANDALONE_TASK_PROCEDURE_REQUESTED = 'workspace.standalone_task.procedure_requested';
/** Workspace → Quy trình: việc ngoài dự án bị huỷ hiệu lực, nhờ huỷ hiệu lực hồ sơ theo. */
export const STANDALONE_TASK_REVERSED = 'workspace.standalone_task.reversed';

export interface StandaloneTaskReversedPayload {
  readonly taskId: string;
  readonly taskCode: string;
  readonly instanceId: string;
  readonly reason: string;
  readonly reversedBy: string;
  readonly reversedByName?: string;
}

/** Quy trình → Workspace: đã mở hồ sơ cho việc ngoài dự án. */
export const STARTED_FOR_STANDALONE_TASK_EVENT = 'procedure.instance.started_for_standalone_task';
/** Quy trình → Workspace: không mở được hồ sơ cho việc ngoài dự án. */
export const STANDALONE_TASK_START_REJECTED_EVENT =
  'procedure.instance.standalone_task_start_rejected';

export interface StandaloneTaskProcedureRequestedPayload {
  readonly taskId: string;
  readonly taskCode: string;
  /** Tên việc; tên hồ sơ ghép thêm mã việc. */
  readonly title: string;
  readonly definitionId: string;
  readonly requestedBy: string;
  readonly requestedByName?: string;
  readonly requestedByIsTenantAdmin: boolean;
}

export interface StartedForStandaloneTaskPayload {
  readonly taskId: string;
  readonly instanceId: string;
  readonly instanceCode: string;
}

/** Khoá chống trùng của hồ sơ mở cho một việc ngoài dự án. */
export function standaloneTaskIdempotencyKey(taskId: string): string {
  return `workspace-standalone-task:${taskId}`;
}

export interface HrmRequestReversedPayload {
  readonly requestKind: string;
  readonly requestId: string;
  readonly instanceId: string;
  readonly reason: string;
  readonly reversedBy: string;
}

export interface ProjectRequestReversalRequestedPayload {
  readonly projectRequestId: string;
  readonly code: string;
  readonly projectId: string;
  readonly instanceId?: string;
  readonly reason: string;
  readonly createAdjustment: boolean;
  readonly requestedBy: string;
  readonly requestedByName?: string;
}

export interface WorkItemReversedPayload {
  readonly workItemId: string;
  readonly workItemCode: string;
  readonly projectId: string;
  /** Hồ sơ gắn công việc; vắng nghĩa là công việc thủ công, Quy trình bỏ qua. */
  readonly instanceId?: string;
  readonly reason: string;
  readonly createAdjustment: boolean;
  readonly reversedBy: string;
  readonly reversedByName?: string;
}

export interface WorkspaceLinkRequestedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly instanceStatus: string;
  readonly projectId: string;
  /** Tên người dùng nhập — Workspace dùng làm tên công việc. */
  readonly title: string;
  readonly requestedBy: string;
  /** Người yêu cầu là quản trị tenant, do Quy trình đã xác thực lúc nhận request. */
  readonly requestedByIsTenantAdmin: boolean;
  readonly workItem: ProcedureWorkspaceWorkItemDraft;
  /** Hồ sơ điều chỉnh: công việc mới nối về công việc đã huỷ hiệu lực này. */
  readonly adjustmentOfWorkItemId?: string;
  /**
   * Người submit khi đơn được tạo hộ (khác người yêu cầu). Chưa thuộc dự án thì Workspace thêm vào dự án,
   * dưới quyền của người yêu cầu.
   */
  readonly submitterUserId?: string;
}

export interface WorkspaceRelinkRequestedPayload extends WorkspaceLinkRequestedPayload {
  /** Công việc đang gắn hồ sơ; Workspace xoá nó sau khi đã chuyển tài liệu sang công việc mới. */
  readonly replacesWorkItemId: string;
}

export interface InstanceDeletedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  /** Công việc Workspace đang gắn hồ sơ; vắng khi chưa gắn xong. Workspace vẫn tra theo `instanceId`. */
  readonly workItemId?: string;
  readonly reason: string;
  readonly deletedBy: string;
  readonly deletedByName?: string;
}

export interface AttachmentAddedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly attachmentId: string;
  /** Khoá tệp trong kho; Workspace dùng lại, không tải lên lần nữa. */
  readonly objectKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string;
  /** Nguồn hiển thị của tệp: "Bước 2", "Bổ sung"… */
  readonly originLabel: string;
}

export interface WorkItemProcedureRequestedPayload {
  readonly workItemId: string;
  readonly workItemCode: string;
  readonly projectId: string;
  readonly projectCode: string;
  /** Tên công việc; tên hồ sơ ghép thêm mã dự án và mã công việc. */
  readonly title: string;
  readonly definitionId: string;
  readonly requestedBy: string;
  readonly requestedByName?: string;
  readonly requestedByIsTenantAdmin: boolean;
}

export interface WorkItemProcedureLinkedPayload {
  readonly instanceId: string;
  readonly workItemId: string;
  readonly workItemCode: string;
  readonly projectId: string;
  readonly projectCode: string;
}

export interface WorkItemProcedureLinkRejectedPayload {
  readonly instanceId: string;
  readonly reason: string;
}

/**
 * Tên hồ sơ gắn công việc: `[mã dự án]-[mã công việc]-[tên]`, ví dụ
 * `EVN-CV013-Mua cáp Anten`. Mã công việc bỏ gạch nối (mã cũ `CV-012` →
 * `CV012`). Cắt về 255 ký tự — giới hạn của cột tiêu đề hồ sơ.
 */
export function workspaceInstanceTitle(projectCode: string, itemCode: string, name: string): string {
  return [projectCode, itemCode.replace(/-/g, ''), name]
    .filter(Boolean)
    .join('-')
    .slice(0, 255);
}

/** Khoá chống trùng của hồ sơ mở cho một công việc Workspace. */
export function workItemIdempotencyKey(workItemId: string): string {
  return `workspace-work-item:${workItemId}`;
}

export interface StartedForWorkItemPayload {
  readonly workItemId: string;
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly title: string;
  readonly status: string;
}

export interface WorkItemStartRejectedPayload {
  readonly workItemId: string;
  readonly reason: string;
}

export interface WorkspaceLinkOutboxEvent {
  readonly type: string;
  readonly aggregateId: string;
  readonly payload:
    | WorkspaceLinkRequestedPayload
    | WorkspaceRelinkRequestedPayload
    | InstanceDeletedPayload
    | StartedForWorkItemPayload
    | StartedForStandaloneTaskPayload;
}

/**
 * Sự kiện gửi Workspace sinh ra từ một lần đổi trạng thái, so trước/sau.
 *
 * - Hồ sơ vừa có yêu cầu gắn dự án (`pending` mới xuất hiện) → nhờ Workspace tạo công việc.
 * - Hồ sơ mới mở cho một công việc Workspace → báo Workspace lưu liên kết.
 * - Hồ sơ mới mở cho một việc ngoài dự án → báo Workspace lưu liên kết.
 */
export function workspaceLinkEvents(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): WorkspaceLinkOutboxEvent[] {
  const previous = new Map(before.map((instance) => [instance.id, instance]));
  const events: WorkspaceLinkOutboxEvent[] = [];
  for (const instance of after) {
    const prior = previous.get(instance.id);
    const link = instance.workspaceLink;
    if (instance.deletion && !prior?.deletion && (link || instance.sourceType === 'workspace_work_item')) {
      const workItemId =
        link?.status === 'linked'
          ? link.workItemId
          : link?.replacesWorkItemId ??
            (instance.sourceType === 'workspace_work_item' ? instance.sourceId : undefined);
      events.push({
        type: INSTANCE_DELETED_EVENT,
        aggregateId: instance.id,
        payload: {
          instanceId: instance.id,
          instanceCode: instance.code,
          ...(workItemId ? { workItemId } : {}),
          reason: instance.deletion.reason,
          deletedBy: instance.deletion.deletedBy,
          ...(instance.deletion.deletedByName ? { deletedByName: instance.deletion.deletedByName } : {}),
        },
      });
    }
    if (link?.status === 'pending' && prior?.workspaceLink?.status !== 'pending') {
      events.push({
        type: link.replacesWorkItemId ? WORKSPACE_RELINK_REQUESTED_EVENT : WORKSPACE_LINK_REQUESTED_EVENT,
        aggregateId: instance.id,
        payload: {
          ...(link.replacesWorkItemId ? { replacesWorkItemId: link.replacesWorkItemId } : {}),
          instanceId: instance.id,
          instanceCode: instance.code,
          instanceStatus: instance.status,
          projectId: link.projectId,
          title: link.baseTitle,
          requestedBy: link.requestedBy,
          requestedByIsTenantAdmin: link.requestedByIsTenantAdmin === true,
          workItem: link.workItem,
          ...(link.adjustmentOfWorkItemId
            ? { adjustmentOfWorkItemId: link.adjustmentOfWorkItemId }
            : {}),
          ...(instance.initiatedBy !== link.requestedBy && !link.replacesWorkItemId
            ? { submitterUserId: instance.initiatedBy }
            : {}),
        },
      });
    }
    if (!prior && instance.sourceType === 'workspace_standalone_task' && instance.sourceId) {
      events.push({
        type: STARTED_FOR_STANDALONE_TASK_EVENT,
        aggregateId: instance.id,
        payload: { taskId: instance.sourceId, instanceId: instance.id, instanceCode: instance.code },
      });
    }
    if (!prior && instance.sourceType === 'workspace_work_item' && instance.sourceId) {
      events.push({
        type: STARTED_FOR_WORK_ITEM_EVENT,
        aggregateId: instance.id,
        payload: {
          workItemId: instance.sourceId,
          instanceId: instance.id,
          instanceCode: instance.code,
          title: instance.title,
          status: instance.status,
        },
      });
    }
  }
  return events;
}
