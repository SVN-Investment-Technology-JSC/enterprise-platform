/**
 * Liên kết Workspace ↔ Quy trình đi hoàn toàn bằng sự kiện.
 *
 * Workspace không gọi API ghi của Quy trình và ngược lại: mỗi bên phát sự kiện
 * qua outbox của mình, bên nhận tự kiểm quyền rồi tự ghi dữ liệu của mình.
 * Tên sự kiện và hình dạng payload phải khớp với module Quy trình
 * (`procedure-workspace-link.ts` bên đó); khai lại ở đây vì module này không
 * được phụ thuộc vào module kia.
 */

/** Quy trình → Workspace: hồ sơ vừa mở có gắn dự án, nhờ Workspace tạo công việc. */
export const PROCEDURE_WORKSPACE_LINK_REQUESTED = 'procedure.instance.workspace_link_requested';
/** Quy trình → Workspace: đã mở hồ sơ cho một công việc "Theo quy trình". */
export const PROCEDURE_STARTED_FOR_WORK_ITEM = 'procedure.instance.started_for_work_item';
/** Quy trình → Workspace: không mở được hồ sơ cho công việc. */
export const PROCEDURE_WORK_ITEM_START_REJECTED = 'procedure.instance.work_item_start_rejected';

/** Workspace → Quy trình: nhờ mở hồ sơ cho công việc "Theo quy trình". */
export const WORK_ITEM_PROCEDURE_REQUESTED = 'workspace.work_item.procedure_requested';
/** Workspace → Quy trình: đã tạo công việc cho hồ sơ gắn dự án. */
export const WORK_ITEM_PROCEDURE_LINKED = 'workspace.work_item.procedure_linked';
/** Workspace → Quy trình: không tạo được công việc cho hồ sơ. */
export const WORK_ITEM_PROCEDURE_LINK_REJECTED = 'workspace.work_item.procedure_link_rejected';

/**
 * Workspace → Quy trình: công việc bị huỷ hiệu lực. Có `instanceId` khi người
 * dùng huỷ công việc gắn hồ sơ — Quy trình huỷ hiệu lực hồ sơ theo.
 */
export const WORK_ITEM_REVERSED = 'workspace.work_item.reversed';
/** Quy trình → Workspace: hồ sơ đã bị huỷ hiệu lực. */
export const PROCEDURE_INSTANCE_REVERSED = 'procedure.instance.reversed';

export interface ProcedureInstanceReversedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly workItemId?: string;
  /** Nguồn mở hồ sơ; `workspace_standalone_task` là việc ngoài dự án. */
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly reason: string;
  readonly reversedBy: string;
  readonly reversedByName?: string;
  readonly adjustmentRequested: boolean;
}

/** Đường mở hồ sơ ở module Quy trình. */
export const PROCEDURE_LAUNCH_URL = '/modules/procedure#workspace';

export interface ProcedureLinkRequestedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly instanceStatus: string;
  readonly projectId: string;
  readonly title: string;
  readonly requestedBy: string;
  readonly requestedByIsTenantAdmin: boolean;
  readonly workItem: {
    readonly itemType?: 'task' | 'milestone';
    readonly description?: string;
    readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
    readonly assigneeUserId?: string;
    readonly parentId?: string;
    readonly plannedStart?: string;
    readonly plannedEnd?: string;
    readonly estimateHours?: number;
    readonly estimatedCost?: number;
  };
  /** Hồ sơ điều chỉnh: công việc mới nối về công việc đã huỷ hiệu lực này. */
  readonly adjustmentOfWorkItemId?: string;
  /** Người submit của đơn tạo hộ; chưa thuộc dự án thì được thêm vào (quyền của người yêu cầu). */
  readonly submitterUserId?: string;
}

/**
 * Quy trình → Workspace: đổi công việc liên kết của hồ sơ. Tạo công việc mới ở dự án / công việc cha đã
 * chọn, chuyển tài liệu của công việc cũ sang, xoá công việc cũ, rồi trả `procedure_linked`.
 */
export const PROCEDURE_WORKSPACE_RELINK_REQUESTED = 'procedure.instance.workspace_relink_requested';

export interface ProcedureRelinkRequestedPayload extends ProcedureLinkRequestedPayload {
  /** Công việc đang gắn hồ sơ; bị xoá sau khi tài liệu đã chuyển sang công việc mới. */
  readonly replacesWorkItemId: string;
}

/** Quy trình → Workspace: hồ sơ bị xoá (xoá mềm); xoá công việc liên kết. */
export const PROCEDURE_INSTANCE_DELETED = 'procedure.instance.deleted';

export interface ProcedureInstanceDeletedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly workItemId?: string;
  readonly reason: string;
  readonly deletedBy: string;
  readonly deletedByName?: string;
}

/** Quy trình → Workspace: hồ sơ gắn dự án có tệp mới tải lên xong; đưa vào thư mục công việc. */
export const PROCEDURE_ATTACHMENT_ADDED = 'procedure.instance.attachment_added';

export interface ProcedureAttachmentAddedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly attachmentId: string;
  /** Khoá tệp trong kho, dùng lại nguyên vẹn (không tải lên lần nữa). */
  readonly objectKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string;
  /** "Bước 2", "Bổ sung"… */
  readonly originLabel: string;
}

export interface ProcedureStartedForWorkItemPayload {
  readonly workItemId: string;
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly title: string;
  readonly status: string;
}

export interface ProcedureWorkItemStartRejectedPayload {
  readonly workItemId: string;
  readonly reason: string;
}

/** Workspace yêu cầu mở hồ sơ, ghi kèm công việc trong cùng transaction. */
export interface WorkItemProcedureRequestDraft {
  readonly definitionId: string;
  readonly projectCode: string;
  readonly requestedByName?: string;
  readonly requestedByIsTenantAdmin: boolean;
}

/** Hồ sơ đã mở sẵn bên Quy trình, công việc tạo ra để gắn vào nó. */
export interface WorkItemLinkedInstanceDraft {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly instanceStatus: string;
  readonly projectCode: string;
}

/* -------------------------------------------- Công việc ngoài dự án ↔ Quy trình */

/** Workspace → Quy trình: việc ngoài dự án "Theo quy trình" vừa tạo, nhờ mở hồ sơ. */
export const STANDALONE_TASK_PROCEDURE_REQUESTED = 'workspace.standalone_task.procedure_requested';
/**
 * Workspace → Quy trình: việc ngoài dự án (có hồ sơ đã hoàn tất) bị huỷ hiệu
 * lực, nhờ huỷ hiệu lực hồ sơ theo.
 */
export const STANDALONE_TASK_REVERSED = 'workspace.standalone_task.reversed';
/** Quy trình → Workspace: đã mở hồ sơ cho việc ngoài dự án. */
export const PROCEDURE_STARTED_FOR_STANDALONE_TASK = 'procedure.instance.started_for_standalone_task';
/** Quy trình → Workspace: không mở được hồ sơ cho việc ngoài dự án. */
export const PROCEDURE_STANDALONE_TASK_START_REJECTED =
  'procedure.instance.standalone_task_start_rejected';
/**
 * Quy trình → mọi bên: hồ sơ đã đóng (`status` completed | rejected | cancelled).
 * Workspace chỉ xử lý hồ sơ có `sourceType` là việc ngoài dự án.
 */
export const PROCEDURE_INSTANCE_COMPLETED = 'procedure.instance.completed';
/** `sourceType` của hồ sơ mở cho việc ngoài dự án, khớp với module Quy trình. */
export const STANDALONE_TASK_PROCEDURE_SOURCE = 'workspace_standalone_task';

export interface ProcedureStartedForStandaloneTaskPayload {
  readonly taskId: string;
  readonly instanceId: string;
  readonly instanceCode: string;
}

export interface ProcedureStandaloneTaskStartRejectedPayload {
  readonly taskId: string;
  readonly reason: string;
}

export interface ProcedureInstanceCompletedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly status: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
}
