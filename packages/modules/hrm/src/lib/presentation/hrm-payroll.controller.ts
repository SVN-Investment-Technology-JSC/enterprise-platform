import type {
  CreatePayrollAdjustmentRequest,
  CreatePayrollPeriodRequest,
  HrmPayrollItem,
  HrmPayrollPeriod,
  HrmPayrollRun,
  HrmPayslip,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

@Controller('v1')
export class HrmPayrollController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Payroll Periods (P2_S3_HRM_API.md § 24)
  // --------------------------------------------------------------------------

  @Get('payroll-periods')
  async listPeriods(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payroll_periods WHERE tenant_id = $1 ORDER BY from_date DESC`,
      [tenantId],
    );
    return {
      data: res.rows.map(this.mapPeriod),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('payroll-periods')
  async createPeriod(@Req() req: Request, @Body() body: CreatePayrollPeriodRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');

    // Verify timesheet period status if linked
    if (body.timesheetPeriodId) {
      const ts = await pool.query(
        `SELECT status FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, body.timesheetPeriodId],
      );
      if (ts.rows.length === 0 || ts.rows[0].status !== 'LOCKED') {
        throw new BadRequestException({
          code: 'HRM_TIMESHEET_NOT_LOCKED',
          message: 'Pre-condition failed: linked timesheet period must be LOCKED before creating payroll period',
        });
      }
    }

    const res = await pool.query(
      `INSERT INTO hrm_schema.payroll_periods (
        tenant_id, period_code, from_date, to_date, timesheet_period_id, payment_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
      RETURNING *`,
      [
        tenantId,
        body.periodCode,
        body.fromDate,
        body.toDate,
        body.timesheetPeriodId || null,
        body.paymentDate,
      ],
    );
    return {
      data: this.mapPeriod(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Payroll Runs (P2_S3_HRM_API.md § 25)
  // --------------------------------------------------------------------------

  @Post('payroll-periods/:periodId/runs')
  async createRun(@Req() req: Request, @Param('periodId') periodId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');

    const lastRun = await pool.query(
      `SELECT COALESCE(MAX(run_no), 0) as last_no FROM hrm_schema.payroll_runs
       WHERE tenant_id = $1 AND payroll_period_id = $2`,
      [tenantId, periodId],
    );
    const nextRunNo = (lastRun.rows[0]?.last_no || 0) + 1;

    const res = await pool.query(
      `INSERT INTO hrm_schema.payroll_runs (
        tenant_id, payroll_period_id, run_no, calculation_version, status
      ) VALUES ($1, $2, $3, 'VN_LABOR_LAW_2026', 'DRAFT')
      RETURNING *`,
      [tenantId, periodId, nextRunNo],
    );
    return {
      data: this.mapRun(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('payroll-runs/:runId')
  async getRun(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payroll_runs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, runId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_RUN_NOT_FOUND', message: 'Payroll run not found' });
    }
    return {
      data: this.mapRun(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('payroll-runs/:runId/calculate')
  async calculateRun(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const runRes = await pool.query(
      `SELECT * FROM hrm_schema.payroll_runs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, runId],
    );
    if (runRes.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_RUN_NOT_FOUND', message: 'Payroll run not found' });
    }

    const run = runRes.rows[0];
    if (run.status === 'FINALIZED') {
      throw new BadRequestException({ code: 'HRM_RUN_FINALIZED', message: 'Finalized run cannot be recalculated' });
    }

    // Set state CALCULATING -> CALCULATED
    await pool.query(
      `UPDATE hrm_schema.payroll_runs SET status = 'CALCULATING', updated_at = now() WHERE id = $1`,
      [runId],
    );

    // Populate standard salary items from active salary profiles
    await pool.query(
      `INSERT INTO hrm_schema.payroll_items (
        tenant_id, payroll_run_id, employee_id, item_code, item_type, description, quantity, rate, amount, source_type
      )
      SELECT
        p.tenant_id, $1, p.employee_id, 'BASE_SALARY', 'EARNING', 'Lương cơ bản theo hợp đồng', 1.0, p.base_salary, p.base_salary, 'SALARY_PROFILE'
      FROM hrm_schema.employee_salary_profiles p
      WHERE p.tenant_id = $2 AND p.status = 'ACTIVE'
      ON CONFLICT DO NOTHING`,
      [runId, tenantId],
    );

    // Aggregate totals
    await pool.query(
      `INSERT INTO hrm_schema.payroll_employee_totals (
        tenant_id, payroll_run_id, employee_id, gross_salary, net_salary, payment_status
      )
      SELECT
        p.tenant_id, $1, p.employee_id, p.base_salary, p.base_salary, 'UNPAID'
      FROM hrm_schema.employee_salary_profiles p
      WHERE p.tenant_id = $2 AND p.status = 'ACTIVE'
      ON CONFLICT (payroll_run_id, employee_id)
      DO UPDATE SET
        gross_salary = EXCLUDED.gross_salary,
        net_salary = EXCLUDED.net_salary,
        updated_at = now()`,
      [runId, tenantId],
    );

    const updated = await pool.query(
      `UPDATE hrm_schema.payroll_runs SET status = 'CALCULATED', calculated_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [runId],
    );

    return {
      data: this.mapRun(updated.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('payroll-runs/:runId/finalize')
  async finalizeRun(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.payroll_runs SET
        status = 'FINALIZED', finalized_by = $3, finalized_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status IN ('CALCULATED', 'APPROVED')
       RETURNING *`,
      [tenantId, runId, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_CANNOT_FINALIZE',
        message: 'Payroll run cannot be finalized: must be in CALCULATED or APPROVED status',
      });
    }
    return {
      data: this.mapRun(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Payroll Items & Adjustments (P2_S3_HRM_API.md § 26)
  // --------------------------------------------------------------------------

  @Get('payroll-runs/:runId/items')
  async listItems(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2`,
      [tenantId, runId],
    );
    return {
      data: res.rows.map(this.mapItem),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('payroll-runs/:runId/adjustments')
  async addAdjustment(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() body: CreatePayrollAdjustmentRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.payroll_items (
        tenant_id, payroll_run_id, employee_id, item_code, item_type, description, quantity, rate, amount, source_type
      ) VALUES ($1, $2, $3, $4, $5, $6, 1.0, $7, $7, 'MANUAL_ADJUSTMENT')
      RETURNING *`,
      [
        tenantId,
        runId,
        body.employeeId,
        body.itemCode,
        body.itemType,
        body.reason,
        body.amount,
      ],
    );
    return {
      data: this.mapItem(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Payslips (P2_S3_HRM_API.md § 27)
  // --------------------------------------------------------------------------

  @Post('payroll-runs/:runId/payslips/generate')
  async generatePayslips(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const totals = await pool.query(
      `SELECT * FROM hrm_schema.payroll_employee_totals WHERE tenant_id = $1 AND payroll_run_id = $2`,
      [tenantId, runId],
    );

    for (const tot of totals.rows) {
      const payslipNo = `PS-${runId.slice(0, 6)}-${tot.employee_id.slice(0, 6)}`;
      await pool.query(
        `INSERT INTO hrm_schema.payslips (
          tenant_id, payroll_run_id, employee_id, payslip_no, status, snapshot_json
        ) VALUES ($1, $2, $3, $4, 'GENERATED', $5)
        ON CONFLICT (tenant_id, payslip_no) DO NOTHING`,
        [tenantId, runId, tot.employee_id, payslipNo, JSON.stringify(tot)],
      );
    }

    return {
      data: { success: true, count: totals.rows.length },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('payroll-runs/:runId/payslips')
  async listPayslips(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payslips WHERE tenant_id = $1 AND payroll_run_id = $2`,
      [tenantId, runId],
    );
    return {
      data: res.rows.map(this.mapPayslip),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  private mapPeriod(row: Record<string, unknown>): HrmPayrollPeriod {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      periodCode: row.period_code as string,
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      timesheetPeriodId: row.timesheet_period_id as string | null,
      paymentDate: String(row.payment_date),
      status: row.status as any,
      lockedAt: row.locked_at ? String(row.locked_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapRun(row: Record<string, unknown>): HrmPayrollRun {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      payrollPeriodId: row.payroll_period_id as string,
      runNo: Number(row.run_no),
      calculationVersion: String(row.calculation_version),
      status: row.status as any,
      reviewerId: row.reviewer_id as string | null,
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
      reviewNotes: row.review_notes as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      rejectedBy: row.rejected_by as string | null,
      rejectionReason: row.rejection_reason as string | null,
      finalizedBy: row.finalized_by as string | null,
      finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
      calculatedAt: row.calculated_at ? String(row.calculated_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapItem(row: Record<string, unknown>): HrmPayrollItem {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      payrollRunId: row.payroll_run_id as string,
      employeeId: row.employee_id as string,
      itemCode: row.item_code as string,
      itemType: row.item_type as any,
      description: row.description as string,
      quantity: Number(row.quantity),
      rate: Number(row.rate),
      amount: Number(row.amount),
      sourceType: row.source_type as string | null,
      sourceId: row.source_id as string | null,
      policyVersionId: row.policy_version_id as string | null,
      calculationSnapshot: (row.calculation_snapshot as Record<string, unknown>) || {},
      createdAt: String(row.created_at),
    };
  }

  private mapPayslip(row: Record<string, unknown>): HrmPayslip {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      payrollRunId: row.payroll_run_id as string,
      employeeId: row.employee_id as string,
      payslipNo: row.payslip_no as string,
      status: row.status as any,
      issuedAt: String(row.issued_at),
      publishedAt: row.published_at ? String(row.published_at) : null,
      fileId: row.file_id as string | null,
      snapshotJson: (row.snapshot_json as Record<string, unknown>) || {},
      createdAt: String(row.created_at),
    };
  }
}
