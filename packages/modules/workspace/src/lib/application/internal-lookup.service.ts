import {
  INTERNAL_PROJECT_OPTION_LIMIT,
  WORKSPACE_LAUNCH_URL,
  type InternalProjectOptionList,
  type InternalProjectSummary,
  type InternalWorkItemOption,
  type InternalWorkItemSummary,
} from '@enterprise-platform/contracts-workspace';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import { ProjectNotFoundError, WorkItemNotFoundError } from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Tra cứu cho module khác, qua `/v1/internal/*`.
 *
 * Bên gọi là một dịch vụ, không phải người dùng, nên **không đi qua kiểm vai
 * trò dự án** — thay vào đó, payload bị cắt về đúng phần nhãn cần để hiển
 * thị: không tài chính, không mô tả, không thành viên. Guard đã xác minh
 * service token và gắn tenant từ `x-tenant-id` trước khi tới đây.
 */
export class InternalLookupService {
  constructor(private readonly store: WorkspaceStore) {}

  async workItem(actor: WorkspaceActor, workItemId: string): Promise<InternalWorkItemSummary> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    const project = await this.store.project.findById(actor.tenantId, item.projectId);
    if (!project) throw new WorkItemNotFoundError(workItemId);

    return {
      id: item.id,
      code: item.code,
      title: item.title,
      itemType: item.itemType,
      executionType: item.executionType,
      status: item.status,
      priority: item.priority,
      assigneeUserId: item.assigneeUserId,
      plannedStart: item.plannedStart,
      plannedEnd: item.plannedEnd,
      progressPercent: item.progressPercent,
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
      },
      launchUrl: WORKSPACE_LAUNCH_URL,
    };
  }

  /**
   * Dự án của cả tenant (không theo thành viên) để module khác cho chọn. Dự án bị huỷ không được chào mời:
   * không ai hạch toán thêm vào đó.
   */
  async listProjects(
    actor: WorkspaceActor,
    query: { readonly search?: string; readonly limit?: number | string },
  ): Promise<InternalProjectOptionList> {
    const limit = Math.min(
      Math.max(Math.trunc(Number(query.limit) || INTERNAL_PROJECT_OPTION_LIMIT), 1),
      INTERNAL_PROJECT_OPTION_LIMIT,
    );
    const { items, total } = await this.store.project.list(actor.tenantId, {
      search: query.search?.trim() || undefined,
      page: 1,
      pageSize: limit,
    });
    const open = items.filter((project) => project.status !== 'cancelled');
    return {
      items: open.map(({ id, code, name, status }) => ({ id, code, name, status })),
      truncated: total > items.length,
    };
  }

  /** Công việc của một dự án (cây đã làm phẳng, theo thứ tự cây), bỏ công việc đã huỷ hiệu lực. */
  async projectWorkItems(actor: WorkspaceActor, projectId: string): Promise<readonly InternalWorkItemOption[]> {
    const project = await this.store.project.findById(actor.tenantId, projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const items = await this.store.workItem.listByProject(actor.tenantId, projectId);
    return items
      .filter((item) => item.status !== 'cancelled')
      .map(({ id, code, title, status, depth }) => ({ id, code, title, status, depth }));
  }

  async project(actor: WorkspaceActor, projectId: string): Promise<InternalProjectSummary> {
    const project = await this.store.project.findById(actor.tenantId, projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const [rollup] = await this.store.project.rollup(
      actor.tenantId,
      [project.id],
      todayKey(timezoneOf(actor.tenantId)),
    );

    return {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      ownerUserId: project.ownerUserId,
      startDate: project.startDate,
      endDate: project.endDate,
      progressPercent: project.progressPercent,
      totalItems: rollup?.totalItems ?? 0,
      closedItems: rollup?.closedItems ?? 0,
      overdueItems: rollup?.overdueItems ?? 0,
      launchUrl: WORKSPACE_LAUNCH_URL,
    };
  }
}
