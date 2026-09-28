import { approveProfileCorrection } from '../infrastructure/hrm-request-transition.js';
import {
  profileCorrectionFields as fields,
  profileCorrectionValue as value,
} from '../infrastructure/hrm-request-transition.js';
import { submitHrmRequest } from '../infrastructure/hrm-submission.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { lockEmployee } from '../infrastructure/hrm-time.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';

@Controller('v1/profile-corrections')
export class HrmProfileCorrectionController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
  ) {}
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
    @Body()
    body: {
      changes: Record<string, string | null>;
      reason: string;
      attributes?: Record<string, unknown>;
    },
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
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'profile_correction',
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn điều chỉnh hồ sơ',
        attributes: body.attributes,
      },
      async (db) => {
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
        return result.rows[0];
      },
    );
    return {
      data: {
        ...row,
        employeeId: row.employee_id,
        procedureInstanceId: link?.instanceId ?? null,
        procedureSyncStatus: link?.syncStatus ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }
  @Post(':id/approve')
  async approve(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.profile.approve',
    );
    return hrmTransaction(pool, (db) =>
      approveProfileCorrection(db, tenantId, principal.userId, id),
    );
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
