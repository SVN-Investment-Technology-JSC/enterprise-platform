import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { isTenantAdmin, tenantActionHeld } from '@enterprise-platform/contracts-identity';
import type { SocialActor } from '@enterprise-platform/module-social';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface SocialRequest extends Request {
  socialActor?: SocialActor;
}

/**
 * JWT, CSRF, access-decision nằm ở `ModuleAccess` dùng chung; guard này chỉ
 * giữ phần riêng của Mạng nội bộ — ánh xạ quyền và dựng actor.
 *
 * Vào phân hệ bằng probe `module.access` (lấy danh sách quyền), rồi đòi `social.read` cho mọi route:
 * thiếu thì 403. Đăng bài, bình luận, phản ứng, tải tệp cần `social.post.write` (cờ `canWrite`, kiểm ở
 * tầng application); kiểm duyệt cần `social.post.moderate`, quản lý chuyên mục cần `social.manage`.
 * Quản trị tenant có mọi quyền. Vai trò mặc định "Nhân viên mặc định" được gán sẵn `social.read` và
 * `social.post.write` (migration `tenant/core/0019`) để người dùng hiện có không mất quyền.
 *
 * Phân hệ chưa có route nội bộ `/v1/internal/*` nào, nên không nhận lời gọi
 * service-to-service.
 */
@Injectable()
export class SocialAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'social' });

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SocialRequest>();
    if (this.access.isHealthCheck(request)) return true;
    if (this.access.isInternal(request)) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: 'Không có route nội bộ.' });
    }

    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    const decision = await this.access.decision(principal, 'module.access');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({
        code: decision.code ?? 'ACCESS_DENIED',
        message: 'Không được phép truy cập Mạng nội bộ.',
      });
    }

    const held = decision.principal.permissions;
    const tenantAdmin = isTenantAdmin(decision.principal.roles);
    const canManage = tenantAdmin || tenantActionHeld(held, 'social.manage');
    const canModerate = tenantAdmin || tenantActionHeld(held, 'social.post.moderate');
    const canWrite = canModerate || tenantActionHeld(held, 'social.post.write');
    const canRead = canManage || canWrite || tenantActionHeld(held, 'social.read');
    if (!canRead) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCESS_DENIED',
        message: 'Bạn không có quyền xem Mạng nội bộ.',
      });
    }

    this.databases.register(decision.database);
    request.socialActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      isTenantAdmin: tenantAdmin,
      canRead,
      canWrite,
      canModerate,
      canManage,
    };
    return true;
  }
}
