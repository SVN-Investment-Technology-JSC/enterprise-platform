import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { InventoryActor } from '@enterprise-platform/module-inventory';
import { tenantActionHeld } from '@enterprise-platform/contracts-identity';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Id của bên gọi dịch vụ; các cột `created_by` là uuid nên không nhận chuỗi tự do. */
const INVENTORY_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000002';

interface InventoryRequest extends Request {
  inventoryActor?: InventoryActor;
}

/**
 * Quyền cần cho một request, tách theo *loại thao tác* chứ không theo HTTP method.
 *
 * Ghi một dòng xuất kho và xoá một mã vật tư đều là POST/DELETE, nhưng hậu quả
 * khác hẳn nhau: thủ kho phải làm được cái đầu mà không được đụng cái sau. Gộp
 * cả hai vào `inventory.manage` buộc phải cấp quyền quản lý cho mọi thủ kho.
 */
function requiredInventoryPermission(request: Request): string | undefined {
  if (request.method === 'GET') return undefined;

  const path = request.path;
  // Đổi trạng thái chất lượng lô, serial (Cách ly, Lỗi, Chờ kiểm định): quyền
  // riêng của người kiểm định, không đi theo quyền ghi phát sinh tồn kho.
  if (/\/(lots|serials)\/[^/]+\/quality\/?$/.test(path)) {
    return 'inventory.quality.write';
  }

  // Duyệt, từ chối chứng từ kho: quyền riêng, người duyệt không nhất thiết là thủ kho.
  if (/\/stock-documents\/[^/]+\/(approve|reject)\/?$/.test(path)) {
    return 'inventory.document.approve';
  }

  // Phát sinh tồn kho: nhập, xuất, chuyển kho, giữ chỗ vật tư, chứng từ kho.
  if (
    path.includes('/stock-documents') ||
    path.includes('/receipts') ||
    path.includes('/issues') ||
    path.includes('/transfers') ||
    path.includes('/reservations')
  ) {
    return 'inventory.transaction.write';
  }

  // Còn lại là sửa danh mục (vật tư, thiết bị) — vẫn đòi quyền quản lý.
  return 'inventory.manage';
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
    // Service-to-service routes (Procedure resolving a Role E task template) carry
    // no browser session, so CSRF and the user access-decision do not apply.
    if (this.access.isInternal(request)) return this.authorizeService(request);

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);

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
    const required = requiredInventoryPermission(request);
    if (required && !tenantActionHeld(held, required)) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message:
          required === 'inventory.transaction.write'
            ? 'Bạn không có quyền ghi phát sinh tồn kho.'
            : required === 'inventory.document.approve'
              ? 'Bạn không có quyền duyệt chứng từ kho.'
              : required === 'inventory.quality.write'
                ? 'Bạn không có quyền đổi trạng thái chất lượng hàng.'
                : 'Bạn không có quyền sửa danh mục kho.',
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
    };
    return true;
  }
}
