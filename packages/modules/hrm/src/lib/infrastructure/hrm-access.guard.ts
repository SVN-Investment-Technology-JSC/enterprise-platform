import type { HrmAction } from '@enterprise-platform/contracts-identity';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { HrmContextService } from './hrm-context.service.js';

export const HRM_REQUIRED_PERMISSION = 'hrm:required-permission';
export const HRM_PUBLIC_ROUTE = 'hrm:public-route';

/**
 * Khai báo quyền tối thiểu của một route HRM. Ở chế độ enforce, guard kiểm tra quyền này
 * trước khi vào handler (handler vẫn tự kiểm tra chi tiết hơn bằng HrmContextService).
 */
export const RequirePermission = (permission: HrmAction) =>
  SetMetadata(HRM_REQUIRED_PERMISSION, permission);

/** Đánh dấu route cố ý không cần quyền HRM (hiếm; phải có lý do rõ ràng). */
export const HrmPublicRoute = () => SetMetadata(HRM_PUBLIC_ROUTE, true);

export type HrmAccessGuardMode = 'audit' | 'enforce';

export function hrmAccessGuardMode(
  env: NodeJS.ProcessEnv = process.env,
): HrmAccessGuardMode {
  return env.HRM_ACCESS_GUARD_MODE?.trim().toLowerCase() === 'enforce'
    ? 'enforce'
    : 'audit';
}

/**
 * HrmAccessGuard (APP_GUARD).
 * - audit (mặc định): chỉ ghi WARN (mỗi route một lần) các route HRM chưa khai báo quyền; KHÔNG chặn.
 * - enforce: từ chối 403 route HRM chưa khai báo quyền; route đã khai báo được kiểm tra quyền.
 * Chỉ áp cho controller có tên bắt đầu bằng "Hrm" để không ảnh hưởng route của module khác.
 */
@Injectable()
export class HrmAccessGuard implements CanActivate {
  private readonly logger = new Logger('HrmAccessGuard');
  private readonly warned = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: HrmContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const controller = context.getClass();
    if (!controller?.name?.startsWith('Hrm')) return true;
    const targets = [context.getHandler(), controller];
    if (this.reflector.getAllAndOverride<boolean>(HRM_PUBLIC_ROUTE, targets))
      return true;
    const permission = this.reflector.getAllAndOverride<HrmAction | undefined>(
      HRM_REQUIRED_PERMISSION,
      targets,
    );
    const route = `${controller.name}.${context.getHandler().name}`;
    const mode = hrmAccessGuardMode();
    if (!permission) {
      if (mode === 'enforce')
        throw new ForbiddenException({
          code: 'HRM_PERMISSION_NOT_DECLARED',
          message: 'Route HRM chưa khai báo quyền truy cập.',
        });
      if (!this.warned.has(route)) {
        this.warned.add(route);
        this.logger.warn(`Route chưa khai báo @RequirePermission: ${route}`);
      }
      return true;
    }
    if (mode === 'enforce') {
      const request = context.switchToHttp().getRequest<Request>();
      await this.ctx.getContext(request, permission);
    }
    return true;
  }
}
