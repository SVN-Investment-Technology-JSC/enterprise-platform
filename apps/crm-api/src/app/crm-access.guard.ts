import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { isTenantAdmin, tenantActionHeld } from '@enterprise-platform/contracts-identity';
import type { CrmActor } from '@enterprise-platform/module-crm';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Định danh actor của lời gọi nội bộ; không phải người dùng thật. */
const CRM_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

interface CrmRequest extends Request {
  crmActor?: CrmActor;
}

/**
 * JWT, CSRF, access-decision nằm ở `ModuleAccess` dùng chung; guard này chỉ
 * giữ phần riêng của Bán hàng — ánh xạ quyền và dựng actor.
 *
 * Mọi lời gọi cần `crm.read` (mọi quyền khác của Bán hàng đều kéo theo quyền
 * này — xem TENANT_ACTION_IMPLIES). Guard không chặn theo method: thao tác cụ
 * thể cần cờ nào (lập báo giá, duyệt, thu tiền...) kiểm ở tầng application,
 * nơi biết thao tác đó là gì. Tenant lấy từ token đã xác minh, không lấy từ
 * header.
 *
 * Route nội bộ `/v1/internal/*` (service-to-service) không đi qua cookie người
 * dùng: guard tự xác thực service token ở `authorizeService`, và bên gọi chỉ
 * nhận một actor hệ thống không có quyền nghiệp vụ nào. Route nội bộ nào cần
 * đọc hay ghi thì tự kiểm ở application.
 */
@Injectable()
export class CrmAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'crm' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CrmRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) return this.authorizeService(request);

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    const decision = await this.access.decision(principal, 'crm.read');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        statusCode: 403,
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập CRM.',
      });
    }

    const held = decision.principal.permissions;
    const tenantAdmin = isTenantAdmin(decision.principal.roles);
    // Quản trị tenant có mọi quyền nghiệp vụ; còn lại tính theo bảng bao hàm.
    const can = (action: string) => tenantAdmin || tenantActionHeld(held, action);

    this.databases.register(decision.database);
    request.crmActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      isTenantAdmin: tenantAdmin,
      canReadAll: can('crm.read.all'),
      canWriteOpportunity: can('crm.opportunity.write'),
      canWriteQuote: can('crm.quote.write'),
      canApproveQuote: can('crm.quote.approve'),
      canWriteOrder: can('crm.order.write'),
      canWriteContract: can('crm.contract.write'),
      canWriteReceivable: can('crm.receivable.write'),
      canWriteWarranty: can('crm.warranty.write'),
      canReadReport: can('crm.report.read'),
      canManage: can('crm.manage'),
    };
    return true;
  }

  /**
   * Lời gọi service-to-service: xác thực `x-service-token` (fail closed khi chưa
   * cấu hình) và `x-tenant-id`. Actor hệ thống không phải quản trị, không có
   * quyền nghiệp vụ nào.
   */
  private async authorizeService(request: CrmRequest): Promise<boolean> {
    const caller = await this.access.authorizeService(request);
    this.databases.register(caller.database);
    request.crmActor = {
      tenantId: caller.tenantId,
      userId: CRM_SYSTEM_ACTOR_ID,
      displayName: 'Hệ thống',
      isTenantAdmin: false,
      canReadAll: false,
      canWriteOpportunity: false,
      canWriteQuote: false,
      canApproveQuote: false,
      canWriteOrder: false,
      canWriteContract: false,
      canWriteReceivable: false,
      canWriteWarranty: false,
      canReadReport: false,
      canManage: false,
    };
    return true;
  }
}
