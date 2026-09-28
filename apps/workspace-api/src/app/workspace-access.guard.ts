import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { WorkspaceActor } from '@enterprise-platform/module-workspace';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Id của bên gọi dịch vụ; các cột `created_by` là uuid nên không nhận chuỗi tự do. */
const WORKSPACE_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000004';

interface WorkspaceRequest extends Request {
  workspaceActor?: WorkspaceActor;
}

/**
 * Quyền cần cho một request, tách theo *loại thao tác* chứ không theo HTTP method.
 *
 * `workspace.manage` chỉ dành cho quản trị cấp tenant — hiện là kho tài liệu
 * dùng chung, kiểm ở tầng application. Các thao tác thuộc thẩm quyền dự án như huỷ dự án hay thêm bớt
 * thành viên CHỈ đòi `workspace.task.write` ở đây, rồi được chặn tiếp bằng vai
 * trò dự án ở tầng application. Đẩy chúng lên `manage` sẽ khiến một chủ nhiệm
 * dự án là tenant-user không huỷ được chính dự án của mình.
 */
function requiredWorkspacePermission(request: Request): string | undefined {
  if (request.method === 'GET') return undefined;

  const path = request.path;
  // Xoá tài liệu hay thư mục là thao tác không có đường lùi, nên nó có quyền
  // riêng chứ không đi chung với quyền ghi.
  if (
    request.method === 'DELETE' &&
    (path.includes('/documents') || path.includes('/folders')) &&
    !path.includes('/links/')
  ) {
    return 'workspace.document.delete';
  }
  if (path.includes('/documents') || path.includes('/folders')) return 'workspace.document.write';
  return 'workspace.task.write';
}

/**
 * JWT, CSRF, access-decision và service token nằm ở `ModuleAccess` dùng chung;
 * guard này chỉ giữ phần riêng của Workspace — ánh xạ quyền và dựng actor.
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'workspace' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) return this.authorizeService(request);

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);

    // Phân giải database bằng quyền đọc — ai dùng được module cũng phải có nó.
    // Quyền chi tiết kiểm ở dưới, trên danh sách quyền mà access-decision trả
    // về, nên `manage` bao hàm quyền hẹp mà không cần cấp thêm dòng nào.
    const decision = await this.access.decision(principal, 'workspace.read');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập Workspace.',
      });
    }

    const held = decision.principal.permissions;
    const isTenantAdmin = decision.principal.roles.includes('tenant-admin');
    /*
     * Quyền xoá là ngoại lệ của luật "manage bao hàm quyền hẹp".
     *
     * Platform hiện cấp cùng một bộ quyền cho mọi người dùng tenant, trong đó
     * có `workspace.manage`; nếu để `manage` bao luôn quyền xoá thì ai cũng
     * xoá được kho tài liệu. Vì vậy quyền này chỉ đến từ hai nguồn: là quản
     * trị tenant, hoặc được cấp đích danh `workspace.document.delete`.
     */
    const canDeleteDocuments = isTenantAdmin || held.includes('workspace.document.delete');
    const required = requiredWorkspacePermission(request);
    if (required === 'workspace.document.delete') {
      if (!canDeleteDocuments) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: 'Bạn không có quyền xoá tài liệu hoặc thư mục.',
        });
      }
    } else if (required && !held.includes(required) && !held.includes('workspace.manage')) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message:
          required === 'workspace.document.write'
            ? 'Bạn không có quyền ghi tài liệu.'
            : required === 'workspace.manage'
              ? 'Bạn không có quyền quản trị danh mục dùng chung.'
              : 'Bạn không có quyền ghi dự án và công việc.',
      });
    }

    this.databases.register(decision.database);
    request.workspaceActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      // `system_role` của người dùng được Platform Core nối vào roles; Procedure
      // đã dùng đúng tín hiệu này cho cờ override của nó.
      isTenantAdmin,
      canManage: held.includes('workspace.manage'),
      canWriteTasks: held.includes('workspace.manage') || held.includes('workspace.task.write'),
      canWriteDocuments:
        held.includes('workspace.manage') || held.includes('workspace.document.write'),
      canDeleteDocuments,
    };
    return true;
  }

  /**
   * Lời gọi service-to-service (`/v1/internal/*`): hiện chỉ gồm hai route đọc
   * nhãn công việc và dự án cho module khác.
   */
  private async authorizeService(request: WorkspaceRequest): Promise<boolean> {
    const caller = await this.access.authorizeService(request);
    this.databases.register(caller.database);

    // Bên gọi nội bộ KHÔNG được quản trị danh mục dùng chung và không mang tư
    // cách quản trị viên tenant.
    request.workspaceActor = {
      tenantId: caller.tenantId,
      userId: WORKSPACE_SYSTEM_ACTOR_ID,
      displayName: 'Hệ thống',
      isTenantAdmin: false,
      canManage: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    return true;
  }
}
