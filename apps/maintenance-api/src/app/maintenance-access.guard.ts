import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { MaintenanceActor } from '@enterprise-platform/module-maintenance';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface MaintenanceRequest extends Request { maintenanceActor?: MaintenanceActor }

/**
 * Quyền cần cho một request, tách theo *loại thao tác* chứ không theo HTTP method.
 *
 * Ghi nhận một phiếu sự cố và sửa lịch bảo trì cả năm đều là POST, nhưng kỹ
 * thuật viên phải làm được cái đầu mà không được đụng cái sau. Hằng
 * `maintenance.occurrence.manage` đã có sẵn trong contract từ trước, chỉ chưa
 * được dùng — giờ mới nối vào.
 */
function requiredMaintenancePermission(request: Request): string | undefined {
  if (request.method === 'GET') return undefined;

  // Xử lý phiếu: tạo sự cố, đánh dấu hoàn thành.
  if (request.path.includes('/occurrences')) return 'maintenance.occurrence.manage';

  // Còn lại là cấu hình: lịch bảo trì, ma trận, chạy scheduler.
  return 'maintenance.manage';
}

/**
 * JWT, CSRF, access-decision và service token nằm ở `ModuleAccess` dùng chung;
 * guard này chỉ giữ phần riêng của Maintenance — ánh xạ quyền và dựng actor.
 */
@Injectable()
export class MaintenanceAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'maintenance' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MaintenanceRequest>();
    if (this.access.isHealthCheck(request)) return true;
    // Service-to-service routes (scheduler ticks driven by cron/worker) carry no
    // browser session, so CSRF and the user access-decision do not apply.
    if (this.access.isInternal(request)) return this.authorizeService(request);
    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    // Phân giải database bằng quyền đọc, rồi kiểm quyền chi tiết trên danh sách
    // trả về — nhờ đó `maintenance.manage` bao hàm quyền hẹp, không cần cấp thêm.
    const decision = await this.access.decision(principal, 'maintenance.read');
    if (!decision.allowed || !decision.database || !decision.principal) throw new ForbiddenException({ code: decision.code ?? 'ACCESS_DENIED', message: 'Không được phép truy cập Maintenance.' });

    const held = decision.principal.permissions;
    const required = requiredMaintenancePermission(request);
    if (required && !held.includes(required) && !held.includes('maintenance.manage')) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message:
          required === 'maintenance.occurrence.manage'
            ? 'Bạn không có quyền xử lý phiếu bảo trì.'
            : 'Bạn không có quyền sửa cấu hình bảo trì.',
      });
    }

    this.databases.register(decision.database);
    request.maintenanceActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      canManage: held.includes('maintenance.manage'),
      canHandleOccurrences:
        held.includes('maintenance.manage') || held.includes('maintenance.occurrence.manage'),
    };
    return true;
  }

  private async authorizeService(request: MaintenanceRequest): Promise<boolean> {
    const caller = await this.access.authorizeService(request);
    this.databases.register(caller.database);
    request.maintenanceActor = {
      tenantId: caller.tenantId,
      userId: 'system',
      displayName: 'Hệ thống',
      canManage: true,
    };
    return true;
  }
}
