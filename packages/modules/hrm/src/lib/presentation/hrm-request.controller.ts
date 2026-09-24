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

@Controller('v1')
export class HrmRequestController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Overtime (OT) Requests (P2_S3_HRM_API.md § 16)
  // --------------------------------------------------------------------------

  @Post('ot-requests')
  async createOtRequest(@Req() req: Request, @Body() body: CreateOtRequestPayload) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const multiplier = body.otType === 'HOLIDAY' ? 3.0 : body.otType === 'WEEKEND' ? 2.0 : 1.5;

    const res = await pool.query(
      `INSERT INTO hrm_schema.ot_requests (
        tenant_id, employee_id, work_date, start_time, end_time, planned_minutes,
        ot_type, ot_rate_multiplier, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        body.employeeId,
        body.workDate,
        body.startTime,
        body.endTime,
        body.plannedMinutes,
        body.otType || 'WEEKDAY',
        multiplier,
        body.reason,
      ],
    );
    return {
      data: this.mapOt(res.rows[0]),
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
    const res = await pool.query(
      `UPDATE hrm_schema.ot_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), updated_at = now()
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

  @Post('ot-requests/:id/reject')
  async rejectOtRequest(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
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
    @Body() body: CreateBusinessTripRequestPayload,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.business_trip_requests (
        tenant_id, employee_id, business_trip_type, destination, from_date, to_date,
        days_count, allow_ot, per_diem_policy_id, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        body.employeeId,
        body.businessTripType || 'DOMESTIC',
        body.destination,
        body.fromDate,
        body.toDate,
        body.daysCount,
        body.allowOt ?? false,
        body.perDiemPolicyId || null,
        body.reason,
      ],
    );
    return {
      data: this.mapTrip(res.rows[0]),
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
    const res = await pool.query(
      `UPDATE hrm_schema.business_trip_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_TRIP_NOT_FOUND', message: 'Business trip request not found' });
    }
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('business-trip-requests/:id/reject')
  async rejectBusinessTrip(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.business_trip_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_TRIP_NOT_FOUND', message: 'Business trip request not found' });
    }
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.shift_change_requests (
        tenant_id, employee_id, change_type, current_shift_id, requested_shift_id,
        from_date, to_date, swap_with_employee_id, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        body.employeeId,
        body.changeType || 'SWAP',
        body.currentShiftId,
        body.requestedShiftId,
        body.fromDate,
        body.toDate,
        body.swapWithEmployeeId || null,
        body.reason,
      ],
    );
    return {
      data: this.mapShiftChange(res.rows[0]),
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
    const res = await pool.query(
      `UPDATE hrm_schema.shift_change_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), applied_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_SHIFT_CHANGE_NOT_FOUND', message: 'Shift change request not found' });
    }
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shift-change-requests/:id/reject')
  async rejectShiftChange(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.shift_change_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_SHIFT_CHANGE_NOT_FOUND', message: 'Shift change request not found' });
    }
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
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
      policyVersionId: row.policy_version_id as string | null,
      monthlyAccumulatedOtMinutes: Number(row.monthly_accumulated_ot_minutes || 0),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
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
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      daysCount: Number(row.days_count),
      allowOt: Boolean(row.allow_ot),
      perDiemPolicyId: row.per_diem_policy_id as string | null,
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
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
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
