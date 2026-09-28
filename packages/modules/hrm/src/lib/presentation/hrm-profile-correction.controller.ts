import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate, lockEmployee } from '../infrastructure/hrm-time.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';

const fields: Record<string, string> = {
  fullName: 'full_name',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  identityCardNumber: 'identity_card_number',
  identityCardIssuedDate: 'identity_card_issued_date',
  identityCardIssuedPlace: 'identity_card_issued_place',
  taxCode: 'tax_code',
  socialInsuranceNumber: 'social_insurance_number',
};
const value = (v: unknown) => (v instanceof Date ? isoDate(v) : (v ?? null));
@Controller('v1/profile-corrections')
export class HrmProfileCorrectionController {
  constructor(private readonly ctx: HrmContextService) {}
  @Get()
  async list(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
    const result = await pool.query(
      `SELECT * FROM hrm_schema.profile_corrections WHERE tenant_id=$1 AND ($2::uuid IS NULL OR employee_id=$2) AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: result.rows.map((r) => ({
        ...r,
        employeeId: r.employee_id,
        createdAt: r.created_at,
      })),
    };
  }
  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { changes: Record<string, string | null>; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.request',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    requireText(body.reason, 'reason', 3000);
    if (
      !body.changes ||
      typeof body.changes !== 'object' ||
      Array.isArray(body.changes) ||
      !Object.keys(body.changes).length
    )
      throw new BadRequestException('Cần dữ liệu thay đổi');
    for (const [key, v] of Object.entries(body.changes)) {
      if (!Object.hasOwn(fields, key) || (v !== null && typeof v !== 'string'))
        throw new BadRequestException('Trường thay đổi không được hỗ trợ');
      if (v !== null && v.length > 255)
        throw new BadRequestException('Giá trị quá dài');
      if ((key === 'dateOfBirth' || key === 'identityCardIssuedDate') && v)
        requireDate(v, key);
      if (key === 'fullName') requireText(v, key, 180);
      if (key === 'gender' && v && !['MALE', 'FEMALE', 'OTHER'].includes(v))
        throw new BadRequestException('Giới tính không hợp lệ');
    }
    return hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const profile = await db.query(
        `SELECT * FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
        [tenantId, employeeId],
      );
      const previous = Object.fromEntries(
        Object.keys(body.changes).map((key) => [
          key,
          value(profile.rows[0][fields[key]]),
        ]),
      );
      const result = await db.query(
        `INSERT INTO hrm_schema.profile_corrections (tenant_id,employee_id,changes,previous_values,reason,submitted_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          tenantId,
          employeeId,
          JSON.stringify(body.changes),
          JSON.stringify(previous),
          body.reason,
          principal.userId,
        ],
      );
      return { data: result.rows[0] };
    });
  }
  @Post(':id/approve')
  async approve(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.profile.approve',
    );
    return hrmTransaction(pool, async (db) => {
      const result = await db.query(
        `SELECT * FROM hrm_schema.profile_corrections WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const correction = result.rows[0];
      if (!correction) throw new NotFoundException('Không tìm thấy đơn');
      if (correction.status === 'APPROVED') return { data: correction };
      if (correction.status !== 'PENDING')
        throw new ConflictException('Đơn không còn chờ duyệt');
      await lockEmployee(db, tenantId, correction.employee_id);
      const profile = await db.query(
        `SELECT * FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
        [tenantId, correction.employee_id],
      );
      for (const [key, v] of Object.entries(correction.changes)) {
        if (!Object.hasOwn(fields, key))
          throw new BadRequestException('Trường thay đổi không hợp lệ');
        if (
          value(profile.rows[0][fields[key]]) !==
          correction.previous_values[key]
        )
          throw new ConflictException(
            'Hồ sơ đã thay đổi sau khi gửi đơn; cần gửi lại để đối chiếu',
          );
        if (key === 'fullName')
          await db.query(
            `UPDATE core_schema.employees SET full_name=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
            [tenantId, correction.employee_id, v],
          );
        else
          await db.query(
            `UPDATE hrm_schema.employee_profiles SET ${fields[key]}=$3,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND employee_id=$2`,
            [tenantId, correction.employee_id, v, principal.userId],
          );
      }
      await db.query(
        `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'PROFILE_CORRECTION_APPROVED',$3,$4)`,
        [
          tenantId,
          principal.userId,
          id,
          JSON.stringify({
            before: correction.previous_values,
            after: correction.changes,
          }),
        ],
      );
      return {
        data: (
          await db.query(
            `UPDATE hrm_schema.profile_corrections SET status='APPROVED',approved_by=$3,approved_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [tenantId, id, principal.userId],
          )
        ).rows[0],
      };
    });
  }
  @Post(':id/reject')
  async reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.profile.approve',
    );
    requireText(reason, 'reason', 2000);
    const result = await pool.query(
      `UPDATE hrm_schema.profile_corrections SET status='REJECTED',approved_by=$3,rejection_reason=$4,approved_at=now() WHERE tenant_id=$1 AND id=$2 AND status='PENDING' RETURNING *`,
      [tenantId, id, principal.userId, reason],
    );
    if (!result.rowCount)
      throw new ConflictException('Đơn không còn chờ duyệt');
    return { data: result.rows[0] };
  }
}
