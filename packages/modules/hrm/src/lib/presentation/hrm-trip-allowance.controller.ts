import { Body, Controller, Delete, Get, Param, Post, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import {
  cancelTripAllowanceRate,
  createTripAllowanceRate,
  listTripAllowanceRates,
} from '../infrastructure/hrm-trip-allowance.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Mức công tác phí mỗi ngày theo hình thức công tác. Cấu hình cùng quyền với cấu hình lương
 * (hrm.payroll.configure); mức được tính vào bảng công khi chốt công và bảng lương chỉ cộng lại.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmTripAllowanceController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get('trip-allowance-rates')
  async list(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.payroll.configure');
    return { data: await listTripAllowanceRates(pool, tenantId) };
  }

  @Post('trip-allowance-rates')
  async create(
    @Req() req: Request,
    @Body() body: { tripType?: unknown; dailyAmount?: unknown; effectiveFrom?: unknown; note?: unknown },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.payroll.configure');
    return { data: await hrmTransaction(pool, (db) => createTripAllowanceRate(db, tenantId, principal.userId, body ?? {})) };
  }

  @Delete('trip-allowance-rates/:id')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.payroll.configure');
    await hrmTransaction(pool, (db) => cancelTripAllowanceRate(db, tenantId, principal.userId, requireUuid(id, 'id')));
    return { data: { id, cancelled: true } };
  }
}
