import type {
  CreateUnitShiftAssignmentRequest,
  HrmOrgUnitOption,
  HrmUnitShiftAssignment,
  HrmUnitShiftResolution,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { assertOpenRange, isoDate } from '../infrastructure/hrm-time.js';
import { requireDate, requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Gán ca chuẩn ở cấp đơn vị (kế thừa). Không sao chép bản ghi cho từng nhân viên:
 * ca của nhân viên được tra lúc cần (hrm-shift-resolution.ts): cá nhân > đơn vị > đơn vị cha.
 */
@Controller('v1')
export class HrmUnitShiftController {
  constructor(private readonly ctx: HrmContextService) {}

  private map(row: Record<string, unknown>): HrmUnitShiftAssignment {
    return {
      id: row.id as string,
      unitId: row.unit_id as string,
      unitName: row.unit_name as string | undefined,
      unitCode: row.unit_code as string | undefined,
      shiftId: row.shift_id as string,
      shiftCode: row.shift_code as string | undefined,
      shiftName: row.shift_name as string | undefined,
      startTime: row.start_time as string | undefined,
      endTime: row.end_time as string | undefined,
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
      status: row.status as 'ACTIVE' | 'CANCELLED',
    };
  }

  @RequirePermission('hrm.shift.read')
  @Get('shift-units')
  async listUnits(@Req() req: Request) {
    const { pool } = await this.ctx.getContext(req, 'hrm.shift.read');
    const res = await pool.query(
      `SELECT id, parent_id, code, name FROM core_schema.organization_nodes
        WHERE deleted_at IS NULL AND category <> 'position' AND status = 'active'
        ORDER BY sort_order, name`,
    );
    const data: HrmOrgUnitOption[] = res.rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id ?? null,
      code: r.code,
      name: r.name,
    }));
    return { data, meta: { requestId: req.headers['x-request-id'] as string } };
  }

  @RequirePermission('hrm.shift.read')
  @Get('unit-shift-assignments')
  async list(@Req() req: Request, @Query('unitId') unitId?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.shift.read');
    const res = await pool.query(
      `SELECT u.*, n.name AS unit_name, n.code AS unit_code, s.code AS shift_code, s.name AS shift_name, s.start_time, s.end_time
         FROM hrm_schema.unit_shift_assignments u
         JOIN core_schema.organization_nodes n ON n.id = u.unit_id
         JOIN hrm_schema.shift_definitions s ON s.id = u.shift_id AND s.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1 AND u.status = 'ACTIVE' AND ($2::uuid IS NULL OR u.unit_id = $2)
        ORDER BY n.name, u.effective_from DESC`,
      [tenantId, unitId ? requireUuid(unitId, 'unitId') : null],
    );
    return {
      data: res.rows.map((r) => this.map(r)),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  /** Ca hiệu lực của đơn vị tại một ngày, kèm đơn vị mà ca được kế thừa từ đó. */
  @RequirePermission('hrm.shift.read')
  @Get('unit-shift-assignments/resolve')
  async resolve(
    @Req() req: Request,
    @Query('unitId') unitId: string,
    @Query('date') date?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.shift.read');
    requireUuid(unitId, 'unitId');
    const day = date
      ? requireDate(date, 'date')
      : new Date().toLocaleDateString('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh',
        });
    const res = await pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id AS unit_id, parent_id, name, 0 AS depth FROM core_schema.organization_nodes WHERE id = $2 AND deleted_at IS NULL
         UNION ALL
         SELECT n.id, n.parent_id, n.name, c.depth + 1 FROM chain c JOIN core_schema.organization_nodes n ON n.id = c.parent_id WHERE c.depth < 20
       )
       SELECT c.unit_id, c.name AS unit_name, c.depth, s.id AS shift_id, s.name AS shift_name
         FROM chain c
         JOIN hrm_schema.unit_shift_assignments u ON u.unit_id = c.unit_id AND u.tenant_id = $1 AND u.status = 'ACTIVE'
          AND $3::date >= u.effective_from AND (u.effective_to IS NULL OR $3::date <= u.effective_to)
         JOIN hrm_schema.shift_definitions s ON s.id = u.shift_id AND s.tenant_id = u.tenant_id
        ORDER BY c.depth LIMIT 1`,
      [tenantId, unitId, day],
    );
    const row = res.rows[0];
    const data: HrmUnitShiftResolution = row
      ? {
          unitId,
          date: day,
          shiftId: row.shift_id,
          shiftName: row.shift_name,
          source: Number(row.depth) === 0 ? 'UNIT' : 'PARENT_UNIT',
          inheritedFromUnitId: row.unit_id,
          inheritedFromUnitName: row.unit_name,
        }
      : { unitId, date: day, shiftId: null, source: null };
    return { data, meta: { requestId: req.headers['x-request-id'] as string } };
  }

  @RequirePermission('hrm.shift.manage')
  @Post('unit-shift-assignments')
  async create(
    @Req() req: Request,
    @Body() body: CreateUnitShiftAssignmentRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    requireUuid(body.unitId, 'unitId');
    requireUuid(body.shiftId, 'shiftId');
    requireDate(body.effectiveFrom, 'effectiveFrom');
    if (
      body.effectiveTo &&
      requireDate(body.effectiveTo, 'effectiveTo') < body.effectiveFrom
    )
      throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu');
    const inserted = await hrmTransaction(pool, async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `hrm:unit-shift:${tenantId}:${body.unitId}`,
      ]);
      const unit = await db.query(
        `SELECT id FROM core_schema.organization_nodes WHERE id=$1 AND category <> 'position' AND deleted_at IS NULL`,
        [body.unitId],
      );
      if (!unit.rowCount)
        throw new BadRequestException(
          'Đơn vị không tồn tại hoặc không phải đơn vị tổ chức',
        );
      const shift = await db.query(
        `SELECT id FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE`,
        [tenantId, body.shiftId],
      );
      if (!shift.rowCount)
        throw new BadRequestException(
          'Ca không thuộc tenant hoặc đã ngừng sử dụng',
        );
      const overlap = await db.query(
        `SELECT id FROM hrm_schema.unit_shift_assignments
          WHERE tenant_id=$1 AND unit_id=$2 AND status='ACTIVE'
            AND daterange(effective_from, COALESCE(effective_to,'infinity'::date), '[]') && daterange($3::date, COALESCE($4::date,'infinity'::date), '[]')`,
        [tenantId, body.unitId, body.effectiveFrom, body.effectiveTo || null],
      );
      if (overlap.rowCount)
        throw new BadRequestException({
          code: 'HRM_UNIT_SHIFT_OVERLAP',
          message:
            'Đơn vị đã có ca chuẩn trong khoảng ngày này; hãy huỷ hoặc kết thúc gán cũ trước.',
        });
      await assertOpenRange(
        db,
        tenantId,
        body.effectiveFrom,
        body.effectiveTo || null,
      );
      const res = await db.query(
        `INSERT INTO hrm_schema.unit_shift_assignments (tenant_id, unit_id, shift_id, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          tenantId,
          body.unitId,
          body.shiftId,
          body.effectiveFrom,
          body.effectiveTo || null,
          principal.userId,
        ],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'UNIT_ROSTER_CREATED',
        res.rows[0].id,
        { after: res.rows[0] },
      );
      return res.rows[0];
    });
    return {
      data: this.map(inserted),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @RequirePermission('hrm.shift.manage')
  @Delete('unit-shift-assignments/:id')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    requireUuid(id, 'id');
    await hrmTransaction(pool, async (db) => {
      const found = await db.query(
        `SELECT * FROM hrm_schema.unit_shift_assignments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const row = found.rows[0];
      if (!row) throw new NotFoundException('Không tìm thấy gán ca đơn vị');
      await assertOpenRange(
        db,
        tenantId,
        isoDate(row.effective_from),
        row.effective_to ? isoDate(row.effective_to) : null,
      );
      await db.query(
        `UPDATE hrm_schema.unit_shift_assignments SET status='CANCELLED', updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, id],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'UNIT_ROSTER_CANCELLED',
        id,
        { before: row },
      );
    });
    return {
      data: { id },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }
}
