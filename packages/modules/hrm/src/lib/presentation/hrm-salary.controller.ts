import { attachProcedureLinkInfo } from '../infrastructure/hrm-procedure-link-info.js';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy.js';
import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';
import {
  resolveDraftSubmission,
  type DraftSubmission,
} from '../infrastructure/hrm-request-drafts.js';
import {
  lockLifecycleRow,
  updateLifecycleRow,
  lifecycleAudit,
  timestamp,
  assertLifecycleVersion,
} from '../infrastructure/hrm-lifecycle.js';
import { approveSalaryAdvance } from '../infrastructure/hrm-request-transition.js';
import { submitHrmRequest } from '../infrastructure/hrm-submission.js';
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
  UpdateSalaryGradeStepRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  ConflictException,
  Delete,
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
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';

@Controller('v1')
export class HrmSalaryController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    const code = requireText(body.code, 'Mã ngạch', 50);
    const name = requireText(body.name, 'Tên ngạch', 255);
    if (
      body.status !== undefined &&
      !['ACTIVE', 'INACTIVE'].includes(body.status)
    )
      throw new BadRequestException('Trạng thái ngạch không hợp lệ');
    const row = await hrmTransaction(pool, async (db) => {
      const res = await db.query(
        `INSERT INTO hrm_schema.salary_grades (tenant_id, code, name, description, status)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, code) DO NOTHING RETURNING *`,
        [
          tenantId,
          code,
          name,
          body.description || null,
          body.status || 'ACTIVE',
        ],
      );
      if (!res.rows[0])
        throw new ConflictException(
          'Mã ngạch đã tồn tại hoặc đã được lưu trong lịch sử. Chọn mã khác.',
        );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SALARY_GRADE_CREATED',
        res.rows[0].id,
        { code },
      );
      return res.rows[0];
    });
    return {
      data: this.mapGrade(row),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('salary-grades/:id')
  async updateGrade(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateSalaryGradeRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    if (body.name !== undefined) requireText(body.name, 'name');
    if (
      body.status !== undefined &&
      !['ACTIVE', 'INACTIVE'].includes(body.status)
    )
      throw new BadRequestException('Trạng thái ngạch không hợp lệ');
    const row = await hrmTransaction(pool, async (db) => {
      await lockLifecycleRow(
        db,
        'salary_grades',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      const result = await updateLifecycleRow(
        db,
        'salary_grades',
        tenantId,
        id,
        { name: body.name, description: body.description, status: body.status },
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SALARY_GRADE_UPDATED',
        id,
        body,
      );
      return result;
    });
    return { data: this.mapGrade(row) };
  }

  @Delete('salary-grades/:id')
  async deleteGrade(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    await hrmTransaction(pool, async (db) => {
      await lockLifecycleRow(
        db,
        'salary_grades',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      const refs = await db.query(
        'SELECT EXISTS(SELECT 1 FROM hrm_schema.salary_grade_steps WHERE tenant_id=$1 AND salary_grade_id=$2 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM hrm_schema.employee_salary_profiles WHERE tenant_id=$1 AND salary_grade_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.position_profiles WHERE tenant_id=$1 AND salary_grade_id=$2) AS used',
        [tenantId, id],
      );
      if (refs.rows[0].used)
        throw new ConflictException(
          'Ngạch đã có bậc hoặc được sử dụng. Chọn ngừng hoạt động để giữ lịch sử.',
        );
      await updateLifecycleRow(db, 'salary_grades', tenantId, id, {
        deleted_at: new Date(),
        status: 'INACTIVE',
      });
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SALARY_GRADE_DELETED',
        id,
        {},
      );
    });
    return { data: { deleted: true } };
  }

  @Get('salary-grades/:gradeId/steps')
  async listGradeSteps(@Req() req: Request, @Param('gradeId') gradeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.salary.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.salary_grade_steps WHERE tenant_id = $1 AND salary_grade_id = $2 AND deleted_at IS NULL ORDER BY step_no ASC`,
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
    requireUuid(gradeId, 'gradeId');
    this.validateStep(body);
    const res = await hrmTransaction(pool, async (db) => {
      const grade = await db.query(
        "SELECT id FROM hrm_schema.salary_grades WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE",
        [tenantId, gradeId],
      );
      if (!grade.rowCount)
        throw new NotFoundException(
          'Ngạch không tồn tại hoặc đã ngừng hoạt động',
        );
      return db.query(
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
    });
    return {
      data: this.mapStep(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('salary-grades/:gradeId/steps/:id')
  async updateGradeStep(
    @Req() req: Request,
    @Param('gradeId') gradeId: string,
    @Param('id') id: string,
    @Body() body: UpdateSalaryGradeStepRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    requireUuid(gradeId, 'gradeId');
    const row = await hrmTransaction(pool, async (db) => {
      const before = await lockLifecycleRow(
        db,
        'salary_grade_steps',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (before.salary_grade_id !== gradeId)
        throw new NotFoundException('Bậc không thuộc ngạch đã chọn');
      const used = await db.query(
        'SELECT 1 FROM hrm_schema.employee_salary_profiles WHERE tenant_id=$1 AND salary_step_id=$2 LIMIT 1',
        [tenantId, id],
      );
      if (
        used.rowCount &&
        Object.keys(body).some(
          (k) => k !== 'expectedUpdatedAt' && k !== 'status',
        )
      )
        throw new ConflictException(
          'Bậc đã sử dụng; tạo bậc mới để giữ lịch sử lương',
        );
      if (
        body.status !== undefined &&
        !['ACTIVE', 'INACTIVE'].includes(body.status)
      )
        throw new BadRequestException('Trạng thái bậc không hợp lệ');
      this.validateStep({ ...this.mapStep(before), ...body });
      const updated = await updateLifecycleRow(
        db,
        'salary_grade_steps',
        tenantId,
        id,
        {
          min_salary: body.minSalary,
          mid_salary: body.midSalary,
          max_salary: body.maxSalary,
          base_salary: body.baseSalary,
          effective_from: body.effectiveFrom,
          effective_to: body.effectiveTo,
          status: body.status,
        },
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SALARY_STEP_UPDATED',
        id,
        body,
      );
      return updated;
    });
    return { data: this.mapStep(row) };
  }

  @Delete('salary-grades/:gradeId/steps/:id')
  async deleteGradeStep(
    @Req() req: Request,
    @Param('gradeId') gradeId: string,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.salary.manage',
    );
    requireUuid(gradeId, 'gradeId');
    await hrmTransaction(pool, async (db) => {
      const before = await lockLifecycleRow(
        db,
        'salary_grade_steps',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (before.salary_grade_id !== gradeId)
        throw new NotFoundException('Bậc không thuộc ngạch đã chọn');
      const used = await db.query(
        'SELECT 1 FROM hrm_schema.employee_salary_profiles WHERE tenant_id=$1 AND salary_step_id=$2 LIMIT 1',
        [tenantId, id],
      );
      if (used.rowCount)
        throw new ConflictException(
          'Bậc đã sử dụng. Chọn ngừng hoạt động để giữ lịch sử.',
        );
      await updateLifecycleRow(db, 'salary_grade_steps', tenantId, id, {
        deleted_at: new Date(),
        status: 'INACTIVE',
      });
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SALARY_STEP_DELETED',
        id,
        {},
      );
    });
    return { data: { deleted: true } };
  }

  private validateStep(body: CreateSalaryGradeStepRequest) {
    if (!Number.isInteger(body.stepNo) || body.stepNo < 1)
      throw new BadRequestException('Số bậc phải là số nguyên dương');
    for (const value of [
      body.minSalary,
      body.midSalary,
      body.maxSalary,
      body.baseSalary,
    ])
      if (!Number.isFinite(value) || value < 0)
        throw new BadRequestException('Mức lương phải là số không âm');
    if (
      body.minSalary > body.midSalary ||
      body.midSalary > body.maxSalary ||
      body.baseSalary < body.minSalary ||
      body.baseSalary > body.maxSalary
    )
      throw new BadRequestException(
        'Cần min ≤ mid ≤ max và lương cơ bản trong khoảng min–max',
      );
    requireDate(body.effectiveFrom, 'effectiveFrom');
    if (
      body.effectiveTo != null &&
      requireDate(body.effectiveTo, 'effectiveTo') < body.effectiveFrom
    )
      throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu');
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
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status NOT IN ('FINALIZED','CANCELLED')`,
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
          `SELECT id FROM hrm_schema.salary_grades WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE`,
          [tenantId, body.salaryGradeId],
        );
        if (!grade.rowCount)
          throw new BadRequestException('Ngạch lương không thuộc tenant');
      }
      if (body.salaryStepId) {
        const step = await db.query(
          `SELECT id FROM hrm_schema.salary_grade_steps WHERE tenant_id=$1 AND id=$2 AND salary_grade_id=$3 AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE`,
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
    @Body()
    body: CreateSalaryAdvanceRequestPayload &
      DraftSubmission & {
        attributes?: Record<string, unknown>;
      },
  ) {
    const { pool, tenantId, employeeId, principal } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'advance',
      body,
    );
    body = submission.body;
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
    requireDate(requestDate, 'Ngày đề nghị');
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'advance',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn tạm ứng lương',
        attributes: body.attributes,
      },
      async (db) => {
        await lockEmployee(db, tenantId, employeeId);
        const res = await db.query(
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
        return res.rows[0];
      },
    );

    return {
      data: {
        ...this.mapAdvance(row),
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  @Get('salary-advance-requests')
  async listAdvanceRequests(
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
    } = await this.ctx.scoped(req, 'hrm.advance.read', employeeId);
    employeeId = visibleEmployeeId;
    const approvalScope =
      forApproval === '1'
        ? await this.approvals.listFilter(
            { pool, tenantId, principal },
            'advance',
            'a',
            4,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter('a', 4 + approvalScope.params.length, {
      assignee,
      currentStep,
    });
    const res = await pool.query(
      `SELECT a.*,e.full_name AS employee_name,e.employee_code FROM hrm_schema.salary_advance_requests a
       JOIN hrm_schema.employee_directory e ON e.tenant_id=a.tenant_id AND e.employee_id=a.employee_id
       WHERE a.tenant_id = $1
         AND ($2::uuid IS NULL OR a.employee_id = $2)
         AND ($3::text IS NULL OR a.status = $3)
         AND ${approvalScope.sql}
         AND ${progress.sql}
       ORDER BY a.request_date DESC`,
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
        'advance',
        res.rows.map(this.mapAdvance),
      ),
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
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'advance',
      'approve',
    );
    const row = await hrmTransaction(pool, (db) =>
      approveSalaryAdvance(db, tenantId, principal.userId, id, amount),
    );
    return { data: this.mapAdvance(row) };
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
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'advance',
      'reject',
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.advance.disburse',
    );
    if (!Number.isFinite(body.amount) || body.amount <= 0)
      throw new BadRequestException('Số tiền thu hồi phải lớn hơn 0');
    return hrmTransaction(pool, async (db) => {
      // Payroll finalization locks the period before advances; use the same order.
      const period = await db.query(
        `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, requireUuid(body.payrollPeriodId, 'payrollPeriodId')],
      );
      if (!period.rows[0] || ['LOCKED', 'PAID'].includes(period.rows[0].status))
        throw new ConflictException('Kỳ lương không hợp lệ hoặc đã khóa');
      const advance = await db.query(
        `SELECT * FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1 AND id=$2 AND status='DISBURSED' FOR UPDATE`,
        [tenantId, id],
      );
      if (!advance.rows[0])
        throw new BadRequestException('Chỉ lập thu hồi sau khi giải ngân');
      const prior = await db.query(
        `SELECT COALESCE(sum(scheduled_amount) FILTER(WHERE status='SCHEDULED'),0) AS reserved,count(*) FILTER(WHERE status<>'CANCELLED')::int AS n,COALESCE(max(installment_no),0)::int AS last_no,count(*) FILTER(WHERE payroll_period_id=$3 AND status<>'CANCELLED')::int AS duplicate FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND advance_request_id=$2`,
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
        [
          tenantId,
          id,
          body.payrollPeriodId,
          prior.rows[0].last_no + 1,
          body.amount,
        ],
      );
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND payroll_period_id=$2 AND status NOT IN ('FINALIZED','CANCELLED')`,
        [tenantId, body.payrollPeriodId],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'ADVANCE_RECOVERY_SCHEDULED',
        result.rows[0].id,
        { after: result.rows[0] },
      );
      return { data: this.mapDeduction(result.rows[0]) };
    });
  }

  @Patch('salary-advance-deductions/:id')
  async updateDeduction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { amount: number; reason: string; expectedUpdatedAt: string },
  ) {
    if (!Number.isFinite(body.amount) || body.amount <= 0)
      throw new BadRequestException('Số tiền thu hồi phải lớn hơn 0');
    return this.changeDeduction(req, id, body, false);
  }

  @Post('salary-advance-deductions/:id/cancel')
  async cancelDeduction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason: string; expectedUpdatedAt: string },
  ) {
    return this.changeDeduction(req, id, body, true);
  }

  private async changeDeduction(
    req: Request,
    id: string,
    body: { amount?: number; reason: string; expectedUpdatedAt: string },
    cancel: boolean,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.advance.disburse',
    );
    requireUuid(id, 'id');
    const reason = requireText(body.reason, 'Lý do', 2000);
    return hrmTransaction(pool, async (db) => {
      const identity = (
        await db.query(
          'SELECT payroll_period_id,advance_request_id FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND id=$2',
          [tenantId, id],
        )
      ).rows[0];
      if (!identity) throw new NotFoundException('Không tìm thấy lịch thu hồi');
      const period = (
        await db.query(
          'SELECT * FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, identity.payroll_period_id],
        )
      ).rows[0];
      if (!period || ['LOCKED', 'PAID'].includes(period.status))
        throw new ConflictException('Kỳ lương đã khóa');
      const advance = (
        await db.query(
          'SELECT * FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, identity.advance_request_id],
        )
      ).rows[0];
      const before = (
        await db.query(
          'SELECT * FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      assertLifecycleVersion(before, body.expectedUpdatedAt);
      if (before.status !== 'SCHEDULED' || advance.status !== 'DISBURSED')
        throw new ConflictException(
          'Chỉ sửa lịch chưa thu hồi của khoản đã giải ngân',
        );
      if (!cancel) {
        const reserved = (
          await db.query(
            "SELECT COALESCE(sum(scheduled_amount),0) AS amount FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND advance_request_id=$2 AND id<>$3 AND status='SCHEDULED'",
            [tenantId, advance.id, id],
          )
        ).rows[0];
        if (
          Number(reserved.amount) + body.amount! >
          Number(advance.remaining_balance)
        )
          throw new BadRequestException('Lịch thu hồi vượt dư nợ còn lại');
      }
      const after = (
        await db.query(
          "UPDATE hrm_schema.salary_advance_deductions SET scheduled_amount=$3,status=$4,note=$5,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [
            tenantId,
            id,
            cancel ? before.scheduled_amount : body.amount,
            cancel ? 'CANCELLED' : 'SCHEDULED',
            reason,
          ],
        )
      ).rows[0];
      await db.query(
        "UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND payroll_period_id=$2 AND status NOT IN ('FINALIZED','CANCELLED')",
        [tenantId, period.id],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        cancel ? 'ADVANCE_RECOVERY_CANCELLED' : 'ADVANCE_RECOVERY_UPDATED',
        id,
        { reason, before, after },
      );
      return { data: this.mapDeduction(after) };
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
    const { pool, tenantId, employeeId } = await this.ctx.scoped(
      req,
      'hrm.advance.read',
    );
    const res = await pool.query(
      `SELECT d.*,p.period_code FROM hrm_schema.salary_advance_deductions d
       JOIN hrm_schema.salary_advance_requests a ON a.tenant_id=d.tenant_id AND a.id=d.advance_request_id
       JOIN hrm_schema.payroll_periods p ON p.tenant_id=d.tenant_id AND p.id=d.payroll_period_id
       WHERE d.tenant_id = $1 AND d.advance_request_id = $2 AND ($3::uuid IS NULL OR a.employee_id=$3)
       ORDER BY d.installment_no ASC`,
      [tenantId, requireUuid(id, 'id'), employeeId || null],
    );
    return {
      data: res.rows.map((row) => ({
        ...this.mapDeduction(row),
        periodCode: row.period_code,
      })),
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
      updatedAt: timestamp(row.updated_at),
    };
  }

  private mapStep(row: Record<string, unknown>): HrmSalaryGradeStep {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      salaryGradeId: row.salary_grade_id as string,
      status: (row.status as 'ACTIVE' | 'INACTIVE') || 'ACTIVE',
      stepNo: Number(row.step_no),
      minSalary: Number(row.min_salary),
      midSalary: Number(row.mid_salary),
      maxSalary: Number(row.max_salary),
      baseSalary: Number(row.base_salary),
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
      createdAt: String(row.created_at),
      updatedAt: timestamp(row.updated_at),
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
      updatedAt: timestamp(row.updated_at),
    };
  }

  private mapAdvance(row: Record<string, unknown>): HrmSalaryAdvanceRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      employeeName: row.employee_name as string | undefined,
      employeeCode: row.employee_code as string | undefined,
      requestDate: isoDate(row.request_date),
      requestedAmount: Number(row.requested_amount),
      approvedAmount: Number(row.approved_amount || 0),
      disbursedAmount: Number(row.disbursed_amount || 0),
      numberOfInstallments: Number(row.number_of_installments || 1),
      totalDeductedAmount: Number(row.total_deducted_amount || 0),
      remainingBalance: Number(row.remaining_balance || 0),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: (row.procedure_instance_id ?? null) as string | null,
      currentStepName: (row.current_step_name ?? null) as string | null,
      currentAssigneeName: (row.current_assignee_name ?? null) as string | null,
      workflowStatus: (row.workflow_status ?? null) as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      disbursedAt: row.disbursed_at ? String(row.disbursed_at) : null,
      createdAt: String(row.created_at),
      updatedAt: timestamp(row.updated_at),
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
      updatedAt: timestamp(row.updated_at),
    };
  }
}
