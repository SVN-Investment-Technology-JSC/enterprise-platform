import type { PoolClient } from 'pg';
import { previewLeaveDays } from '../infrastructure/hrm-leave-day-preview.js';
import { attachProcedureLinkInfo } from '../infrastructure/hrm-procedure-link-info.js';
import { HrmApprovalPolicyService, approverPermissions } from '../infrastructure/hrm-approval-policy.js';
import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';
import {
  assertLifecycleVersion,
  lifecycleAudit,
} from '../infrastructure/hrm-lifecycle.js';
import {
  resolveDraftSubmission,
  type DraftSubmission,
} from '../infrastructure/hrm-request-drafts.js';
import { submitHrmRequest } from '../infrastructure/hrm-submission.js';
import { syncEmployeeProcedureResults } from '../infrastructure/hrm-procedure-sync.js';
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
import { applyLeaveDelta } from '../infrastructure/hrm-leave-balance.js';
import {
  leaveBalanceAtDate,
  reconcileLeaveBalances,
} from '../infrastructure/hrm-leave-reconcile.js';
import {
  findSimilarLeaveTypes,
  mergeLeaveTypes,
} from '../infrastructure/hrm-leave-merge.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate, lockEmployee } from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireUuid,
  requireText,
} from '../infrastructure/hrm-validation.js';
import {
  areSimilarLeaveNames,
  rethrowDuplicateLeaveCode,
} from '../infrastructure/hrm-leave-merge.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  employeeEntitlement,
  enrichLeaveBalances,
} from '../infrastructure/hrm-annual-leave.js';
import {
  computeLeaveSettlement,
  mapSettlement,
  scheduleSettlement,
  settlementBlockers,
  waiveSettlement,
} from '../infrastructure/hrm-leave-settlement.js';
import { sumEntitlement } from '../domain/annual-leave-entitlement.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';
import {
  accrualScheduleColumns,
  lockAccrualConfiguration,
  mutateAccrualSchedule,
  replaceSeniorityTiers,
  validateAccrualSchedule,
  type AccrualMutation,
} from '../infrastructure/hrm-leave-schedule.js';

@Controller('v1')
export class HrmLeaveController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
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

  @Post('leave-types/merge')
  async mergeLeaveType(
    @Req() req: Request,
    @Body() body: { sourceId: string; targetId: string; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(body.sourceId, 'Loại nguồn');
    requireUuid(body.targetId, 'Loại đích');
    const reason = requireText(body.reason, 'Lý do gộp', 1000);
    return {
      data: await hrmTransaction(pool, (db) =>
        mergeLeaveTypes(
          db,
          tenantId,
          principal.userId,
          body.sourceId,
          body.targetId,
          reason,
        ),
      ),
    };
  }

  @Get('leave-types/similar-names')
  async similarLeaveTypes(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    const res = await pool.query(
      `SELECT id,code,name FROM hrm_schema.leave_types WHERE tenant_id=$1 AND deleted_at IS NULL AND active=true ORDER BY code`,
      [tenantId],
    );
    return { data: findSimilarLeaveTypes(res.rows) };
  }

  @Get('leave-balances/reconcile')
  async reconcileBalances(@Req() req: Request, @Query('year') year?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    const y = parseInt(year || '', 10) || new Date().getFullYear();
    if (y < 2000 || y > 2200) throw new BadRequestException('Năm không hợp lệ');
    return { data: await reconcileLeaveBalances(pool, tenantId, y) };
  }

  @Get('employees/:employeeId/leave-balance-at-date')
  async employeeLeaveAtDate(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('date') date?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    requireUuid(employeeId, 'employeeId');
    const asOf = date || new Date().toISOString().slice(0, 10);
    requireDate(asOf, 'date');
    return {
      data: await leaveBalanceAtDate(pool, tenantId, employeeId, asOf),
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
    const res = await pool
      .query(
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
        (body.paid ?? true) ? (body.deductBalance ?? true) : false,
        body.negativeLimit ?? 0,
      ],
      )
      .catch(rethrowDuplicateLeaveCode);
    const existing = await pool.query(
      `SELECT id,code,name FROM hrm_schema.leave_types WHERE tenant_id=$1 AND deleted_at IS NULL AND id<>$2`,
      [tenantId, res.rows[0].id],
    );
    return {
      data: this.mapLeaveType(res.rows[0]),
      meta: {
        requestId: req.headers['x-request-id'] as string,
        similarTo: existing.rows
          .filter((t) => areSimilarLeaveNames(t.name, body.name))
          .map((t) => ({ id: t.id, code: t.code, name: t.name })),
      },
    };
  }

  @Patch('leave-types/:id')
  async updateLeaveType(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: UpdateLeaveTypeRequest & {
      expectedUpdatedAt?: string;
      reason?: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(id, 'Loại nghỉ');
    requireText(body.reason, 'Lý do', 1000);
    if (body.name !== undefined) requireText(body.name, 'Tên loại nghỉ', 255);
    for (const n of [body.negativeLimit, body.maxCarryoverDays])
      if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > 366))
        throw new BadRequestException('Hạn mức phép phải từ 0 đến 366');
    if (
      body.carryoverExpiryMonth !== undefined &&
      (!Number.isInteger(body.carryoverExpiryMonth) ||
        body.carryoverExpiryMonth < 1 ||
        body.carryoverExpiryMonth > 12)
    )
      throw new BadRequestException('Tháng hết hạn phải từ 1 đến 12');
    for (const flag of [
      body.paid,
      body.requiresAttachment,
      body.carryoverAllowed,
      body.active,
      body.deductBalance,
    ])
      if (flag !== undefined && typeof flag !== 'boolean')
        throw new BadRequestException('Cấu hình loại nghỉ không hợp lệ');
    return hrmTransaction(pool, async (db) => {
      await lockAccrualConfiguration(db, tenantId);
      const before = (
        await db.query(
          'SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      if (!before) throw new NotFoundException('Không tìm thấy loại nghỉ');
      assertLifecycleVersion(before, body.expectedUpdatedAt);
      if (
        (body.paid !== undefined && body.paid !== before.paid) ||
        (body.deductBalance !== undefined &&
          body.deductBalance !== before.deduct_balance)
      ) {
        if (
          (
            await db.query(
              'SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND leave_type_id=$2 LIMIT 1',
              [tenantId, id],
            )
          ).rowCount
        )
          throw new ConflictException(
            'Loại nghỉ đã có đơn; tạo loại mới để đổi chế độ hưởng lương hoặc trừ quỹ.',
          );
      }
      const row = (
        await db.query(
          `UPDATE hrm_schema.leave_types SET name=COALESCE($3,name),paid=COALESCE($4,paid),requires_attachment=COALESCE($5,requires_attachment),carryover_allowed=COALESCE($6,carryover_allowed),max_carryover_days=COALESCE($7,max_carryover_days),carryover_expiry_month=COALESCE($8,carryover_expiry_month),active=COALESCE($9,active),deduct_balance=CASE WHEN COALESCE($4,paid) THEN COALESCE($10,deduct_balance) ELSE false END,negative_limit=COALESCE($11,negative_limit),updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
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
        )
      ).rows[0];
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'LEAVE_TYPE_UPDATED',
        id,
        { before, after: row, reason: body.reason },
      );
      return { data: this.mapLeaveType(row) };
    });
  }
  @Delete('leave-types/:id')
  async deleteLeaveType(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt?: string; reason?: string },
  ) {
    return this.updateLeaveType(req, id, { ...body, active: false });
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
      `SELECT s.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('minYears',t.min_years,'bonusDays',t.bonus_days) ORDER BY t.min_years)
                FROM hrm_schema.leave_seniority_tiers t WHERE t.tenant_id=s.tenant_id AND t.schedule_id=s.id),'[]'::jsonb) AS seniority_tiers
       FROM hrm_schema.leave_accrual_schedules s WHERE s.tenant_id = $1 AND s.leave_type_id = $2 ORDER BY s.effective_from DESC`,
      [tenantId, leaveTypeId],
    );
    return {
      data: res.rows.map((row) => this.mapAccrualSchedule(row)),
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
    validateAccrualSchedule(body);
    const cols = accrualScheduleColumns(body);
    const res = await hrmTransaction(pool, async (db) => {
      await lockAccrualConfiguration(db, tenantId);
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
      const created = await db.query(
        `INSERT INTO hrm_schema.leave_accrual_schedules (
        tenant_id, leave_type_id, policy_version_id, accrual_frequency, accrual_amount,
        proration_rule, seniority_bonus_years, seniority_bonus_days, effective_from, effective_to,
        accrual_basis, start_offset_months, advance_allowed, annual_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
        [
          tenantId,
          leaveTypeId,
          body.policyVersionId || null,
          body.accrualFrequency,
          cols.accrualAmount,
          cols.prorationRule,
          cols.seniorityBonusYears,
          cols.seniorityBonusDays,
          body.effectiveFrom,
          body.effectiveTo || null,
          cols.accrualBasis,
          cols.startOffsetMonths,
          cols.advanceAllowed,
          cols.annualDays,
        ],
      );
      await replaceSeniorityTiers(
        db,
        tenantId,
        created.rows[0].id,
        body.seniorityTiers ?? [],
      );
      return {
        ...created.rows[0],
        seniority_tiers: body.seniorityTiers ?? [],
      };
    });
    return {
      data: this.mapAccrualSchedule(res),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('leave-types/:leaveTypeId/accrual-schedules/:id')
  async updateAccrualSchedule(
    @Req() req: Request,
    @Param('leaveTypeId') typeId: string,
    @Param('id') id: string,
    @Body() body: AccrualMutation,
  ) {
    return this.changeAccrualSchedule(req, typeId, id, body, 'edit');
  }
  @Delete('leave-types/:leaveTypeId/accrual-schedules/:id')
  async deleteAccrualSchedule(
    @Req() req: Request,
    @Param('leaveTypeId') typeId: string,
    @Param('id') id: string,
    @Body() body: AccrualMutation,
  ) {
    return this.changeAccrualSchedule(req, typeId, id, body, 'delete');
  }
  @Post('leave-types/:leaveTypeId/accrual-schedules/:id/version')
  async versionAccrualSchedule(
    @Req() req: Request,
    @Param('leaveTypeId') typeId: string,
    @Param('id') id: string,
    @Body() body: AccrualMutation,
  ) {
    return this.changeAccrualSchedule(req, typeId, id, body, 'version');
  }
  @Post('leave-types/:leaveTypeId/accrual-schedules/:id/deactivate')
  async deactivateAccrualSchedule(
    @Req() req: Request,
    @Param('leaveTypeId') typeId: string,
    @Param('id') id: string,
    @Body() body: AccrualMutation,
  ) {
    return this.changeAccrualSchedule(req, typeId, id, body, 'deactivate');
  }
  private async changeAccrualSchedule(
    req: Request,
    typeId: string,
    id: string,
    body: AccrualMutation,
    action: 'edit' | 'delete' | 'version' | 'deactivate',
  ) {
    requireUuid(typeId, 'Loại nghỉ');
    requireUuid(id, 'Lịch cộng phép');
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    const row = await hrmTransaction(pool, (db) =>
      mutateAccrualSchedule(
        db,
        tenantId,
        principal.userId,
        typeId,
        id,
        body,
        action,
      ),
    );
    return { data: action === 'delete' ? row : this.mapAccrualSchedule(row) };
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
    const res = await hrmTransaction(pool, async (db) => {
      const raw = await db.query(
        `SELECT lb.*, lt.name as leave_type_name, lt.code as leave_type_code,
              e.full_name as employee_name, e.employee_code, e.department_name AS department,
              COALESCE((SELECT sum(x.days_changed) FROM hrm_schema.leave_transactions x
                 WHERE x.tenant_id = lb.tenant_id AND x.employee_id = lb.employee_id
                   AND x.leave_type_id = lb.leave_type_id AND x.balance_year = lb.year
                   AND x.transaction_type = 'SENIORITY_ACCRUAL'), 0) AS seniority_accrued
       FROM hrm_schema.leave_balances lb
       JOIN hrm_schema.leave_types lt ON lb.leave_type_id = lt.id
       JOIN hrm_schema.employee_directory e ON lb.employee_id = e.employee_id AND e.tenant_id = lb.tenant_id
       WHERE lb.tenant_id = $1 AND lb.year = $2
         AND ($3::uuid IS NULL OR lb.employee_id = $3)
       ORDER BY e.full_name ASC`,
        [tenantId, year, employeeId || null],
      );
      return { rows: await enrichLeaveBalances(db, tenantId, raw.rows) };
    });
    return {
      data: res.rows.map((row) => ({
        ...this.mapBalance(row),
        seniorityAccrued:
          Math.round(Number(row.seniority_accrued || 0) * 100) / 100,
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
    @Query('year') yearStr?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    // Lọc theo năm của quỹ phép (balance_year); bỏ trống thì lấy mọi năm.
    const year = /^\d{4}$/.test(yearStr || '') ? Number(yearStr) : null;
    const res = await pool.query(
      `SELECT lt.*, ltypes.name as leave_type_name, ltypes.code as leave_type_code,
              e.full_name as employee_name, e.employee_code, e.department_name AS department
       FROM hrm_schema.leave_transactions lt
       JOIN hrm_schema.leave_types ltypes ON lt.leave_type_id = ltypes.id
       JOIN hrm_schema.employee_directory e ON lt.employee_id = e.employee_id AND e.tenant_id = lt.tenant_id
       WHERE lt.tenant_id = $1
         AND ($2::uuid IS NULL OR lt.employee_id = $2)
         AND ($3::uuid IS NULL OR lt.leave_type_id = $3)
         AND ($4::int IS NULL OR lt.balance_year = $4)
       ORDER BY lt.created_at DESC`,
      [tenantId, employeeId || null, leaveTypeId || null, year],
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
      const updated = {
        rows: [
          await applyLeaveDelta(db, tenantId, balance.id, {
            adjusted: body.daysAdjusted,
            remaining: body.daysAdjusted,
          }),
        ],
      };
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

  @Post('leave-transactions/:id/reverse')
  async reverseLeaveAdjustment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(id, 'Giao dịch');
    const reason = requireText(body.reason, 'Lý do đảo điều chỉnh', 2000);
    const row = await hrmTransaction(pool, async (db) => {
      const tx = (
        await db.query(
          'SELECT * FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND id=$2',
          [tenantId, id],
        )
      ).rows[0];
      if (!tx)
        throw new NotFoundException('Không tìm thấy giao dịch trong tenant');
      if (tx.transaction_type !== 'ADJUSTMENT' || !tx.balance_year)
        throw new BadRequestException(
          'Chỉ đảo giao dịch điều chỉnh thủ công có năm quỹ; giao dịch đơn từ phải hủy hiệu lực đơn gốc.',
        );
      await lockEmployee(db, tenantId, tx.employee_id);
      const key = `reverse-adjustment:${id}`;
      const prior = (
        await db.query(
          'SELECT * FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND operation_key=$2',
          [tenantId, key],
        )
      ).rows[0];
      if (prior) return prior;
      const type = (
        await db.query(
          'SELECT negative_limit FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2',
          [tenantId, tx.leave_type_id],
        )
      ).rows[0];
      const balance = await ensureLeaveBalance(
        db,
        tenantId,
        tx.employee_id,
        tx.leave_type_id,
        tx.balance_year,
      );
      const delta = -Number(tx.days_changed);
      if (
        Number(balance.remaining) + delta - Number(balance.pending) <
        -Number(type.negative_limit)
      )
        throw new ConflictException(
          'Quỹ đã dùng hoặc giữ chỗ; đảo điều chỉnh sẽ vượt hạn mức âm phép.',
        );
      const updated = await applyLeaveDelta(db, tenantId, balance.id, {
        adjusted: delta,
        remaining: delta,
      });
      const reversal = (
        await db.query(
          `INSERT INTO hrm_schema.leave_transactions(tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,note,balance_year,actor_id,operation_key) VALUES($1,$2,$3,'REVERSAL',$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            tenantId,
            tx.employee_id,
            tx.leave_type_id,
            delta,
            updated.remaining,
            `Đảo ${id}: ${reason}`,
            tx.balance_year,
            principal.userId,
            key,
          ],
        )
      ).rows[0];
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'LEAVE_ADJUSTMENT_REVERSED',
        id,
        { reason, reversalId: reversal.id, original: tx },
      );
      return reversal;
    });
    return { data: this.mapTransaction(row) };
  }

  // --------------------------------------------------------------------------
  // Annual leave entitlement & termination settlement
  // --------------------------------------------------------------------------

  @Get('leave-entitlements/preview')
  async previewEntitlements(
    @Req() req: Request,
    @Query('leave_type_id') leaveTypeId: string,
    @Query('year') yearStr?: string,
    @Query('employee_id') employeeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    requireUuid(leaveTypeId, 'leave_type_id');
    if (employeeId) requireUuid(employeeId, 'employee_id');
    const year = parseInt(yearStr || '', 10) || new Date().getFullYear();
    const data = await hrmTransaction(pool, async (db) => {
      const employees = await db.query(
        `SELECT e.employee_id,e.employee_code,e.full_name FROM hrm_schema.employee_directory e
         JOIN hrm_schema.employee_profiles p ON p.tenant_id=e.tenant_id AND p.employee_id=e.employee_id
         WHERE e.tenant_id=$1 AND p.deleted_at IS NULL AND ($2::uuid IS NULL OR e.employee_id=$2)
           AND (p.inactive_from IS NULL OR p.inactive_from>make_date($3,1,1)) ORDER BY e.employee_code LIMIT 500`,
        [tenantId, employeeId || null, year],
      );
      const today = isoDate(
        (await db.query('SELECT CURRENT_DATE AS today')).rows[0].today,
      );
      const currentYear = Number(today.slice(0, 4));
      const throughMonth =
        year < currentYear
          ? 12
          : year > currentYear
            ? 0
            : Number(today.slice(5, 7));
      const rows = [];
      for (const employee of employees.rows) {
        const ent = await employeeEntitlement(
          db,
          tenantId,
          employee.employee_id,
          leaveTypeId,
          year,
        );
        const balance = (
          await db.query(
            `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
            [tenantId, employee.employee_id, leaveTypeId, year],
          )
        ).rows[0];
        const projected = sumEntitlement(ent.months);
        const toDate = sumEntitlement(ent.months, throughMonth);
        const remaining = Number(balance?.remaining ?? 0),
          accrued = Number(balance?.accrued ?? 0);
        const ifTerminated = remaining - accrued + toDate.total;
        rows.push({
          employeeId: employee.employee_id,
          employeeCode: employee.employee_code,
          employeeName: employee.full_name,
          leaveTypeId,
          year,
          signDate: ent.signDate,
          startDate: ent.startDate,
          lastWorkingDay: ent.lastWorkingDay,
          projectedEntitlement: projected.total,
          entitledToDate: toDate.total,
          seniorityDays: projected.seniority,
          seniorityTierYears: Math.max(...ent.months.map((m) => m.tierYears)),
          accruedInLedger: accrued,
          remaining,
          used: Number(balance?.used ?? 0),
          pending: Number(balance?.pending ?? 0),
          excessIfTerminated: Math.max(
            0,
            Math.round(-ifTerminated * 100) / 100,
          ),
          unusedIfTerminated: Math.max(
            0,
            Math.round(ifTerminated * 100) / 100,
          ),
          blockers: !ent.hasPolicy
            ? ['Loại nghỉ chưa có lịch cộng phép theo ngày ký HĐ']
            : ent.signDate
              ? []
              : ['Chưa có HĐLĐ chính thức đã ký'],
        });
      }
      return rows;
    });
    return { data, meta: { total: data.length } };
  }

  @Get('employees/:employeeId/leave-settlement-preview')
  async previewSettlement(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('date') date: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    requireUuid(employeeId, 'employeeId');
    requireDate(date, 'date');
    const data = await hrmTransaction(pool, async (db) => ({
      blockers: await settlementBlockers(db, tenantId, employeeId, date),
      lines: await computeLeaveSettlement(db, tenantId, employeeId, date),
    }));
    return { data };
  }

  @Get('leave-settlements')
  async listSettlements(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('employee_id') employeeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.leave.read');
    if (employeeId) requireUuid(employeeId, 'employee_id');
    const res = await pool.query(
      `SELECT s.*, e.employee_code, e.full_name AS employee_name, t.name AS leave_type_name, p.period_code
       FROM hrm_schema.leave_settlements s
       JOIN hrm_schema.leave_types t ON t.id=s.leave_type_id AND t.tenant_id=s.tenant_id
       LEFT JOIN hrm_schema.employee_directory e ON e.tenant_id=s.tenant_id AND e.employee_id=s.employee_id
       LEFT JOIN hrm_schema.payroll_periods p ON p.tenant_id=s.tenant_id AND p.id=s.payroll_period_id
       WHERE s.tenant_id=$1 AND ($2::text IS NULL OR s.status=$2) AND ($3::uuid IS NULL OR s.employee_id=$3)
       ORDER BY s.created_at DESC LIMIT 500`,
      [tenantId, status || null, employeeId || null],
    );
    return {
      data: res.rows.map(mapSettlement),
      meta: { total: res.rowCount },
    };
  }

  @Post('leave-settlements/:id/schedule')
  async scheduleLeaveSettlement(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      payrollPeriodId: string | null;
      recoveryAmount?: number;
      reason: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    const row = await hrmTransaction(pool, (db) =>
      scheduleSettlement(db, tenantId, principal.userId, id, body),
    );
    return { data: mapSettlement(row) };
  }

  @Post('leave-settlements/:id/waive')
  async waiveLeaveSettlement(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    const row = await hrmTransaction(pool, (db) =>
      waiveSettlement(db, tenantId, principal.userId, id, reason),
    );
    return { data: mapSettlement(row) };
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
    const res = await hrmTransaction(pool, async (db) => {
      const raw = await db.query(
        `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND year = $3`,
        [tenantId, employeeId, year],
      );
      return { rows: await enrichLeaveBalances(db, tenantId, raw.rows) };
    });
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
    @Body()
    body: CreateLeaveRequestPayload &
      DraftSubmission & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, principal, employeeId } =
      await this.ctx.getRequestContext(req, body.employeeId);
    // Đơn đã hủy/từ chối trên quy trình không còn chiếm ngày: đồng bộ trước khi kiểm tra trùng.
    await syncEmployeeProcedureResults(pool, tenantId, employeeId);
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'leave',
      body,
    );
    body = submission.body;
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'leave',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn nghỉ phép',
        attributes: body.attributes,
      },
      (db) =>
        createLeave(db, tenantId, principal.userId, { ...body, employeeId }),
    );
    return {
      data: {
        ...this.mapLeaveRequest(row),
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  /** Từng ngày trong khoảng nghỉ với ca thực tế của nhân viên (giao diện dùng để tính số ngày nghỉ). */
  @Get('employees/:employeeId/leave-day-preview')
  async leaveDayPreview(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const from = requireDate(fromDate, 'from'),
      to = requireDate(toDate, 'to');
    if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000)
      throw new BadRequestException('Khoảng xem trước tối đa 366 ngày');
    // Người có quyền đọc đơn xem được mọi nhân viên; còn lại chỉ xem của chính mình.
    const { pool, tenantId, employeeId: visible } = await this.ctx.scoped(
      req,
      'hrm.request.read',
      requireUuid(employeeId, 'employeeId'),
    );
    const data = await previewLeaveDays(pool as unknown as PoolClient, tenantId, visible ?? employeeId, from, to);
    return { data };
  }

  @Get('leave-requests')
  async listLeaveRequests(
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
      forApproval === '1' ? approverPermissions('leave') : [],
    );
    employeeId = visibleEmployeeId;
    if (employeeId) await syncEmployeeProcedureResults(pool, tenantId, employeeId);
    const approvalScope =
      forApproval === '1'
        ? await this.approvals.listFilter(
            { pool, tenantId, principal },
            'leave',
            'lr',
            4,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter('lr', 4 + approvalScope.params.length, {
      assignee,
      currentStep,
    });
    const res = await pool.query(
      `SELECT lr.*, lt.code as leave_type_code, lt.name as leave_type_name, lt.paid as is_paid
       FROM hrm_schema.leave_requests lr
       LEFT JOIN hrm_schema.leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.tenant_id = $1
         AND ($2::uuid IS NULL OR lr.employee_id = $2)
         AND ($3::text IS NULL OR lr.status = $3)
         AND ${approvalScope.sql}
         AND ${progress.sql}
       ORDER BY lr.created_at DESC`,
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
        'leave',
        res.rows.map(this.mapLeaveRequest),
      ),
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
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'leave',
      'cancel',
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
            throw new ConflictException(
              'Đơn đã duyệt: dùng Hủy hiệu lực tại hộp xử lý đơn để ghi nhận lý do, phiên bản và bút toán đảo.',
            );
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
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'leave',
      target === 'APPROVED' ? 'approve' : 'reject',
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
    @Body()
    body: AmendLeaveRequestPayload & {
      expectedUpdatedAt: string;
      attributes?: Record<string, unknown>;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    requireUuid(id, 'Đơn nghỉ');
    const owner = (
      await pool.query(
        'SELECT employee_id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      )
    ).rows[0];
    if (!owner) throw new NotFoundException('Không tìm thấy đơn nghỉ');
    await this.ctx.getRequestContext(
      req,
      owner.employee_id,
      'hrm.leave.approve',
    );
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'leave',
        employeeId: owner.employee_id,
        initiatedBy: principal.userId,
        title: 'Đơn nghỉ phép điều chỉnh',
        attributes: body.attributes || {},
      },
      async (db) => {
        const current = await db.query(
          `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, id],
        );
        const leave = current.rows[0];
        if (!leave || leave.status !== 'PENDING')
          throw new BadRequestException('Chỉ sửa đơn đang chờ duyệt');
        assertLifecycleVersion(leave, body.expectedUpdatedAt);
        if (
          (
            await db.query(
              "SELECT 1 FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind='leave' AND request_id=$2",
              [tenantId, id],
            )
          ).rowCount
        )
          throw new ConflictException(
            'Đơn có quy trình: rút đơn qua Procedure, sau đó gửi bản nháp thay thế.',
          );
        await transitionLeave(
          db,
          tenantId,
          principal.userId,
          id,
          'CANCELLED',
          'Thay thế bằng đơn điều chỉnh',
        );
        const replacement = await createLeave(db, tenantId, principal.userId, {
          employeeId: leave.employee_id,
          leaveTypeId: leave.leave_type_id,
          attachmentFileId: leave.attachment_file_id,
          fromDate: body.fromDate,
          toDate: body.toDate,
          duration: body.duration,
          reason: body.reason,
        });
        await lifecycleAudit(
          db,
          tenantId,
          principal.userId,
          'LEAVE_AMENDED',
          id,
          { replacementId: replacement.id, before: leave, reason: body.reason },
        );
        return replacement;
      },
    );
    return {
      data: {
        ...this.mapLeaveRequest(row),
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
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
      deductBalance: Boolean(row.deduct_balance),
      negativeLimit: Number(row.negative_limit || 0),
      requiresAttachment: Boolean(row.requires_attachment),
      carryoverAllowed: Boolean(row.carryover_allowed),
      maxCarryoverDays: Number(row.max_carryover_days || 0),
      carryoverExpiryMonth: Number(row.carryover_expiry_month || 3),
      active: Boolean(row.active),
      mergedIntoId: (row.merged_into_id as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
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
      seniorityBonusYears: Number(row.seniority_bonus_years ?? 5),
      seniorityBonusDays: Number(row.seniority_bonus_days ?? 1),
      accrualBasis: (row.accrual_basis ??
        'JOIN_DATE') as HrmLeaveAccrualSchedule['accrualBasis'],
      startOffsetMonths: Number(row.start_offset_months ?? 0),
      advanceAllowed: Boolean(row.advance_allowed),
      annualDays: row.annual_days == null ? null : Number(row.annual_days),
      seniorityTiers: (
        (row.seniority_tiers as { minYears: unknown; bonusDays: unknown }[]) ??
        []
      ).map((t) => ({
        minYears: Number(t.minYears),
        bonusDays: Number(t.bonusDays),
      })),
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
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
      carryoverExpiryDate: row.carryover_expiry_date
        ? String(row.carryover_expiry_date)
        : null,
      maxNegativeAllowed: Number(row.max_negative_allowed || 2.0),
      projectedEntitlement:
        row.projected_entitlement == null
          ? null
          : Number(row.projected_entitlement),
      available:
        row.available == null
          ? Number(row.remaining)
          : Number(row.available),
      advanceAllowed: Boolean(row.advance_allowed),
      createdAt: String(row.created_at),
      updatedAt: new Date(row.updated_at as string).toISOString(),
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
      balanceYear: row.balance_year == null ? null : Number(row.balance_year),
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
      isPaid:
        row.is_paid !== undefined && row.is_paid !== null
          ? Boolean(row.is_paid)
          : undefined,
      seniorityDaysUsed: Number(row.seniority_days_used || 0),
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      currentAssigneeName: (row.current_assignee_name ?? null) as string | null,
      workflowStatus: row.workflow_status as string | null,
      attachmentFileId: row.attachment_file_id as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }
}
