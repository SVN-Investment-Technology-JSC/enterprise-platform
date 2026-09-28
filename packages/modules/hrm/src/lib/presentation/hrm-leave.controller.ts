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
import {
  carryoverYear,
  expireCarryovers,
} from '../infrastructure/hrm-leave-carryover.js';
import { accrueMonth } from '../infrastructure/hrm-leave-accrual.js';
import {
  createLeave,
  transitionLeave,
  ensureLeaveBalance,
} from '../infrastructure/hrm-leave-operations.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate, lockEmployee } from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireUuid,
  requireText,
} from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';

@Controller('v1')
export class HrmLeaveController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
  ) {}

  // --------------------------------------------------------------------------
  // Leave Types APIs (P2_S3_HRM_API.md § 13.1)
  // --------------------------------------------------------------------------

  @Post('leave-carryovers/run')
  async carryover(@Req() req: Request, @Body('year') year: number) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    return {
      data: await hrmTransaction(pool, (db) =>
        carryoverYear(db, tenantId, principal.userId, year),
      ),
    };
  }
  @Post('leave-carryovers/expire')
  async expire(@Req() req: Request, @Body('date') date: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    return {
      data: await hrmTransaction(pool, (db) =>
        expireCarryovers(db, tenantId, principal.userId, date),
      ),
    };
  }

  @Post('leave-accruals/run')
  async runAccrual(@Req() req: Request, @Body('month') month: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    return {
      data: await hrmTransaction(pool, (db) =>
        accrueMonth(db, tenantId, principal.userId, month),
      ),
    };
  }

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
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('leave-types')
  async createLeaveType(
    @Req() req: Request,
    @Body() body: CreateLeaveTypeRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireText(body.code, 'code', 50);
    requireText(body.name, 'name', 255);
    if (
      body.negativeLimit !== undefined &&
      (!Number.isFinite(body.negativeLimit) ||
        body.negativeLimit < 0 ||
        body.negativeLimit > 366)
    )
      throw new BadRequestException('Hạn mức âm phép không hợp lệ');
    const res = await pool.query(
      `INSERT INTO hrm_schema.leave_types (
        tenant_id, code, name, unit, paid, requires_attachment, carryover_allowed,
        max_carryover_days, carryover_expiry_month, active, deduct_balance, negative_limit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        body.deductBalance ?? true,
        body.negativeLimit ?? 0,
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
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    if (
      body.negativeLimit !== undefined &&
      (!Number.isFinite(body.negativeLimit) ||
        body.negativeLimit < 0 ||
        body.negativeLimit > 366)
    )
      throw new BadRequestException('Hạn mức âm phép không hợp lệ');
    const res = await pool.query(
      `UPDATE hrm_schema.leave_types SET
        name = COALESCE($3, name),
        paid = COALESCE($4, paid),
        requires_attachment = COALESCE($5, requires_attachment),
        carryover_allowed = COALESCE($6, carryover_allowed),
        max_carryover_days = COALESCE($7, max_carryover_days),
        carryover_expiry_month = COALESCE($8, carryover_expiry_month),
        active = COALESCE($9, active), deduct_balance=COALESCE($10,deduct_balance), negative_limit=COALESCE($11,negative_limit),
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
        body.deductBalance,
        body.negativeLimit,
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_LEAVE_TYPE_NOT_FOUND',
        message: 'Leave type not found',
      });
    }
    return {
      data: this.mapLeaveType(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('leave-types/:id')
  async deleteLeaveType(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
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
  async listAccrualSchedules(
    @Req() req: Request,
    @Param('leaveTypeId') leaveTypeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id = $1 AND leave_type_id = $2 ORDER BY effective_from DESC`,
      [tenantId, leaveTypeId],
    );
    return {
      data: res.rows.map(this.mapAccrualSchedule),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('leave-types/:leaveTypeId/accrual-schedules')
  async createAccrualSchedule(
    @Req() req: Request,
    @Param('leaveTypeId') leaveTypeId: string,
    @Body() body: CreateLeaveAccrualScheduleRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(leaveTypeId, 'leaveTypeId');
    requireDate(body.effectiveFrom, 'effectiveFrom');
    if (
      body.effectiveTo &&
      requireDate(body.effectiveTo, 'effectiveTo') < body.effectiveFrom
    )
      throw new BadRequestException('Ngày hiệu lực không hợp lệ');
    if (
      !['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(body.accrualFrequency) ||
      !Number.isFinite(body.accrualAmount) ||
      body.accrualAmount < 0 ||
      body.accrualAmount > 366
    )
      throw new BadRequestException('Chu kỳ hoặc định mức phép không hợp lệ');
    if (
      body.prorationRule &&
      !['BY_JOIN_DATE', 'NONE'].includes(body.prorationRule)
    )
      throw new BadRequestException('Quy tắc phân bổ không hợp lệ');
    for (const value of [
      body.seniorityBonusYears ?? 5,
      body.seniorityBonusDays ?? 1,
    ])
      if (!Number.isFinite(value) || value < 0 || value > 100)
        throw new BadRequestException('Định mức thâm niên không hợp lệ');
    const res = await hrmTransaction(pool, async (db) => {
      const type = await db.query(
        `SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, leaveTypeId],
      );
      if (!type.rowCount)
        throw new NotFoundException('Không tìm thấy loại nghỉ');
      if (body.policyVersionId) {
        const policy = await db.query(
          `SELECT v.id FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND v.id=$2`,
          [tenantId, body.policyVersionId],
        );
        if (!policy.rowCount)
          throw new BadRequestException(
            'Phiên bản chính sách không thuộc tenant',
          );
      }
      const overlap = await db.query(
        `SELECT id FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND daterange(effective_from,COALESCE(effective_to,'infinity'::date),'[]') && daterange($3::date,COALESCE($4::date,'infinity'::date),'[]')`,
        [tenantId, leaveTypeId, body.effectiveFrom, body.effectiveTo || null],
      );
      if (overlap.rowCount)
        throw new BadRequestException(
          'Lịch cộng phép trùng thời gian hiệu lực',
        );
      return db.query(
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
    });
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    const year = parseInt(yearStr || '', 10) || new Date().getFullYear();
    const res = await pool.query(
      `SELECT lb.*, lt.name as leave_type_name, lt.code as leave_type_code,
              e.full_name as employee_name, e.employee_code, e.department_name AS department
       FROM hrm_schema.leave_balances lb
       JOIN hrm_schema.leave_types lt ON lb.leave_type_id = lt.id
       JOIN hrm_schema.employee_directory e ON lb.employee_id = e.employee_id AND e.tenant_id = lb.tenant_id
       WHERE lb.tenant_id = $1 AND lb.year = $2
         AND ($3::uuid IS NULL OR lb.employee_id = $3)
       ORDER BY u.full_name ASC`,
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
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Get('leave-transactions')
  async listAllLeaveTransactions(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('leave_type_id') leaveTypeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    const res = await pool.query(
      `SELECT lt.*, ltypes.name as leave_type_name, ltypes.code as leave_type_code,
              e.full_name as employee_name, e.employee_code, e.department_name AS department
       FROM hrm_schema.leave_transactions lt
       JOIN hrm_schema.leave_types ltypes ON lt.leave_type_id = ltypes.id
       JOIN hrm_schema.employee_directory e ON lt.employee_id = e.employee_id AND e.tenant_id = lt.tenant_id
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
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
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
      operationId?: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    const year = body.year || new Date().getFullYear();
    const operationKey = body.operationId
      ? `adjust:${requireUuid(body.operationId, 'operationId')}`
      : null;
    requireText(body.reason, 'reason', 2000);
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2200 ||
      !Number.isFinite(body.daysAdjusted) ||
      body.daysAdjusted === 0 ||
      Math.abs(body.daysAdjusted) > 366
    )
      throw new BadRequestException(
        'Năm hoặc số lượng điều chỉnh không hợp lệ',
      );
    const row = await hrmTransaction(pool, async (db) => {
      if (operationKey) {
        await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `${tenantId}:${operationKey}`,
        ]);
        const prior = await db.query(
          `SELECT * FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND operation_key=$2`,
          [tenantId, operationKey],
        );
        const previous = prior.rows[0];
        if (previous) {
          if (
            previous.employee_id !== body.employeeId ||
            previous.leave_type_id !== body.leaveTypeId ||
            Number(previous.days_changed) !== body.daysAdjusted ||
            previous.note !== body.reason ||
            previous.balance_year !== year
          )
            throw new BadRequestException(
              'Mã thao tác đã dùng cho nội dung điều chỉnh khác',
            );
          return previous;
        }
      }
      await lockEmployee(db, tenantId, body.employeeId);
      const type = await db.query(
        `SELECT negative_limit FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2`,
        [tenantId, body.leaveTypeId],
      );
      if (!type.rows[0])
        throw new NotFoundException('Không tìm thấy loại nghỉ');
      const balance = await ensureLeaveBalance(
        db,
        tenantId,
        body.employeeId,
        body.leaveTypeId,
        year,
      );
      if (
        Number(balance.remaining) +
          body.daysAdjusted -
          Number(balance.pending) <
        -Number(type.rows[0].negative_limit)
      )
        throw new BadRequestException('Điều chỉnh vượt hạn mức âm phép');
      const updated = await db.query(
        `UPDATE hrm_schema.leave_balances SET adjusted=adjusted+$2,remaining=remaining+$2,updated_at=now() WHERE id=$1 RETURNING remaining`,
        [balance.id, body.daysAdjusted],
      );
      const tx = await db.query(
        `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,note,balance_year,actor_id,operation_key) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          tenantId,
          body.employeeId,
          body.leaveTypeId,
          body.daysAdjusted,
          updated.rows[0].remaining,
          body.reason,
          year,
          principal.userId,
          operationKey,
        ],
      );
      return tx.rows[0];
    });
    return { data: this.mapTransaction(row) };
  }

  @Get('employees/:employeeId/leave-balances')
  async getEmployeeLeaveBalances(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('year') yearStr?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.leave.read',
      'hrm.self.read',
    );
    const year = parseInt(yearStr || '', 10) || new Date().getFullYear();
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND year = $3`,
      [tenantId, employeeId, year],
    );
    return {
      data: res.rows.map(this.mapBalance),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Get('employees/:employeeId/leave-transactions')
  async getEmployeeLeaveTransactions(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('leave_type_id') leaveTypeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.leave.read',
      'hrm.self.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.leave_transactions
       WHERE tenant_id = $1 AND employee_id = $2 AND ($3::uuid IS NULL OR leave_type_id = $3)
       ORDER BY created_at DESC`,
      [tenantId, employeeId, leaveTypeId || null],
    );
    return {
      data: res.rows.map(this.mapTransaction),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Leave Request APIs (P2_S3_HRM_API.md § 15)
  // --------------------------------------------------------------------------

  @Post('leave-requests')
  async createLeaveRequest(
    @Req() req: Request,
    @Body() body: CreateLeaveRequestPayload & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, principal, employeeId } = await this.ctx.getRequestContext(
      req,
      body.employeeId,
    );
    const row = await hrmTransaction(pool, (db) =>
      createLeave(db, tenantId, principal.userId, { ...body, employeeId }),
    );
    // Payload thuộc tính để PE Node S và Gateway đánh giá rẽ nhánh
    const procAttributes: Record<string, unknown> = {
      so_ngay_nghi: Number(body.duration),
      duration: Number(body.duration),
      leave_type_id: body.leaveTypeId,
      tu_ngay: body.fromDate,
      den_ngay: body.toDate,
      is_negative_leave: Boolean(body.isNegativeLeave),
      ly_do: body.reason,
      ...(body.attributes || {}),
    };

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'leave',
      row.id,
      employeeId,
      `Đơn nghỉ phép (${body.duration} ngày) - Từ ${body.fromDate} đến ${body.toDate}`,
      procAttributes,
    );

    if (proc) {
      const updatedProc = await pool.query(
        `UPDATE hrm_schema.leave_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, row.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapLeaveRequest(updatedProc.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return { data: this.mapLeaveRequest(row) };
  }

  @Get('leave-requests')
  async listLeaveRequests(
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
      `SELECT lr.*, lt.code as leave_type_code, lt.name as leave_type_name, lt.paid as is_paid
       FROM hrm_schema.leave_requests lr
       LEFT JOIN hrm_schema.leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.tenant_id = $1
         AND ($2::uuid IS NULL OR lr.employee_id = $2)
         AND ($3::text IS NULL OR lr.status = $3)
       ORDER BY lr.created_at DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: res.rows.map(this.mapLeaveRequest),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('leave-requests/:id/approve')
  async approveLeaveRequest(@Req() req: Request, @Param('id') id: string) {
    return this.transition(req, id, 'APPROVED');
  }
  @Post('leave-requests/:id/reject')
  async rejectLeaveRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.transition(
      req,
      id,
      'REJECTED',
      requireText(reason, 'reason', 2000),
    );
  }
  @Post('leave-requests/:id/cancel')
  async cancelLeaveRequest(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const owned = await pool.query(
      `SELECT employee_id,status FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id],
    );
    if (!owned.rows[0]) throw new NotFoundException('Không tìm thấy đơn');
    const { principal } = await this.ctx.getRequestContext(
      req,
      owned.rows[0].employee_id,
      'hrm.leave.approve',
    );
    return {
      data: this.mapLeaveRequest(
        await hrmTransaction(pool, async (db) => {
          const current = await db.query(
            `SELECT status FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [tenantId, id],
          );
          // Recheck under the same row lock as approval, so a concurrent approval cannot turn a withdrawal into an unauthorized reversal.
          if (current.rows[0]?.status === 'APPROVED')
            await this.ctx.getContext(req, 'hrm.leave.approve');
          return transitionLeave(
            db,
            tenantId,
            principal.userId,
            id,
            'CANCELLED',
          );
        }),
      ),
    };
  }
  private async transition(
    req: Request,
    id: string,
    target: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    reason?: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.approve',
    );
    const row = await hrmTransaction(pool, (db) =>
      transitionLeave(db, tenantId, principal.userId, id, target, reason),
    );
    return { data: this.mapLeaveRequest(row) };
  }
  @Post('leave-requests/:id/amend')
  async amendLeaveRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: AmendLeaveRequestPayload,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    const row = await hrmTransaction(pool, async (db) => {
      const current = await db.query(
        `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const leave = current.rows[0];
      if (!leave || leave.status !== 'PENDING')
        throw new BadRequestException('Chỉ sửa đơn đang chờ duyệt');
      await this.ctx.getRequestContext(
        req,
        leave.employee_id,
        'hrm.leave.approve',
      );
      await transitionLeave(
        db,
        tenantId,
        principal.userId,
        id,
        'CANCELLED',
        'Thay thế bằng đơn điều chỉnh',
      );
      return createLeave(db, tenantId, principal.userId, {
        employeeId: leave.employee_id,
        leaveTypeId: leave.leave_type_id,
        attachmentFileId: leave.attachment_file_id,
        fromDate: body.fromDate,
        toDate: body.toDate,
        duration: body.duration,
        reason: body.reason,
      });
    });
    return { data: this.mapLeaveRequest(row) };
  }

  private mapLeaveType(row: Record<string, unknown>): HrmLeaveType {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      code: row.code as string,
      name: row.name as string,
      unit: row.unit as any,
      paid: Boolean(row.paid),
      deductBalance: Boolean(row.deduct_balance),
      negativeLimit: Number(row.negative_limit || 0),
      requiresAttachment: Boolean(row.requires_attachment),
      carryoverAllowed: Boolean(row.carryover_allowed),
      maxCarryoverDays: Number(row.max_carryover_days || 0),
      carryoverExpiryMonth: Number(row.carryover_expiry_month || 3),
      active: Boolean(row.active),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAccrualSchedule(
    row: Record<string, unknown>,
  ): HrmLeaveAccrualSchedule {
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
      seniorityDays: Number(row.seniority_days || 0),
      carryoverRemaining: Number(row.carryover_remaining || 0),
      carryoverExpiryDate: row.carryover_expiry_date ? String(row.carryover_expiry_date) : null,
      maxNegativeAllowed: Number(row.max_negative_allowed || 2.0),
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
      fromDate: isoDate(row.from_date),
      toDate: isoDate(row.to_date),
      duration: Number(row.duration),
      reason: row.reason as string,
      status: row.status as any,
      isNegativeLeave: Boolean(row.is_negative_leave),
      leaveTypeCode: row.leave_type_code as string | undefined,
      leaveTypeName: row.leave_type_name as string | undefined,
      isPaid: row.is_paid !== undefined && row.is_paid !== null ? Boolean(row.is_paid) : undefined,
      seniorityDaysUsed: Number(row.seniority_days_used || 0),
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      workflowStatus: row.workflow_status as string | null,
      attachmentFileId: row.attachment_file_id as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
