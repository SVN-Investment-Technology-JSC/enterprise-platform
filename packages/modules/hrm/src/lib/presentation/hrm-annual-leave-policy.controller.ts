import type {
  AnnualLeavePolicyResponse,
  SaveAnnualLeavePolicyRequest,
} from '@enterprise-platform/contracts-hrm';
import { Body, Controller, Get, Put, Req, UseInterceptors } from '@nestjs/common';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import {
  readAnnualLeavePolicy,
  saveAnnualLeavePolicy,
  validateAnnualLeavePolicyInput,
} from '../infrastructure/hrm-annual-leave-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';

/**
 * Chính sách phép năm: MỘT cấu hình duy nhất của tenant (lý do nghỉ là phép năm, căn cứ tính,
 * định mức năm, ứng phép, thâm niên, chuyển phép). Lưu xuống lịch cộng phép cũ nhưng không lộ phiên bản.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1/annual-leave-policy')
export class HrmAnnualLeavePolicyController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get()
  @RequirePermission('hrm.leave.read')
  async get(@Req() req: Request): Promise<{ data: AnnualLeavePolicyResponse }> {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    return {
      data: await hrmTransaction(pool, (db) =>
        readAnnualLeavePolicy(db, tenantId),
      ),
    };
  }

  @Put()
  @RequirePermission('hrm.leave.manage')
  async put(
    @Req() req: Request,
    @Body() body: SaveAnnualLeavePolicyRequest,
  ): Promise<{ data: AnnualLeavePolicyResponse }> {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    const input = validateAnnualLeavePolicyInput(body);
    return {
      data: await hrmTransaction(pool, async (db) => {
        const { closedOtherSchedules } = await saveAnnualLeavePolicy(
          db,
          tenantId,
          principal.userId,
          input,
        );
        return {
          ...(await readAnnualLeavePolicy(db, tenantId)),
          closedOtherSchedules,
        };
      }),
    };
  }
}
