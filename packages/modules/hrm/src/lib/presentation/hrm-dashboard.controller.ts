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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');

    // 1. Profile
    const profileRes = await pool.query(
      `SELECT * FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [tenantId, employeeId],
    );
    if (profileRes.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_EMPLOYEE_NOT_FOUND', message: 'Employee profile not found' });
    }

    // 2. Current Shift Assignment
    const shiftRes = await pool.query(
      `SELECT s.* FROM hrm_schema.shift_assignments sa
       JOIN hrm_schema.shift_definitions s ON s.id = sa.shift_id
       WHERE sa.tenant_id = $1 AND sa.employee_id = $2 AND sa.status = 'ACTIVE'
       ORDER BY sa.effective_from DESC LIMIT 1`,
      [tenantId, employeeId],
    );

    // 3. Leave Balances
    const currentYear = new Date().getFullYear();
    const balancesRes = await pool.query(
      `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND year = $3`,
      [tenantId, employeeId, currentYear],
    );

    // 4. Today Attendance
    const today = new Date().toISOString().slice(0, 10);
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
      profile: profileRes.rows[0] as any,
      currentPosition: null,
      currentShift: shiftRes.rows[0] ? (shiftRes.rows[0] as any) : null,
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');

    // Headcount
    const headcount = await pool.query(
      `SELECT
        count(*)::int as total,
        count(*) FILTER (WHERE employment_status = 'OFFICIAL')::int as official,
        count(*) FILTER (WHERE employment_status = 'PROBATION')::int as probation
       FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );

    // Today Attendance stats
    const today = new Date().toISOString().slice(0, 10);
    const attStats = await pool.query(
      `SELECT
        count(*) FILTER (WHERE check_in_at IS NOT NULL)::int as checked_in,
        count(*) FILTER (WHERE status = 'MISSING_PUNCH')::int as missing,
        count(*) FILTER (WHERE status = 'LATE')::int as late
       FROM hrm_schema.attendances WHERE tenant_id = $1 AND work_date = $2`,
      [tenantId, today],
    );

    // Pending approvals count
    const leavePending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId],
    );
    const otPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId],
    );
    const corrPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId],
    );
    const advPending = await pool.query(
      `SELECT count(*)::int as c FROM hrm_schema.salary_advance_requests WHERE tenant_id = $1 AND status = 'PENDING'`,
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

    const overview: HrmDashboardOverview = {
      periodCode: period || tsPeriod.rows[0]?.period_code || 'CURRENT',
      totalEmployees: headcount.rows[0]?.total || 0,
      officialEmployees: headcount.rows[0]?.official || 0,
      probationEmployees: headcount.rows[0]?.probation || 0,
      todayAttendance: {
        checkedInCount: attStats.rows[0]?.checked_in || 0,
        missingPunchCount: attStats.rows[0]?.missing || 0,
        lateCount: attStats.rows[0]?.late || 0,
        onLeaveCount: 0,
      },
      pendingApprovals: {
        leaveRequests: leavePending.rows[0]?.c || 0,
        otRequests: otPending.rows[0]?.c || 0,
        corrections: corrPending.rows[0]?.c || 0,
        advances: advPending.rows[0]?.c || 0,
      },
      currentTimesheetPeriod: tsPeriod.rows[0] ? (tsPeriod.rows[0] as any) : null,
      currentPayrollPeriod: prPeriod.rows[0] ? (prPeriod.rows[0] as any) : null,
    };

    return {
      data: overview,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }
}
