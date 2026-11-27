import { Controller, Get, HttpException, Inject, Query, Req } from '@nestjs/common';
import { ProjectService } from '../application/project.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { WORKSPACE_STORE, type WorkspaceStore } from '../application/workspace-store.port.js';

interface WorkspaceRequest {
  workspaceActor?: WorkspaceActor;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Trần số id mỗi loại trong một lần gọi. */
export const PROJECT_REFS_MAX = 200;

/** `a,b,c` → các UUID hợp lệ, không trùng, tối đa `PROJECT_REFS_MAX`; giá trị lạ bị bỏ. */
export function parseRefIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return [...new Set(raw.split(',').map((id) => id.trim().toLowerCase()).filter((id) => UUID.test(id)))].slice(
    0,
    PROJECT_REFS_MAX,
  );
}

/**
 * Mã và tên dự án theo lô, cho module khác hiện tên dự án (vd danh sách hồ sơ Quy trình gom theo dự án). Chỉ trả mã và tên,
 * không thành viên, tài chính hay thống kê, nên nhẹ và đi một lượt thay vì gọi chi tiết dự án / công việc từng dòng.
 * Đi qua guard chung của workspace-api: chỉ người dùng Workspace đã xác minh mới gọi được.
 *
 * Controller riêng để không đụng `WorkspaceController`.
 */
@Controller('v1')
export class ProjectRefsController {
  constructor(
    @Inject(WORKSPACE_STORE) private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
  ) {}

  /**
   * `GET v1/project-options`: dự án còn mở để chọn, kèm vai và quyền của người gọi, một lượt (không phân trang, không thống kê).
   * Cùng phạm vi thấy như `GET v1/projects`.
   */
  @Get('project-options')
  options(@Req() request: WorkspaceRequest) {
    return this.projects.openOptions(this.actorOf(request)).then((items) => ({ items }));
  }

  /** `GET v1/project-refs?projectIds=a,b&workItemIds=c,d` → `{ projects: [{id, code, name}], workItems: [{id, projectId}] }`. */
  @Get('project-refs')
  async refs(
    @Req() request: WorkspaceRequest,
    @Query('projectIds') projectIds?: string,
    @Query('workItemIds') workItemIds?: string,
  ) {
    const actor = this.actorOf(request);
    return this.store.project.refs(actor.tenantId, parseRefIds(projectIds), parseRefIds(workItemIds));
  }

  private actorOf(request: WorkspaceRequest): WorkspaceActor {
    if (!request.workspaceActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted workspace context.' },
        401,
      );
    }
    return request.workspaceActor;
  }
}
