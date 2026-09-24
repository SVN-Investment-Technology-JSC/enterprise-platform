import type {
  AmendLeaveRequestPayload,
  CreateLeaveAccrualScheduleRequest,
  CreateLeaveRequestPayload,
  CreateLeaveTypeRequest,
  HrmLeaveAccrualSchedule,
  HrmLeaveBalance,
  HrmLeaveRequest,
  HrmLeaveTransaction,
  HrmLeaveType,
  UpdateLeaveTypeRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
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
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

@Controller('v1')
export class HrmLeaveController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Leave Types APIs (P2_S3_HRM_API.md § 13.1)
  // --------------------------------------------------------------------------

  @Get('leave-types')
  async listLeaveTypes(@Req() req: Request, @Query('active') active?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_types
       WHERE tenant_id = $1 AND deleted_at IS NULL AND ($2::boolean IS NULL OR active = $2)
       ORDER BY code ASC`,
      [tenantId, active !== undefined ? active === 'true' : null],
    );
    return {
      data: res.rows.map(this.mapLeaveType),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-types')
  async createLeaveType(@Req() req: Request, @Body() body: CreateLeaveTypeRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.leave_types (
        tenant_id, code, name, unit, paid, requires_attachment, carryover_allowed,
        max_carryover_days, carryover_expiry_month, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        tenantId,
        body.code,
        body.name,
        body.unit || 'DAYS',
        body.paid ?? true,
        body.requiresAttachment ?? false,
        body.carryoverAllowed ?? false,
        body.maxCarryoverDays ?? 0,
        body.carryoverExpiryMonth ?? 3,
        body.active ?? true,
      ],
    );
    return {
      data: this.mapLeaveType(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('leave-types/:id')
  async updateLeaveType(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateLeaveTypeRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.leave_types SET
        name = COALESCE($3, name),
        paid = COALESCE($4, paid),
        requires_attachment = COALESCE($5, requires_attachment),
        carryover_allowed = COALESCE($6, carryover_allowed),
        max_carryover_days = COALESCE($7, max_carryover_days),
        carryover_expiry_month = COALESCE($8, carryover_expiry_month),
        active = COALESCE($9, active),
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
      RETURNING *`,
      [
        tenantId,
        id,
        body.name,
        body.paid,
        body.requiresAttachment,
        body.carryoverAllowed,
        body.maxCarryoverDays,
        body.carryoverExpiryMonth,
        body.active,
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_LEAVE_TYPE_NOT_FOUND', message: 'Leave type not found' });
    }
    return {
      data: this.mapLeaveType(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('leave-types/:id')
  async deleteLeaveType(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    await pool.query(
      `UPDATE hrm_schema.leave_types SET active = false, deleted_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return {
      data: { success: true },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Accrual Schedule APIs (P2_S3_HRM_API.md § 13.2)
  // --------------------------------------------------------------------------

  @Get('leave-types/:leaveTypeId/accrual-schedules')
  async listAccrualSchedules(@Req() req: Request, @Param('leaveTypeId') leaveTypeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id = $1 AND leave_type_id = $2 ORDER BY effective_from DESC`,
      [tenantId, leaveTypeId],
    );
    return {
      data: res.rows.map(this.mapAccrualSchedule),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-types/:leaveTypeId/accrual-schedules')
  async createAccrualSchedule(
    @Req() req: Request,
    @Param('leaveTypeId') leaveTypeId: string,
    @Body() body: CreateLeaveAccrualScheduleRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.leave_accrual_schedules (
        tenant_id, leave_type_id, policy_version_id, accrual_frequency, accrual_amount,
        proration_rule, seniority_bonus_years, seniority_bonus_days, effective_from, effective_to
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        tenantId,
        leaveTypeId,
        body.policyVersionId || null,
        body.accrualFrequency,
        body.accrualAmount,
        body.prorationRule || null,
        body.seniorityBonusYears ?? 5,
        body.seniorityBonusDays ?? 1.0,
        body.effectiveFrom,
        body.effectiveTo || null,
      ],
    );
    return {
      data: this.mapAccrualSchedule(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Leave Balance & Ledger APIs (P2_S3_HRM_API.md § 14)
  // --------------------------------------------------------------------------

  @Get('leave-balances')
  async listAllLeaveBalances(
    @Req() req: Request,
    @Query('year') yearStr?: string,
    @Query('employee_id') employeeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const year = parseInt(yearStr || '', 10) || new Date().getFullYear();
    const res = await pool.query(
      `SELECT lb.*, lt.name as leave_type_name, lt.code as leave_type_code,
              e.full_name as employee_name, e.employee_code, e.department
       FROM hrm_schema.leave_balances lb
       JOIN hrm_schema.leave_types lt ON lb.leave_type_id = lt.id
       JOIN hrm_schema.employee_profiles e ON lb.employee_id = e.employee_id
       WHERE lb.tenant_id = $1 AND lb.year = $2
         AND ($3::uuid IS NULL OR lb.employee_id = $3)
       ORDER BY e.full_name ASC`,
      [tenantId, year, employeeId || null],
    );
    return {
      data: res.rows.map((row) => ({
        ...this.mapBalance(row),
        leaveTypeName: row.leave_type_name as string,
        leaveTypeCode: row.leave_type_code as string,
        employeeName: row.employee_name as string,
        employeeCode: row.employee_code as string,
        department: row.department as string | null,
      })),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('leave-transactions')
  async listAllLeaveTransactions(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('leave_type_id') leaveTypeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT lt.*, ltypes.name as leave_type_name, ltypes.code as leave_type_code,
              e.full_name as employee_name, e.employee_code, e.department
       FROM hrm_schema.leave_transactions lt
       JOIN hrm_schema.leave_types ltypes ON lt.leave_type_id = ltypes.id
       JOIN hrm_schema.employee_profiles e ON lt.employee_id = e.employee_id
       WHERE lt.tenant_id = $1
         AND ($2::uuid IS NULL OR lt.employee_id = $2)
         AND ($3::uuid IS NULL OR lt.leave_type_id = $3)
       ORDER BY lt.created_at DESC`,
      [tenantId, employeeId || null, leaveTypeId || null],
    );
    return {
      data: res.rows.map((row) => ({
        ...this.mapTransaction(row),
        leaveTypeName: row.leave_type_name as string,
        leaveTypeCode: row.leave_type_code as string,
        employeeName: row.employee_name as string,
        employeeCode: row.employee_code as string,
        department: row.department as string | null,
      })),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-adjustments')
  async adjustLeaveBalance(
    @Req() req: Request,
    @Body()
    body: {
      employeeId: string;
      leaveTypeId: string;
      daysAdjusted: number;
      reason: string;
      year?: number;
    },
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const year = body.year || new Date().getFullYear();

    // 1. Ensure leave_balance exists
    await pool.query(
      `INSERT INTO hrm_schema.leave_balances (
        tenant_id, employee_id, leave_type_id, year, opening_balance, accrued, used, pending, adjusted, remaining
      ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, $5, $5)
      ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
      DO UPDATE SET
        adjusted = hrm_schema.leave_balances.adjusted + EXCLUDED.adjusted,
        remaining = hrm_schema.leave_balances.remaining + EXCLUDED.adjusted,
        updated_at = now()`,
      [tenantId, body.employeeId, body.leaveTypeId, year, body.daysAdjusted],
    );

    // 2. Fetch updated balance
    const updatedBal = await pool.query(
      `SELECT remaining FROM hrm_schema.leave_balances
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, body.employeeId, body.leaveTypeId, year],
    );
    const balanceAfter = Number(updatedBal.rows[0]?.remaining || 0);

    // 3. Record transaction in leave_transactions
    const txRes = await pool.query(
      `INSERT INTO hrm_schema.leave_transactions (
        tenant_id, employee_id, leave_type_id, transaction_type, days_changed, balance_after, note
      ) VALUES ($1, $2, $3, 'ADJUSTMENT', $4, $5, $6)
      RETURNING *`,
      [tenantId, body.employeeId, body.leaveTypeId, body.daysAdjusted, balanceAfter, body.reason],
    );

    return {
      data: this.mapTransaction(txRes.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('employees/:employeeId/leave-balances')
  async getEmployeeLeaveBalances(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('year') yearStr?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const year = parseInt(yearStr || '', 10) || new Date().getFullYear();
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND year = $3`,
      [tenantId, employeeId, year],
    );
    return {
      data: res.rows.map(this.mapBalance),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('employees/:employeeId/leave-transactions')
  async getEmployeeLeaveTransactions(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('leave_type_id') leaveTypeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_transactions
       WHERE tenant_id = $1 AND employee_id = $2 AND ($3::uuid IS NULL OR leave_type_id = $3)
       ORDER BY created_at DESC`,
      [tenantId, employeeId, leaveTypeId || null],
    );
    return {
      data: res.rows.map(this.mapTransaction),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Leave Request APIs (P2_S3_HRM_API.md § 15)
  // --------------------------------------------------------------------------

  @Post('leave-requests')
  async createLeaveRequest(@Req() req: Request, @Body() body: CreateLeaveRequestPayload) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');

    // Check balance if leave is paid
    const currentYear = new Date(body.fromDate).getFullYear();
    const balance = await pool.query(
      `SELECT remaining FROM hrm_schema.leave_balances
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, body.employeeId, body.leaveTypeId, currentYear],
    );

    if (balance.rows.length > 0 && Number(balance.rows[0].remaining) < body.duration) {
      throw new BadRequestException({
        code: 'HRM_LEAVE_BALANCE_INSUFFICIENT',
        message: 'Số dư ngày nghỉ phép không đủ',
        details: { requested_days: body.duration, available_days: Number(balance.rows[0].remaining) },
      });
    }

    const res = await pool.query(
      `INSERT INTO hrm_schema.leave_requests (
        tenant_id, employee_id, leave_type_id, from_date, to_date, duration, reason,
        attachment_file_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        body.employeeId,
        body.leaveTypeId,
        body.fromDate,
        body.toDate,
        body.duration,
        body.reason,
        body.attachmentFileId || null,
      ],
    );

    // Update pending balance
    await pool.query(
      `UPDATE hrm_schema.leave_balances SET pending = pending + $5, updated_at = now()
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, body.employeeId, body.leaveTypeId, currentYear, body.duration],
    );

    return {
      data: this.mapLeaveRequest(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('leave-requests')
  async listLeaveRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: res.rows.map(this.mapLeaveRequest),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-requests/:id/approve')
  async approveLeaveRequest(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');

    const check = await pool.query(
      `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_LEAVE_NOT_FOUND', message: 'Leave request not found' });
    }
    const leave = check.rows[0];

    const res = await pool.query(
      `UPDATE hrm_schema.leave_requests SET
        status = 'APPROVED', approved_by = $3, approved_at = now(), applied_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );

    // Business Apply: Deduct from pending and increase used, reduce remaining
    const year = new Date(leave.from_date).getFullYear();
    await pool.query(
      `UPDATE hrm_schema.leave_balances SET
        pending = GREATEST(0, pending - $5),
        used = used + $5,
        remaining = remaining - $5,
        updated_at = now()
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, leave.employee_id, leave.leave_type_id, year, leave.duration],
    );

    // Fetch updated balance for transaction
    const balRes = await pool.query(
      `SELECT remaining FROM hrm_schema.leave_balances
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, leave.employee_id, leave.leave_type_id, year],
    );
    const balanceAfter = Number(balRes.rows[0]?.remaining || 0);

    // Create USAGE transaction in ledger
    await pool.query(
      `INSERT INTO hrm_schema.leave_transactions (
        tenant_id, employee_id, leave_type_id, transaction_type, days_changed, balance_after,
        reference_request_id, note
      ) VALUES ($1, $2, $3, 'USAGE', $4, $5, $6, $7)`,
      [
        tenantId,
        leave.employee_id,
        leave.leave_type_id,
        -Number(leave.duration),
        balanceAfter,
        id,
        `Trừ tự động khi phê duyệt đơn nghỉ phép #${id.slice(0, 8)}`,
      ],
    );

    return {
      data: this.mapLeaveRequest(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-requests/:id/reject')
  async rejectLeaveRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');

    const check = await pool.query(
      `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_LEAVE_NOT_FOUND', message: 'Leave request not found' });
    }
    const leave = check.rows[0];

    const res = await pool.query(
      `UPDATE hrm_schema.leave_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, principal.userId],
    );

    // Rollback pending balance
    const year = new Date(leave.from_date).getFullYear();
    await pool.query(
      `UPDATE hrm_schema.leave_balances SET
        pending = GREATEST(0, pending - $5),
        updated_at = now()
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, leave.employee_id, leave.leave_type_id, year, leave.duration],
    );

    return {
      data: this.mapLeaveRequest(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-requests/:id/cancel')
  async cancelLeaveRequest(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const check = await pool.query(
      `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_LEAVE_NOT_FOUND', message: 'Leave request not found' });
    }

    const leave = check.rows[0];
    const res = await pool.query(
      `UPDATE hrm_schema.leave_requests SET status = 'CANCELLED', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );

    // Rollback pending balance if it was pending
    if (leave.status === 'PENDING') {
      const year = new Date(leave.from_date).getFullYear();
      await pool.query(
        `UPDATE hrm_schema.leave_balances SET pending = GREATEST(0, pending - $5), updated_at = now()
         WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
        [tenantId, leave.employee_id, leave.leave_type_id, year, leave.duration],
      );
    }

    return {
      data: this.mapLeaveRequest(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('leave-requests/:id/amend')
  async amendLeaveRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: AmendLeaveRequestPayload,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.leave_requests SET
        from_date = $3, to_date = $4, duration = $5, reason = $6, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
       RETURNING *`,
      [tenantId, id, body.fromDate, body.toDate, body.duration, body.reason],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_LEAVE_CANNOT_AMEND',
        message: 'Leave request not found or not in PENDING status',
      });
    }
    return {
      data: this.mapLeaveRequest(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private mapLeaveType(row: Record<string, unknown>): HrmLeaveType {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      code: row.code as string,
      name: row.name as string,
      unit: row.unit as any,
      paid: Boolean(row.paid),
      requiresAttachment: Boolean(row.requires_attachment),
      carryoverAllowed: Boolean(row.carryover_allowed),
      maxCarryoverDays: Number(row.max_carryover_days || 0),
      carryoverExpiryMonth: Number(row.carryover_expiry_month || 3),
      active: Boolean(row.active),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAccrualSchedule(row: Record<string, unknown>): HrmLeaveAccrualSchedule {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      leaveTypeId: row.leave_type_id as string,
      policyVersionId: row.policy_version_id as string | null,
      accrualFrequency: row.accrual_frequency as any,
      accrualAmount: Number(row.accrual_amount),
      prorationRule: row.proration_rule as string | null,
      seniorityBonusYears: Number(row.seniority_bonus_years || 5),
      seniorityBonusDays: Number(row.seniority_bonus_days || 1),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapBalance(row: Record<string, unknown>): HrmLeaveBalance {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      leaveTypeId: row.leave_type_id as string,
      year: Number(row.year),
      openingBalance: Number(row.opening_balance),
      accrued: Number(row.accrued),
      used: Number(row.used),
      pending: Number(row.pending),
      adjusted: Number(row.adjusted),
      remaining: Number(row.remaining),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTransaction(row: Record<string, unknown>): HrmLeaveTransaction {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      leaveTypeId: row.leave_type_id as string,
      transactionType: row.transaction_type as any,
      daysChanged: Number(row.days_changed),
      balanceAfter: Number(row.balance_after),
      referenceRequestId: row.reference_request_id as string | null,
      accrualScheduleId: row.accrual_schedule_id as string | null,
      note: row.note as string | null,
      createdAt: String(row.created_at),
    };
  }

  private mapLeaveRequest(row: Record<string, unknown>): HrmLeaveRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      leaveTypeId: row.leave_type_id as string,
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      duration: Number(row.duration),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      attachmentFileId: row.attachment_file_id as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
