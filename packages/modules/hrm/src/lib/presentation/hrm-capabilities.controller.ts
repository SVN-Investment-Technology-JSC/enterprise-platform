import { Controller, Get, Req } from '@nestjs/common';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { HRM_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import type { Request } from 'express';
import { HrmPublicRoute } from '../infrastructure/hrm-access.guard.js';
import {
  HRM_APPROVE_PERMISSIONS,
  assignedKindsWithoutPermission,
} from '../infrastructure/hrm-approval-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

const ASSIGNED_CACHE_MS = 30_000;
const ASSIGNED_TIMEOUT_MS = 3_000;

@Controller('v1')
export class HrmCapabilitiesController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Kết quả "được giao duyệt" giữ ngắn hạn: giao diện làm mới quyền mỗi 2 phút và mỗi lần quay lại cửa sổ. */
  private readonly assignedCache = new Map<string, { at: number; kinds: HrmRequestKind[] }>();

  private async assignedKinds(context: {
    pool: Parameters<typeof assignedKindsWithoutPermission>[0];
    tenantId: string;
    principal: { userId: string; permissions?: readonly string[] };
  }): Promise<HrmRequestKind[]> {
    const key = `${context.tenantId}:${context.principal.userId}`;
    const cached = this.assignedCache.get(key);
    if (cached && Date.now() - cached.at < ASSIGNED_CACHE_MS) return cached.kinds;
    // Procedure chậm thì không giữ chân cả giao diện: bỏ qua phần này, lần làm mới sau sẽ thử lại.
    const kinds = await Promise.race([
      assignedKindsWithoutPermission(context.pool, context.tenantId, {
        userId: context.principal.userId,
        permissions: context.principal.permissions,
      }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ASSIGNED_TIMEOUT_MS)),
    ]);
    if (!kinds) return cached?.kinds ?? [];
    if (this.assignedCache.size > 2000) this.assignedCache.clear();
    this.assignedCache.set(key, { at: Date.now(), kinds });
    return kinds;
  }
  // Mọi tài khoản có module HRM đều xem được quyền của chính mình (module.access kiểm trong handler).
  @HrmPublicRoute()
  @Get('capabilities')
  async get(@Req() req: Request) {
    const context = await this.ctx.getContext(req, 'module.access');
    const actions: string[] = HRM_PERMISSION_ACTIONS.filter((a) =>
      this.ctx.has(context, a.key),
    ).map((a) => a.key);
    // Người được giao duyệt riêng (người dự phòng của PE, chức danh duyệt dự phòng) chưa có quyền duyệt HRM: cho thấy
    // mục "Đơn từ cần xử lý" và loại đơn tương ứng. Danh sách chỉ trả đúng đơn được giao (xem resolveApprovalScope).
    if (actions.includes('hrm.read')) {
      const assigned = await this.assignedKinds(context);
      for (const kind of assigned) actions.push(HRM_APPROVE_PERMISSIONS[kind].approve);
    }
    return {
      data: {
        actions: [...new Set(actions)],
        catalog: HRM_PERMISSION_ACTIONS,
        displayName: context.principal.displayName,
        tenantId: context.tenantId,
        // FE ẩn lựa chọn PROCEDURE khi false; API lưu binding từ chối PROCEDURE khi false.
        procedureAvailable: await this.ctx.procedureAvailable(context.tenantId),
      },
    };
  }
}
