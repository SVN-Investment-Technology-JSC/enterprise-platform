import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { isTenantAdmin, tenantActionHeld } from '@enterprise-platform/contracts-identity';
import { TenantStorageRouter, type SharedActor } from '@enterprise-platform/module-shared';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Định danh actor của lời gọi nội bộ; không phải người dùng thật. */
const SHARED_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** Route chuyển tiếp tệp (`/v1/files/<phiếu>`): GET tải xuống, PUT tải lên. */
const FILE_PROXY_ROUTE = /\/v1\/files\/[^/]+$/;

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
 * nhận một actor hệ thống không có quyền nào, nên route nội bộ không dùng được
 * để đọc hay ghi tài liệu của người dùng. Gồm `POST /v1/internal/storage/capacity-check`
 * và `/v1/internal/filings/*`: phân hệ khác (Văn thư) lưu tệp, chỉ trong thư mục
 * gốc do chính phân hệ đó dựng (`FilingService`).
 *
 * Route chuyển tiếp tệp `/v1/files/<phiếu>` (kho ngoài ở chế độ `proxy`) không đi
 * qua phiên người dùng: phiếu do service ký lúc người dùng đã qua guard xin URL,
 * như URL ký sẵn của S3. Guard kiểm chữ ký, hạn, thao tác của phiếu rồi mở DB của
 * tenant trong phiếu; không gắn actor nào, nên route này không gọi được API khác.
 */
@Injectable()
export class SharedAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'shared' });

  constructor(
    private readonly databases: TenantDatabaseRegistry,
    private readonly storages: TenantStorageRouter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SharedRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) return this.authorizeService(request);
    if (FILE_PROXY_ROUTE.test(request.path)) return this.authorizeFileTicket(request);

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

  /** Phiếu hợp lệ thì bảo đảm DB của tenant đã đăng ký; phiếu hỏng trả 403. */
  private async authorizeFileTicket(request: SharedRequest): Promise<boolean> {
    const token = request.path.split('/').pop() ?? '';
    const operation = request.method === 'PUT' ? 'put' : request.method === 'GET' || request.method === 'HEAD' ? 'get' : undefined;
    const ticket = operation ? this.storages.verifyTicket(token, operation) : undefined;
    if (!ticket) {
      throw new ForbiddenException({
        code: 'FILE_TICKET_INVALID',
        message: 'Liên kết tệp không hợp lệ hoặc đã hết hạn.',
      });
    }
    try {
      this.databases.require(ticket.t);
    } catch {
      this.databases.register(await this.access.tenantDatabase(ticket.t));
    }
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
