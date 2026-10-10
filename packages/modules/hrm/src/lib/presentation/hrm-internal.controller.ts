import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmPublicRoute } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
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
