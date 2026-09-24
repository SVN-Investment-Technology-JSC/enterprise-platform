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
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

@Controller('v1')
export class HrmSalaryController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Salary Grades & Steps (P2_S3_HRM_API.md § 21)
  // --------------------------------------------------------------------------

  @Get('salary-grades')
  async listGrades(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_grades WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code ASC`,
      [tenantId],
    );
    return {
      data: res.rows.map(this.mapGrade),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('salary-grades')
  async createGrade(@Req() req: Request, @Body() body: CreateSalaryGradeRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.salary_grades (tenant_id, code, name, description, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, body.code, body.name, body.description || null, body.status || 'ACTIVE'],
    );
    return {
      data: this.mapGrade(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('salary-grades/:id')
  async updateGrade(@Req() req: Request, @Param('id') id: string, @Body() body: UpdateSalaryGradeRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
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
      throw new NotFoundException({ code: 'HRM_GRADE_NOT_FOUND', message: 'Salary grade not found' });
    }
    return {
      data: this.mapGrade(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('salary-grades/:gradeId/steps')
  async listGradeSteps(@Req() req: Request, @Param('gradeId') gradeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_grade_steps WHERE tenant_id = $1 AND salary_grade_id = $2 ORDER BY step_no ASC`,
      [tenantId, gradeId],
    );
    return {
      data: res.rows.map(this.mapStep),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('salary-grades/:gradeId/steps')
  async createGradeStep(
    @Req() req: Request,
    @Param('gradeId') gradeId: string,
    @Body() body: CreateSalaryGradeStepRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
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
  async listEmployeeSalaryProfiles(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_salary_profiles
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY effective_from DESC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map(this.mapSalaryProfile),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('employees/:employeeId/salary-profiles/current')
  async getCurrentEmployeeSalaryProfile(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_salary_profiles
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'ACTIVE'
       ORDER BY effective_from DESC LIMIT 1`,
      [tenantId, employeeId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_SALARY_PROFILE_NOT_FOUND', message: 'Current salary profile not found' });
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');

    // Supersede previous active profile
    await pool.query(
      `UPDATE hrm_schema.employee_salary_profiles SET status = 'SUPERSEDED', updated_at = now()
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'ACTIVE'`,
      [tenantId, employeeId],
    );

    const res = await pool.query(
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
    return {
      data: this.mapSalaryProfile(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Salary Advance Requests (P2_S3_HRM_API.md § 23)
  // --------------------------------------------------------------------------

  @Post('salary-advance-requests')
  async createAdvanceRequest(@Req() req: Request, @Body() body: CreateSalaryAdvanceRequestPayload) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const requestDate = body.requestDate || new Date().toISOString().slice(0, 10);
    const res = await pool.query(
      `INSERT INTO hrm_schema.salary_advance_requests (
        tenant_id, employee_id, request_date, requested_amount, approved_amount,
        disbursed_amount, number_of_installments, total_deducted_amount, remaining_balance,
        reason, status
      ) VALUES ($1, $2, $3, $4, 0, 0, $5, 0, 0, $6, 'PENDING')
      RETURNING *`,
      [tenantId, body.employeeId, requestDate, body.requestedAmount, body.numberOfInstallments || 1, body.reason],
    );
    return {
      data: this.mapAdvance(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('salary-advance-requests')
  async listAdvanceRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
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
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('salary-advance-requests/:id/disburse')
  async disburseAdvance(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: DisburseSalaryAdvancePayload,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.salary_advance_requests SET
        disbursed_amount = $3,
        remaining_balance = $3,
        disbursed_at = now(),
        status = 'DISBURSED',
        updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'APPROVED'
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_advance_deductions
       WHERE tenant_id = $1 AND advance_request_id = $2
       ORDER BY installment_no ASC`,
      [tenantId, id],
    );
    return {
      data: res.rows.map(this.mapDeduction),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
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
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapSalaryProfile(row: Record<string, unknown>): HrmEmployeeSalaryProfile {
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
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
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

  private mapDeduction(row: Record<string, unknown>): HrmSalaryAdvanceDeduction {
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
