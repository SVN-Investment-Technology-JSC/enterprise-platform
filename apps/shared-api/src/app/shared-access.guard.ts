import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { isTenantAdmin, tenantActionHeld } from '@enterprise-platform/contracts-identity';
import type { SharedActor } from '@enterprise-platform/module-shared';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface SharedRequest extends Request {
  sharedActor?: SharedActor;
}

/**
 * JWT, CSRF, access-decision nằm ở `ModuleAccess` dùng chung; guard này chỉ
 * giữ phần riêng của Hệ dùng chung — ánh xạ quyền và dựng actor.
 *
 * Mọi lời gọi cần `shared.read` (ghi, xoá, quản trị kho đều kéo theo quyền này
 * — xem TENANT_ACTION_IMPLIES); lời gọi thay đổi dữ liệu cần thêm quyền ghi
 * hoặc quyền xoá. Quyền xoá không kéo theo quyền ghi nên người chỉ có quyền xoá
 * vẫn dọn được tài liệu. Thao tác cụ thể cần quyền nào, và quyền dựng khung
 * kho, kiểm tiếp ở tầng application, nơi biết thao tác đó là gì.
 *
 * Phân hệ chưa có route nội bộ `/v1/internal/*` nào, nên không nhận lời gọi
 * service-to-service.
 */
@Injectable()
export class SharedAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'shared' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SharedRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: 'Không có route nội bộ.' });
    }

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    const decision = await this.access.decision(principal, 'shared.read');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập Hệ dùng chung.',
      });
    }

    const held = decision.principal.permissions;
    const tenantAdmin = isTenantAdmin(decision.principal.roles);
    const canManage = tenantAdmin || tenantActionHeld(held, 'shared.manage');
    const canWriteDocuments = tenantAdmin || tenantActionHeld(held, 'shared.document.write');
    // Như Workspace: quyền xoá không đi kèm `manage`, chỉ từ quản trị tenant
    // hoặc được cấp đích danh.
    const canDeleteDocuments = tenantAdmin || held.includes('shared.document.delete');

    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      !canWriteDocuments &&
      !canDeleteDocuments
    ) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'Bạn chỉ có quyền xem tài liệu công ty.',
      });
    }

    this.databases.register(decision.database);
    request.sharedActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      isTenantAdmin: tenantAdmin,
      canManage,
      canWriteDocuments,
      canDeleteDocuments,
    };
    return true;
  }
}
