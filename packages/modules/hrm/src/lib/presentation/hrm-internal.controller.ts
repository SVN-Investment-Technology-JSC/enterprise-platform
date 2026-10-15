import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmPublicRoute } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { findAvailability } from '../infrastructure/hrm-fleet.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';
import {
  checkLinkedReversal,
  checkRequestReversal,
} from '../infrastructure/hrm-request-reversal.js';

/**
 * API nội bộ cho module khác, xác thực bằng service token. Chỉ đọc: module khác
 * hỏi, HRM trả lời; mọi thay đổi dữ liệu HRM vẫn đi qua sự kiện.
 */
@Controller('v1/internal')
export class HrmInternalController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Procedure hỏi trước khi huỷ hiệu lực hồ sơ đứng sau một đơn HRM. */
  @HrmPublicRoute()
  @Get('procedure-links/:linkId/reversal-check')
  async reversalCheck(@Req() req: Request, @Param('linkId') linkId: string) {
    const { pool, tenantId } = await this.ctx.serviceContext(req);
    return checkLinkedReversal(pool, tenantId, linkId);
  }

  /** Workspace và Maintenance xem xe và tài xế còn trống để form không cho chọn trùng lịch. */
  @HrmPublicRoute()
  @Get('fleet/availability')
  async fleetAvailability(
    @Req() req: Request,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('excludeSourceType') excludeSourceType?: string,
    @Query('excludeSourceId') excludeSourceId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.serviceContext(req);
    const exclude =
      excludeSourceType && excludeSourceId
        ? { sourceType: excludeSourceType as never, sourceId: requireUuid(excludeSourceId, 'excludeSourceId') }
        : undefined;
    return { data: await findAvailability(pool, tenantId, from, to, exclude) };
  }

  /** Workspace hỏi trước khi gửi yêu cầu huỷ hiệu lực đơn từ của dự án. */
  @HrmPublicRoute()
  @Get('requests/:kind/:id/reversal-check')
  async requestReversalCheck(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    const { pool, tenantId } = await this.ctx.serviceContext(req);
    return checkRequestReversal(pool, tenantId, kind, id);
  }
}
