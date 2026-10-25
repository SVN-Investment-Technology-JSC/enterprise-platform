import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { isTenantAdmin, tenantActionHeld } from '@enterprise-platform/contracts-identity';
import type { SharedActor } from '@enterprise-platform/module-shared';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Định danh actor của lời gọi nội bộ; không phải người dùng thật. */
const SHARED_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

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
 * Route nội bộ `/v1/internal/*` (service-to-service) không đi qua cookie người
 * dùng: guard tự xác thực service token ở `authorizeService`, và bên gọi chỉ
 * nhận một actor hệ thống không có quyền nào, nên route nội bộ không thể dùng
 * để đọc hay ghi tài liệu. Hiện chỉ có `POST /v1/internal/storage/capacity-check`.
 */
@Injectable()
export class SharedAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'shared' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SharedRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) return this.authorizeService(request);

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

  /**
   * Lời gọi service-to-service: xác thực `x-service-token` (fail closed khi chưa
   * cấu hình) và `x-tenant-id`. Actor hệ thống không phải quản trị, không có
   * quyền ghi hay xoá tài liệu.
   */
  private async authorizeService(request: SharedRequest): Promise<boolean> {
    const caller = await this.access.authorizeService(request);
    this.databases.register(caller.database);
    request.sharedActor = {
      tenantId: caller.tenantId,
      userId: SHARED_SYSTEM_ACTOR_ID,
      displayName: 'Hệ thống',
      isTenantAdmin: false,
      canManage: false,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    return true;
  }
}
