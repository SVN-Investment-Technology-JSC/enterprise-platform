import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { FinanceActor } from '@enterprise-platform/module-finance';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface FinanceRequest extends Request {
  financeActor?: FinanceActor;
}

/**
 * JWT, CSRF và access-decision nằm ở `ModuleAccess` dùng chung. Guard này chỉ xác nhận người dùng
 * được vào module (có ít nhất một quyền `finance.*`) và dựng actor; quyền chi tiết từng thao tác
 * (lập, duyệt, quản lý tài khoản, xem báo cáo...) do tầng nghiệp vụ kiểm trên danh sách quyền của actor,
 * vì cùng một route có thể được cho phép hay không tuỳ loại phiếu.
 */
@Injectable()
export class FinanceAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'finance' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FinanceRequest>();
    if (this.access.isHealthCheck(request)) return true;

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    const decision = await this.access.decision(principal, 'module.access');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập Tài chính.',
      });
    }

    this.databases.register(decision.database);
    request.financeActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      permissions: decision.principal.permissions,
    };
    return true;
  }
}
