import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { InventoryActor } from '@enterprise-platform/module-inventory';
import { tenantActionHeld } from '@enterprise-platform/contracts-identity';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { resolveInventoryRoute } from './inventory-route-permissions';

/** Id của bên gọi dịch vụ; các cột `created_by` là uuid nên không nhận chuỗi tự do. */
const INVENTORY_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000002';

interface InventoryRequest extends Request {
  inventoryActor?: InventoryActor;
}

const DENIED_MESSAGES: Readonly<Record<string, string>> = {
  'inventory.transaction.write': 'Bạn không có quyền ghi phát sinh tồn kho.',
  'inventory.document.approve': 'Bạn không có quyền duyệt chứng từ kho.',
  'inventory.quality.write': 'Bạn không có quyền đổi trạng thái chất lượng hàng.',
  'inventory.manage': 'Bạn không có quyền sửa danh mục kho.',
};

/** Route chưa khai trong `INVENTORY_ROUTE_RULES`: từ chối thay vì đoán quyền. */
function undeclaredRoute(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'ROUTE_NOT_DECLARED',
    message: 'Thao tác này chưa được khai báo quyền trong phân hệ Kho.',
  });
}

/**
 * JWT, CSRF, access-decision và service token nằm ở `ModuleAccess` dùng chung;
 * guard này chỉ giữ phần riêng của Inventory — ánh xạ quyền và dựng actor.
 */
@Injectable()
export class InventoryAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'inventory' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<InventoryRequest>();
    if (this.access.isHealthCheck(request)) return true;
    // Quyền tra theo bảng route khớp đúng method và đường dẫn; không có dòng thì từ chối.
    const route = resolveInventoryRoute(request.method, request.path);
    // Service-to-service routes (Procedure resolving a Role E task template) carry
    // no browser session, so CSRF and the user access-decision do not apply.
    if (this.access.isInternal(request)) {
      const allowed = await this.authorizeService(request);
      if (route?.permission !== 'service') throw undeclaredRoute();
      return allowed;
    }

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    if (!route || route.permission === 'service') throw undeclaredRoute();

    // Phân giải database bằng quyền đọc — ai dùng được module cũng phải có nó.
    // Quyền chi tiết cho từng loại thao tác kiểm ở dưới, trên danh sách quyền mà
    // access-decision trả về, nên `manage` bao hàm quyền hẹp mà không cần cấp
    // thêm dòng nào cho quản trị.
    const decision = await this.access.decision(principal, 'inventory.read');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập Inventory.',
      });
    }

    const held = decision.principal.permissions;
    const required = route.permission;
    if (required !== 'inventory.read' && !tenantActionHeld(held, required)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCESS_DENIED',
        message: DENIED_MESSAGES[required] ?? 'Bạn không có quyền thực hiện thao tác này trong phân hệ Kho.',
      });
    }

    this.databases.register(decision.database);
    request.inventoryActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      canManage: tenantActionHeld(held, 'inventory.manage'),
      canWriteTransactions: tenantActionHeld(held, 'inventory.transaction.write'),
      canApproveDocuments: tenantActionHeld(held, 'inventory.document.approve'),
      canWriteQuality: tenantActionHeld(held, 'inventory.quality.write'),
      // Giá vốn, giá trị tồn, nguồn giữ hàng: `inventory.manage` bao hàm, `inventory.read` thì không.
      canReadCost: tenantActionHeld(held, 'inventory.cost.read'),
    };
    return true;
  }

  private async authorizeService(request: InventoryRequest): Promise<boolean> {
    const caller = await this.access.authorizeService(request);
    this.databases.register(caller.database);

    // Bên gọi nội bộ (Quy trình giữ chỗ vật tư cho một bước) được ghi phát sinh
    // tồn kho, nhưng KHÔNG được sửa danh mục — không dịch vụ nào có lý do xoá
    // một mã vật tư.
    request.inventoryActor = {
      tenantId: caller.tenantId,
      // created_by là cột uuid, nên actor dịch vụ cần một id thật. Cùng cách
      // Procedure giải bằng PROCEDURE_SYSTEM_ACTOR_ID.
      userId: INVENTORY_SYSTEM_ACTOR_ID,
      displayName: 'Hệ thống',
      canManage: false,
      canWriteTransactions: true,
      // Dịch vụ không duyệt thay người: chứng từ cần duyệt phải có người duyệt thật.
      canApproveDocuments: false,
      // Đổi chất lượng cần người kiểm định thật, có lý do và người chịu trách nhiệm.
      canWriteQuality: false,
      // Bán hàng báo giá theo giá vốn bình quân từ danh mục nội bộ.
      canReadCost: true,
    };
    return true;
  }
}
