import type {
  CreateEmployeeSalaryProfileRequest,
  CreateSalaryAdvanceRequestPayload,
  CreateSalaryGradeRequest,
  CreateSalaryGradeStepRequest,
  DisburseSalaryAdvancePayload,
  HrmEmployeeSalaryProfile,
  HrmSalaryAdvanceDeduction,
  HrmSalaryAdvanceRequest,
  HrmSalaryGrade,
  HrmSalaryGradeStep,
  UpdateSalaryGradeRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { lockEmployee, isoDate } from '../infrastructure/hrm-time.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';

@Controller('v1')
export class HrmSalaryController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
  ) {}

  // --------------------------------------------------------------------------
  // Salary Grades & Steps (P2_S3_HRM_API.md § 21)
  // --------------------------------------------------------------------------

  @Get('salary-grades')
  async listGrades(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_grades WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code ASC`,
      [tenantId],
    );
    return {
      data: res.rows.map(this.mapGrade),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('salary-grades')
  async createGrade(
    @Req() req: Request,
    @Body() body: CreateSalaryGradeRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    const res = await pool.query(
      `INSERT INTO hrm_schema.salary_grades (tenant_id, code, name, description, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        tenantId,
        body.code,
        body.name,
        body.description || null,
        body.status || 'ACTIVE',
      ],
    );
    return {
      data: this.mapGrade(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('salary-grades/:id')
  async updateGrade(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateSalaryGradeRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    const res = await pool.query(
      `UPDATE hrm_schema.salary_grades SET
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        status = COALESCE($5, status),
        updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, body.name, body.description, body.status],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_GRADE_NOT_FOUND',
        message: 'Salary grade not found',
      });
    }
    return {
      data: this.mapGrade(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('salary-grades/:gradeId/steps')
  async listGradeSteps(@Req() req: Request, @Param('gradeId') gradeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_grade_steps WHERE tenant_id = $1 AND salary_grade_id = $2 ORDER BY step_no ASC`,
      [tenantId, gradeId],
    );
    return {
      data: res.rows.map(this.mapStep),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('salary-grades/:gradeId/steps')
  async createGradeStep(
    @Req() req: Request,
    @Param('gradeId') gradeId: string,
    @Body() body: CreateSalaryGradeStepRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    const res = await pool.query(
      `INSERT INTO hrm_schema.salary_grade_steps (
        tenant_id, salary_grade_id, step_no, min_salary, mid_salary, max_salary, base_salary, effective_from, effective_to
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        tenantId,
        gradeId,
        body.stepNo,
        body.minSalary,
        body.midSalary,
        body.maxSalary,
        body.baseSalary,
        body.effectiveFrom,
        body.effectiveTo || null,
      ],
    );
    return {
      data: this.mapStep(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Employee Salary Profiles (P2_S3_HRM_API.md § 22)
  // --------------------------------------------------------------------------

  @Get('employees/:employeeId/salary-profiles')
  async listEmployeeSalaryProfiles(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.salary.read',
      'hrm.self.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_salary_profiles
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY effective_from DESC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map(this.mapSalaryProfile),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Get('employees/:employeeId/salary-profiles/current')
  async getCurrentEmployeeSalaryProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.salary.read',
      'hrm.self.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_salary_profiles
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'ACTIVE'
       ORDER BY effective_from DESC LIMIT 1`,
      [tenantId, employeeId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_SALARY_PROFILE_NOT_FOUND',
        message: 'Current salary profile not found',
      });
    }
    return {
      data: this.mapSalaryProfile(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('employees/:employeeId/salary-profiles')
  async createEmployeeSalaryProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateEmployeeSalaryProfileRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );

    requireDate(body.effectiveFrom, 'effectiveFrom');
    requireText(body.changeReason, 'changeReason', 2000);
    if (
      !Number.isFinite(body.baseSalary) ||
      body.baseSalary < 0 ||
      body.baseSalary > 1e12
    )
      throw new BadRequestException('Mức lương không hợp lệ');
    if (
      body.effectiveTo &&
      requireDate(body.effectiveTo, 'effectiveTo') < body.effectiveFrom
    )
      throw new BadRequestException('Khoảng hiệu lực không hợp lệ');
    const res = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const locked = await db.query(
        `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND to_date>=$2::date ORDER BY id FOR UPDATE`,
        [tenantId, body.effectiveFrom],
      );
      if (locked.rows.some((p) => ['LOCKED', 'PAID'].includes(p.status)))
        throw new BadRequestException('Không sửa mức lương trong kỳ đã chốt');
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status<>'FINALIZED'`,
        [tenantId, locked.rows.map((p) => p.id)],
      );
      const newer = await db.query(
        `SELECT id FROM hrm_schema.employee_salary_profiles WHERE tenant_id=$1 AND employee_id=$2 AND effective_from>=$3::date AND status<>'CANCELLED'`,
        [tenantId, employeeId, body.effectiveFrom],
      );
      if (newer.rowCount)
        throw new BadRequestException(
          'Ngày hiệu lực phải sau hồ sơ lương đã lưu',
        );
      if (body.salaryGradeId) {
        const grade = await db.query(
          `SELECT id FROM hrm_schema.salary_grades WHERE tenant_id=$1 AND id=$2`,
          [tenantId, body.salaryGradeId],
        );
        if (!grade.rowCount)
          throw new BadRequestException('Ngạch lương không thuộc tenant');
      }
      if (body.salaryStepId) {
        const step = await db.query(
          `SELECT id FROM hrm_schema.salary_grade_steps WHERE tenant_id=$1 AND id=$2 AND salary_grade_id=$3`,
          [tenantId, body.salaryStepId, body.salaryGradeId],
        );
        if (!step.rowCount)
          throw new BadRequestException('Bậc lương không khớp ngạch');
      }
      await db.query(
        `UPDATE hrm_schema.employee_salary_profiles SET status='SUPERSEDED',effective_to=$3::date-1,updated_at=now() WHERE tenant_id=$1 AND employee_id=$2 AND (effective_to IS NULL OR effective_to>=$3::date) AND status='ACTIVE'`,
        [tenantId, employeeId, body.effectiveFrom],
      );
      return db.query(
        `INSERT INTO hrm_schema.employee_salary_profiles (
        tenant_id, employee_id, salary_grade_id, salary_step_id, salary_type, base_salary,
        currency, change_reason, effective_from, effective_to, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')
      RETURNING *`,
        [
          tenantId,
          employeeId,
          body.salaryGradeId || null,
          body.salaryStepId || null,
          body.salaryType || 'NET',
          body.baseSalary,
          body.currency || 'VND',
          body.changeReason || null,
          body.effectiveFrom,
          body.effectiveTo || null,
        ],
      );
    });
    return {
      data: this.mapSalaryProfile(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Salary Advance Requests (P2_S3_HRM_API.md § 23)
  // --------------------------------------------------------------------------

  @Post('salary-advance-requests')
  async createAdvanceRequest(
    @Req() req: Request,
    @Body() body: CreateSalaryAdvanceRequestPayload & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, employeeId } = await this.ctx.getRequestContext(
      req,
      body.employeeId,
    );
    requireText(body.reason, 'reason', 2000);
    if (
      !Number.isFinite(body.requestedAmount) ||
      body.requestedAmount <= 0 ||
      !Number.isInteger(body.numberOfInstallments || 1) ||
      (body.numberOfInstallments || 1) < 1 ||
      (body.numberOfInstallments || 1) > 60
    )
      throw new BadRequestException(
        'Số tiền hoặc số kỳ ứng lương không hợp lệ',
      );
    const requestDate =
      body.requestDate || new Date().toISOString().slice(0, 10);
    const res = await pool.query(
      `INSERT INTO hrm_schema.salary_advance_requests (
        tenant_id, employee_id, request_date, requested_amount, approved_amount,
        disbursed_amount, number_of_installments, total_deducted_amount, remaining_balance,
        reason, status
      ) VALUES ($1, $2, $3, $4, 0, 0, $5, 0, 0, $6, 'PENDING')
      RETURNING *`,
      [
        tenantId,
        employeeId,
        requestDate,
        body.requestedAmount,
        body.numberOfInstallments || 1,
        body.reason,
      ],
    );
    const inserted = res.rows[0];

    // Payload thuộc tính để PE Node S và Gateway đánh giá rẽ nhánh
    const procAttributes: Record<string, unknown> = {
      so_tien: Number(body.requestedAmount),
      amount: Number(body.requestedAmount),
      so_ky_tra: Number(body.numberOfInstallments || 1),
      ly_do: body.reason,
      ...(body.attributes || {}),
    };

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'advance',
      inserted.id,
      employeeId,
      `Đơn tạm ứng lương (${Number(body.requestedAmount).toLocaleString('vi-VN')} VND)`,
      procAttributes,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.salary_advance_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, inserted.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapAdvance(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapAdvance(inserted),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('salary-advance-requests')
  async listAdvanceRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.advance.read', employeeId);
    employeeId = visibleEmployeeId;
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_advance_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY request_date DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: res.rows.map(this.mapAdvance),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('salary-advance-requests/:id/approve')
  async approveAdvance(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('approvedAmount') amount?: number,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.advance.approve',
    );
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0))
      throw new BadRequestException('Số tiền duyệt không hợp lệ');
    const result = await pool.query(
      `UPDATE hrm_schema.salary_advance_requests SET status='APPROVED',approved_amount=COALESCE($4,requested_amount),approved_by=$3,approved_at=now() WHERE tenant_id=$1 AND id=$2 AND status='PENDING' AND COALESCE($4,requested_amount)<=requested_amount RETURNING *`,
      [tenantId, id, principal.userId, amount ?? null],
    );
    if (!result.rowCount)
      throw new BadRequestException(
        'Đơn không còn chờ duyệt hoặc số tiền vượt đề nghị',
      );
    return { data: this.mapAdvance(result.rows[0]) };
  }
  @Post('salary-advance-requests/:id/reject')
  async rejectAdvance(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.advance.approve',
    );
    requireText(reason, 'reason', 2000);
    const result = await pool.query(
      `UPDATE hrm_schema.salary_advance_requests SET status='REJECTED',approved_by=$3,approved_at=now() WHERE tenant_id=$1 AND id=$2 AND status='PENDING' RETURNING *`,
      [tenantId, id, principal.userId],
    );
    if (!result.rowCount)
      throw new BadRequestException('Đơn không còn chờ duyệt');
    return { data: this.mapAdvance(result.rows[0]) };
  }
  @Post('salary-advance-requests/:id/schedule')
  async scheduleAdvance(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { payrollPeriodId: string; amount: number },
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.advance.disburse',
    );
    if (!Number.isFinite(body.amount) || body.amount <= 0)
      throw new BadRequestException('Số tiền thu hồi phải lớn hơn 0');
    return hrmTransaction(pool, async (db) => {
      const advance = await db.query(
        `SELECT * FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1 AND id=$2 AND status='DISBURSED' FOR UPDATE`,
        [tenantId, id],
      );
      if (!advance.rows[0])
        throw new BadRequestException('Chỉ lập thu hồi sau khi giải ngân');
      const period = await db.query(
        `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, body.payrollPeriodId],
      );
      if (!period.rows[0] || ['LOCKED', 'PAID'].includes(period.rows[0].status))
        throw new BadRequestException('Kỳ lương không hợp lệ');
      const prior = await db.query(
        `SELECT COALESCE(sum(scheduled_amount) FILTER(WHERE status='SCHEDULED'),0) AS reserved,count(*)::int AS n,count(*) FILTER(WHERE payroll_period_id=$3 AND status<>'CANCELLED')::int AS duplicate FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND advance_request_id=$2`,
        [tenantId, id, body.payrollPeriodId],
      );
      if (
        prior.rows[0].duplicate ||
        prior.rows[0].n >= advance.rows[0].number_of_installments ||
        Number(prior.rows[0].reserved) + body.amount >
          Number(advance.rows[0].remaining_balance)
      )
        throw new BadRequestException(
          'Lịch thu hồi trùng kỳ, vượt số kỳ hoặc dư nợ',
        );
      const result = await db.query(
        `INSERT INTO hrm_schema.salary_advance_deductions (tenant_id,advance_request_id,payroll_period_id,installment_no,scheduled_amount) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [tenantId, id, body.payrollPeriodId, prior.rows[0].n + 1, body.amount],
      );
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=$2 AND status<>'FINALIZED'`,
        [tenantId, body.payrollPeriodId],
      );
      return { data: this.mapDeduction(result.rows[0]) };
    });
  }

  @Post('salary-advance-requests/:id/disburse')
  async disburseAdvance(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: DisburseSalaryAdvancePayload,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.advance.disburse',
    );
    if (!Number.isFinite(body.disbursedAmount) || body.disbursedAmount <= 0)
      throw new BadRequestException('Số tiền giải ngân không hợp lệ');
    const res = await pool.query(
      `UPDATE hrm_schema.salary_advance_requests SET
        disbursed_amount = $3,
        remaining_balance = $3,
        disbursed_at = now(),
        status = 'DISBURSED',
        updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'APPROVED' AND $3<=approved_amount
       RETURNING *`,
      [tenantId, id, body.disbursedAmount],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_ADVANCE_CANNOT_DISBURSE',
        message: 'Salary advance request not found or not in APPROVED state',
      });
    }
    return {
      data: this.mapAdvance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('salary-advance-requests/:id/deductions')
  async listAdvanceDeductions(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.advance.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_advance_deductions
       WHERE tenant_id = $1 AND advance_request_id = $2
       ORDER BY installment_no ASC`,
      [tenantId, id],
    );
    return {
      data: res.rows.map(this.mapDeduction),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  private mapGrade(row: Record<string, unknown>): HrmSalaryGrade {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      code: row.code as string,
      name: row.name as string,
      description: row.description as string | null,
      status: row.status as any,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapStep(row: Record<string, unknown>): HrmSalaryGradeStep {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      salaryGradeId: row.salary_grade_id as string,
      stepNo: Number(row.step_no),
      minSalary: Number(row.min_salary),
      midSalary: Number(row.mid_salary),
      maxSalary: Number(row.max_salary),
      baseSalary: Number(row.base_salary),
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapSalaryProfile(
    row: Record<string, unknown>,
  ): HrmEmployeeSalaryProfile {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      salaryGradeId: row.salary_grade_id as string | null,
      salaryStepId: row.salary_step_id as string | null,
      salaryType: row.salary_type as any,
      baseSalary: Number(row.base_salary),
      currency: String(row.currency || 'VND'),
      changeReason: row.change_reason as string | null,
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
      approvedBy: row.approved_by as string | null,
      status: row.status as any,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAdvance(row: Record<string, unknown>): HrmSalaryAdvanceRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      requestDate: String(row.request_date),
      requestedAmount: Number(row.requested_amount),
      approvedAmount: Number(row.approved_amount || 0),
      disbursedAmount: Number(row.disbursed_amount || 0),
      numberOfInstallments: Number(row.number_of_installments || 1),
      totalDeductedAmount: Number(row.total_deducted_amount || 0),
      remainingBalance: Number(row.remaining_balance || 0),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      disbursedAt: row.disbursed_at ? String(row.disbursed_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapDeduction(
    row: Record<string, unknown>,
  ): HrmSalaryAdvanceDeduction {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      advanceRequestId: row.advance_request_id as string,
      payrollPeriodId: row.payroll_period_id as string,
      installmentNo: Number(row.installment_no),
      scheduledAmount: Number(row.scheduled_amount),
      actualDeductedAmount: Number(row.actual_deducted_amount || 0),
      status: row.status as any,
      deductedAt: row.deducted_at ? String(row.deducted_at) : null,
      payrollRunId: row.payroll_run_id as string | null,
      note: row.note as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
