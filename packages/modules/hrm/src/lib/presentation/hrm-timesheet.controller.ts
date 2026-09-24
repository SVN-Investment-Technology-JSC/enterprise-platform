import type {
  AdjustTimesheetRequest,
  CreateTimesheetPeriodRequest,
  HrmTimesheet,
  HrmTimesheetPeriod,
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
export class HrmTimesheetController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Timesheet Periods (P2_S3_HRM_API.md § 19)
  // --------------------------------------------------------------------------

  @Get('timesheet-periods')
  async listPeriods(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 ORDER BY from_date DESC`,
      [tenantId],
    );
    return {
      data: res.rows.map(this.mapPeriod),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('timesheet-periods')
  async createPeriod(@Req() req: Request, @Body() body: CreateTimesheetPeriodRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.timesheet_periods (
        tenant_id, period_code, from_date, to_date, status
      ) VALUES ($1, $2, $3, $4, 'OPEN')
      RETURNING *`,
      [tenantId, body.periodCode, body.fromDate, body.toDate],
    );
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('timesheet-periods/:id')
  async getPeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_PERIOD_NOT_FOUND', message: 'Timesheet period not found' });
    }
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('timesheet-periods/:id/calculate')
  async calculatePeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const periodRes = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (periodRes.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_PERIOD_NOT_FOUND', message: 'Timesheet period not found' });
    }

    const period = periodRes.rows[0];
    if (period.status === 'LOCKED') {
      throw new BadRequestException({ code: 'HRM_PERIOD_LOCKED', message: 'Cannot calculate a locked period' });
    }

    // Populate or sync timesheets from attendances in range
    await pool.query(
      `INSERT INTO hrm_schema.timesheets (
        tenant_id, period_id, employee_id, work_date, attendance_id, scheduled_minutes,
        worked_minutes, paid_minutes, workday_units, status
      )
      SELECT
        a.tenant_id, $1, a.employee_id, a.work_date, a.id, 480,
        a.worked_minutes, a.worked_minutes,
        ROUND((a.worked_minutes::numeric / 480), 2),
        'NORMAL'
      FROM hrm_schema.attendances a
      WHERE a.tenant_id = $2 AND a.work_date >= $3 AND a.work_date <= $4
      ON CONFLICT (period_id, employee_id, work_date)
      DO UPDATE SET
        worked_minutes = EXCLUDED.worked_minutes,
        paid_minutes = EXCLUDED.paid_minutes,
        workday_units = EXCLUDED.workday_units,
        updated_at = now()
      WHERE hrm_schema.timesheets.is_manually_adjusted = false`,
      [period.id, tenantId, period.from_date, period.to_date],
    );

    return {
      data: { success: true, message: 'Timesheet period calculation completed successfully' },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('timesheet-periods/:id/lock')
  async lockPeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.timesheet_periods SET
        status = 'LOCKED', locked_by = $3, locked_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_PERIOD_NOT_FOUND', message: 'Timesheet period not found' });
    }
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('timesheet-periods/:id/reopen')
  async reopenPeriod(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    if (!reason) {
      throw new BadRequestException({ code: 'HRM_REASON_REQUIRED', message: 'Reopen reason is mandatory' });
    }
    const res = await pool.query(
      `UPDATE hrm_schema.timesheet_periods SET
        status = 'REOPENED', reopened_by = $3, reopened_at = now(), reopen_reason = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, principal.userId, reason],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_PERIOD_NOT_FOUND', message: 'Timesheet period not found' });
    }
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Daily Timesheet Lines (P2_S3_HRM_API.md § 20)
  // --------------------------------------------------------------------------

  @Get('timesheets')
  async listTimesheets(
    @Req() req: Request,
    @Query('period_id') periodId?: string,
    @Query('employee_id') employeeId?: string,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheets
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR period_id = $2)
         AND ($3::uuid IS NULL OR employee_id = $3)
         AND ($4::date IS NULL OR work_date >= $4)
         AND ($5::date IS NULL OR work_date <= $5)
       ORDER BY work_date DESC`,
      [tenantId, periodId || null, employeeId || null, fromDate || null, toDate || null],
    );
    return {
      data: res.rows.map(this.mapTimesheet),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('timesheets/:id')
  async getTimesheet(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheets WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_TIMESHEET_NOT_FOUND', message: 'Timesheet record not found' });
    }
    return {
      data: this.mapTimesheet(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('timesheets/:id/adjust')
  async adjustTimesheet(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: AdjustTimesheetRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    if (!body.reason) {
      throw new BadRequestException({ code: 'HRM_REASON_REQUIRED', message: 'Adjustment reason is required' });
    }
    const res = await pool.query(
      `UPDATE hrm_schema.timesheets SET
        workday_units = COALESCE($3, workday_units),
        paid_minutes = COALESCE($4, paid_minutes),
        status = COALESCE($5, status),
        is_manually_adjusted = true,
        adjusted_by = $6,
        adjusted_reason = $7,
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
      [
        tenantId,
        id,
        body.workdayUnits,
        body.paidMinutes,
        body.status,
        principal.userId,
        body.reason,
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_TIMESHEET_NOT_FOUND', message: 'Timesheet record not found' });
    }
    return {
      data: this.mapTimesheet(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private mapPeriod(row: Record<string, unknown>): HrmTimesheetPeriod {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      periodCode: row.period_code as string,
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      status: row.status as any,
      submittedBy: row.submitted_by as string | null,
      submittedAt: row.submitted_at ? String(row.submitted_at) : null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      lockedBy: row.locked_by as string | null,
      lockedAt: row.locked_at ? String(row.locked_at) : null,
      reopenedBy: row.reopened_by as string | null,
      reopenedAt: row.reopened_at ? String(row.reopened_at) : null,
      reopenReason: row.reopen_reason as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTimesheet(row: Record<string, unknown>): HrmTimesheet {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      periodId: row.period_id as string,
      employeeId: row.employee_id as string,
      workDate: String(row.work_date),
      shiftId: row.shift_id as string | null,
      attendanceId: row.attendance_id as string | null,
      leaveRequestId: row.leave_request_id as string | null,
      otRequestId: row.ot_request_id as string | null,
      businessTripRequestId: row.business_trip_request_id as string | null,
      scheduledMinutes: Number(row.scheduled_minutes || 480),
      workedMinutes: Number(row.worked_minutes || 0),
      paidMinutes: Number(row.paid_minutes || 0),
      otMinutes: Number(row.ot_minutes || 0),
      lateMinutes: Number(row.late_minutes || 0),
      earlyLeaveMinutes: Number(row.early_leave_minutes || 0),
      workdayUnits: Number(row.workday_units || 0),
      status: row.status as any,
      isManuallyAdjusted: Boolean(row.is_manually_adjusted),
      adjustedBy: row.adjusted_by as string | null,
      adjustedReason: row.adjusted_reason as string | null,
      calculationSnapshot: (row.calculation_snapshot as Record<string, unknown>) || {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
