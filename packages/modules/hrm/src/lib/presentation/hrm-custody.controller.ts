import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Pool } from 'pg';
import type {
  AssignHrmCustodyRequest,
  HrmCustodyAsset,
} from '@enterprise-platform/contracts-hrm';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  listAssignableCustody,
  listCustodyOfEmployee,
  setCustody,
} from '../infrastructure/hrm-inventory-custody-api.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { requireText, requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Cấp phát tài sản công ty cho nhân viên. Tài sản thuộc phân hệ Kho nên mọi đọc/ghi đi qua API nội bộ của Kho
 * (`hrm-inventory-custody-api`); HRM chỉ kiểm quyền, kiểm nhân viên và ghi nhật ký HRM. Kho tự kiểm trạng thái tài
 * sản và người đang giữ.
 */
@Controller('v1')
export class HrmCustodyController {
  private readonly logger = new Logger(HrmCustodyController.name);

  constructor(private readonly ctx: HrmContextService) {}

  /** Nhân viên có hồ sơ trong tenant. Cấp mới đòi còn làm việc; thu hồi thì không, vì người nghỉ việc vẫn phải trả. */
  private async requireEmployee(
    pool: Pool,
    tenantId: string,
    employeeId: string,
    mustBeActive: boolean,
  ) {
    requireUuid(employeeId, 'Nhân viên');
    const row = (
      await pool.query(
        `SELECT employment_status FROM hrm_schema.employee_directory
          WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
        [tenantId, employeeId],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Không tìm thấy nhân viên');
    if (
      mustBeActive &&
      ['RESIGNED', 'TERMINATED'].includes(String(row.employment_status))
    )
      throw new BadRequestException({
        code: 'HRM_EMPLOYEE_NOT_ACTIVE',
        message: 'Nhân viên đã nghỉ việc, không thể cấp phát tài sản.',
      });
  }

  /** Nhật ký là việc phụ: tài sản đã đổi chủ ở Kho thì lỗi ghi nhật ký không được làm thao tác báo thất bại. */
  private async audit(
    pool: Pool,
    tenantId: string,
    actorId: string,
    action: string,
    employeeId: string,
    detail: unknown,
  ) {
    try {
      await lifecycleAudit(pool, tenantId, actorId, action, employeeId, detail);
    } catch (error) {
      this.logger.error(`Không ghi được nhật ký ${action}`, error);
    }
  }

  @Get('employees/:employeeId/custody')
  @RequirePermission('hrm.employee.read')
  async list(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ): Promise<HrmCustodyAsset[]> {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.employee.read',
    );
    await this.requireEmployee(pool, tenantId, employeeId, false);
    return listCustodyOfEmployee(tenantId, employeeId);
  }

  @Get('custody/assignable')
  @RequirePermission('hrm.custody.manage')
  async assignable(@Req() req: Request): Promise<HrmCustodyAsset[]> {
    const { tenantId } = await this.ctx.getContext(req, 'hrm.custody.manage');
    return listAssignableCustody(tenantId);
  }

  @Post('employees/:employeeId/custody')
  @RequirePermission('hrm.custody.manage')
  async assign(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: AssignHrmCustodyRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.custody.manage',
    );
    const materialCode = requireText(body?.materialCode, 'Mã tài sản');
    await this.requireEmployee(pool, tenantId, employeeId, true);
    await setCustody(tenantId, materialCode, employeeId);
    await this.audit(
      pool,
      tenantId,
      principal.userId,
      'CUSTODY_ASSIGNED',
      employeeId,
      { materialCode },
    );
    return { ok: true };
  }

  @Post('employees/:employeeId/custody/:materialCode/revoke')
  @RequirePermission('hrm.custody.manage')
  async revoke(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Param('materialCode') materialCode: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.custody.manage',
    );
    await this.requireEmployee(pool, tenantId, employeeId, false);
    // Chỉ thu hồi tài sản đúng người này đang giữ, không thu hồi nhầm của người khác qua đường dẫn của nhân viên.
    const held = await listCustodyOfEmployee(tenantId, employeeId);
    if (!held.some((asset) => asset.code === materialCode))
      throw new NotFoundException('Nhân viên không đang giữ tài sản này');
    await setCustody(tenantId, materialCode, null);
    await this.audit(
      pool,
      tenantId,
      principal.userId,
      'CUSTODY_REVOKED',
      employeeId,
      { materialCode },
    );
    return { ok: true };
  }
}
