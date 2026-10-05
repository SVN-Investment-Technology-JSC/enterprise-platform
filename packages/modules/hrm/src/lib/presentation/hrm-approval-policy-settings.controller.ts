import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  loadApprovalPolicySettings,
  saveApprovalPolicySettings,
} from '../infrastructure/hrm-approval-policy-settings.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';

/** Cấu hình chính sách duyệt đơn của tenant (ngoại lệ cho phép tự duyệt). */
@Controller('v1/approval-policy-settings')
export class HrmApprovalPolicySettingsController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get()
  async get(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    return { data: await loadApprovalPolicySettings(pool, tenantId) };
  }

  @Put()
  async put(@Req() req: Request, @Body() body: unknown) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    const data = await hrmTransaction(pool, (db) =>
      saveApprovalPolicySettings(db, tenantId, principal.userId, body),
    );
    return { data };
  }
}
