import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Patch,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import {
  assertLifecycleVersion,
  timestamp,
  lifecycleAudit,
} from '../infrastructure/hrm-lifecycle.js';
import { isoDate, lockEmployee } from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';

async function invalidatePayroll(
  db: PoolClient,
  tenant: string,
  from: string,
  to: string | null,
) {
  const periods = await db.query(
    `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND to_date>=$2::date AND ($3::date IS NULL OR to_date<=$3::date) ORDER BY id FOR UPDATE`,
    [tenant, from, to],
  );
  if (periods.rows.some((p) => ['LOCKED', 'PAID'].includes(p.status)))
    throw new BadRequestException(
      'Không thay đổi đăng ký ảnh hưởng kỳ lương đã chốt',
    );
  await db.query(
    `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) AND status<>'FINALIZED'`,
    [tenant, periods.rows.map((p) => p.id)],
  );
}
@Controller('v1')
export class HrmDependentController {
  constructor(private readonly ctx: HrmContextService) {}
  private map(row: Record<string, any>): Record<string, any> {
    return {
      ...row,
      birth_date: isoDate(row.birth_date),
      effective_from: isoDate(row.effective_from),
      effective_to: row.effective_to ? isoDate(row.effective_to) : null,
      updated_at: timestamp(row.updated_at),
    };
  }
  private async lock(
    db: PoolClient,
    tenantId: string,
    id: string,
    version: unknown,
  ) {
    requireUuid(id, 'Đăng ký');
    const owner = (
      await db.query(
        'SELECT employee_id FROM hrm_schema.employee_dependents WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      )
    ).rows[0];
    if (!owner) throw new NotFoundException('Không tìm thấy đăng ký');
    await lockEmployee(db, tenantId, owner.employee_id);
    const row = (
      await db.query(
        'SELECT * FROM hrm_schema.employee_dependents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, id],
      )
    ).rows[0];
    assertLifecycleVersion(row, version);
    return row;
  }
  @Patch('dependents/:id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      expectedUpdatedAt: string;
      fullName?: string;
      relationship?: string;
      birthDate?: string;
      taxCode?: string | null;
      evidenceReference: string;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      reason: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.dependent.manage',
    );
    requireText(body.reason, 'Lý do điều chỉnh', 500);
    requireText(body.evidenceReference, 'Căn cứ xác minh', 500);
    return hrmTransaction(pool, async (db) => {
      const before = await this.lock(db, tenantId, id, body.expectedUpdatedAt);
      const columns: Record<string, string> = {
        fullName: 'full_name',
        relationship: 'relationship',
        birthDate: 'birth_date',
        taxCode: 'tax_code',
        evidenceReference: 'evidence_reference',
        effectiveFrom: 'effective_from',
        effectiveTo: 'effective_to',
      };
      const input = body as unknown as Record<string, unknown>;
      const entries = Object.entries(columns)
        .filter(([k]) => input[k] !== undefined)
        .map(([k, col]) => [col, input[k]] as const);
      const next = { ...this.map(before), ...Object.fromEntries(entries) };
      requireText(next.full_name, 'Họ tên', 200);
      requireText(next.relationship, 'Quan hệ', 100);
      requireDate(next.birth_date, 'Ngày sinh');
      requireDate(next.effective_from, 'Hiệu lực từ');
      if (next.effective_to) requireDate(next.effective_to, 'Hiệu lực đến');
      if (
        next.birth_date > next.effective_from ||
        next.birth_date > new Date().toISOString().slice(0, 10) ||
        (next.effective_to && next.effective_to < next.effective_from)
      )
        throw new BadRequestException('Ngày sinh hoặc hiệu lực không hợp lệ');
      const overlap = await db.query(
        "SELECT id FROM hrm_schema.employee_dependents WHERE tenant_id=$1 AND employee_id=$2 AND reference_code=$3 AND id<>$4 AND effective_from<=COALESCE($6::date,'infinity'::date) AND COALESCE(effective_to,'infinity'::date)>=$5::date",
        [
          tenantId,
          before.employee_id,
          before.reference_code,
          id,
          next.effective_from,
          next.effective_to,
        ],
      );
      if (overlap.rowCount)
        throw new BadRequestException('Đăng ký trùng hiệu lực');
      await invalidatePayroll(
        db,
        tenantId,
        isoDate(before.effective_from),
        before.effective_to ? isoDate(before.effective_to) : null,
      );
      await invalidatePayroll(
        db,
        tenantId,
        next.effective_from,
        next.effective_to,
      );
      const result = await db.query(
        `UPDATE hrm_schema.employee_dependents SET ${entries.map(([col], i) => col + '=$' + (i + 3)).join(',')},verified_by=$${entries.length + 3},updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, ...entries.map(([, v]) => v), principal.userId],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'DEPENDENT_AMENDED',
        id,
        {
          before: this.map(before),
          reason: body.reason,
          evidenceReference: body.evidenceReference,
        },
      );
      return { data: this.map(result.rows[0]) };
    });
  }
  @Get('dependents')
  async list(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.dependent.read',
    );
    return {
      data: (
        await pool.query(
          `SELECT d.*,e.full_name AS employee_name,e.employee_code FROM hrm_schema.employee_dependents d JOIN hrm_schema.employee_directory e ON e.tenant_id=d.tenant_id AND e.employee_id=d.employee_id WHERE d.tenant_id=$1 ORDER BY e.full_name,d.effective_from DESC`,
          [tenantId],
        )
      ).rows.map((r) => ({
        ...r,
        birth_date: isoDate(r.birth_date),
        effective_from: isoDate(r.effective_from),
        effective_to: r.effective_to ? isoDate(r.effective_to) : null,
        updated_at: timestamp(r.updated_at),
      })),
    };
  }
  @Post('dependents')
  async create(
    @Req() req: Request,
    @Body()
    body: {
      employeeId: string;
      referenceCode: string;
      fullName: string;
      relationship: string;
      birthDate: string;
      taxCode?: string;
      evidenceReference: string;
      effectiveFrom: string;
      effectiveTo?: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.dependent.manage',
    );
    requireUuid(body.employeeId, 'Nhân viên');
    requireText(body.referenceCode, 'Mã định danh hồ sơ', 100);
    requireText(body.fullName, 'Họ tên', 200);
    requireText(body.relationship, 'Quan hệ', 100);
    requireText(body.evidenceReference, 'Căn cứ xác minh', 500);
    requireDate(body.birthDate, 'Ngày sinh');
    requireDate(body.effectiveFrom, 'Hiệu lực từ');
    if (body.effectiveTo) requireDate(body.effectiveTo, 'Hiệu lực đến');
    if (
      body.birthDate > body.effectiveFrom ||
      body.birthDate > new Date().toISOString().slice(0, 10) ||
      (body.effectiveTo && body.effectiveTo < body.effectiveFrom)
    )
      throw new BadRequestException(
        'Ngày sinh và thời gian đăng ký không hợp lệ',
      );
    if (body.taxCode) requireText(body.taxCode, 'Mã số thuế', 50);
    return hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, body.employeeId);
      const overlap = await db.query(
        `SELECT id FROM hrm_schema.employee_dependents WHERE tenant_id=$1 AND employee_id=$2 AND reference_code=$3 AND effective_from<=COALESCE($5::date,'infinity'::date) AND COALESCE(effective_to,'infinity'::date)>=$4::date`,
        [
          tenantId,
          body.employeeId,
          body.referenceCode.trim(),
          body.effectiveFrom,
          body.effectiveTo || null,
        ],
      );
      if (overlap.rowCount)
        throw new BadRequestException(
          'Hồ sơ người phụ thuộc đã có đăng ký trùng hiệu lực',
        );
      await invalidatePayroll(
        db,
        tenantId,
        body.effectiveFrom,
        body.effectiveTo || null,
      );
      const result = await db.query(
        `INSERT INTO hrm_schema.employee_dependents(tenant_id,employee_id,reference_code,full_name,relationship,birth_date,tax_code,evidence_reference,effective_from,effective_to,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          tenantId,
          body.employeeId,
          body.referenceCode.trim(),
          body.fullName.trim(),
          body.relationship.trim(),
          body.birthDate,
          body.taxCode?.trim() || null,
          body.evidenceReference.trim(),
          body.effectiveFrom,
          body.effectiveTo || null,
          principal.userId,
        ],
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'DEPENDENT_REGISTER','employee_dependent',$3,$4)`,
        [
          tenantId,
          principal.userId,
          result.rows[0].id,
          JSON.stringify({
            employeeId: body.employeeId,
            effectiveFrom: body.effectiveFrom,
            effectiveTo: body.effectiveTo || null,
          }),
        ],
      );
      return { data: result.rows[0] };
    });
  }
  @Post('dependents/:id/end')
  async end(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      effectiveTo: string;
      reason: string;
      expectedUpdatedAt?: string;
      evidenceReference?: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.dependent.manage',
    );
    requireUuid(id, 'Hồ sơ');
    requireDate(body.effectiveTo, 'Ngày kết thúc');
    requireText(body.reason, 'Lý do', 500);
    requireText(body.evidenceReference, 'Căn cứ xác minh', 500);
    return hrmTransaction(pool, async (db) => {
      const prior = await this.lock(db, tenantId, id, body.expectedUpdatedAt);
      if (
        body.effectiveTo < isoDate(prior.effective_from) ||
        (prior.effective_to && body.effectiveTo > isoDate(prior.effective_to))
      )
        throw new BadRequestException(
          'Ngày kết thúc phải trong khoảng đã đăng ký',
        );
      if (
        prior.effective_to &&
        body.effectiveTo === isoDate(prior.effective_to)
      )
        return { data: this.map(prior) };
      // Only cutoffs after the new end date change; historical payroll remains immutable.
      const next = new Date(`${body.effectiveTo}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      await invalidatePayroll(
        db,
        tenantId,
        next.toISOString().slice(0, 10),
        prior.effective_to ? isoDate(prior.effective_to) : null,
      );
      const result = await db.query(
        `UPDATE hrm_schema.employee_dependents SET effective_to=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, body.effectiveTo],
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'DEPENDENT_END','employee_dependent',$3,$4)`,
        [tenantId, principal.userId, id, JSON.stringify(body)],
      );
      return { data: this.map(result.rows[0]) };
    });
  }
}
