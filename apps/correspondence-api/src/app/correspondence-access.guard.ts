import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { isTenantAdmin, tenantActionHeld } from '@enterprise-platform/contracts-identity';
import type { CorrespondenceActor } from '@enterprise-platform/module-correspondence';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface CorrespondenceRequest extends Request {
  correspondenceActor?: CorrespondenceActor;
}

/**
 * JWT, CSRF, access-decision nằm ở `ModuleAccess` dùng chung; guard này chỉ ánh xạ
 * quyền và dựng actor của Văn thư.
 *
 * Mọi lời gọi cần `correspondence.read` (mọi quyền khác của phân hệ kéo theo quyền này,
 * xem TENANT_ACTION_IMPLIES). Ai được làm gì ở bước nào (văn thư, lãnh đạo được trình,
 * người thuộc phòng ban được giao) kiểm tiếp ở tầng application trên dữ liệu đã khoá.
 *
 * Phân hệ không có route nội bộ `/v1/internal/*`; tệp nằm ở Hệ dùng chung và Văn thư
 * là bên gọi route nội bộ của phân hệ đó.
 */
@Injectable()
export class CorrespondenceAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'correspondence' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CorrespondenceRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: 'Không có route nội bộ.' });
    }

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    const decision = await this.access.decision(principal, 'correspondence.read');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập Văn thư.',
      });
    }

    const held = decision.principal.permissions;
    const tenantAdmin = isTenantAdmin(decision.principal.roles);
    this.databases.register(decision.database);
    request.correspondenceActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      isTenantAdmin: tenantAdmin,
      canRegister: tenantAdmin || tenantActionHeld(held, 'correspondence.letter.register'),
      // Quyền chỉ đạo cấp đích danh: quản trị tenant không tự thành lãnh đạo nhận công văn.
      canDirect: held.includes('correspondence.letter.direct'),
      canManage: tenantAdmin || tenantActionHeld(held, 'correspondence.manage'),
    };
    return true;
  }
}
