import { projectProgress, rollUpProgress, type ProgressNode } from '../domain/progress.rules.js';
import { ProjectRoleForbiddenError, WorkItemNotFoundError } from '../domain/workspace.error.js';
import { type ProjectService } from './project.service.js';
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
  ) {}

  async delete(actor: WorkspaceActor, workItemId: string): Promise<void> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);

    // Chỉ chủ nhiệm (vai 'owner' của dự án). KHÔNG dùng `hasProjectRole` vì nó
    // cho quản trị tenant đi tắt — yêu cầu nghiệp vụ là chỉ chủ nhiệm xoá được.
    const access = await this.projects.access(actor, item.projectId);
    if (access.role !== 'owner') {
      throw new ProjectRoleForbiddenError('chủ nhiệm dự án');
    }

    await this.store.workItem.remove(actor.tenantId, workItemId, {
      projectId: item.projectId,
      fromStatus: item.status,
      note: `Đã xoá công việc: ${item.code} — ${item.title}`,
      createdBy: actor.userId,
    });

    // Cây đã đổi: tính lại tiến độ cuộn của cha và của dự án. Cùng các bước như
    // `WorkItemService.recalculate`, dùng lại hàm miền `rollUpProgress` /
    // `projectProgress` để hai nơi không lệch công thức.
    await this.recalculate(actor, item.projectId);
  }

  private async recalculate(actor: WorkspaceActor, projectId: string): Promise<void> {
    const rows = await this.store.workItem.progressRows(actor.tenantId, projectId);
    const nodes: ProgressNode[] = rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      status: row.status,
      progressPercent: row.progressPercent,
      estimateHours: row.estimateHours,
    }));

    const changed = rollUpProgress(nodes);
    await this.store.workItem.applyProgress(actor.tenantId, changed);

    const updated = nodes.map((node) => ({
      ...node,
      progressPercent: changed.get(node.id) ?? node.progressPercent,
    }));
    await this.store.project.updateProgress(actor.tenantId, projectId, projectProgress(updated));
  }
}
