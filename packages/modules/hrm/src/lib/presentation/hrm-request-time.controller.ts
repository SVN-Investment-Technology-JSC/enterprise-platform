import { BadRequestException, Controller, Get, NotFoundException, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { resolveRequestTime, toTimePreview } from '../infrastructure/hrm-request-time.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Xem trước thời gian của đơn từ trước khi gửi: từ ngày giờ đến ngày giờ -> số giờ, số ngày công và từng ngày
 * theo ca thực tế của nhân viên. Cùng quy tắc với lúc tạo đơn (`resolveRequestTime`), nên con số hiển thị chính là
 * con số server sẽ lưu. Quyền như tạo đơn: tự xem của mình, hoặc `hrm.request.manage` để xem cho người khác.
 */
@Controller('v1')
export class HrmRequestTimeController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get('requests/time-preview')
  async timePreview(
    @Req() req: Request,
    @Query('employeeId') employeeId?: string,
    @Query('fromAt') fromAt?: string,
    @Query('toAt') toAt?: string,
    @Query('leaveTypeId') leaveTypeId?: string,
    @Query('unit') unit?: string,
  ) {
    const { pool, tenantId, employeeId: targetEmployeeId } = await this.ctx.getRequestContext(
      req,
      employeeId ? requireUuid(employeeId, 'employeeId') : undefined,
    );
    if (unit !== undefined && unit !== 'DAYS' && unit !== 'HOURS')
      throw new BadRequestException('Đơn vị chỉ nhận DAYS hoặc HOURS.');
    let effectiveUnit: 'DAYS' | 'HOURS' = unit === 'HOURS' ? 'HOURS' : 'DAYS';
    if (leaveTypeId) {
      // Loại nghỉ quyết định đơn vị tính (ngày hoặc giờ).
      const type = (
        await pool.query(
          `SELECT unit FROM hrm_schema.leave_types WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, requireUuid(leaveTypeId, 'leaveTypeId')],
        )
      ).rows[0];
      if (!type) throw new NotFoundException('Không tìm thấy loại nghỉ.');
      effectiveUnit = type.unit === 'HOURS' ? 'HOURS' : 'DAYS';
    }
    const { timezone, fromMs, toMs, result } = await resolveRequestTime(
      pool as unknown as PoolClient,
      tenantId,
      targetEmployeeId,
      fromAt,
      toAt,
      effectiveUnit,
    );
    return { data: toTimePreview(fromMs, toMs, timezone, result) };
  }
}
