import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { assertOpenRange, lockEmployee } from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';
import {
  evaluatePayroll,
  type PayrollComponent,
} from '../domain/payroll-formula.js';
import {
  payrollItemTypes,
  payrollSystemInputs,
} from '../infrastructure/hrm-payroll-calculation.js';

function validateInputs(inputs: Record<string, number>) {
  if (
    !inputs ||
    typeof inputs !== 'object' ||
    Array.isArray(inputs) ||
    Object.keys(inputs).length > 100
  )
    throw new BadRequestException('Bộ tham số không hợp lệ');
  for (const [key, value] of Object.entries(inputs))
    if (
      !/^[A-Z][A-Z0-9_]{0,49}$/.test(key) ||
      payrollSystemInputs.includes(key) ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1e12
    )
      throw new BadRequestException(`Tham số không hợp lệ: ${key}`);
}

@Controller('v1')
export class HrmPayrollSettingsController {
  constructor(private readonly ctx: HrmContextService) {}
  @Get('payroll-period-options')
  async periodOptions(@Req() req: Request) {
    const context = await this.ctx.getContext(req, 'hrm.read');
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      this.ctx.has(context, 'hrm.advance.disburse')
        ? 'hrm.advance.disburse'
        : 'hrm.payroll.calculate',
    );
    return {
      data: (
        await pool.query(
          `SELECT id,period_code AS "periodCode",from_date AS "fromDate",to_date AS "toDate",status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND status NOT IN ('LOCKED','PAID') ORDER BY from_date DESC`,
          [tenantId],
        )
      ).rows,
    };
  }
  @Get('payroll-configuration')
  async get(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    const versions = await pool.query(
      `SELECT p.policy_type,v.* FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND p.policy_type IN ('PAYROLL','OT') ORDER BY v.effective_from DESC`,
      [tenantId],
    );
    return { data: versions.rows };
  }
  @Post('payroll-configuration')
  async save(
    @Req() req: Request,
    @Body()
    body: {
      effectiveFrom: string;
      salaryType: 'NET' | 'GROSS';
      components: PayrollComponent[];
      inputs: Record<string, number>;
      standardMinutes?: number;
    },
  ) {
    requireDate(body.effectiveFrom, 'effectiveFrom');
    validateInputs(body.inputs);
    if (
      body.standardMinutes !== undefined &&
      (!Number.isInteger(body.standardMinutes) ||
        body.standardMinutes < 1 ||
        body.standardMinutes > 90720)
    )
      throw new BadRequestException('Định mức phút của kỳ phải từ 1 đến 90720');
    if (
      !['NET', 'GROSS'].includes(body.salaryType) ||
      !Array.isArray(body.components) ||
      body.components.some(
        (c) => !payrollItemTypes.includes(c.type) || !c.name?.trim(),
      )
    )
      throw new BadRequestException('Loại lương hoặc thành phần không hợp lệ');
    if (body.components.filter((c) => c.type === 'NET_PAY').length !== 1)
      throw new BadRequestException('Cần đúng một công thức thực lĩnh');
    try {
      evaluatePayroll(body.components, {
        ...body.inputs,
        ...Object.fromEntries(payrollSystemInputs.map((k) => [k, 1])),
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Công thức không hợp lệ',
      );
    }
    return this.savePolicy(req, 'PAYROLL', body.effectiveFrom, body);
  }
  @Post('ot-configuration')
  async overtime(
    @Req() req: Request,
    @Body()
    body: {
      effectiveFrom: string;
      dailyLimitMinutes: number;
      weeklyLimitMinutes: number;
      monthlyLimitMinutes: number;
      yearlyLimitMinutes: number;
      weekdayRate: number;
      offRate: number;
      holidayRate: number;
      nightRate: number;
      nightOffRate?: number;
      nightHolidayRate?: number;
      nightStartMinute?: number;
      nightEndMinute?: number;
    },
  ) {
    requireDate(body.effectiveFrom, 'effectiveFrom');
    for (const n of [
      body.dailyLimitMinutes,
      body.weeklyLimitMinutes,
      body.monthlyLimitMinutes,
      body.yearlyLimitMinutes,
    ])
      if (!Number.isInteger(n) || n < 0 || n > 525600)
        throw new BadRequestException('Giới hạn OT phải là số phút không âm');
    for (const n of [
      body.weekdayRate,
      body.offRate,
      body.holidayRate,
      body.nightRate,
      ...(body.nightOffRate === undefined ? [] : [body.nightOffRate]),
      ...(body.nightHolidayRate === undefined ? [] : [body.nightHolidayRate]),
    ])
      if (!Number.isFinite(n) || n < 1 || n > 10)
        throw new BadRequestException('Hệ số OT từ 1 đến 10');
    const start = body.nightStartMinute ?? 1320,
      end = body.nightEndMinute ?? 360;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start <= end ||
      start > 1439 ||
      end < 0
    )
      throw new BadRequestException(
        'Khung đêm phải qua 00:00, theo phút từ đầu ngày',
      );
    return this.savePolicy(req, 'OT', body.effectiveFrom, body);
  }
  private async savePolicy(
    req: Request,
    type: 'PAYROLL' | 'OT',
    date: string,
    config: unknown,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    return hrmTransaction(pool, async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `hrm-policy:${tenantId}:${type}`,
      ]);
      const locked = await db.query(
        `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND to_date>=$2::date ORDER BY id FOR UPDATE`,
        [tenantId, date],
      );
      if (locked.rows.some((p) => ['LOCKED', 'PAID'].includes(p.status)))
        throw new BadRequestException(
          'Không đổi chính sách trong kỳ lương đã chốt',
        );
      if (type === 'OT') await assertOpenRange(db, tenantId, date);
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status<>'FINALIZED'`,
        [tenantId, locked.rows.map((p) => p.id)],
      );
      const policy = await db.query(
        `INSERT INTO hrm_schema.policies (tenant_id,code,name,policy_type,created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,code) DO UPDATE SET updated_at=now() RETURNING id`,
        [
          tenantId,
          `${type}_DEFAULT`,
          type === 'OT' ? 'Quy định tăng ca' : 'Công thức lương',
          type,
          principal.userId,
        ],
      );
      const id = policy.rows[0].id;
      const newer = await db.query(
        `SELECT id FROM hrm_schema.policy_versions WHERE policy_id=$1 AND effective_from>=$2::date`,
        [id, date],
      );
      if (newer.rowCount)
        throw new BadRequestException(
          'Ngày hiệu lực phải sau phiên bản đã lưu',
        );
      await db.query(
        `UPDATE hrm_schema.policy_versions SET effective_to=$2::date-1,status='SUPERSEDED' WHERE policy_id=$1 AND effective_to IS NULL`,
        [id, date],
      );
      const result = await db.query(
        `INSERT INTO hrm_schema.policy_versions (policy_id,version_no,effective_from,config_json,status,created_by) SELECT $1,COALESCE(max(version_no),0)+1,$2,$3,'ACTIVE',$4 FROM hrm_schema.policy_versions WHERE policy_id=$1 RETURNING *`,
        [id, date, JSON.stringify(config), principal.userId],
      );
      return { data: result.rows[0] };
    });
  }
  @Post('employees/:employeeId/payroll-inputs')
  async inputs(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: { effectiveFrom: string; inputs: Record<string, number> },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    requireUuid(employeeId, 'employeeId');
    requireDate(body.effectiveFrom, 'effectiveFrom');
    validateInputs(body.inputs);
    const result = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const periods = await db.query(
        `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND to_date>=$2::date ORDER BY id FOR UPDATE`,
        [tenantId, body.effectiveFrom],
      );
      if (periods.rows.some((p) => ['LOCKED', 'PAID'].includes(p.status)))
        throw new BadRequestException(
          'Không đổi tham số trong kỳ lương đã chốt',
        );
      const prior = await db.query(
        `SELECT effective_from FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 AND effective_from >= $3::date`,
        [tenantId, employeeId, body.effectiveFrom],
      );
      if (prior.rowCount)
        throw new BadRequestException(
          'Ngày hiệu lực phải sau bộ tham số đã lưu',
        );
      await db.query(
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status<>'FINALIZED'`,
        [tenantId, periods.rows.map((p) => p.id)],
      );
      return db.query(
        `INSERT INTO hrm_schema.payroll_employee_inputs (tenant_id,employee_id,effective_from,inputs,created_by) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL) RETURNING *`,
        [
          tenantId,
          employeeId,
          body.effectiveFrom,
          JSON.stringify(body.inputs),
          principal.userId,
        ],
      );
    });
    if (!result.rowCount)
      throw new BadRequestException('Không tìm thấy nhân viên');
    return { data: result.rows[0] };
  }
  @Get('payroll-periods/:id/runs')
  async runs(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.read',
    );
    return {
      data: (
        await pool.query(
          `SELECT id,run_no,status FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=$2 ORDER BY run_no DESC`,
          [tenantId, requireUuid(id, 'id')],
        )
      ).rows,
    };
  }
  @Get('payroll-runs/:id/totals')
  async totals(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.read',
    );
    return {
      data: (
        await pool.query(
          `SELECT t.*,e.full_name,e.employee_code FROM hrm_schema.payroll_employee_totals t JOIN hrm_schema.employee_directory e ON e.employee_id=t.employee_id AND e.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.payroll_run_id=$2 ORDER BY e.full_name`,
          [tenantId, requireUuid(id, 'id')],
        )
      ).rows,
    };
  }
  @Post('payroll-totals/:id/record-payment')
  async payment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reference: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.pay',
    );
    requireText(body.reference, 'reference', 180);
    return hrmTransaction(pool, async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `hrm-payments:${tenantId}`,
      ]);
      const prior = await db.query(
        `SELECT * FROM hrm_schema.payroll_employee_totals WHERE tenant_id=$1 AND id=$2`,
        [tenantId, requireUuid(id, 'id')],
      );
      if (
        prior.rows[0]?.payment_status === 'PAID' &&
        prior.rows[0]?.payment_reference === body.reference
      )
        return { data: prior.rows[0] };
      const result = await db.query(
        `UPDATE hrm_schema.payroll_employee_totals t SET payment_status='PAID',payment_reference=$3,paid_at=now() FROM hrm_schema.payroll_runs r WHERE t.payroll_run_id=r.id AND t.tenant_id=r.tenant_id AND t.tenant_id=$1 AND t.id=$2 AND r.status='FINALIZED' AND t.payment_status<>'PAID' RETURNING t.*`,
        [tenantId, id, body.reference],
      );
      if (!result.rowCount)
        throw new BadRequestException(
          'Chỉ ghi nhận một lần cho khoản lương đã chốt',
        );
      await db.query(
        `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'PAYROLL_PAYMENT_RECORDED',$3,$4)`,
        [tenantId, principal.userId, id, JSON.stringify(body)],
      );
      await db.query(
        `UPDATE hrm_schema.payroll_periods p SET status='PAID' FROM hrm_schema.payroll_runs r WHERE p.tenant_id=$1 AND r.tenant_id=p.tenant_id AND r.payroll_period_id=p.id AND r.id=$2 AND r.status='FINALIZED' AND NOT EXISTS(SELECT 1 FROM hrm_schema.payroll_employee_totals t WHERE t.tenant_id=$1 AND t.payroll_run_id=r.id AND t.payment_status<>'PAID')`,
        [tenantId, result.rows[0].payroll_run_id],
      );
      return { data: result.rows[0] };
    });
  }
}
