import type { ProjectRequestList } from '@enterprise-platform/contracts-workspace';
import type { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Tab "Đơn từ" của dự án.
 *
 * Chỉ đọc: đơn được ghi bằng sự kiện từ module gửi (xem
 * `infrastructure/project-request-events.ts`). Mọi thành viên dự án đều xem
 * được, kể cả `viewer` — cùng hàng rào với các tab khác của dự án.
 */
export class ProjectRequestService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
  ) {}

  async listForProject(actor: WorkspaceActor, projectId: string): Promise<ProjectRequestList> {
    const access = await this.projects.access(actor, projectId);
    const items = await this.store.projectRequest.listByProject(actor.tenantId, access.project.id);
    return { items };
  }
}
