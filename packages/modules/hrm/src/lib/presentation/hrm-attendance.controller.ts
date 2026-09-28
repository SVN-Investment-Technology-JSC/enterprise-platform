import { approveAttendanceCorrection } from '../infrastructure/hrm-request-transition.js';
import { submitHrmRequest } from '../infrastructure/hrm-submission.js';
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
import { randomUUID } from 'node:crypto';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest.js';
import {
  assertOpenDate,
  lockEmployee,
  resolvePolicy,
  shiftForDate,
  timeContext,
  isoDate,
  isoTime,
} from '../infrastructure/hrm-time.js';
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
    return this.punch(req, body, 'IN');
  }

  @Post('attendance/check-out')
  async checkOut(@Req() req: Request, @Body() body: CheckOutRequest) {
    return this.punch(req, body, 'OUT');
  }

  private async punch(req: Request, body: CheckInRequest, kind: 'IN' | 'OUT') {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.attendance',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    if (body.employeeId && body.employeeId !== employeeId)
      throw new BadRequestException('Không thể chấm công thay nhân viên khác');
    if (body.occurredAt)
      throw new BadRequestException('Chấm công trực tuyến sử dụng giờ máy chủ');
    const row = await ingestEvent(
      pool,
      tenantId,
      principal.userId,
      {
        employeeId,
        kind,
        occurredAt: new Date().toISOString(),
        source: 'WEB_PORTAL',
        externalEventId: body.externalEventId || randomUUID(),
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      },
      req,
    );
    return {
      data: this.mapAttendance(row),
      meta: { requestId: req.headers['x-request-id'] },
    };
  }

  @Get('my-attendance-context')
  async myTimeContext(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const context = await hrmTransaction(pool, (db) =>
      timeContext(db, tenantId, employeeId, new Date().toISOString()),
    );
    return {
      data: {
        employeeId,
        workDate: context.date,
        timezone: context.timezone,
        shift: context.shift,
        requireGps: context.policy?.config_json.requireGps === true,
      },
    };
  }

  @Get('my-attendance')
  async myAttendance(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const result = await pool.query(
      `SELECT * FROM hrm_schema.attendances WHERE tenant_id=$1 AND employee_id=$2 ORDER BY work_date DESC LIMIT 93`,
      [tenantId, employeeId],
    );
    return { data: result.rows.map(this.mapAttendance) };
  }

  @Get('attendance')
  async listAttendance(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.attendance.read', employeeId);
    employeeId = visibleEmployeeId;
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
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Get('attendance/:attendanceId')
  async getAttendance(
    @Req() req: Request,
    @Param('attendanceId') attendanceId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.attendance.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.attendances WHERE tenant_id = $1 AND id = $2`,
      [tenantId, attendanceId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_ATTENDANCE_NOT_FOUND',
        message: 'Attendance record not found',
      });
    }
    return {
      data: this.mapAttendance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('internal/attendance/ingest')
  async ingestAttendance(
    @Req() req: Request,
    @Body() body: IngestAttendanceRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.attendance.import',
    );
    const row = await ingestEvent(pool, tenantId, principal.userId, {
      employeeId: body.employeeId,
      kind: body.kind,
      occurredAt: body.occurredAt,
      source: body.source,
      externalEventId: body.externalEventId || '',
    });
    return {
      data: this.mapAttendance(row),
      meta: { requestId: req.headers['x-request-id'] },
    };
  }

  // --------------------------------------------------------------------------
  // Attendance Correction APIs (P2_S3_HRM_API.md § 12)
  // --------------------------------------------------------------------------

  @Post('attendance-corrections')
  async createCorrection(
    @Req() req: Request,
    @Body()
    body: CreateAttendanceCorrectionRequest & {
      attributes?: Record<string, unknown>;
    },
  ) {
    const { pool, tenantId, principal, employeeId } =
      await this.ctx.getRequestContext(req, body.employeeId);
    requireDate(body.requestDate, 'requestDate');
    requireText(body.reason, 'reason', 2000);
    const sessions =
      body.sessions ||
      (body.newCheckInAt && body.newCheckOutAt
        ? [{ start: body.newCheckInAt, end: body.newCheckOutAt }]
        : []);
    if (!sessions.length || sessions.length > 12)
      throw new BadRequestException('Cần khai báo từ 1 đến 12 cặp giờ vào/ra');
    let previousEnd = 0;
    for (const session of sessions) {
      const start = Date.parse(session.start),
        end = Date.parse(session.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < previousEnd ||
        end <= start ||
        end - start > 86400000 ||
        end > Date.now()
      )
        throw new BadRequestException('Giờ vào/ra không hợp lệ hoặc chồng lấn');
      previousEnd = end;
    }
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'correction',
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn giải trình công',
        attributes: body.attributes,
      },
      async (db) => {
        await lockEmployee(db, tenantId, employeeId);
        await assertOpenDate(db, tenantId, body.requestDate);
        const policy = await resolvePolicy(
          db,
          tenantId,
          'ATTENDANCE',
          body.requestDate,
          employeeId,
        );
        const timezone = String(
          policy?.config_json.timezone || 'Asia/Ho_Chi_Minh',
        );
        const shift = await shiftForDate(
          db,
          tenantId,
          employeeId,
          body.requestDate,
          timezone,
        );
        const bounds = await db.query(
          `SELECT ($1::date::timestamp AT TIME ZONE $2) AS start, (($1::date+1)::timestamp AT TIME ZONE $2) AS end`,
          [body.requestDate, timezone],
        );
        const start = shift
          ? Date.parse(shift.window.start) - shift.before * 60000
          : new Date(bounds.rows[0].start).getTime();
        const end = shift
          ? Date.parse(shift.window.end) + shift.after * 60000
          : new Date(bounds.rows[0].end).getTime();
        if (
          sessions.some(
            (s) => Date.parse(s.start) < start || Date.parse(s.end) > end,
          )
        )
          throw new BadRequestException(
            'Giờ giải trình phải thuộc ngày công và cửa sổ ca đã chọn',
          );
        const att = await db.query(
          `SELECT id,check_in_at,check_out_at FROM hrm_schema.attendances WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3`,
          [tenantId, employeeId, body.requestDate],
        );
        if (body.attendanceId && body.attendanceId !== att.rows[0]?.id)
          throw new BadRequestException(
            'Bản ghi công không khớp nhân viên/ngày',
          );
        const result = await db.query(
          `INSERT INTO hrm_schema.attendance_corrections (tenant_id,employee_id,attendance_id,request_date,old_check_in_at,old_check_out_at,new_check_in_at,new_check_out_at,corrected_sessions,reason,status,submitted_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING',$11) RETURNING *`,
          [
            tenantId,
            employeeId,
            att.rows[0]?.id || null,
            body.requestDate,
            att.rows[0]?.check_in_at || null,
            att.rows[0]?.check_out_at || null,
            sessions[0].start,
            sessions[sessions.length - 1].end,
            JSON.stringify(sessions),
            body.reason,
            principal.userId,
          ],
        );
        return result.rows[0];
      },
    );
    return {
      data: {
        ...this.mapCorrection(row),
        procedureSyncStatus: link?.syncStatus ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  @Get('attendance-corrections')
  async listCorrections(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
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
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('attendance-corrections/:id/submit')
  async submitCorrection(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.attendance.approve',
    );
    const res = await pool.query(
      `UPDATE hrm_schema.attendance_corrections SET status = 'PENDING', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status='PENDING' RETURNING *`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_CORRECTION_NOT_FOUND',
        message: 'Correction request not found',
      });
    }
    return {
      data: this.mapCorrection(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance-corrections/:id/approve')
  async approveCorrection(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.attendance.approve',
    );

    const row = await hrmTransaction(pool, (db) =>
      approveAttendanceCorrection(db, tenantId, principal.userId, id),
    );
    return { data: this.mapCorrection(row) };
  }

  @Post('attendance-corrections/:id/reject')
  async rejectCorrection(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.attendance.approve',
    );
    const res = await pool.query(
      `UPDATE hrm_schema.attendance_corrections
       SET status = 'REJECTED', approved_by = $3, rejection_reason = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status='PENDING'
       RETURNING *`,
      [
        tenantId,
        id,
        principal.userId,
        reason || 'Bị từ chối bởi người quản lý',
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_CORRECTION_NOT_FOUND',
        message: 'Correction request not found',
      });
    }
    return {
      data: this.mapCorrection(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('attendance-corrections/:id/cancel')
  async cancelCorrection(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.attendance.approve',
    );
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
      workDate: isoDate(row.work_date),
      checkInAt: isoTime(row.check_in_at),
      checkOutAt: isoTime(row.check_out_at),
      attendanceSource: row.attendance_source as any,
      deviceId: row.device_id as string | null,
      status: row.status as any,
      workedMinutes: row.worked_minutes as number,
      scheduledMinutes: Number(row.scheduled_minutes || 0),
      lateMinutes: Number(row.late_minutes || 0),
      earlyMinutes: Number(row.early_minutes || 0),
      calculationSnapshot: row.calculation_snapshot as Record<string, unknown>,
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
      requestDate: isoDate(row.request_date),
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
