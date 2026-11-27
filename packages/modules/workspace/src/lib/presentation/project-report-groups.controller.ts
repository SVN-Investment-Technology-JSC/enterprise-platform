import type {
  SaveProjectReportGroupsRequest,
  SetProjectReportGroupRequest,
} from '@enterprise-platform/contracts-workspace';
import { Body, Controller, Get, HttpException, Param, Put, Req } from '@nestjs/common';
import { ProjectReportGroupService } from '../application/project-report-group.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { WorkspaceError } from '../domain/workspace.error.js';

interface WorkspaceRequest {
  workspaceActor?: WorkspaceActor;
}

/**
 * Nhóm báo cáo: danh mục của tenant (Cài đặt > Nhóm báo cáo) và nhóm của từng dự án.
 *
 * Controller riêng, không thêm vào `WorkspaceController`, để tính năng mới không đụng file cũ (cùng cách
 * `RelatedObjectsController`). Đi qua cùng guard toàn cục của workspace-api nên `workspaceActor` đã được xác minh; lệnh
 * ghi đòi `workspace.task.write` ở guard rồi được kiểm tiếp ở service.
 */
@Controller('v1')
export class ProjectReportGroupsController {
  constructor(private readonly reportGroups: ProjectReportGroupService) {}

  /** Ai dùng Workspace cũng đọc được; `canEdit` cho biết người gọi có sửa được danh mục không. */
  @Get('project-report-groups')
  list(@Req() request: WorkspaceRequest) {
    return this.execute(() => this.reportGroups.list(this.actor(request)));
  }

  /** Thay cả danh sách theo thứ tự gửi lên (quản trị tenant). */
  @Put('project-report-groups')
  save(@Req() request: WorkspaceRequest, @Body() body: SaveProjectReportGroupsRequest) {
    return this.execute(() =>
      this.reportGroups.save(this.actor(request), body ?? ({} as SaveProjectReportGroupsRequest)),
    );
  }

  /** Gán hay bỏ nhóm báo cáo của một dự án; trả dự án sau khi lưu. */
  @Put('projects/:id/report-group')
  setForProject(
    @Req() request: WorkspaceRequest,
    @Param('id') id: string,
    @Body() body: SetProjectReportGroupRequest,
  ) {
    return this.execute(() =>
      this.reportGroups.setForProject(this.actor(request), id, body ?? ({} as SetProjectReportGroupRequest)),
    );
  }

  private actor(request: WorkspaceRequest): WorkspaceActor {
    if (!request.workspaceActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted workspace context.' },
        401,
      );
    }
    return request.workspaceActor;
  }

  /** Đổi lỗi nghiệp vụ thành phản hồi HTTP có mã máy đọc được; id sai định dạng UUID coi là không tìm thấy. */
  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof WorkspaceError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
