import {
  assertLifecycleVersion,
  lifecycleAudit,
  timestamp,
} from '../infrastructure/hrm-lifecycle.js';
import { invalidatePayrollRange } from '../infrastructure/hrm-payroll-lifecycle.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import type { PoolClient } from 'pg';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  NotFoundException,
  Patch,
  Delete,
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

function validatePayroll(
  body: Parameters<HrmPayrollSettingsController['save']>[1],
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
}
function validateOvertime(
  body: Parameters<HrmPayrollSettingsController['overtime']>[1],
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
    return {
      data: versions.rows.map((row) => ({
        ...row,
        effective_from: isoDate(row.effective_from),
        effective_to: row.effective_to ? isoDate(row.effective_to) : null,
        updated_at: timestamp(row.updated_at),
      })),
    };
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
    validatePayroll(body);
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
    validateOvertime(body);
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
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status NOT IN ('FINALIZED','CANCELLED')`,
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
        `UPDATE hrm_schema.policy_versions SET effective_to=$2::date-1,status='SUPERSEDED',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE policy_id=$1 AND effective_to IS NULL`,
        [id, date],
      );
      const result = await db.query(
        `INSERT INTO hrm_schema.policy_versions (policy_id,version_no,effective_from,config_json,status,created_by) SELECT $1,COALESCE(max(version_no),0)+1,$2,$3,'ACTIVE',$4 FROM hrm_schema.policy_versions WHERE policy_id=$1 RETURNING *`,
        [id, date, JSON.stringify(config), principal.userId],
      );
      return {
        data: {
          ...result.rows[0],
          updated_at: timestamp(result.rows[0].updated_at),
        },
      };
    });
  }

  private async configVersion(
    db: PoolClient,
    tenant: string,
    id: string,
    expected: string,
  ) {
    const owned = await db.query(
      "SELECT v.*,p.policy_type FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND v.id=$2 AND p.policy_type IN ('PAYROLL','OT')",
      [tenant, id],
    );
    const found = owned.rows[0];
    if (!found)
      throw new NotFoundException('Không tìm thấy phiên bản lương/OT');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'hrm-policy:' + tenant + ':' + found.policy_type,
    ]);
    const result = await db.query(
      'SELECT * FROM hrm_schema.policy_versions WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (!result.rowCount) throw new NotFoundException('Phiên bản đã được xóa');
    const row = { ...result.rows[0], policy_type: found.policy_type };
    assertLifecycleVersion(row, expected);
    return row;
  }
  private async assertUnusedConfiguration(
    db: PoolClient,
    tenant: string,
    row: any,
  ) {
    const used = await db.query(
      'SELECT EXISTS(SELECT 1 FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND policy_version_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND policy_version_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND policy_version_id=$2) AS used',
      [tenant, row.id],
    );
    const newer = await db.query(
      'SELECT id FROM hrm_schema.policy_versions WHERE policy_id=$1 AND version_no>$2',
      [row.policy_id, row.version_no],
    );
    if (used.rows[0].used || newer.rowCount)
      throw new ConflictException(
        'Phiên bản đã được dùng hoặc đã có bản mới; tạo phiên bản tiếp theo để giữ lịch sử',
      );
    await invalidatePayrollRange(
      db,
      tenant,
      isoDate(row.effective_from),
      row.effective_to ? isoDate(row.effective_to) : null,
    );
    if (row.policy_type === 'OT')
      await assertOpenRange(
        db,
        tenant,
        isoDate(row.effective_from),
        row.effective_to ? isoDate(row.effective_to) : null,
      );
  }
  @Patch('payroll-configuration/:id')
  async updateConfiguration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: Parameters<HrmPayrollSettingsController['save']>[1] & {
      reason: string;
      expectedUpdatedAt: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    requireText(body.reason, 'Lý do', 2000);
    const row = await hrmTransaction(pool, async (db) => {
      const before = await this.configVersion(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (body.effectiveFrom !== isoDate(before.effective_from))
        throw new BadRequestException(
          'Giữ ngày bắt đầu hiệu lực; tạo phiên bản mới khi đổi khoảng áp dụng',
        );
      if (before.policy_type === 'PAYROLL') validatePayroll(body);
      else
        validateOvertime(
          body as unknown as Parameters<
            HrmPayrollSettingsController['overtime']
          >[1],
        );
      await this.assertUnusedConfiguration(db, tenantId, before);
      const { reason, expectedUpdatedAt, ...config } = body;
      const result = await db.query(
        "UPDATE hrm_schema.policy_versions SET config_json=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1 RETURNING *",
        [id, JSON.stringify(config)],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_CONFIGURATION_UPDATED',
        id,
        { before, after: result.rows[0], reason },
      );
      return result.rows[0];
    });
    return { data: { ...row, updated_at: timestamp(row.updated_at) } };
  }
  @Delete('payroll-configuration/:id')
  async deleteConfiguration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason: string; expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    requireText(body.reason, 'Lý do', 2000);
    await hrmTransaction(pool, async (db) => {
      const before = await this.configVersion(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      await this.assertUnusedConfiguration(db, tenantId, before);
      await db.query('DELETE FROM hrm_schema.policy_versions WHERE id=$1', [
        id,
      ]);
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_CONFIGURATION_DELETED',
        id,
        { before, reason: body.reason },
      );
    });
    return { data: { id, deleted: true } };
  }
  @Post('payroll-configuration/:id/deactivate')
  async deactivateConfiguration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: { reason: string; expectedUpdatedAt: string; effectiveTo: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    requireText(body.reason, 'Lý do', 2000);
    requireDate(body.effectiveTo, 'Ngày kết thúc');
    const row = await hrmTransaction(pool, async (db) => {
      const before = await this.configVersion(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (
        body.effectiveTo < isoDate(before.effective_from) ||
        before.effective_to
      )
        throw new BadRequestException(
          'Chỉ kết thúc phiên bản đang mở, từ ngày bắt đầu hiệu lực',
        );
      const after = new Date(body.effectiveTo + 'T00:00:00Z');
      after.setUTCDate(after.getUTCDate() + 1);
      const from = after.toISOString().slice(0, 10);
      await invalidatePayrollRange(db, tenantId, from);
      if (before.policy_type === 'OT')
        await assertOpenRange(db, tenantId, from);
      const changed = await db.query(
        "UPDATE hrm_schema.policy_versions SET effective_to=$2,status='SUPERSEDED',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1 RETURNING *",
        [id, body.effectiveTo],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_CONFIGURATION_ENDED',
        id,
        { before, reason: body.reason, effectiveTo: body.effectiveTo },
      );
      return changed.rows[0];
    });
    return { data: { ...row, updated_at: timestamp(row.updated_at) } };
  }
  @Get('employees/:employeeId/payroll-inputs')
  async listInputs(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    requireUuid(employeeId, 'Nhân viên');
    const result = await pool.query(
      'SELECT * FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 ORDER BY effective_from DESC',
      [tenantId, employeeId],
    );
    return {
      data: result.rows.map((row) => ({
        ...row,
        effective_from: isoDate(row.effective_from),
        updated_at: timestamp(row.updated_at),
      })),
    };
  }
  private async changeInputs(
    req: Request,
    employeeId: string,
    date: string,
    body: {
      inputs?: Record<string, number>;
      expectedUpdatedAt: string;
      reason: string;
    },
    remove: boolean,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.payroll.configure',
    );
    requireUuid(employeeId, 'Nhân viên');
    requireDate(date, 'Ngày hiệu lực');
    requireText(body.reason, 'Lý do', 2000);
    if (!remove) validateInputs(body.inputs!);
    return hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const found = await db.query(
        'SELECT * FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 AND effective_from=$3',
        [tenantId, employeeId, date],
      );
      const before = found.rows[0];
      if (!before) throw new NotFoundException('Không tìm thấy bộ tham số');
      assertLifecycleVersion(before, body.expectedUpdatedAt);
      const next = await db.query(
        "SELECT to_char(min(effective_from)-1,'YYYY-MM-DD') AS end FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 AND effective_from>$3",
        [tenantId, employeeId, date],
      );
      await invalidatePayrollRange(db, tenantId, date, next.rows[0].end);
      let changed;
      if (remove)
        await db.query(
          'DELETE FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 AND effective_from=$3',
          [tenantId, employeeId, date],
        );
      else
        changed = (
          await db.query(
            "UPDATE hrm_schema.payroll_employee_inputs SET inputs=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND employee_id=$2 AND effective_from=$3 RETURNING *",
            [tenantId, employeeId, date, JSON.stringify(body.inputs)],
          )
        ).rows[0];
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        remove ? 'PAYROLL_INPUT_DELETED' : 'PAYROLL_INPUT_UPDATED',
        employeeId,
        { before, after: changed, reason: body.reason },
      );
      return {
        data: changed
          ? { ...changed, updated_at: timestamp(changed.updated_at) }
          : { deleted: true },
      };
    });
  }
  @Patch('employees/:employeeId/payroll-inputs/:date')
  updateInputs(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Param('date') date: string,
    @Body()
    body: {
      inputs: Record<string, number>;
      expectedUpdatedAt: string;
      reason: string;
    },
  ) {
    return this.changeInputs(req, employeeId, date, body, false);
  }
  @Delete('employees/:employeeId/payroll-inputs/:date')
  deleteInputs(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Param('date') date: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    return this.changeInputs(req, employeeId, date, body, true);
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
        `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status NOT IN ('FINALIZED','CANCELLED')`,
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
    return {
      data: {
        ...result.rows[0],
        updated_at: timestamp(result.rows[0].updated_at),
      },
    };
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
          `SELECT id,run_no,status,updated_at FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=$2 ORDER BY run_no DESC`,
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
