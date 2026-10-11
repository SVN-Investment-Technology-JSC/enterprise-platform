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

/** Workspace → Quy trình: công việc "Theo quy trình" vừa tạo, nhờ Quy trình mở hồ sơ. */
export const WORK_ITEM_PROCEDURE_REQUESTED = 'workspace.work_item.procedure_requested';
/** Workspace → Quy trình: đã tạo công việc cho hồ sơ, kèm mã công việc. */
export const WORK_ITEM_PROCEDURE_LINKED = 'workspace.work_item.procedure_linked';
/** Workspace → Quy trình: từ chối tạo công việc cho hồ sơ. */
export const WORK_ITEM_PROCEDURE_LINK_REJECTED = 'workspace.work_item.procedure_link_rejected';

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
  readonly payload: WorkspaceLinkRequestedPayload | StartedForWorkItemPayload;
}

/**
 * Sự kiện gửi Workspace sinh ra từ một lần đổi trạng thái, so trước/sau.
 *
 * - Hồ sơ vừa có yêu cầu gắn dự án (`pending` mới xuất hiện) → nhờ Workspace tạo công việc.
 * - Hồ sơ mới mở cho một công việc Workspace → báo Workspace lưu liên kết.
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
    if (link?.status === 'pending' && prior?.workspaceLink?.status !== 'pending') {
      events.push({
        type: WORKSPACE_LINK_REQUESTED_EVENT,
        aggregateId: instance.id,
        payload: {
          instanceId: instance.id,
          instanceCode: instance.code,
          instanceStatus: instance.status,
          projectId: link.projectId,
          title: link.baseTitle,
          requestedBy: link.requestedBy,
          requestedByIsTenantAdmin: link.requestedByIsTenantAdmin === true,
          workItem: link.workItem,
        },
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
