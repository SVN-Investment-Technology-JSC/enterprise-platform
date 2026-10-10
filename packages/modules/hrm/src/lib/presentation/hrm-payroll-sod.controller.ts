import { BadRequestException, Body, Controller, ForbiddenException, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  loadPayrollSod,
  payrollSodReady,
} from '../infrastructure/hrm-payroll-sod.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';

/** Cấu hình phân tách nhiệm vụ lương (FIX-C-12). */
@Controller('v1')
export class HrmPayrollSodController {
  constructor(private readonly ctx: HrmContextService) {}

  @RequirePermission('hrm.payroll.read')
  @Get('payroll-sod-settings')
  async get(@Req() req: Request) {
    // Người xem lương hoặc người cấu hình lương đều đọc được cấu hình này (cấu hình lương không kéo theo xem lương).
    const context = await this.ctx.getContext(req, 'hrm.read');
    if (
      !this.ctx.has(context, 'hrm.payroll.read') &&
      !this.ctx.has(context, 'hrm.payroll.configure')
    )
      throw new ForbiddenException('Cần quyền xem hoặc cấu hình lương');
    const { pool, tenantId } = context;
    const ready = await payrollSodReady(pool);
    return {
      data: ready
        ? { ...(await loadPayrollSod(pool, tenantId)), enforced: true }
        : {
            separateCalcFinalize: false,
            separateFinalizePublish: false,
            enforced: false,
          },
    };
  }

  @RequirePermission('hrm.payroll.configure')
  @Put('payroll-sod-settings')
  async put(
    @Req() req: Request,
    @Body()
    body: { separateCalcFinalize?: boolean; separateFinalizePublish?: boolean },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    if (
      typeof body?.separateCalcFinalize !== 'boolean' ||
      typeof body?.separateFinalizePublish !== 'boolean'
    )
      throw new BadRequestException('Cấu hình phân tách nhiệm vụ không hợp lệ');
    await hrmTransaction(pool, async (db) => {
      if (!(await payrollSodReady(db)))
        throw new BadRequestException('Chưa áp dụng migration 0026');
      await db.query(
        `INSERT INTO hrm_schema.payroll_sod_settings(tenant_id,separate_calc_finalize,separate_finalize_publish,updated_by,updated_at)
         VALUES($1,$2,$3,$4,now())
         ON CONFLICT(tenant_id) DO UPDATE SET separate_calc_finalize=$2,separate_finalize_publish=$3,updated_by=$4,updated_at=now()`,
        [
          tenantId,
          body.separateCalcFinalize,
          body.separateFinalizePublish,
          principal.userId,
        ],
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'PAYROLL_SOD_CONFIGURED',$1,$3)`,
        [tenantId, principal.userId, JSON.stringify(body)],
      );
    });
    return { data: { ...body, enforced: true } };
  }
}
