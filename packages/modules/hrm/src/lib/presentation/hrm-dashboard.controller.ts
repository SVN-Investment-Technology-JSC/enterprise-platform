import type {
  HrmDashboardOverview,
  HrmEmployeeOverview,
} from '@enterprise-platform/contracts-hrm';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { resolveShiftRow } from '../infrastructure/hrm-shift-resolution.js';
import { dayKindOf } from '../infrastructure/hrm-time.js';
import { redactSensitiveRow } from '../infrastructure/hrm-profile-visibility.js';

const TODAY = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

@Controller('v1')
export class HrmDashboardController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Employee Personal Overview (P2_S3_HRM_API.md § 28)
  // --------------------------------------------------------------------------

  @Get('employees/:employeeId/overview')
  async getEmployeeOverview(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const context = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.employee.read',
      'hrm.self.read',
    );
    const { pool, tenantId } = context;

    // 1. Profile
    const profileRes = await pool.query(
      `SELECT * FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [tenantId, employeeId],
    );
    if (profileRes.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message: 'Employee profile not found',
      });
    }

    // 2. Ca hôm nay: ngoại lệ cá nhân > ca đơn vị > đơn vị cha; ngày nghỉ hằng tuần/lịch làm việc
    const todayIso = TODAY();
    const todayDayKind = await dayKindOf(pool, tenantId, todayIso, employeeId);
    const todayShift = await resolveShiftRow(
      pool,
      tenantId,
      employeeId,
      todayIso,
      'Asia/Ho_Chi_Minh',
    );
    let currentShiftRow: Record<string, unknown> | null = null;
    if (todayShift && todayDayKind !== 'OFF' && todayDayKind !== 'HOLIDAY') {
      const {
        starts_at: _a,
        ends_at: _b,
        break_starts_at: _c,
        break_ends_at: _d,
        assignment_id: _e,
        depth: _f,
        unit_id: _g,
        ...definition
      } = todayShift.row;
      currentShiftRow = definition;
    }

    // 3. Leave Balances
    const currentYear = new Date().getFullYear();
    const balancesRes = await pool.query(
      `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND year = $3`,
      [tenantId, employeeId, currentYear],
    );

    // 4. Today Attendance
    const today = todayIso;
    const attRes = await pool.query(
      `SELECT * FROM hrm_schema.attendances WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3`,
      [tenantId, employeeId, today],
    );

    // 5. Pending request counts
    const leavePending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND employee_id = $2 AND status = 'PENDING'`,
      [tenantId, employeeId],
    );
    const otPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND employee_id = $2 AND status = 'PENDING'`,
      [tenantId, employeeId],
    );
    const corrPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND employee_id = $2 AND status = 'PENDING'`,
      [tenantId, employeeId],
    );
    const advPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.salary_advance_requests WHERE tenant_id = $1 AND employee_id = $2 AND status = 'PENDING'`,
      [tenantId, employeeId],
    );

    const overview: HrmEmployeeOverview = {
      // CCCD, mã số thuế, BHXH, ngân hàng chỉ hiện cho chính chủ hoặc người có quyền xem dữ liệu nhạy cảm.
      profile: ((await this.ctx.resolveEmployee(pool, tenantId, context.principal.userId)).employeeId === employeeId ||
      this.ctx.has(context, 'hrm.employee.sensitive')
        ? profileRes.rows[0]
        : redactSensitiveRow(profileRes.rows[0])) as any,
      currentPosition: null,
      currentShift: currentShiftRow as any,
      currentShiftSource: currentShiftRow ? todayShift?.source : null,
      todayDayKind,
      leaveBalances: balancesRes.rows as any,
      currentAttendance: attRes.rows[0] ? (attRes.rows[0] as any) : null,
      currentTimesheet: null,
      latestPayslip: null,
      pendingRequestsCount: {
        leave: leavePending.rows[0]?.c || 0,
        ot: otPending.rows[0]?.c || 0,
        correction: corrPending.rows[0]?.c || 0,
        advance: advPending.rows[0]?.c || 0,
      },
    };

    return {
      data: overview,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // HR Department Overview (P2_S3_HRM_API.md § 28)
  // --------------------------------------------------------------------------

  @Get('dashboard/overview')
  async getDashboardOverview(
    @Req() req: Request,
    @Query('period') period?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.dashboard.read',
    );

    // Headcount
    const headcount = await pool.query(
      `SELECT
        count(*)::int as total,
        count(*) FILTER (WHERE employment_status = 'OFFICIAL')::int as official,
        count(*) FILTER (WHERE employment_status = 'PROBATION')::int as probation
       FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND deleted_at IS NULL AND employment_status NOT IN ('RESIGNED','TERMINATED')`,
      [tenantId],
    );

    // Today Attendance stats
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const todayDayKind = await dayKindOf(pool, tenantId, today);
    const attStats = await pool.query(
      `SELECT
        count(*) FILTER (WHERE check_in_at IS NOT NULL)::int as checked_in,
        count(*) FILTER (WHERE status IN ('MISSING_PUNCH','ABNORMAL'))::int as missing,
        count(*) FILTER (WHERE late_minutes>0)::int as late
       FROM hrm_schema.attendances WHERE tenant_id = $1 AND work_date = $2`,
      [tenantId, today],
    );

    // Pending approvals count
    const leavePending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND status IN ('PENDING','PEER_CONFIRMED')`,
      [tenantId],
    );
    const otPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND status IN ('PENDING','PEER_CONFIRMED')`,
      [tenantId],
    );
    const corrPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND status IN ('PENDING','PEER_CONFIRMED')`,
      [tenantId],
    );
    const advPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.salary_advance_requests WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId],
    );
    const tripPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.business_trip_requests WHERE tenant_id = $1 AND status IN ('PENDING','PEER_CONFIRMED')`,
      [tenantId],
    );
    const shiftPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND status IN ('PENDING','PEER_CONFIRMED')`,
      [tenantId],
    );
    const profilePending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.profile_corrections WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId],
    );

    // Current open periods
    const tsPeriod = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 ORDER BY from_date DESC LIMIT 1`,
      [tenantId],
    );
    const prPeriod = await pool.query(
      `SELECT * FROM hrm_schema.payroll_periods WHERE tenant_id = $1 ORDER BY from_date DESC LIMIT 1`,
      [tenantId],
    );

    const onLeave = await pool.query(
      `SELECT count(DISTINCT employee_id)::int AS c FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='APPROVED' AND $2::date BETWEEN from_date AND to_date`,
      [tenantId, today],
    );
    const dayOff = todayDayKind === 'OFF' || todayDayKind === 'HOLIDAY';
    const overview: HrmDashboardOverview = {
      todayDayKind,
      periodCode: period || tsPeriod.rows[0]?.period_code || 'CURRENT',
      totalEmployees: headcount.rows[0]?.total || 0,
      officialEmployees: headcount.rows[0]?.official || 0,
      probationEmployees: headcount.rows[0]?.probation || 0,
      todayAttendance: {
        checkedInCount: attStats.rows[0]?.checked_in || 0,
        // Ngày nghỉ hằng tuần/lễ: không tính thiếu lượt hay đi trễ.
        missingPunchCount: dayOff ? 0 : attStats.rows[0]?.missing || 0,
        lateCount: dayOff ? 0 : attStats.rows[0]?.late || 0,
        onLeaveCount: onLeave.rows[0]?.c || 0,
      },
      pendingApprovals: {
        leaveRequests: leavePending.rows[0]?.c || 0,
        otRequests: otPending.rows[0]?.c || 0,
        corrections: corrPending.rows[0]?.c || 0,
        advances: advPending.rows[0]?.c || 0,
        businessTrips: tripPending.rows[0]?.c || 0,
        shiftChanges: shiftPending.rows[0]?.c || 0,
        profileChanges: profilePending.rows[0]?.c || 0,
      },
      currentTimesheetPeriod: tsPeriod.rows[0]
        ? (tsPeriod.rows[0] as any)
        : null,
      currentPayrollPeriod: prPeriod.rows[0] ? (prPeriod.rows[0] as any) : null,
    };

    return {
      data: overview,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }
}
