import type {
  CreateHrmPersonnelDecisionPayload,
  UpdateHrmPersonnelDecisionPayload,
} from '@enterprise-platform/contracts-hrm';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import {
  type HrmOrgAppointmentPort,
  defaultOrgAppointmentPort,
} from '../infrastructure/hrm-org-appointment.js';
import {
  applyDecision,
  approveDecision,
  cancelDecision,
  createDecision,
  listDecisions,
  loadAppointmentContext,
  loadDecision,
  loadReportingOverview,
  mapDecision,
  quickAssignPosition,
  rejectDecision,
  updateDraft,
} from '../infrastructure/hrm-personnel-decisions.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';

const meta = (req: Request) => ({ requestId: req.headers['x-request-id'] as string });

/**
 * Quyết định nhân sự: bổ nhiệm, thăng chức, điều chuyển, kiêm nhiệm, miễn nhiệm.
 * Chức danh ghi sang Core qua endpoint nội bộ, lương do HRM ghi. Quản lý trực tiếp
 * không do quyết định gán: lấy từ "Báo cáo cho" của chức danh trên Core, không có thì Tổng giám đốc.
 */
@Controller('v1')
export class HrmPersonnelDecisionController {
  /** Ghi đè được trong test tích hợp để không gọi Core thật. */
  protected org: HrmOrgAppointmentPort = defaultOrgAppointmentPort();

  constructor(private readonly ctx: HrmContextService) {}

  @Get('personnel-decisions')
  @RequirePermission('hrm.appointment.read')
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.appointment.read');
    return {
      data: await listDecisions(pool, tenantId, { status, type, employeeId }),
      meta: meta(req),
    };
  }

  @Get('personnel-decisions/:id')
  @RequirePermission('hrm.appointment.read')
  async get(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.appointment.read');
    return { data: mapDecision(await loadDecision(pool, tenantId, id)), meta: meta(req) };
  }

  @Post('personnel-decisions')
  @RequirePermission('hrm.appointment.manage')
  async create(@Req() req: Request, @Body() body: CreateHrmPersonnelDecisionPayload) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.appointment.manage');
    return {
      data: await createDecision(pool, tenantId, principal.userId, body),
      meta: meta(req),
    };
  }

  @Patch('personnel-decisions/:id')
  @RequirePermission('hrm.appointment.manage')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateHrmPersonnelDecisionPayload,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.appointment.manage');
    return {
      data: await updateDraft(pool, tenantId, principal.userId, id, body),
      meta: meta(req),
    };
  }

  @Post('personnel-decisions/:id/approve')
  @RequirePermission('hrm.appointment.approve')
  async approve(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.appointment.approve');
    return {
      data: await approveDecision(pool, tenantId, principal.userId, id, { org: this.org }),
      meta: meta(req),
    };
  }

  @Post('personnel-decisions/:id/reject')
  @RequirePermission('hrm.appointment.approve')
  async reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.appointment.approve');
    return {
      data: await rejectDecision(pool, tenantId, principal.userId, id, body?.reason),
      meta: meta(req),
    };
  }

  @Post('personnel-decisions/:id/cancel')
  @RequirePermission('hrm.appointment.manage')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const context = await this.ctx.getContext(req, 'hrm.appointment.read');
    if (
      !this.ctx.has(context, 'hrm.appointment.manage') &&
      !this.ctx.has(context, 'hrm.appointment.approve')
    )
      throw new ForbiddenException('Không có quyền hủy quyết định nhân sự');
    return {
      data: await cancelDecision(context.pool, context.tenantId, context.principal.userId, id),
      meta: meta(req),
    };
  }

  @Post('personnel-decisions/:id/retry-apply')
  @RequirePermission('hrm.appointment.approve')
  async retryApply(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.appointment.approve');
    return {
      data: await applyDecision(pool, tenantId, id, { org: this.org }),
      meta: meta(req),
    };
  }

  /** Người quản lý hiện tại (Core, không có thì Tổng giám đốc); nhân viên xem được của chính mình. */
  @Get('employees/:employeeId/reporting-lines')
  @RequirePermission('hrm.self.read')
  async reportingLines(@Req() req: Request, @Param('employeeId') employeeId: string) {
    requireUuid(employeeId, 'Nhân viên');
    const { pool, tenantId } = await this.ctx.scoped(req, 'hrm.employee.read', employeeId);
    return { data: await loadReportingOverview(pool, tenantId, employeeId), meta: meta(req) };
  }

  /** Hiện trạng chức danh, quản lý, lương để form quyết định hiện cột "Trước". */
  @Get('employees/:employeeId/appointment-context')
  @RequirePermission('hrm.appointment.read')
  async appointmentContext(@Req() req: Request, @Param('employeeId') employeeId: string) {
    requireUuid(employeeId, 'Nhân viên');
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.appointment.read');
    return { data: await loadAppointmentContext(pool, tenantId, employeeId), meta: meta(req) };
  }

  /**
   * Gán chức danh nhanh từ Drawer "Sửa" của hồ sơ nhân sự: tạo quyết định APPOINT rồi áp dụng ngay, không
   * cần người khác duyệt. Cần cả hai quyền quản lý và duyệt bổ nhiệm, vì thao tác này có hiệu lực tương
   * đương một quyết định đã duyệt.
   */
  @Post('employees/:employeeId/quick-appoint')
  @RequirePermission('hrm.appointment.manage')
  async quickAppoint(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: { toPositionNodeId?: string; reason?: string; effectiveDate?: string },
  ) {
    requireUuid(employeeId, 'Nhân viên');
    const context = await this.ctx.getContext(req, 'hrm.appointment.manage');
    if (!this.ctx.has(context, 'hrm.appointment.approve'))
      throw new ForbiddenException('Cần quyền duyệt bổ nhiệm để gán chức danh trực tiếp');
    return {
      data: await quickAssignPosition(
        context.pool,
        context.tenantId,
        context.principal.userId,
        {
          employeeId,
          toPositionNodeId: String(body?.toPositionNodeId ?? ''),
          reason: String(body?.reason ?? ''),
          effectiveDate: body?.effectiveDate,
        },
        { org: this.org },
      ),
      meta: meta(req),
    };
  }
}
