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

/** Trang Workspace của module Quy trình; thêm `/<id hồ sơ>` thì mở thẳng hồ sơ đó. */
export const PROCEDURE_LAUNCH_URL = '/modules/procedure#workspace';

/** Đường mở đúng một hồ sơ ở module Quy trình. */
export function procedureLaunchUrl(instanceId: string): string {
  return `${PROCEDURE_LAUNCH_URL}/${encodeURIComponent(instanceId)}`;
}

/**
 * Link của một liên kết ngoài, trỏ thẳng vào hồ sơ.
 *
 * Liên kết Quy trình tạo trước đây lưu chung một đường tới trang danh sách,
 * người dùng phải tự tìm lại hồ sơ. Sửa lúc đọc ra nên không phải sửa dữ liệu
 * cũ; link của module khác giữ nguyên.
 */
export function resolveLaunchUrl(moduleKey: string, externalId: string, launchUrl: string): string {
  if (moduleKey === 'procedure-engine' && externalId && launchUrl === PROCEDURE_LAUNCH_URL) {
    return procedureLaunchUrl(externalId);
  }
  return launchUrl;
}

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
    readonly plannedStart?: string;
    readonly plannedEnd?: string;
    readonly estimateHours?: number;
    readonly estimatedCost?: number;
  };
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
