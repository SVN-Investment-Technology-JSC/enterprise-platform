import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmPublicRoute } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { checkLinkedReversal } from '../infrastructure/hrm-request-reversal.js';

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
}
