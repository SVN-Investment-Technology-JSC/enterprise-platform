import type {
  AdjustTimesheetRequest,
  CreateTimesheetPeriodRequest,
  HrmTimesheet,
  HrmTimesheetPeriod,
  UpdateTimesheetPeriodRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { calculateTimesheet } from '../infrastructure/hrm-timesheet-calculation.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import {
  assertLifecycleVersion,
  lifecycleAudit,
  timestamp,
} from '../infrastructure/hrm-lifecycle.js';
import type { PoolClient } from 'pg';

@Controller('v1')
export class HrmTimesheetController {
  constructor(private readonly ctx: HrmContextService) {}

  /**
   * Bảng công của CHÍNH người đăng nhập (nhân viên tự xem). Chỉ cần quyền cá nhân, luôn lọc theo nhân viên của tài khoản.
   * Dòng thuộc kỳ chưa khóa là số tạm tính; kèm trạng thái kỳ để giao diện hiển thị.
   */
  @Get('my-timesheet')
  async myTimesheet(
    @Req() req: Request,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const from = requireDate(fromDate, 'from'),
      to = requireDate(toDate, 'to');
    if (to < from || Date.parse(to) - Date.parse(from) > 92 * 86400000)
      throw new BadRequestException('Chỉ xem tối đa 93 ngày');
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.self.read');
    const { employeeId } = await this.ctx.resolveEmployee(pool, tenantId, principal.userId);
    const res = await pool.query(
      `SELECT to_char(t.work_date,'YYYY-MM-DD') AS work_date, t.status, t.scheduled_minutes, t.worked_minutes, t.paid_minutes,
              t.ot_minutes, t.late_minutes, t.early_leave_minutes, t.workday_units, t.is_manually_adjusted,
              p.period_code, p.status AS period_status, s.code AS shift_code, s.name AS shift_name
         FROM hrm_schema.timesheets t
         JOIN hrm_schema.timesheet_periods p ON p.id = t.period_id AND p.tenant_id = t.tenant_id
         LEFT JOIN hrm_schema.shift_definitions s ON s.id = t.shift_id AND s.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1 AND t.employee_id = $2 AND t.work_date BETWEEN $3::date AND $4::date
        ORDER BY t.work_date`,
      [tenantId, employeeId, from, to],
    );
    const rows = res.rows.map((r) => ({
      workDate: r.work_date as string,
      status: r.status as string,
      shiftCode: (r.shift_code as string | null) ?? null,
      shiftName: (r.shift_name as string | null) ?? null,
      scheduledMinutes: Number(r.scheduled_minutes ?? 0),
      workedMinutes: Number(r.worked_minutes ?? 0),
      paidMinutes: Number(r.paid_minutes ?? 0),
      otMinutes: Number(r.ot_minutes ?? 0),
      lateMinutes: Number(r.late_minutes ?? 0),
      earlyLeaveMinutes: Number(r.early_leave_minutes ?? 0),
      workdayUnits: Number(r.workday_units ?? 0),
      adjusted: r.is_manually_adjusted === true,
      periodCode: r.period_code as string,
      periodStatus: r.period_status as string,
    }));
    return {
      data: rows,
      meta: {
        total: rows.length,
        requestId: req.headers['x-request-id'] as string,
        summary: {
          workdayUnits: Math.round(rows.reduce((n, r) => n + r.workdayUnits, 0) * 100) / 100,
          paidMinutes: rows.reduce((n, r) => n + r.paidMinutes, 0),
          otMinutes: rows.reduce((n, r) => n + r.otMinutes, 0),
          lateMinutes: rows.reduce((n, r) => n + r.lateMinutes, 0),
          earlyLeaveMinutes: rows.reduce((n, r) => n + r.earlyLeaveMinutes, 0),
        },
      },
    };
  }

  @Get('timesheet-periods/:id/export')
  async exportPeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.export',
    );
    const result = await this.listTimesheets(req, id);
    await pool.query(
      `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'TIMESHEET_EXPORT','timesheet_period',$3,'{}')`,
      [tenantId, principal.userId, id],
    );
    return result;
  }

  // --------------------------------------------------------------------------
  // Timesheet Periods (P2_S3_HRM_API.md § 19)
  // --------------------------------------------------------------------------

  @Get('timesheet-periods')
  async listPeriods(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.timesheet.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 ORDER BY from_date DESC`,
      [tenantId],
    );
    return {
      data: res.rows.map(this.mapPeriod),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('timesheet-periods')
  async createPeriod(
    @Req() req: Request,
    @Body() body: CreateTimesheetPeriodRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.timesheet.calculate',
    );
    requireDate(body.fromDate, 'fromDate');
    requireDate(body.toDate, 'toDate');
    requireText(body.periodCode, 'periodCode', 50);
    if (
      body.toDate < body.fromDate ||
      Date.parse(body.toDate) - Date.parse(body.fromDate) > 62 * 86400000
    )
      throw new BadRequestException('Kỳ công tối đa 63 ngày');
    const res = await hrmTransaction(pool, async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `timesheet-period:${tenantId}`,
      ]);
      const overlap = await db.query(
        `SELECT id FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND daterange(from_date,to_date,'[]') && daterange($2::date,$3::date,'[]')`,
        [tenantId, body.fromDate, body.toDate],
      );
      if (overlap.rowCount)
        throw new BadRequestException('Kỳ công trùng khoảng thời gian đã có');
      return db.query(
        `INSERT INTO hrm_schema.timesheet_periods (
        tenant_id, period_code, from_date, to_date, status
      ) VALUES ($1, $2, $3, $4, 'OPEN')
      RETURNING *`,
        [tenantId, body.periodCode, body.fromDate, body.toDate],
      );
    });
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('timesheet-periods/:id')
  async getPeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.timesheet.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_PERIOD_NOT_FOUND',
        message: 'Timesheet period not found',
      });
    }
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private async emptyPeriod(
    db: PoolClient,
    tenantId: string,
    id: string,
    expectedUpdatedAt: string,
  ) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `timesheet-period:${tenantId}`,
    ]);
    const result = await db.query(
      'SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Không tìm thấy kỳ công');
    assertLifecycleVersion(row, expectedUpdatedAt);
    const used = await db.query(
      `SELECT EXISTS(SELECT 1 FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND timesheet_period_id=$2) AS used`,
      [tenantId, id],
    );
    if (row.status === 'LOCKED' || used.rows[0].used)
      throw new ConflictException(
        'Chỉ sửa hoặc xóa kỳ chưa khóa, chưa có dòng công và chưa được kỳ lương tham chiếu',
      );
    return row;
  }

  @Patch('timesheet-periods/:id')
  async updatePeriod(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateTimesheetPeriodRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.calculate',
    );
    requireText(body.reason, 'Lý do', 2000);
    const row = await hrmTransaction(pool, async (db) => {
      const before = await this.emptyPeriod(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      const code = requireText(
        body.periodCode ?? before.period_code,
        'Mã kỳ',
        50,
      );
      const from = body.fromDate ?? isoDate(before.from_date),
        to = body.toDate ?? isoDate(before.to_date);
      requireDate(from, 'Từ ngày');
      requireDate(to, 'Đến ngày');
      if (to < from || Date.parse(to) - Date.parse(from) > 62 * 86400000)
        throw new BadRequestException('Kỳ công tối đa 63 ngày');
      const overlap = await db.query(
        `SELECT id FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id<>$2 AND (period_code=$3 OR daterange(from_date,to_date,'[]') && daterange($4::date,$5::date,'[]'))`,
        [tenantId, id, code, from, to],
      );
      if (overlap.rowCount)
        throw new ConflictException(
          'Trùng mã kỳ hoặc khoảng thời gian kỳ công',
        );
      const changed = await db.query(
        `UPDATE hrm_schema.timesheet_periods SET period_code=$3,from_date=$4,to_date=$5,calculated_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, code, from, to],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'TIMESHEET_PERIOD_UPDATED',
        id,
        { before, after: changed.rows[0], reason: body.reason },
      );
      return changed.rows[0];
    });
    return { data: this.mapPeriod(row) };
  }

  @Delete('timesheet-periods/:id')
  async deletePeriod(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.calculate',
    );
    requireText(body.reason, 'Lý do', 2000);
    await hrmTransaction(pool, async (db) => {
      const before = await this.emptyPeriod(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      await db.query(
        'DELETE FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'TIMESHEET_PERIOD_DELETED',
        id,
        { before, reason: body.reason },
      );
    });
    return { data: { id, deleted: true } };
  }

  @Post('timesheet-periods/:id/calculate')
  async calculatePeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.calculate',
    );
    return {
      data: await hrmTransaction(pool, async (db) => {
        // Preserve the source snapshot behind previous manual decisions.
        await db.query(
          'SELECT id FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        );
        const manual = await db.query(
          'SELECT * FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND is_manually_adjusted',
          [tenantId, id],
        );
        const result = await calculateTimesheet(db, tenantId, id);
        await lifecycleAudit(
          db,
          tenantId,
          principal.userId,
          'TIMESHEET_CALCULATED',
          id,
          { result, manualBefore: manual.rows },
        );
        return result;
      }),
    };
  }

  @RequirePermission('hrm.timesheet.lock')
  @Post('timesheet-periods/:id/lock')
  async lockPeriod(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.lock',
    );
    const res = await hrmTransaction(pool, async (db) => {
      const period = await db.query(
        `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      if (!period.rows[0])
        throw new NotFoundException('Không tìm thấy kỳ công');
      if (period.rows[0].status === 'LOCKED') return period;
      const ready = await db.query(
        `SELECT $2::date < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ended, EXISTS(SELECT 1 FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$3) AS has_lines`,
        [tenantId, period.rows[0].to_date, id],
      );
      if (!ready.rows[0].ended || !ready.rows[0].has_lines)
        throw new BadRequestException(
          'Chỉ khóa kỳ công đã kết thúc và có dữ liệu',
        );
      if (!period.rows[0].calculated_at)
        throw new BadRequestException(
          'Cần tính lại bảng công sau thay đổi dữ liệu nguồn',
        );
      const issues = await db.query(
        `SELECT id FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND status='ABNORMAL' LIMIT 1`,
        [tenantId, id],
      );
      if (issues.rowCount)
        throw new BadRequestException(
          'Cần giải trình các dòng bất thường trước khi khóa kỳ',
        );
      const pending = await db.query(
        `SELECT id FROM hrm_schema.attendance_corrections WHERE tenant_id=$1 AND status='PENDING' AND request_date BETWEEN $2 AND $3 UNION ALL SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3 AND to_date>=$2 UNION ALL SELECT id FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND status='PENDING' AND work_date BETWEEN $2 AND $3 UNION ALL SELECT id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3 AND to_date>=$2 UNION ALL SELECT id FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND status IN ('PENDING','PEER_CONFIRMED') AND from_date<=$3 AND to_date>=$2 LIMIT 1`,
        [tenantId, period.rows[0].from_date, period.rows[0].to_date],
      );
      if (pending.rowCount)
        throw new BadRequestException('Còn đơn chờ duyệt trong kỳ công');
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'TIMESHEET_PERIOD_LOCKED',
        id,
        { before: period.rows[0] },
      );
      return db.query(
        `UPDATE hrm_schema.timesheet_periods SET status='LOCKED',locked_by=$3,locked_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, principal.userId],
      );
    });
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @RequirePermission('hrm.timesheet.reopen')
  @Post('timesheet-periods/:id/reopen')
  async reopenPeriod(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.reopen',
    );
    if (!reason) {
      throw new BadRequestException({
        code: 'HRM_REASON_REQUIRED',
        message: 'Reopen reason is mandatory',
      });
    }
    requireText(reason, 'reason', 2000);
    const res = await hrmTransaction(pool, async (db) => {
      await db.query(
        `SELECT id FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND timesheet_period_id=$2 ORDER BY id FOR UPDATE`,
        [tenantId, id],
      );
      const runs = await db.query(
        `SELECT r.id,r.status FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND p.timesheet_period_id=$2 ORDER BY r.id FOR UPDATE OF r`,
        [tenantId, id],
      );
      if (runs.rows.some((r) => r.status === 'FINALIZED'))
        throw new BadRequestException(
          'Bảng công đã dùng cho lương chốt; cần quy trình điều chỉnh kỳ sau',
        );
      const before = await db.query(
        'SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, id],
      );
      if (!before.rowCount)
        throw new NotFoundException('Không tìm thấy kỳ công');
      if (before.rows[0].status !== 'LOCKED')
        throw new ConflictException('Chỉ mở lại kỳ đã khóa');
      const result = await db.query(
        `UPDATE hrm_schema.timesheet_periods SET
        status = 'REOPENED', calculated_at=NULL, reopened_by = $3, reopened_at = now(), reopen_reason = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
        [tenantId, id, principal.userId, reason],
      );
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',updated_at=now() WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status<>'CANCELLED'`,
        [tenantId, runs.rows.map((r) => r.id)],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'TIMESHEET_PERIOD_REOPENED',
        id,
        { before: before.rows[0], reason },
      );
      return result;
    });
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_PERIOD_NOT_FOUND',
        message: 'Timesheet period not found',
      });
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
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.timesheet.read',
    );
    const res = await pool.query(
      `SELECT t.*, e.full_name AS employee_name, e.employee_code, e.department_name, e.position_name FROM hrm_schema.timesheets t JOIN hrm_schema.employee_directory e ON e.tenant_id=t.tenant_id AND e.employee_id=t.employee_id
       WHERE t.tenant_id = $1
         AND ($2::uuid IS NULL OR period_id = $2)
         AND ($3::uuid IS NULL OR t.employee_id = $3)
         AND ($4::date IS NULL OR work_date >= $4)
         AND ($5::date IS NULL OR work_date <= $5)
       ORDER BY work_date DESC`,
      [
        tenantId,
        periodId || null,
        employeeId || null,
        fromDate || null,
        toDate || null,
      ],
    );
    return {
      data: res.rows.map(this.mapTimesheet),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Get('timesheets/:id')
  async getTimesheet(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.timesheet.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheets WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_TIMESHEET_NOT_FOUND',
        message: 'Timesheet record not found',
      });
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.timesheet.adjust',
    );
    if (!body.reason) {
      throw new BadRequestException({
        code: 'HRM_REASON_REQUIRED',
        message: 'Adjustment reason is required',
      });
    }
    for (const value of [body.paidMinutes, body.workdayUnits])
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        throw new BadRequestException('Số công không hợp lệ');
    const res = await hrmTransaction(pool, async (db) => {
      const current = await db.query(
        `SELECT t.*,p.status AS period_status FROM hrm_schema.timesheets t JOIN hrm_schema.timesheet_periods p ON p.id=t.period_id AND p.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE OF p,t`,
        [tenantId, id],
      );
      if (!current.rows[0])
        throw new NotFoundException('Không tìm thấy dòng công');
      if (current.rows[0].period_status === 'LOCKED')
        throw new BadRequestException('Kỳ công đã khóa');
      assertLifecycleVersion(current.rows[0], body.expectedUpdatedAt);
      requireText(body.reason, 'Căn cứ điều chỉnh', 2000);
      if (
        (body.paidMinutes ?? 0) > current.rows[0].scheduled_minutes ||
        (body.workdayUnits ?? 0) > 1
      )
        throw new BadRequestException('Điều chỉnh vượt định mức ca');
      const scheduled = Number(current.rows[0].scheduled_minutes);
      const paid =
        body.paidMinutes ??
        (body.workdayUnits !== undefined
          ? Math.round(body.workdayUnits * scheduled)
          : Number(current.rows[0].paid_minutes));
      const units = scheduled
        ? Math.round((paid / scheduled) * 10000) / 10000
        : 0;
      if (
        body.workdayUnits !== undefined &&
        Math.abs(body.workdayUnits - units) > 0.005
      )
        throw new BadRequestException(
          'Số công và phút công hưởng lương không khớp',
        );
      const changed = await db.query(
        `UPDATE hrm_schema.timesheets SET
        workday_units = COALESCE($3, workday_units),
        paid_minutes = COALESCE($4, paid_minutes),
        status = COALESCE($5, status),
        is_manually_adjusted = true,
        adjustment_needs_review = false,
        adjusted_by = $6,
        adjusted_reason = $7,
        updated_at = GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
        [tenantId, id, units, paid, 'ADJUSTED', principal.userId, body.reason],
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'TIMESHEET_ADJUSTED',$3,$4)`,
        [
          tenantId,
          principal.userId,
          id,
          JSON.stringify({ before: current.rows[0], request: body }),
        ],
      );
      return changed;
    });
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_TIMESHEET_NOT_FOUND',
        message: 'Timesheet record not found',
      });
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
      fromDate: isoDate(row.from_date),
      toDate: isoDate(row.to_date),
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
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }

  private mapTimesheet(row: Record<string, unknown>): HrmTimesheet {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      periodId: row.period_id as string,
      employeeId: row.employee_id as string,
      employeeName: row.employee_name as string | undefined,
      employeeCode: (row.employee_code as string | null) ?? undefined,
      department: (row.department_name as string | null) ?? undefined,
      position: (row.position_name as string | null) ?? undefined,
      workDate: isoDate(row.work_date),
      shiftId: row.shift_id as string | null,
      attendanceId: row.attendance_id as string | null,
      leaveRequestId: row.leave_request_id as string | null,
      otRequestId: row.ot_request_id as string | null,
      businessTripRequestId: row.business_trip_request_id as string | null,
      scheduledMinutes: Number(row.scheduled_minutes ?? 0),
      workedMinutes: Number(row.worked_minutes || 0),
      paidMinutes: Number(row.paid_minutes || 0),
      otMinutes: Number(row.ot_minutes || 0),
      lateMinutes: Number(row.late_minutes || 0),
      earlyLeaveMinutes: Number(row.early_leave_minutes || 0),
      workdayUnits: Number(row.workday_units || 0),
      status: row.status as any,
      isManuallyAdjusted: Boolean(row.is_manually_adjusted),
      adjustmentNeedsReview: Boolean(row.adjustment_needs_review),
      adjustedBy: row.adjusted_by as string | null,
      adjustedReason: row.adjusted_reason as string | null,
      calculationSnapshot:
        (row.calculation_snapshot as Record<string, unknown>) || {},
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }
}
