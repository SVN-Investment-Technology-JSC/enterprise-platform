import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

/** Giải thích phạm vi duyệt đơn của người dùng hiện tại (cảnh báo khi thiếu "Báo cáo cho"/trưởng đơn vị). */
@Controller('v1/approval-scope')
export class HrmApprovalScopeController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly approvals: HrmApprovalPolicyService,
  ) {}

  @RequirePermission('hrm.read')
  @Get()
  async get(@Req() req: Request) {
    const { tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    return { data: await this.approvals.scopeStatus({ tenantId, principal }) };
  }
}
