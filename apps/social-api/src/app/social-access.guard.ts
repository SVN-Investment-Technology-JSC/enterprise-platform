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
 * Phân hệ mở cho mọi thành viên của tenant đã bật nó (như Trợ lý): vào bằng probe
 * `module.access`, ai cũng đọc và đăng bài được. Chỉ kiểm duyệt (`social.post.moderate`) và quản lý
 * chuyên mục (`social.manage`) còn đòi quyền, hoặc vai trò quản trị tenant. Thao tác cụ thể (sửa bài
 * của chính mình hay của người khác) kiểm tiếp ở tầng application.
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
    // Mạng nội bộ mở cho mọi thành viên của tenant đã bật phân hệ: đọc và đăng bài không đòi quyền.
    const canWrite = true;
    const canRead = true;

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
