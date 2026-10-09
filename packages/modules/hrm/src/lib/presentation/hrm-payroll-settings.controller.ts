import {
  assertLifecycleVersion,
  lifecycleAudit,
  timestamp,
} from '../infrastructure/hrm-lifecycle.js';
import { invalidatePayrollRange } from '../infrastructure/hrm-payroll-lifecycle.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import {
  publishPolicyVersion,
  reopenPreviousVersion,
  todayInVietnam,
} from '../infrastructure/hrm-policy-versions.js';
import type { PoolClient } from 'pg';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
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
import { dryRunPayroll } from '../domain/payroll-dry-run.js';

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
  // Hệ số OT khai báo ở Danh mục đơn từ (Loại OT); chính sách chỉ giữ giới hạn giờ và khung đêm.
  for (const n of [
    body.weekdayRate,
    body.offRate,
    body.holidayRate,
    body.nightRate,
    body.nightOffRate,
    body.nightHolidayRate,
  ])
    if (n !== undefined && (!Number.isFinite(n) || n < 1 || n > 10))
      throw new BadRequestException('Hệ số OT từ 1 đến 10');
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
      `SELECT p.policy_type,v.*,
        (EXISTS(SELECT 1 FROM hrm_schema.payroll_items i WHERE i.tenant_id=p.tenant_id AND i.policy_version_id=v.id)
          OR EXISTS(SELECT 1 FROM hrm_schema.ot_requests o WHERE o.tenant_id=p.tenant_id AND o.policy_version_id=v.id)
          OR EXISTS(SELECT 1 FROM hrm_schema.leave_accrual_schedules l WHERE l.tenant_id=p.tenant_id AND l.policy_version_id=v.id)) AS used,
        EXISTS(SELECT 1 FROM hrm_schema.payroll_items i JOIN hrm_schema.payroll_runs r ON r.id=i.payroll_run_id AND r.tenant_id=i.tenant_id WHERE i.tenant_id=p.tenant_id AND i.policy_version_id=v.id AND r.status='FINALIZED') AS used_by_finalized
       FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND p.policy_type IN ('PAYROLL','OT') ORDER BY v.effective_from DESC`,
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
  /** FIX-C-11: kỳ lương đã tính, dùng làm dữ liệu nguồn để tính thử (chỉ đọc). */
  private async dryRunContext(req: Request) {
    const context = await this.ctx.getContext(req, 'hrm.payroll.configure');
    if (!this.ctx.has(context, 'hrm.payroll.read'))
      throw new ForbiddenException(
        'Tính thử dùng dữ liệu lương thật nên cần thêm quyền xem lương',
      );
    return context;
  }
  @Get('payroll-dry-run/runs')
  async dryRunRuns(@Req() req: Request) {
    const { pool, tenantId } = await this.dryRunContext(req);
    return {
      data: (
        await pool.query(
          `SELECT r.id,r.run_no AS "runNo",r.status,p.period_code AS "periodCode",p.from_date AS "fromDate",p.to_date AS "toDate" FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.status IN ('CALCULATED','APPROVED','FINALIZED') ORDER BY p.from_date DESC,r.run_no DESC LIMIT 36`,
          [tenantId],
        )
      ).rows,
    };
  }
  @Get('payroll-dry-run/runs/:id/employees')
  async dryRunEmployees(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.dryRunContext(req);
    return {
      data: (
        await pool.query(
          `SELECT t.employee_id AS "employeeId",e.full_name AS "fullName",e.employee_code AS "employeeCode" FROM hrm_schema.payroll_employee_totals t JOIN hrm_schema.employee_directory e ON e.employee_id=t.employee_id AND e.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.payroll_run_id=$2 ORDER BY e.full_name`,
          [tenantId, requireUuid(id, 'id')],
        )
      ).rows,
    };
  }
  /** Tính thử: dùng biến hệ thống đã chốt trong kỳ đã tính, KHÔNG ghi dữ liệu. */
  @Post('payroll-dry-run')
  async dryRun(
    @Req() req: Request,
    @Body()
    body: {
      runId: string;
      employeeIds: string[];
      components: PayrollComponent[];
      inputs: Record<string, number>;
    },
  ) {
    const { pool, tenantId } = await this.dryRunContext(req);
    requireUuid(body.runId, 'Kỳ lương');
    if (
      !Array.isArray(body.employeeIds) ||
      body.employeeIds.length < 1 ||
      body.employeeIds.length > 3
    )
      throw new BadRequestException('Chọn từ 1 đến 3 nhân viên để tính thử');
    body.employeeIds.forEach((e) => requireUuid(e, 'Nhân viên'));
    validateInputs(body.inputs);
    if (
      !Array.isArray(body.components) ||
      body.components.some(
        (c) => !payrollItemTypes.includes(c.type) || !c.name?.trim(),
      ) ||
      body.components.filter((c) => c.type === 'NET_PAY').length !== 1
    )
      throw new BadRequestException(
        'Thành phần không hợp lệ hoặc thiếu đúng một công thức thực lĩnh',
      );
    const run = (
      await pool.query(
        `SELECT r.id,p.from_date FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2 AND r.status IN ('CALCULATED','APPROVED','FINALIZED')`,
        [tenantId, body.runId],
      )
    ).rows[0];
    if (!run)
      throw new NotFoundException('Chỉ tính thử trên kỳ lương đã được tính');
    const results = [];
    for (const employeeId of body.employeeIds) {
      const snapshot = (
        await pool.query(
          `SELECT i.calculation_snapshot->'inputs' AS inputs,e.full_name,e.employee_code FROM hrm_schema.payroll_items i JOIN hrm_schema.employee_directory e ON e.employee_id=i.employee_id AND e.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.payroll_run_id=$2 AND i.employee_id=$3 AND i.source_type='FORMULA' LIMIT 1`,
          [tenantId, body.runId, employeeId],
        )
      ).rows[0];
      if (!snapshot?.inputs)
        throw new NotFoundException(
          'Nhân viên không có dữ liệu tính lương trong kỳ đã chọn',
        );
      const custom = (
        await pool.query(
          `SELECT inputs FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 AND effective_from<=$3::date ORDER BY effective_from DESC LIMIT 1`,
          [tenantId, employeeId, isoDate(run.from_date)],
        )
      ).rows[0]?.inputs as Record<string, number> | undefined;
      const system = Object.fromEntries(
        Object.entries(snapshot.inputs as Record<string, number | string>).filter(
          ([k]) => payrollSystemInputs.includes(k),
        ),
      );
      try {
        results.push({
          employeeId,
          fullName: snapshot.full_name,
          employeeCode: snapshot.employee_code,
          ...dryRunPayroll(
            body.components,
            system,
            { ...body.inputs, ...(custom ?? {}) },
            payrollSystemInputs,
          ),
        });
      } catch (error) {
        throw new BadRequestException(
          `Công thức không tính được cho ${snapshot.full_name}: ${error instanceof Error ? error.message : 'không hợp lệ'}`,
        );
      }
    }
    return { data: results };
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
      reason: string;
    },
  ) {
    validatePayroll(body);
    requireText(body.reason, 'Lý do', 2000);
    // config_json chỉ giữ cấu hình; lý do vào nhật ký, ngày hiệu lực vào cột effective_from.
    const { reason, effectiveFrom, ...config } = body;
    return this.savePolicy(req, 'PAYROLL', effectiveFrom, config, reason);
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
      weekdayRate?: number;
      offRate?: number;
      holidayRate?: number;
      nightRate?: number;
      nightOffRate?: number;
      nightHolidayRate?: number;
      nightStartMinute?: number;
      nightEndMinute?: number;
      reason: string;
    },
  ) {
    validateOvertime(body);
    requireText(body.reason, 'Lý do', 2000);
    const { reason, effectiveFrom, ...config } = body;
    return this.savePolicy(req, 'OT', effectiveFrom, config, reason);
  }
  private async savePolicy(
    req: Request,
    type: 'PAYROLL' | 'OT',
    date: string,
    config: Record<string, unknown>,
    reason: string,
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
      const published = await publishPolicyVersion(db, tenantId, type, {
        effectiveFrom: date,
        config,
        reason: reason.trim(),
        actorId: principal.userId,
        defaultCode: `${type}_DEFAULT`,
        defaultName: type === 'OT' ? 'Quy định tăng ca' : 'Công thức lương',
        touchUpdatedAt: true,
        skipPeriodGuard: true,
      });
      return {
        data: {
          ...published.version,
          updated_at: timestamp(published.version.updated_at),
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
    forDelete = false,
  ) {
    const used = await db.query(
      'SELECT EXISTS(SELECT 1 FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND policy_version_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND policy_version_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND policy_version_id=$2) AS used',
      [tenant, row.id],
    );
    const newer = forDelete
      ? { rowCount: 0 } // delete: reopenPreviousVersion reports the exact newer versions
      : await db.query(
          'SELECT id FROM hrm_schema.policy_versions WHERE policy_id=$1 AND version_no>$2',
          [row.policy_id, row.version_no],
        );
    if (used.rows[0].used)
      throw new ConflictException(
        'Phiên bản đã được kỳ lương/OT/phép tham chiếu; tạo phiên bản tiếp theo để giữ lịch sử',
      );
    if (newer.rowCount)
      throw new ConflictException(
        'Phiên bản đã có bản mới; tạo phiên bản tiếp theo để giữ lịch sử',
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
    // Lý do, mốc khóa lạc quan và ngày hiệu lực không thuộc config_json.
    const { reason, expectedUpdatedAt, effectiveFrom, ...config } = body;
    const row = await hrmTransaction(pool, async (db) => {
      const before = await this.configVersion(
        db,
        tenantId,
        id,
        expectedUpdatedAt,
      );
      if (effectiveFrom !== isoDate(before.effective_from))
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
    return hrmTransaction(pool, async (db) => {
      const before = await this.configVersion(
        db,
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      await this.assertUnusedConfiguration(db, tenantId, before, true);
      // Newest, not-yet-effective version only; the previous version is reopened in the same transaction.
      const reopened = await reopenPreviousVersion(
        db,
        tenantId,
        before.policy_type,
        {
          ...before,
          effective_from: isoDate(before.effective_from),
          effective_to: before.effective_to ? isoDate(before.effective_to) : null,
        },
        todayInVietnam(),
      );
      await db.query('DELETE FROM hrm_schema.policy_versions WHERE id=$1', [
        id,
      ]);
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'PAYROLL_CONFIGURATION_DELETED',
        id,
        { before, reason: body.reason, reopenedVersionId: reopened?.id ?? null },
      );
      return reopened;
    }).then((reopened) => ({
      data: { id, deleted: true, reopenedVersionId: reopened?.id ?? null },
    }));
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
