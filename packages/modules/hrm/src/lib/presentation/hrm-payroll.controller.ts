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
import { randomUUID } from 'node:crypto';
import { calculatePayroll } from '../infrastructure/hrm-payroll-calculation.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmCsv } from '../domain/hrm-csv.js';
import {
  assertLifecycleVersion,
  lifecycleAudit,
  timestamp,
} from '../infrastructure/hrm-lifecycle.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { lockEmptyPayrollPeriod } from '../infrastructure/hrm-payroll-lifecycle.js';
import {
  assertPayrollSod,
  recordPayrollActor,
} from '../infrastructure/hrm-payroll-sod.js';
import { payslipPublishedEvent } from '../infrastructure/hrm-notification-events.js';

@Controller('v1')
export class HrmPayrollController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get('payroll-runs/:runId/export')
  async exportRun(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Query('kind') kind = 'payments',
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.export',
    );
    requireUuid(runId, 'Lần tính lương');
    if (!['payments', 'reconciliation'].includes(kind))
      throw new BadRequestException('Loại xuất không hợp lệ');
    return hrmTransaction(pool, async (db) => {
      const run = (
        await db.query(
          `SELECT r.status,p.period_code FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2 FOR SHARE OF r,p`,
          [tenantId, runId],
        )
      ).rows[0];
      if (!run) throw new NotFoundException('Không tìm thấy lần tính lương');
      if (run.status !== 'FINALIZED')
        throw new BadRequestException(
          'Chỉ xuất chi trả/đối soát từ lần lương đã chốt',
        );
      let csv: string;
      if (kind === 'payments') {
        const totals = (
          await db.query(
            `SELECT * FROM hrm_schema.payroll_employee_totals WHERE tenant_id=$1 AND payroll_run_id=$2 ORDER BY employee_id`,
            [tenantId, runId],
          )
        ).rows;
        if (
          totals.some(
            (t) =>
              !t.beneficiary_snapshot?.bank_account_number ||
              !t.beneficiary_snapshot?.bank_name,
          )
        )
          throw new BadRequestException(
            'Thiếu thông tin ngân hàng trong snapshot lương; kiểm tra hồ sơ và tính lại trước khi chốt. Lần lương cũ chưa có snapshot chỉ xuất đối soát',
          );
        csv = hrmCsv([
          [
            'Kỳ',
            'Mã NV',
            'Người thụ hưởng',
            'Ngân hàng',
            'Chi nhánh',
            'Tài khoản',
            'Tiền tệ',
            'Thực lĩnh',
            'Trạng thái thanh toán',
            'Tham chiếu chi trả',
          ],
          ...totals.map((t) => [
            run.period_code,
            t.beneficiary_snapshot.employee_code,
            t.beneficiary_snapshot.full_name,
            t.beneficiary_snapshot.bank_name,
            t.beneficiary_snapshot.bank_branch,
            t.beneficiary_snapshot.bank_account_number,
            'VND',
            t.net_salary,
            t.payment_status,
            t.payment_reference,
          ]),
        ]);
      } else {
        const items = (
          await db.query(
            `SELECT i.*,t.beneficiary_snapshot FROM hrm_schema.payroll_items i LEFT JOIN hrm_schema.payroll_employee_totals t ON t.tenant_id=i.tenant_id AND t.payroll_run_id=i.payroll_run_id AND t.employee_id=i.employee_id WHERE i.tenant_id=$1 AND i.payroll_run_id=$2 ORDER BY i.employee_id,i.item_code`,
            [tenantId, runId],
          )
        ).rows;
        csv = hrmCsv([
          [
            'Kỳ',
            'Lần tính',
            'ID nhân viên',
            'Mã NV',
            'Nhân viên',
            'Mã khoản',
            'Loại khoản',
            'Diễn giải',
            'Số tiền',
            'Nguồn',
          ],
          ...items.map((i) => [
            run.period_code,
            runId,
            i.employee_id,
            i.beneficiary_snapshot?.employee_code,
            i.beneficiary_snapshot?.full_name,
            i.item_code,
            i.item_type,
            i.description,
            i.amount,
            i.source_type,
          ]),
        ]);
      }
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'PAYROLL_EXPORT','payroll_run',$3,$4)`,
        [tenantId, principal.userId, runId, JSON.stringify({ kind })],
      );
      return {
        data: {
          filename: `${run.period_code.replace(/[^a-zA-Z0-9_-]/g, '_')}-${kind}.csv`,
          csv,
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // Payroll Periods (P2_S3_HRM_API.md § 24)
  // --------------------------------------------------------------------------

  @Get('payroll-periods')
  async listPeriods(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payroll_periods WHERE tenant_id = $1 ORDER BY from_date DESC`,
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

  @Post('payroll-periods')
  async createPeriod(
    @Req() req: Request,
    @Body() body: CreatePayrollPeriodRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.calculate',
    );

    requireDate(body.fromDate, 'fromDate');
    requireDate(body.toDate, 'toDate');
    requireDate(body.paymentDate, 'paymentDate');
    requireText(body.periodCode, 'periodCode', 50);
    if (!body.timesheetPeriodId || body.toDate < body.fromDate)
      throw new BadRequestException('Cần liên kết kỳ công hợp lệ');
    // Verify timesheet period status if linked
    if (body.timesheetPeriodId) {
      const ts = await pool.query(
        `SELECT status,from_date,to_date FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, body.timesheetPeriodId],
      );
      if (
        ts.rows.length === 0 ||
        ts.rows[0].status !== 'LOCKED' ||
        isoDate(ts.rows[0].from_date) !== body.fromDate ||
        isoDate(ts.rows[0].to_date) !== body.toDate
      ) {
        throw new BadRequestException({
          code: 'HRM_TIMESHEET_NOT_LOCKED',
          message:
            'Pre-condition failed: linked timesheet period must be LOCKED before creating payroll period',
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

  @Patch('payroll-periods/:id')
  async updatePeriod(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      periodCode?: string;
      paymentDate?: string;
      expectedUpdatedAt: string;
      reason: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.calculate',
    );
    requireText(body.reason, 'Lý do', 2000);
    const row = await hrmTransaction(pool, async (db) => {
      const before = await lockEmptyPayrollPeriod(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      const code = requireText(
          body.periodCode ?? before.period_code,
          'Mã kỳ',
          50,
        ),
        payment = requireDate(
          body.paymentDate ?? isoDate(before.payment_date),
          'Ngày chi trả',
        );
      const duplicate = await db.query(
        'SELECT id FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id<>$2 AND period_code=$3',
        [tenantId, id, code],
      );
      if (duplicate.rowCount)
        throw new ConflictException('Mã kỳ lương đã tồn tại');
      const changed = await db.query(
        `UPDATE hrm_schema.payroll_periods SET period_code=$3,payment_date=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, code, payment],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_PERIOD_UPDATED',
        id,
        { before, after: changed.rows[0], reason: body.reason },
      );
      return changed.rows[0];
    });
    return { data: this.mapPeriod(row) };
  }

  @Delete('payroll-periods/:id')
  async deletePeriod(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.calculate',
    );
    requireText(body.reason, 'Lý do', 2000);
    await hrmTransaction(pool, async (db) => {
      const before = await lockEmptyPayrollPeriod(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      await db.query(
        'DELETE FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_PERIOD_DELETED',
        id,
        { before, reason: body.reason },
      );
    });
    return { data: { id, deleted: true } };
  }

  @Post('payroll-runs/:runId/cancel')
  async cancelRun(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.calculate',
    );
    requireText(body.reason, 'Lý do hủy', 2000);
    const row = await hrmTransaction(pool, async (db) => {
      const result = await db.query(
        `SELECT r.*,p.status AS period_status FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.tenant_id=r.tenant_id AND p.id=r.payroll_period_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF p,r`,
        [tenantId, runId],
      );
      const before = result.rows[0];
      if (!before) throw new NotFoundException('Không tìm thấy lần tính lương');
      if (before.status === 'CANCELLED' && before.cancel_reason === body.reason)
        return before;
      assertLifecycleVersion(before, body.expectedUpdatedAt);
      if (
        ['FINALIZED', 'CANCELLED'].includes(before.status) ||
        ['LOCKED', 'PAID'].includes(before.period_status)
      )
        throw new ConflictException(
          'Không hủy lần tính thuộc kỳ đã chốt hoặc đã hủy',
        );
      const changed = await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='CANCELLED',cancelled_by=$3,cancelled_at=now(),cancel_reason=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, runId, principal.userId, body.reason],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_RUN_CANCELLED',
        runId,
        { before, reason: body.reason },
      );
      return changed.rows[0];
    });
    return { data: this.mapRun(row) };
  }

  @Post('payroll-periods/:periodId/runs')
  async createRun(@Req() req: Request, @Param('periodId') periodId: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.calculate',
    );

    const res = await hrmTransaction(pool, async (db) => {
      const period = await db.query(
        `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, periodId],
      );
      if (!period.rows[0] || ['LOCKED', 'PAID'].includes(period.rows[0].status))
        throw new BadRequestException('Kỳ lương không tồn tại hoặc đã chốt');
      return db.query(
        `INSERT INTO hrm_schema.payroll_runs (tenant_id,payroll_period_id,run_no,calculation_version,status) SELECT $1,$2,COALESCE(max(run_no),0)+1,'HRM_FORMULA_V1','DRAFT' FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=$2 RETURNING *`,
        [tenantId, periodId],
      );
    });
    return {
      data: this.mapRun(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('payroll-runs/:runId')
  async getRun(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payroll_runs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, runId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_RUN_NOT_FOUND',
        message: 'Payroll run not found',
      });
    }
    return {
      data: this.mapRun(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @RequirePermission('hrm.payroll.calculate')
  @Post('payroll-runs/:runId/calculate')
  async calculateRun(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.calculate',
    );
    const row = await hrmTransaction(pool, async (db) => {
      const calculated = await calculatePayroll(db, tenantId, runId);
      await recordPayrollActor(
        db,
        tenantId,
        runId,
        'calculated_by',
        principal.userId,
      );
      return calculated;
    });
    return { data: this.mapRun(row) };
  }

  @RequirePermission('hrm.payroll.finalize')
  @Post('payroll-runs/:runId/finalize')
  async finalizeRun(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.finalize',
    );
    const res = await hrmTransaction(pool, async (db) => {
      const current = await db.query(
        `SELECT r.*,p.timesheet_period_id FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF p,r`,
        [tenantId, runId],
      );
      const run = current.rows[0];
      if (!run) throw new NotFoundException('Không tìm thấy lần lương');
      if (run.status === 'FINALIZED') return current;
      if (!['CALCULATED', 'APPROVED'].includes(run.status))
        throw new BadRequestException(
          'Cần tính và rà soát trước khi chốt lương',
        );
      await assertPayrollSod(db, tenantId, runId, 'finalize', principal.userId);
      const prior = await db.query(
        `SELECT id FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=$2 AND status='FINALIZED'`,
        [tenantId, run.payroll_period_id],
      );
      if (prior.rowCount)
        throw new BadRequestException('Kỳ này đã có lần lương được chốt');
      const ts = await db.query(
        `SELECT status FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
        [tenantId, run.timesheet_period_id],
      );
      if (ts.rows[0]?.status !== 'LOCKED')
        throw new BadRequestException(
          'Bảng công đã mở lại; cần tính lại lương',
        );
      const advances = await db.query(
        `SELECT d.*,a.remaining_balance FROM hrm_schema.salary_advance_deductions d JOIN hrm_schema.salary_advance_requests a ON a.id=d.advance_request_id AND a.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND d.payroll_period_id=$2 AND d.status='SCHEDULED'
           AND EXISTS(SELECT 1 FROM hrm_schema.payroll_employee_totals t WHERE t.tenant_id=d.tenant_id AND t.payroll_run_id=$3 AND t.employee_id=a.employee_id)
         ORDER BY a.id FOR UPDATE OF d,a`,
        [tenantId, run.payroll_period_id, runId],
      );
      // Chỉ thu hồi ứng cho nhân viên có trong lần tính này: khoản của người không nằm trong lần tính chưa bị trừ
      // vào lương nên giữ nguyên SCHEDULED để xử lý ở kỳ sau, không được ghi giảm nợ.
      for (const deduction of advances.rows) {
        const updated = await db.query(
          `UPDATE hrm_schema.salary_advance_requests SET status=CASE WHEN remaining_balance=$3 THEN 'REPAID' ELSE status END,remaining_balance=remaining_balance-$3,total_deducted_amount=total_deducted_amount+$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND remaining_balance>=$3 RETURNING id`,
          [tenantId, deduction.advance_request_id, deduction.scheduled_amount],
        );
        if (!updated.rowCount)
          throw new BadRequestException('Lịch thu hồi vượt dư nợ ứng lương');
        await db.query(
          `UPDATE hrm_schema.salary_advance_deductions SET status='DEDUCTED',actual_deducted_amount=scheduled_amount,payroll_run_id=$3,deducted_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tenantId, deduction.id, runId],
        );
      }
      // Khoản thu hồi phép đã nằm trong lần lương này thì chuyển sang đã khấu trừ.
      await db.query(
        `UPDATE hrm_schema.leave_settlements s SET status='DEDUCTED',payroll_run_id=$3,updated_at=now()
         WHERE s.tenant_id=$1 AND s.payroll_period_id=$2 AND s.status='SCHEDULED'
           AND EXISTS(SELECT 1 FROM hrm_schema.payroll_items i WHERE i.tenant_id=s.tenant_id AND i.payroll_run_id=$3 AND i.source_type='LEAVE_RECOVERY' AND i.source_id=s.id)`,
        [tenantId, run.payroll_period_id, runId],
      );
      await db.query(
        `UPDATE hrm_schema.payroll_periods SET status='LOCKED',locked_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, run.payroll_period_id],
      );
      return db.query(
        `UPDATE hrm_schema.payroll_runs SET status='FINALIZED',finalized_by=$3,finalized_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, runId, principal.userId],
      );
    });
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
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2`,
      [tenantId, runId],
    );
    return {
      data: res.rows.map(this.mapItem),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('payroll-runs/:runId/adjustments')
  async addAdjustment(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() body: CreatePayrollAdjustmentRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.adjust',
    );
    if (body.operationId) requireUuid(body.operationId, 'operationId');
    requireText(body.reason, 'reason', 2000);
    requireText(body.itemCode, 'itemCode', 50);
    if (
      !['EARNING', 'OTHER_DEDUCTION'].includes(body.itemType) ||
      !Number.isFinite(body.amount) ||
      body.amount < 0
    )
      throw new BadRequestException(
        'Điều chỉnh hỗ trợ khoản thu nhập/khấu trừ bổ sung không âm',
      );
    const res = await hrmTransaction(pool, async (db) => {
      const run = await db.query(
        `SELECT r.status,p.status AS period_status FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.tenant_id=r.tenant_id AND p.id=r.payroll_period_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF p,r`,
        [tenantId, runId],
      );
      if (['LOCKED', 'PAID'].includes(run.rows[0]?.period_status))
        throw new ConflictException('Kỳ lương đã khóa');
      if (body.operationId) {
        const prior = await db.query(
          `SELECT * FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND source_type='MANUAL_ADJUSTMENT' AND calculation_snapshot->>'operationId'=$3`,
          [tenantId, runId, body.operationId],
        );
        const previous = prior.rows[0];
        if (previous) {
          if (
            previous.employee_id !== body.employeeId ||
            previous.item_code !== body.itemCode ||
            previous.item_type !== body.itemType ||
            Number(previous.amount) !== body.amount ||
            previous.description !== body.reason
          )
            throw new BadRequestException(
              'Mã thao tác đã dùng cho nội dung điều chỉnh khác',
            );
          return prior;
        }
      }
      if (
        !run.rows[0] ||
        ['FINALIZED', 'APPROVED', 'CANCELLED'].includes(run.rows[0].status)
      )
        throw new BadRequestException('Lần lương không được điều chỉnh');
      const employee = await db.query(
        `SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL`,
        [tenantId, body.employeeId],
      );
      if (!employee.rowCount)
        throw new NotFoundException('Không tìm thấy nhân viên');
      const changed = await db.query(
        `INSERT INTO hrm_schema.payroll_items (
        tenant_id, payroll_run_id, employee_id, item_code, item_type, description, quantity, rate, amount, source_type, calculation_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6, 1.0, $7, $7, 'MANUAL_ADJUSTMENT', $8)
      RETURNING *`,
        [
          tenantId,
          runId,
          body.employeeId,
          body.itemCode,
          body.itemType,
          body.reason,
          body.amount,
          JSON.stringify({ operationId: body.operationId ?? null }),
        ],
      );
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND id=$2`,
        [tenantId, runId],
      );
      return changed;
    });
    return {
      data: this.mapItem(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('payroll-adjustments/:id')
  async updateAdjustment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { amount: number; reason: string; expectedUpdatedAt: string },
  ) {
    if (!Number.isFinite(body.amount) || body.amount < 0)
      throw new BadRequestException('Số tiền không hợp lệ');
    return this.changeAdjustment(req, id, body, false);
  }

  @Delete('payroll-adjustments/:id')
  async deleteAdjustment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason: string; expectedUpdatedAt: string },
  ) {
    return this.changeAdjustment(req, id, body, true);
  }

  private async changeAdjustment(
    req: Request,
    id: string,
    body: { amount?: number; reason: string; expectedUpdatedAt: string },
    remove: boolean,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.adjust',
    );
    requireUuid(id, 'id');
    const reason = requireText(body.reason, 'Lý do', 2000);
    return hrmTransaction(pool, async (db) => {
      const identity = (
        await db.query(
          'SELECT payroll_run_id FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND id=$2',
          [tenantId, id],
        )
      ).rows[0];
      if (!identity)
        throw new NotFoundException('Không tìm thấy khoản điều chỉnh');
      const run = (
        await db.query(
          'SELECT r.*,p.status AS period_status FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.tenant_id=r.tenant_id AND p.id=r.payroll_period_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF p,r',
          [tenantId, identity.payroll_run_id],
        )
      ).rows[0];
      if (
        ['LOCKED', 'PAID'].includes(run.period_status) ||
        ['FINALIZED', 'APPROVED', 'CANCELLED'].includes(run.status)
      )
        throw new ConflictException(
          'Lần tính hoặc kỳ lương không được điều chỉnh',
        );
      const before = (
        await db.query(
          'SELECT * FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      if (!before) throw new NotFoundException('Khoản đã bị xóa');
      assertLifecycleVersion(before, body.expectedUpdatedAt);
      if (before.source_type !== 'MANUAL_ADJUSTMENT')
        throw new ConflictException(
          'Chỉ sửa khoản điều chỉnh thủ công; khoản tự động cần sửa đầu vào và tính lại',
        );
      let after;
      if (remove)
        await db.query(
          'DELETE FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND id=$2',
          [tenantId, id],
        );
      else
        after = (
          await db.query(
            "UPDATE hrm_schema.payroll_items SET amount=$3,rate=$3,description=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [tenantId, id, body.amount, reason],
          )
        ).rows[0];
      await db.query(
        "UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2",
        [tenantId, run.id],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        remove ? 'PAYROLL_ADJUSTMENT_DELETED' : 'PAYROLL_ADJUSTMENT_UPDATED',
        id,
        { reason, before, after },
      );
      return { data: after ? this.mapItem(after) : { deleted: true } };
    });
  }

  // --------------------------------------------------------------------------
  // Payslips (P2_S3_HRM_API.md § 27)
  // --------------------------------------------------------------------------

  @RequirePermission('hrm.payroll.publish')
  @Post('payroll-runs/:runId/payslips/generate')
  async generatePayslips(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.publish',
    );
    const count = await hrmTransaction(pool, async (db) => {
      const run = await db.query(
        `SELECT payroll_run.status,period.period_code
           FROM hrm_schema.payroll_runs payroll_run
           JOIN hrm_schema.payroll_periods period
             ON period.tenant_id=payroll_run.tenant_id
            AND period.id=payroll_run.payroll_period_id
          WHERE payroll_run.tenant_id=$1 AND payroll_run.id=$2
          FOR UPDATE OF payroll_run`,
        [tenantId, runId],
      );
      if (run.rows[0]?.status !== 'FINALIZED')
        throw new BadRequestException(
          'Chỉ phát hành phiếu lương từ lần đã chốt',
        );
      await assertPayrollSod(db, tenantId, runId, 'publish', principal.userId);
      await recordPayrollActor(
        db,
        tenantId,
        runId,
        'published_by',
        principal.userId,
      );
      const totals = await db.query(
        `SELECT t.*,e.full_name,e.employee_code,e.user_id
           FROM hrm_schema.payroll_employee_totals t
           JOIN hrm_schema.employee_directory e
             ON e.tenant_id=t.tenant_id AND e.employee_id=t.employee_id
          WHERE t.tenant_id=$1 AND t.payroll_run_id=$2`,
        [tenantId, runId],
      );
      const runInfo = await db.query(
        `SELECT r.run_no, p.period_code, p.from_date, p.to_date, p.payment_date 
         FROM hrm_schema.payroll_runs r 
         JOIN hrm_schema.payroll_periods p ON p.id = r.payroll_period_id AND p.tenant_id = r.tenant_id 
         WHERE r.tenant_id = $1 AND r.id = $2`,
        [tenantId, runId],
      );
      const periodMeta = runInfo.rows[0];

      for (const total of totals.rows) {
        const existing = await db.query(
          `SELECT id FROM hrm_schema.payslips WHERE tenant_id=$1 AND payroll_run_id=$2 AND employee_id=$3`,
          [tenantId, runId, total.employee_id],
        );
        if (existing.rowCount) continue;
        const items = await db.query(
          `SELECT item_code,item_type,description,amount,calculation_snapshot FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND employee_id=$3 ORDER BY created_at`,
          [tenantId, runId, total.employee_id],
        );
        // Query employee salary profile segments across the period
        const salaryProfiles = await db.query(
          `SELECT id, salary_type, base_salary, currency, effective_from, effective_to 
           FROM hrm_schema.employee_salary_profiles 
           WHERE tenant_id = $1 AND employee_id = $2 AND status IN ('ACTIVE', 'SUPERSEDED')
             AND effective_from <= $4::date AND (effective_to IS NULL OR effective_to >= $3::date)
           ORDER BY effective_from ASC`,
          [tenantId, total.employee_id, periodMeta?.from_date, periodMeta?.to_date],
        );

        const payslip = await db.query(
          `INSERT INTO hrm_schema.payslips
            (tenant_id,payroll_run_id,employee_id,payslip_no,status,snapshot_json,published_at)
           VALUES ($1,$2,$3,$4,'PUBLISHED',$5,now())
           RETURNING id`,
          [
            tenantId,
            runId,
            total.employee_id,
            `PS-${randomUUID()}`,
            JSON.stringify({
              period: periodMeta
                ? {
                    periodCode: periodMeta.period_code,
                    fromDate: isoDate(periodMeta.from_date),
                    toDate: isoDate(periodMeta.to_date),
                    paymentDate: isoDate(periodMeta.payment_date),
                    runNo: periodMeta.run_no,
                  }
                : undefined,
              total,
              salaryProfiles: salaryProfiles.rows.map((sp) => ({
                baseSalary: Number(sp.base_salary),
                currency: sp.currency,
                salaryType: sp.salary_type,
                effectiveFrom: isoDate(sp.effective_from),
                effectiveTo: sp.effective_to ? isoDate(sp.effective_to) : null,
              })),
              items: items.rows,
            }),
          ],
        );
        if (total.user_id) {
          const event = payslipPublishedEvent({
            tenantId,
            userId: total.user_id,
            employeeId: total.employee_id,
            payslipId: payslip.rows[0].id,
            payrollRunId: runId,
            periodLabel: run.rows[0].period_code,
            actorUserId: principal.userId,
          });
          await db.query(
            `INSERT INTO integration_schema.outbox_events
              (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
             VALUES ($1,'hrm-payslip',$2,$3,$4,$5::jsonb,$6::timestamptz)`,
            [
              event.id,
              event.correlationId,
              event.type,
              event.version,
              JSON.stringify(event),
              event.occurredAt,
            ],
          );
        }
      }
      return totals.rowCount;
    });
    return { data: { success: true, count } };
  }

  @Get('my-payslips')
  async myPayslips(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.payslip',
    );
    const employee = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const result = await pool.query(
      `SELECT * FROM hrm_schema.payslips WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PUBLISHED','VIEWED','DOWNLOADED') ORDER BY issued_at DESC`,
      [tenantId, employee.employeeId],
    );
    return { data: result.rows.map(this.mapPayslip) };
  }

  @Get('payroll-runs/:runId/payslips')
  async listPayslips(@Req() req: Request, @Param('runId') runId: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.payslips WHERE tenant_id = $1 AND payroll_run_id = $2`,
      [tenantId, runId],
    );
    return {
      data: res.rows.map(this.mapPayslip),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  private mapPeriod(row: Record<string, unknown>): HrmPayrollPeriod {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      periodCode: row.period_code as string,
      fromDate: isoDate(row.from_date),
      toDate: isoDate(row.to_date),
      timesheetPeriodId: row.timesheet_period_id as string | null,
      paymentDate: isoDate(row.payment_date),
      status: row.status as any,
      lockedAt: row.locked_at ? String(row.locked_at) : null,
      createdAt: String(row.created_at),
      updatedAt: timestamp(row.updated_at),
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
      updatedAt: timestamp(row.updated_at),
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
      calculationSnapshot:
        (row.calculation_snapshot as Record<string, unknown>) || {},
      createdAt: String(row.created_at),
      updatedAt: timestamp(row.updated_at),
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
