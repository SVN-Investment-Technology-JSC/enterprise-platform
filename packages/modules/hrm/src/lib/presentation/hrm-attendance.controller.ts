import { attachProcedureLinkInfo } from '../infrastructure/hrm-procedure-link-info.js';
import { HrmApprovalPolicyService, approverPermissions } from '../infrastructure/hrm-approval-policy.js';
import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';
import {
  resolveDraftSubmission,
  type DraftSubmission,
} from '../infrastructure/hrm-request-drafts.js';
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
import { requireDate, requireText, requireUuid } from '../infrastructure/hrm-validation.js';
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
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
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

  /**
   * Dữ liệu chấm công theo ngày của nhiều nhân viên (màn Dữ liệu chấm công). Cần quyền xem chấm công toàn tenant.
   * Khác `attendance` ở chỗ có mã/tên nhân viên, đi muộn/về sớm/phút ca, lọc và phân trang.
   */
  @Get('attendance-data')
  async attendanceData(
    @Req() req: Request,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('employee_id') employeeId?: string,
    @Query('page') pageValue = '1',
    @Query('page_size') sizeValue = '50',
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.attendance.read');
    const from = requireDate(fromDate, 'from'),
      to = requireDate(toDate, 'to');
    const page = Number(pageValue),
      size = Number(sizeValue);
    if (
      to < from ||
      Date.parse(to) - Date.parse(from) > 92 * 86400000 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 200
    )
      throw new BadRequestException('Khoảng lọc tối đa 93 ngày; phân trang không hợp lệ.');
    const allowedStatus = ['VALID', 'LATE', 'EARLY_LEAVE', 'ABNORMAL', 'MISSING_PUNCH', 'APPROVED_CORRECTION'];
    const params: unknown[] = [tenantId, from, to];
    let where = `a.tenant_id=$1 AND a.work_date BETWEEN $2::date AND $3::date`;
    if (employeeId) {
      params.push(requireUuid(employeeId, 'employee_id'));
      where += ` AND a.employee_id=$${params.length}`;
    }
    if (status) {
      if (!allowedStatus.includes(status)) throw new BadRequestException('Trạng thái chấm công không hợp lệ');
      params.push(status);
      where += ` AND a.status=$${params.length}`;
    }
    if (q?.trim()) {
      params.push(`%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where += ` AND (e.employee_code ILIKE $${params.length} OR e.full_name ILIKE $${params.length})`;
    }
    const base = `FROM hrm_schema.attendances a
      LEFT JOIN hrm_schema.employee_directory e ON e.tenant_id=a.tenant_id AND e.employee_id=a.employee_id
      WHERE ${where}`;
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT a.id, a.employee_id, e.employee_code, e.full_name, e.department_name,
                to_char(a.work_date,'YYYY-MM-DD') AS work_date, a.check_in_at, a.check_out_at,
                a.worked_minutes, a.scheduled_minutes, a.late_minutes, a.early_minutes, a.status, a.attendance_source
         ${base} ORDER BY a.work_date DESC, e.employee_code, a.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, size, (page - 1) * size],
      ),
      pool.query(`SELECT count(*)::int AS total ${base}`, params),
    ]);
    return {
      data: rows.rows.map((r) => ({
        id: r.id as string,
        employeeId: r.employee_id as string,
        employeeCode: (r.employee_code as string | null) ?? '',
        employeeName: (r.full_name as string | null) ?? '',
        departmentName: (r.department_name as string | null) ?? null,
        workDate: r.work_date as string,
        checkInAt: r.check_in_at ? new Date(r.check_in_at as string).toISOString() : null,
        checkOutAt: r.check_out_at ? new Date(r.check_out_at as string).toISOString() : null,
        workedMinutes: Number(r.worked_minutes ?? 0),
        scheduledMinutes: Number(r.scheduled_minutes ?? 0),
        lateMinutes: Number(r.late_minutes ?? 0),
        earlyMinutes: Number(r.early_minutes ?? 0),
        status: r.status as string,
        source: r.attendance_source as string,
      })),
      meta: { total: count.rows[0].total as number, page, pageSize: size },
    };
  }

  @Get('attendance-events')
  async listEvents(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
    @Query('page') pageValue = '1',
    @Query('page_size') sizeValue = '50',
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.attendance.read', employeeId);
    const from = requireDate(fromDate, 'from'),
      to = requireDate(toDate, 'to');
    const page = Number(pageValue),
      size = Number(sizeValue);
    if (
      to < from ||
      Date.parse(to) - Date.parse(from) > 92 * 86400000 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 200
    )
      throw new BadRequestException(
        'Khoảng lọc tối đa 93 ngày; phân trang không hợp lệ.',
      );
    const params = [tenantId, visibleEmployeeId || null, from, to];
    const where = `a.tenant_id=$1 AND ($2::uuid IS NULL OR a.employee_id=$2) AND a.work_date BETWEEN $3::date AND $4::date`;
    const [events, count] = await Promise.all([
      pool.query(
        `SELECT a.id,a.employee_id,e.employee_code,e.full_name,to_char(a.work_date,'YYYY-MM-DD') AS work_date,a.occurred_at,a.event_kind,a.source,a.device_id,a.evidence,a.voided_by_correction_id
        FROM hrm_schema.attendance_events a LEFT JOIN hrm_schema.employee_directory e ON e.tenant_id=a.tenant_id AND e.employee_id=a.employee_id
        WHERE ${where} ORDER BY a.occurred_at DESC,a.id DESC LIMIT $5 OFFSET $6`,
        [...params, size, (page - 1) * size],
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM hrm_schema.attendance_events a WHERE ${where}`,
        params,
      ),
    ]);
    return {
      data: events.rows,
      meta: { total: count.rows[0].total, page, pageSize: size },
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
    body: CreateAttendanceCorrectionRequest &
      DraftSubmission & {
        attributes?: Record<string, unknown>;
      },
  ) {
    const { pool, tenantId, principal, employeeId } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'correction',
      body,
    );
    body = submission.body;
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
        draft: submission.draft,
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

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  @Get('attendance-corrections')
  async listCorrections(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
    @Query('forApproval') forApproval?: string,
    @Query('assignee') assignee?: string,
    @Query('currentStep') currentStep?: string,
  ) {
    const {
      pool,
      tenantId,
      principal,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(
      req,
      'hrm.request.read',
      employeeId,
      forApproval === '1' ? approverPermissions('correction') : [],
    );
    employeeId = visibleEmployeeId;
    const approvalScope =
      forApproval === '1'
        ? await this.approvals.listFilter(
            { pool, tenantId, principal },
            'correction',
            'attendance_corrections',
            4,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter(
      'attendance_corrections',
      4 + approvalScope.params.length,
      { assignee, currentStep },
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.attendance_corrections
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
         AND ${approvalScope.sql}
         AND ${progress.sql}
       ORDER BY created_at DESC`,
      [
        tenantId,
        employeeId || null,
        status || null,
        ...approvalScope.params,
        ...progress.params,
      ],
    );
    return {
      data: await attachProcedureLinkInfo(
        pool,
        tenantId,
        'correction',
        res.rows.map(this.mapCorrection),
      ),
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
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'correction',
      'approve',
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
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'correction',
      'reject',
    );
    const res = await hrmTransaction(pool, (db) =>
      db.query(
        `UPDATE hrm_schema.attendance_corrections
       SET status = 'REJECTED', approved_by = $3, rejection_reason = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status='PENDING'
       RETURNING *`,
        [
          tenantId,
          id,
          principal.userId,
          requireText(reason, 'Lý do từ chối', 2000),
        ],
      ),
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.attendance.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'correction',
      'cancel',
    );
    const res = await hrmTransaction(pool, (db) =>
      db.query(
        `UPDATE hrm_schema.attendance_corrections SET status = 'CANCELLED', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING' RETURNING *`,
        [tenantId, id],
      ),
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
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  private mapCorrection(row: Record<string, unknown>): HrmAttendanceCorrection {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      attendanceId: row.attendance_id as string | null,
      requestDate: isoDate(row.request_date),
      correctedSessions: (row.corrected_sessions || []) as {
        start: string;
        end: string;
      }[],
      oldCheckInAt: row.old_check_in_at ? String(row.old_check_in_at) : null,
      oldCheckOutAt: row.old_check_out_at ? String(row.old_check_out_at) : null,
      newCheckInAt: row.new_check_in_at ? String(row.new_check_in_at) : null,
      newCheckOutAt: row.new_check_out_at ? String(row.new_check_out_at) : null,
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      currentAssigneeName: (row.current_assignee_name ?? null) as string | null,
      workflowStatus: row.workflow_status as string | null,
      submittedBy: row.submitted_by as string,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      rejectionReason: row.rejection_reason as string | null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }
}
