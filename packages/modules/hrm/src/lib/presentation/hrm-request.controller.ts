import type {
  CreateBusinessTripRequestPayload,
  CreateOtRequestPayload,
  CreateShiftChangeRequestPayload,
  HrmBusinessTripRequest,
  HrmOtRequest,
  HrmShiftChangeRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';

@Controller('v1')
export class HrmRequestController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
  ) {}

  // --------------------------------------------------------------------------
  // Overtime (OT) Requests (P2_S3_HRM_API.md § 16)
  // --------------------------------------------------------------------------

  @Get('procedure-definitions/binding')
  async getBindingDefinition(
    @Req() req: Request,
    @Query('kind') kind: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    if (!kind) {
      throw new BadRequestException('Query parameter "kind" is required');
    }
    const def = await this.bridge.getBindingDefinitionWithAttributes(pool, tenantId, kind as any);
    return { data: def };
  }

  @Post('ot-requests')
  async createOtRequest(@Req() req: Request, @Body() body: CreateOtRequestPayload & { attributes?: Record<string, unknown> }) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const employeeId = body.employeeId || principal.userId;
    const multiplier = body.otType === 'HOLIDAY' ? 3.0 : body.otType === 'WEEKEND' ? 2.0 : 1.5;
    const isNightOt = body.isNightOt || body.otType === 'NIGHT';

    // Ràng buộc trần giờ OT (4h/ngày, 40h/tháng, 200h/năm)
    const exceedsDaily = body.plannedMinutes > 240; // > 4 hours
    
    // Kiểm tra lũy kế tháng
    const monthStart = `${body.workDate.slice(0, 7)}-01`;
    const accRes = await pool.query(
      `SELECT COALESCE(SUM(planned_minutes), 0) as total_month_ot
       FROM hrm_schema.ot_requests
       WHERE tenant_id = $1 AND employee_id = $2 AND work_date >= $3::date AND work_date <= $4::date AND status != 'REJECTED'`,
      [tenantId, employeeId, monthStart, body.workDate],
    );
    const totalMonthOt = Number(accRes.rows[0]?.total_month_ot || 0) + body.plannedMinutes;
    const exceedsMonthly = totalMonthOt > 2400; // > 40 hours

    const res = await pool.query(
      `INSERT INTO hrm_schema.ot_requests (
        tenant_id, employee_id, work_date, start_time, end_time, planned_minutes,
        ot_type, ot_rate_multiplier, is_night_ot, exceeds_daily_limit, exceeds_monthly_limit,
        monthly_accumulated_ot_minutes, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.workDate,
        body.startTime,
        body.endTime,
        body.plannedMinutes,
        body.otType || 'WEEKDAY',
        multiplier,
        isNightOt,
        exceedsDaily,
        exceedsMonthly,
        totalMonthOt,
        body.reason,
      ],
    );
    const inserted = res.rows[0];

    // Payload thuộc tính để PE Node S và Gateway đánh giá rẽ nhánh
    const otHours = Math.round((body.plannedMinutes / 60) * 100) / 100;
    const procAttributes: Record<string, unknown> = {
      so_gio_ot: otHours,
      ot_hours: otHours,
      loai_ot: body.otType || 'WEEKDAY',
      is_night_ot: Boolean(isNightOt),
      ly_do: body.reason,
      ...(body.attributes || {}),
    };

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'ot',
      inserted.id,
      employeeId,
      `Đơn làm thêm giờ (${body.plannedMinutes} phút) - Ngày ${body.workDate}`,
      procAttributes,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.ot_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, inserted.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapOt(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapOt(inserted),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('ot-requests')
  async listOtRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.ot_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::date IS NULL OR work_date >= $3)
         AND ($4::date IS NULL OR work_date <= $4)
       ORDER BY work_date DESC`,
      [tenantId, employeeId || null, fromDate || null, toDate || null],
    );
    return {
      data: res.rows.map(this.mapOt),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('ot-requests/:id/approve')
  async approveOtRequest(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');

    const check = await pool.query(
      `SELECT * FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_OT_NOT_FOUND', message: 'OT request not found' });
    }
    const ot = check.rows[0];

    // Nếu đơn có gắn quy trình động thì cập nhật qua Procedure Engine
    if (ot.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'ot',
        id,
        'APPROVE',
        principal.userId,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapOt(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    const res = await pool.query(
      `UPDATE hrm_schema.ot_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    return {
      data: this.mapOt(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('ot-requests/:id/reject')
  async rejectOtRequest(@Req() req: Request, @Param('id') id: string, @Body('reason') reason?: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');

    const check = await pool.query(
      `SELECT * FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_OT_NOT_FOUND', message: 'OT request not found' });
    }
    const ot = check.rows[0];

    // Nếu đơn có gắn quy trình động thì cập nhật qua Procedure Engine
    if (ot.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'ot',
        id,
        'REJECT',
        principal.userId,
        reason,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapOt(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    const res = await pool.query(
      `UPDATE hrm_schema.ot_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_OT_NOT_FOUND', message: 'OT request not found' });
    }
    return {
      data: this.mapOt(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Business Trip Requests (P2_S3_HRM_API.md § 17)
  // --------------------------------------------------------------------------

  @Post('business-trip-requests')
  async createBusinessTripRequest(
    @Req() req: Request,
    @Body() body: CreateBusinessTripRequestPayload & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const employeeId = body.employeeId || principal.userId;
    const res = await pool.query(
      `INSERT INTO hrm_schema.business_trip_requests (
        tenant_id, employee_id, business_trip_type, destination,
        project_id, project_name, destination_lat, destination_lng,
        from_date, to_date, days_count, allow_ot, per_diem_policy_id, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.businessTripType || 'DOMESTIC',
        body.destination,
        body.projectId || null,
        body.projectName || null,
        body.destinationLat || null,
        body.destinationLng || null,
        body.fromDate,
        body.toDate,
        body.daysCount,
        body.allowOt ?? false,
        body.perDiemPolicyId || null,
        body.reason,
      ],
    );
    const inserted = res.rows[0];

    // Payload thuộc tính để PE Node S và Gateway đánh giá rẽ nhánh
    const procAttributes: Record<string, unknown> = {
      so_ngay_cong_tac: Number(body.daysCount),
      days_count: Number(body.daysCount),
      loai_cong_tac: body.businessTripType || 'DOMESTIC',
      dia_diem: body.destination,
      allow_ot: Boolean(body.allowOt),
      ly_do: body.reason,
      ...(body.attributes || {}),
    };

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'business_trip',
      inserted.id,
      employeeId,
      `Đơn công tác (${body.destination}) - Từ ${body.fromDate} đến ${body.toDate}`,
      procAttributes,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.business_trip_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, inserted.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapTrip(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapTrip(inserted),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('business-trip-requests')
  async listBusinessTripRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.business_trip_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY from_date DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: res.rows.map(this.mapTrip),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('business-trip-requests/:id/approve')
  async approveBusinessTrip(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const check = await pool.query(
      `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_TRIP_NOT_FOUND', message: 'Business trip request not found' });
    }
    const trip = check.rows[0];

    if (trip.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'business_trip',
        id,
        'APPROVE',
        principal.userId,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapTrip(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    const res = await pool.query(
      `UPDATE hrm_schema.business_trip_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('business-trip-requests/:id/reject')
  async rejectBusinessTrip(@Req() req: Request, @Param('id') id: string, @Body('reason') reason?: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const check = await pool.query(
      `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_TRIP_NOT_FOUND', message: 'Business trip request not found' });
    }
    const trip = check.rows[0];

    if (trip.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'business_trip',
        id,
        'REJECT',
        principal.userId,
        reason,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapTrip(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    const res = await pool.query(
      `UPDATE hrm_schema.business_trip_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('business-trip-requests/:id/cancel')
  async cancelBusinessTrip(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.business_trip_requests SET status = 'CANCELLED', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING' RETURNING *`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_TRIP_CANNOT_CANCEL',
        message: 'Business trip request not found or not in PENDING state',
      });
    }
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Shift Change Requests (P2_S3_HRM_API.md § 18)
  // --------------------------------------------------------------------------

  @Post('shift-change-requests')
  async createShiftChangeRequest(
    @Req() req: Request,
    @Body() body: CreateShiftChangeRequestPayload,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const employeeId = body.employeeId || principal.userId;
    const res = await pool.query(
      `INSERT INTO hrm_schema.shift_change_requests (
        tenant_id, employee_id, change_type, current_shift_id, requested_shift_id,
        from_date, to_date, swap_with_employee_id, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.changeType || 'SWAP',
        body.currentShiftId,
        body.requestedShiftId,
        body.fromDate,
        body.toDate,
        body.swapWithEmployeeId || null,
        body.reason,
      ],
    );
    const inserted = res.rows[0];

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'shift_change',
      inserted.id,
      employeeId,
      `Đơn đổi ca (${body.changeType || 'SWAP'}) - Ngày ${body.fromDate}`,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.shift_change_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, inserted.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapShiftChange(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapShiftChange(inserted),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shift-change-requests/:id/peer-confirm')
  async peerConfirmShiftChange(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('confirmed') confirmed: boolean,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.shift_change_requests SET
        swap_peer_confirmed = $3,
        status = CASE WHEN $3 = true THEN 'PEER_CONFIRMED' ELSE 'REJECTED' END,
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
      RETURNING *`,
      [tenantId, id, Boolean(confirmed)],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_SHIFT_CHANGE_CANNOT_CONFIRM',
        message: 'Shift change request not found or not in PENDING state',
      });
    }
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('shift-change-requests')
  async listShiftChanges(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_change_requests
       WHERE tenant_id = $1 AND ($2::uuid IS NULL OR employee_id = $2)
       ORDER BY from_date DESC`,
      [tenantId, employeeId || null],
    );
    return {
      data: res.rows.map(this.mapShiftChange),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shift-change-requests/:id/approve')
  async approveShiftChange(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const check = await pool.query(
      `SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_SHIFT_CHANGE_NOT_FOUND', message: 'Shift change request not found' });
    }
    const shiftChange = check.rows[0];

    if (shiftChange.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'shift_change',
        id,
        'APPROVE',
        principal.userId,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapShiftChange(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    const res = await pool.query(
      `UPDATE hrm_schema.shift_change_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), applied_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shift-change-requests/:id/reject')
  async rejectShiftChange(@Req() req: Request, @Param('id') id: string, @Body('reason') reason?: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const check = await pool.query(
      `SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_SHIFT_CHANGE_NOT_FOUND', message: 'Shift change request not found' });
    }
    const shiftChange = check.rows[0];

    if (shiftChange.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'shift_change',
        id,
        'REJECT',
        principal.userId,
        reason,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapShiftChange(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    const res = await pool.query(
      `UPDATE hrm_schema.shift_change_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Dynamic Procedure Progress & Real-time Reverse Sync
  // --------------------------------------------------------------------------

  @Get('procedure-progress/:procedureInstanceId')
  async getProcedureProgress(
    @Req() req: Request,
    @Param('procedureInstanceId') procedureInstanceId: string,
    @Query('kind') kind?: string,
    @Query('request_id') requestId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const result = await this.bridge.getProcedureProgress(
      pool,
      tenantId,
      procedureInstanceId,
      kind as any,
      requestId,
    );

    if (!result) {
      throw new NotFoundException({
        code: 'PROCEDURE_INSTANCE_NOT_FOUND',
        message: 'Procedure instance not found',
      });
    }

    return {
      data: result,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Workspace Projects Integration
  // --------------------------------------------------------------------------

  @Get('workspace-projects')
  async listWorkspaceProjects(@Req() req: Request) {
    const { pool } = await this.ctx.getContext(req, 'hrm.read');
    try {
      const res = await pool.query(
        `SELECT id, code, name, status, start_date, end_date
         FROM workspace_schema.projects
         ORDER BY created_at DESC`,
      );
      return {
        data: res.rows.map((r: any) => ({
          id: r.id as string,
          code: r.code as string,
          name: r.name as string,
          status: r.status as string,
          startDate: r.start_date ? String(r.start_date) : null,
          endDate: r.end_date ? String(r.end_date) : null,
        })),
        meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
      };
    } catch {
      // Fallback nếu schema workspace_schema chưa khởi tạo trong DB
      return {
        data: [],
        meta: { total: 0, requestId: req.headers['x-request-id'] as string },
      };
    }
  }

  private mapOt(row: Record<string, unknown>): HrmOtRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      workDate: String(row.work_date),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      plannedMinutes: Number(row.planned_minutes),
      approvedMinutes: Number(row.approved_minutes || 0),
      actualMinutes: Number(row.actual_minutes || 0),
      billableOtMinutes: Number(row.billable_ot_minutes || 0),
      otType: row.ot_type as any,
      otRateMultiplier: Number(row.ot_rate_multiplier || 1.5),
      isNightOt: Boolean(row.is_night_ot),
      exceedsDailyLimit: Boolean(row.exceeds_daily_limit),
      exceedsMonthlyLimit: Boolean(row.exceeds_monthly_limit),
      policyVersionId: row.policy_version_id as string | null,
      monthlyAccumulatedOtMinutes: Number(row.monthly_accumulated_ot_minutes || 0),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTrip(row: Record<string, unknown>): HrmBusinessTripRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      businessTripType: row.business_trip_type as any,
      destination: row.destination as string,
      projectId: row.project_id as string | null,
      projectName: row.project_name as string | null,
      destinationLat: row.destination_lat ? Number(row.destination_lat) : null,
      destinationLng: row.destination_lng ? Number(row.destination_lng) : null,
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      daysCount: Number(row.days_count),
      allowOt: Boolean(row.allow_ot),
      perDiemPolicyId: row.per_diem_policy_id as string | null,
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapShiftChange(row: Record<string, unknown>): HrmShiftChangeRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      changeType: row.change_type as any,
      currentShiftId: row.current_shift_id as string,
      requestedShiftId: row.requested_shift_id as string,
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      swapWithEmployeeId: row.swap_with_employee_id as string | null,
      swapPeerConfirmed: Boolean(row.swap_peer_confirmed),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
