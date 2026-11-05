import { PROJECT_PERMISSION_LABELS } from '@enterprise-platform/contracts-workspace';
import { projectProgress, rollUpProgress, type ProgressNode } from '../domain/progress.rules.js';
import {
  ProjectPermissionForbiddenError,
  WorkItemNotFoundError,
} from '../domain/workspace.error.js';
import type { FleetTransportService } from './fleet-transport.service.js';
import { assertProjectWritable, permissionsOf, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Xoá hẳn một công việc — tách khỏi `WorkItemService` theo đúng phân vai ở lần
 * sửa này.
 *
 * "Xoá" khác hẳn "Huỷ": Huỷ chuyển trạng thái sang `cancelled` và mở lại được,
 * còn Xoá gỡ bỏ công việc cùng toàn bộ nhánh con khỏi cơ sở dữ liệu. Vì không
 * hoàn tác được nên **chỉ chủ nhiệm dự án** mới xoá — ngay cả quản trị tenant
 * cũng phải là chủ nhiệm mới xoá được. Server là nơi quyết định quyền, giao
 * diện chỉ ẩn hiện cho gọn. Dù xoá hẳn, một dòng "đã xoá" vẫn được ghi vào nhật
 * ký hoạt động của dự án để giữ vết.
 */
export class WorkItemDeletionService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly fleet?: FleetTransportService,
  ) {}

  async delete(actor: WorkspaceActor, workItemId: string): Promise<void> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);

    // Chỉ thành viên mà vai trò có quyền "Có thể xoá công việc" (mặc định chỉ
    // chủ nhiệm). KHÔNG dùng `hasProjectPermission` vì nó cho quản trị tenant
    // đi tắt — yêu cầu nghiệp vụ là phải giữ vai trò có quyền xoá trong dự án.
    const access = await this.projects.access(actor, item.projectId);
    assertProjectWritable(access.project);
    if (!permissionsOf(access).has('work_item.delete')) {
      throw new ProjectPermissionForbiddenError(PROJECT_PERMISSION_LABELS['work_item.delete']);
    }

    // Xoá kéo theo cả nhánh con: tìm trước, rồi trả xe của từng công việc sau khi xoá.
    const doomed = this.fleet ? await this.subtreeIds(actor.tenantId, item.projectId, item.id) : [];

    await this.store.workItem.remove(actor.tenantId, workItemId, {
      projectId: item.projectId,
      fromStatus: item.status,
      note: `Đã xoá công việc: ${item.code} — ${item.title}`,
      createdBy: actor.userId,
    });
    for (const id of doomed) await this.fleet?.release(actor.tenantId, 'WORK_ITEM', id);

    // Cây đã đổi: tính lại tiến độ cuộn của cha và của dự án. Cùng các bước như
    // `WorkItemService.recalculate`, dùng lại hàm miền `rollUpProgress` /
    // `projectProgress` để hai nơi không lệch công thức.
    await this.recalculate(actor.tenantId, item.projectId);
  }

  /**
   * Xoá công việc gắn hồ sơ Quy trình theo quyết định của Quy trình (đơn bị xoá, hoặc đổi sang công việc
   * khác). Quy trình đã kiểm quyền người thao tác (vai A của đơn hoặc quản trị), nên ở đây không kiểm vai
   * dự án; vẫn ghi dòng "đã xoá" vào nhật ký dự án và gỡ con trỏ tới hồ sơ. Không còn công việc thì thôi.
   */
  async removeForProcedure(
    tenantId: string,
    workItemId: string,
    input: { readonly instanceId: string; readonly removedBy: string; readonly note: string },
  ): Promise<void> {
    const item = await this.store.workItem.findById(tenantId, workItemId);
    if (!item) return;
    const doomed = this.fleet ? await this.subtreeIds(tenantId, item.projectId, item.id) : [];
    for (const reference of await this.store.externalRef.listByEntity(tenantId, 'work_item', item.id)) {
      if (reference.moduleKey === 'procedure-engine' && reference.externalId === input.instanceId) {
        await this.store.externalRef.remove(tenantId, reference.id);
      }
    }
    await this.store.workItem.remove(tenantId, workItemId, {
      projectId: item.projectId,
      fromStatus: item.status,
      note: `${input.note}: ${item.code} — ${item.title}`.slice(0, 1000),
      createdBy: input.removedBy,
    });
    for (const id of doomed) await this.fleet?.release(tenantId, 'WORK_ITEM', id);
    await this.recalculate(tenantId, item.projectId);
  }

  /** Công việc và mọi công việc con cháu của nó. */
  private async subtreeIds(tenantId: string, projectId: string, rootId: string): Promise<string[]> {
    const all = await this.store.workItem.listByProject(tenantId, projectId);
    const ids = [rootId];
    for (let index = 0; index < ids.length; index++) {
      for (const node of all) if (node.parentId === ids[index]) ids.push(node.id);
    }
    return ids;
  }

  private async recalculate(tenantId: string, projectId: string): Promise<void> {
    const rows = await this.store.workItem.progressRows(tenantId, projectId);
    const nodes: ProgressNode[] = rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      status: row.status,
      progressPercent: row.progressPercent,
      manualPercent: row.manualPercent,
      estimateHours: row.estimateHours,
    }));

    const changed = rollUpProgress(nodes);
    await this.store.workItem.applyProgress(tenantId, changed);

    const updated = nodes.map((node) => ({
      ...node,
      progressPercent: changed.get(node.id) ?? node.progressPercent,
    }));
    await this.store.project.updateProgress(tenantId, projectId, projectProgress(updated));
    // Xoá việc cuối còn mở cũng làm mọi việc còn lại đã xong: tự đóng hồ sơ nếu tenant bật tuỳ chọn.
    await this.projects.autoArchiveIfDone(
      tenantId,
      projectId,
      updated.map((node) => node.status),
    );
  }
}
