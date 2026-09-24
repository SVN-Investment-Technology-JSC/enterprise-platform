import type {
  CheckInRequest,
  CheckOutRequest,
  CreateAttendanceCorrectionRequest,
  HrmAttendance,
  HrmAttendanceCorrection,
  IngestAttendanceRequest,
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
export class HrmAttendanceController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Attendance Tracking APIs (P2_S3_HRM_API.md § 11)
  // --------------------------------------------------------------------------

  @Post('attendance/check-in')
  async checkIn(@Req() req: Request, @Body() body: CheckInRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const employeeId = body.employeeId || principal.userId;
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const workDate = occurredAt.toISOString().slice(0, 10);

    const res = await pool.query(
      `INSERT INTO hrm_schema.attendances (
        tenant_id, employee_id, work_date, check_in_at, attendance_source, device_id, status, worked_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, 'VALID', 0)
      ON CONFLICT (tenant_id, employee_id, work_date)
      DO UPDATE SET
        check_in_at = COALESCE(hrm_schema.attendances.check_in_at, EXCLUDED.check_in_at),
        attendance_source = EXCLUDED.attendance_source,
        device_id = COALESCE(EXCLUDED.device_id, hrm_schema.attendances.device_id),
        updated_at = now()
      RETURNING *`,
      [
        tenantId,
        employeeId,
        workDate,
        occurredAt.toISOString(),
        body.source || 'WEB_PORTAL',
        body.deviceId || null,
      ],
    );

    return {
      data: this.mapAttendance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance/check-out')
  async checkOut(@Req() req: Request, @Body() body: CheckOutRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const employeeId = body.employeeId || principal.userId;
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const workDate = occurredAt.toISOString().slice(0, 10);

    // Calculate worked minutes if check_in exists
    const existing = await pool.query(
      `SELECT check_in_at FROM hrm_schema.attendances WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3`,
      [tenantId, employeeId, workDate],
    );

    let workedMinutes = 0;
    if (existing.rows.length > 0 && existing.rows[0].check_in_at) {
      const checkIn = new Date(existing.rows[0].check_in_at);
      workedMinutes = Math.max(0, Math.floor((occurredAt.getTime() - checkIn.getTime()) / 60000));
    }

    const res = await pool.query(
      `INSERT INTO hrm_schema.attendances (
        tenant_id, employee_id, work_date, check_out_at, attendance_source, device_id, status, worked_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, 'VALID', $7)
      ON CONFLICT (tenant_id, employee_id, work_date)
      DO UPDATE SET
        check_out_at = EXCLUDED.check_out_at,
        attendance_source = EXCLUDED.attendance_source,
        device_id = COALESCE(EXCLUDED.device_id, hrm_schema.attendances.device_id),
        worked_minutes = GREATEST(hrm_schema.attendances.worked_minutes, EXCLUDED.worked_minutes),
        updated_at = now()
      RETURNING *`,
      [
        tenantId,
        employeeId,
        workDate,
        occurredAt.toISOString(),
        body.source || 'WEB_PORTAL',
        body.deviceId || null,
        workedMinutes,
      ],
    );

    return {
      data: this.mapAttendance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('attendance')
  async listAttendance(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.attendances
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::date IS NULL OR work_date >= $3)
         AND ($4::date IS NULL OR work_date <= $4)
       ORDER BY work_date DESC`,
      [tenantId, employeeId || null, fromDate || null, toDate || null],
    );
    return {
      data: res.rows.map(this.mapAttendance),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('attendance/:attendanceId')
  async getAttendance(@Req() req: Request, @Param('attendanceId') attendanceId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.attendances WHERE tenant_id = $1 AND id = $2`,
      [tenantId, attendanceId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_ATTENDANCE_NOT_FOUND', message: 'Attendance record not found' });
    }
    return {
      data: this.mapAttendance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('internal/attendance/ingest')
  async ingestAttendance(@Req() req: Request, @Body() body: IngestAttendanceRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const occurredAt = new Date(body.occurredAt);
    const workDate = occurredAt.toISOString().slice(0, 10);

    const res = await pool.query(
      `INSERT INTO hrm_schema.attendances (
        tenant_id, employee_id, work_date, check_in_at, attendance_source, device_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'VALID')
      ON CONFLICT (tenant_id, employee_id, work_date)
      DO UPDATE SET
        check_out_at = EXCLUDED.check_in_at,
        updated_at = now()
      RETURNING *`,
      [tenantId, body.employeeId, workDate, occurredAt.toISOString(), body.source, body.deviceId || null],
    );
    return {
      data: this.mapAttendance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Attendance Correction APIs (P2_S3_HRM_API.md § 12)
  // --------------------------------------------------------------------------

  @Post('attendance-corrections')
  async createCorrection(
    @Req() req: Request,
    @Body() body: CreateAttendanceCorrectionRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.attendance_corrections (
        tenant_id, employee_id, attendance_id, request_date, new_check_in_at, new_check_out_at,
        reason, status, submitted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
      RETURNING *`,
      [
        tenantId,
        body.employeeId,
        body.attendanceId || null,
        body.requestDate,
        body.newCheckInAt || null,
        body.newCheckOutAt || null,
        body.reason,
        principal.userId,
      ],
    );
    return {
      data: this.mapCorrection(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('attendance-corrections')
  async listCorrections(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.attendance_corrections
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: res.rows.map(this.mapCorrection),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance-corrections/:id/submit')
  async submitCorrection(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.attendance_corrections SET status = 'PENDING', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_CORRECTION_NOT_FOUND', message: 'Correction request not found' });
    }
    return {
      data: this.mapCorrection(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance-corrections/:id/approve')
  async approveCorrection(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    
    // Fetch the correction record
    const corrRes = await pool.query(
      `SELECT * FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (corrRes.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_CORRECTION_NOT_FOUND', message: 'Correction request not found' });
    }
    const corr = corrRes.rows[0];

    // Update correction status to APPROVED
    const updatedRes = await pool.query(
      `UPDATE hrm_schema.attendance_corrections
       SET status = 'APPROVED', approved_by = $3, approved_at = now(), applied_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, principal.userId],
    );

    // Apply change to attendances table if attendanceId or employeeId & requestDate match
    if (corr.attendance_id) {
      await pool.query(
        `UPDATE hrm_schema.attendances
         SET check_in_at = COALESCE($3, check_in_at),
             check_out_at = COALESCE($4, check_out_at),
             status = 'APPROVED_CORRECTION',
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, corr.attendance_id, corr.new_check_in_at, corr.new_check_out_at],
      );
    } else if (corr.employee_id && corr.request_date) {
      await pool.query(
        `INSERT INTO hrm_schema.attendances (
          tenant_id, employee_id, work_date, check_in_at, check_out_at, attendance_source, status, worked_minutes
        ) VALUES ($1, $2, $3, $4, $5, 'MANUAL_CORRECTION', 'APPROVED_CORRECTION', 480)
        ON CONFLICT (tenant_id, employee_id, work_date)
        DO UPDATE SET
          check_in_at = COALESCE(EXCLUDED.check_in_at, hrm_schema.attendances.check_in_at),
          check_out_at = COALESCE(EXCLUDED.check_out_at, hrm_schema.attendances.check_out_at),
          status = 'APPROVED_CORRECTION',
          updated_at = now()`,
        [tenantId, corr.employee_id, corr.request_date, corr.new_check_in_at, corr.new_check_out_at],
      );
    }

    return {
      data: this.mapCorrection(updatedRes.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance-corrections/:id/reject')
  async rejectCorrection(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.attendance_corrections
       SET status = 'REJECTED', approved_by = $3, rejection_reason = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, principal.userId, reason || 'Bị từ chối bởi người quản lý'],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_CORRECTION_NOT_FOUND', message: 'Correction request not found' });
    }
    return {
      data: this.mapCorrection(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance-corrections/:id/cancel')
  async cancelCorrection(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.attendance_corrections SET status = 'CANCELLED', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING' RETURNING *`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_CORRECTION_CANNOT_CANCEL',
        message: 'Correction request not found or not in PENDING state',
      });
    }
    return {
      data: this.mapCorrection(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private mapAttendance(row: Record<string, unknown>): HrmAttendance {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      workDate: String(row.work_date),
      checkInAt: row.check_in_at ? String(row.check_in_at) : null,
      checkOutAt: row.check_out_at ? String(row.check_out_at) : null,
      attendanceSource: row.attendance_source as any,
      deviceId: row.device_id as string | null,
      status: row.status as any,
      workedMinutes: row.worked_minutes as number,
      note: row.note as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapCorrection(row: Record<string, unknown>): HrmAttendanceCorrection {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      attendanceId: row.attendance_id as string | null,
      requestDate: String(row.request_date),
      oldCheckInAt: row.old_check_in_at ? String(row.old_check_in_at) : null,
      oldCheckOutAt: row.old_check_out_at ? String(row.old_check_out_at) : null,
      newCheckInAt: row.new_check_in_at ? String(row.new_check_in_at) : null,
      newCheckOutAt: row.new_check_out_at ? String(row.new_check_out_at) : null,
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      submittedBy: row.submitted_by as string,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      rejectionReason: row.rejection_reason as string | null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
