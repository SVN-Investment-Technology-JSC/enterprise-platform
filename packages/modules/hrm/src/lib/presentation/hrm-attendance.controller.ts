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
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';

@Controller('v1')
export class HrmAttendanceController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
  ) {}

  // --------------------------------------------------------------------------
  // Attendance Tracking APIs (P2_S3_HRM_API.md § 11)
  // --------------------------------------------------------------------------

  @Post('attendance/check-in')
  async checkIn(@Req() req: Request, @Body() body: CheckInRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const employeeId = body.employeeId || principal.userId;
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const workDate = occurredAt.toISOString().slice(0, 10);

    // 1. Resolve employee shift assignment or fallback to default shift
    const shiftRes = await pool.query(
      `SELECT sd.* FROM hrm_schema.shift_assignments sa
       JOIN hrm_schema.shift_definitions sd ON sa.shift_id = sd.id
       WHERE sa.tenant_id = $1 AND sa.employee_id = $2
         AND sa.status = 'ACTIVE'
         AND sa.effective_from <= $3
         AND (sa.effective_to IS NULL OR sa.effective_to >= $3)
       ORDER BY sa.effective_from DESC LIMIT 1`,
      [tenantId, employeeId, workDate],
    );

    let shift = shiftRes.rows[0];
    if (!shift) {
      const defaultShiftRes = await pool.query(
        `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`,
        [tenantId],
      );
      shift = defaultShiftRes.rows[0];
    }

    // 2. Evaluate punctuality (start_time + grace_late_minutes)
    let status = 'VALID';
    let checkInNote = body.note || null;
    if (shift && shift.start_time) {
      const [startHour, startMin] = shift.start_time.split(':').map(Number);
      const shiftStartTime = new Date(occurredAt);
      shiftStartTime.setHours(startHour, startMin, 0, 0);

      const graceLate = shift.grace_late_minutes || 0;
      const lateThreshold = new Date(shiftStartTime.getTime() + graceLate * 60000);

      if (occurredAt.getTime() > lateThreshold.getTime()) {
        status = 'LATE';
        const lateMins = Math.floor((occurredAt.getTime() - shiftStartTime.getTime()) / 60000);
        checkInNote = `Vào trễ ${lateMins} phút (Ca: ${shift.name || shift.code})`;
      }
    }

    // Append metadata if provided (e.g. GPS, Wifi, Verification Method)
    const metaParts = [];
    if (body.verificationMethod) metaParts.push(`Method: ${body.verificationMethod}`);
    if (body.latitude && body.longitude) metaParts.push(`GPS: ${body.latitude},${body.longitude}`);
    if (body.wifiSsid) metaParts.push(`Wi-Fi: ${body.wifiSsid}`);
    if (metaParts.length > 0) {
      checkInNote = checkInNote ? `${checkInNote} | [${metaParts.join(', ')}]` : `[${metaParts.join(', ')}]`;
    }

    const res = await pool.query(
      `INSERT INTO hrm_schema.attendances (
        tenant_id, employee_id, work_date, check_in_at, attendance_source, device_id, status, worked_minutes, note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
      ON CONFLICT (tenant_id, employee_id, work_date)
      DO UPDATE SET
        check_in_at = COALESCE(hrm_schema.attendances.check_in_at, EXCLUDED.check_in_at),
        attendance_source = EXCLUDED.attendance_source,
        device_id = COALESCE(EXCLUDED.device_id, hrm_schema.attendances.device_id),
        status = CASE 
          WHEN hrm_schema.attendances.status = 'VALID' AND EXCLUDED.status = 'LATE' THEN 'LATE'
          ELSE COALESCE(hrm_schema.attendances.status, EXCLUDED.status)
        END,
        note = COALESCE(EXCLUDED.note, hrm_schema.attendances.note),
        updated_at = now()
      RETURNING *`,
      [
        tenantId,
        employeeId,
        workDate,
        occurredAt.toISOString(),
        body.source || 'WEB_PORTAL',
        body.deviceId || null,
        status,
        checkInNote,
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

    // 1. Resolve assigned shift
    const shiftRes = await pool.query(
      `SELECT sd.* FROM hrm_schema.shift_assignments sa
       JOIN hrm_schema.shift_definitions sd ON sa.shift_id = sd.id
       WHERE sa.tenant_id = $1 AND sa.employee_id = $2
         AND sa.status = 'ACTIVE'
         AND sa.effective_from <= $3
         AND (sa.effective_to IS NULL OR sa.effective_to >= $3)
       ORDER BY sa.effective_from DESC LIMIT 1`,
      [tenantId, employeeId, workDate],
    );

    let shift = shiftRes.rows[0];
    if (!shift) {
      const defaultShiftRes = await pool.query(
        `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`,
        [tenantId],
      );
      shift = defaultShiftRes.rows[0];
    }

    // 2. Fetch existing check_in_at to calculate worked minutes and preserve LATE status if present
    const existing = await pool.query(
      `SELECT check_in_at, status, note FROM hrm_schema.attendances WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3`,
      [tenantId, employeeId, workDate],
    );

    let workedMinutes = 0;
    let initialStatus = existing.rows.length > 0 && existing.rows[0].status ? existing.rows[0].status : 'VALID';

    if (existing.rows.length > 0 && existing.rows[0].check_in_at) {
      const checkIn = new Date(existing.rows[0].check_in_at);
      let diffMinutes = Math.max(0, Math.floor((occurredAt.getTime() - checkIn.getTime()) / 60000));
      
      // Deduct break minutes if duration spans longer than break time
      const breakMins = shift?.break_minutes || 0;
      if (breakMins > 0 && diffMinutes > breakMins) {
        diffMinutes -= breakMins;
      }
      workedMinutes = diffMinutes;
    }

    // 3. Evaluate early leave condition
    let status = initialStatus;
    let checkOutNote = body.note || (existing.rows.length > 0 ? existing.rows[0].note : null);
    if (shift && shift.end_time) {
      const [endHour, endMin] = shift.end_time.split(':').map(Number);
      const shiftEndTime = new Date(occurredAt);
      shiftEndTime.setHours(endHour, endMin, 0, 0);

      const graceEarly = shift.grace_early_minutes || 0;
      const earlyThreshold = new Date(shiftEndTime.getTime() - graceEarly * 60000);

      if (occurredAt.getTime() < earlyThreshold.getTime()) {
        if (status === 'VALID') {
          status = 'EARLY_LEAVE';
        }
        const earlyMins = Math.floor((shiftEndTime.getTime() - occurredAt.getTime()) / 60000);
        checkOutNote = checkOutNote
          ? `${checkOutNote} | Về sớm ${earlyMins} phút`
          : `Về sớm ${earlyMins} phút (Ca: ${shift.name || shift.code})`;
      }
    }

    const res = await pool.query(
      `INSERT INTO hrm_schema.attendances (
        tenant_id, employee_id, work_date, check_out_at, attendance_source, device_id, status, worked_minutes, note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tenant_id, employee_id, work_date)
      DO UPDATE SET
        check_out_at = EXCLUDED.check_out_at,
        attendance_source = EXCLUDED.attendance_source,
        device_id = COALESCE(EXCLUDED.device_id, hrm_schema.attendances.device_id),
        worked_minutes = GREATEST(hrm_schema.attendances.worked_minutes, EXCLUDED.worked_minutes),
        status = CASE
          WHEN hrm_schema.attendances.status IN ('LATE', 'ABNORMAL') THEN hrm_schema.attendances.status
          ELSE EXCLUDED.status
        END,
        note = COALESCE(EXCLUDED.note, hrm_schema.attendances.note),
        updated_at = now()
      RETURNING *`,
      [
        tenantId,
        employeeId,
        workDate,
        occurredAt.toISOString(),
        body.source || 'WEB_PORTAL',
        body.deviceId || null,
        status,
        workedMinutes,
        checkOutNote,
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
      `SELECT id, tenant_id, employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
              check_in_at, check_out_at, attendance_source, device_id, status, worked_minutes,
              note, created_at, updated_at
       FROM hrm_schema.attendances
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
    const employeeId = body.employeeId || principal.userId;
    const res = await pool.query(
      `INSERT INTO hrm_schema.attendance_corrections (
        tenant_id, employee_id, attendance_id, request_date, new_check_in_at, new_check_out_at,
        reason, status, submitted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.attendanceId || null,
        body.requestDate,
        body.newCheckInAt || null,
        body.newCheckOutAt || null,
        body.reason,
        principal.userId,
      ],
    );
    const inserted = res.rows[0];

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'correction',
      inserted.id,
      employeeId,
      `Đơn giải trình công - Ngày ${body.requestDate}`,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.attendance_corrections SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, inserted.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapCorrection(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapCorrection(inserted),
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

    // Nếu đơn có gắn quy trình động thì cập nhật qua Procedure Engine
    if (corr.procedure_instance_id) {
      await this.bridge.handleProcedureAction(
        pool,
        tenantId,
        'correction',
        id,
        'APPROVE',
        principal.userId,
      );
      const updated = await pool.query(
        `SELECT * FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return {
        data: this.mapCorrection(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

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
    let workDateStr = String(row.work_date || '');
    if (row.work_date instanceof Date) {
      const y = row.work_date.getFullYear();
      const m = String(row.work_date.getMonth() + 1).padStart(2, '0');
      const d = String(row.work_date.getDate()).padStart(2, '0');
      workDateStr = `${y}-${m}-${d}`;
    } else if (workDateStr.includes('T')) {
      workDateStr = workDateStr.split('T')[0];
    }

    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      workDate: workDateStr,
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
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      workflowStatus: row.workflow_status as string | null,
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
