import type {
  CreateShiftAssignmentRequest,
  CreateShiftDefinitionRequest,
  HrmShiftAssignment,
  HrmShiftDefinition,
  UpdateShiftDefinitionRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
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
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import {
  lockEmployee,
  isoDate,
  assertOpenRange,
} from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

@Controller('v1')
export class HrmShiftController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Shift Definitions (P2_S3_HRM_API.md § 10.1)
  // --------------------------------------------------------------------------

  @Get('shifts')
  async listShifts(@Req() req: Request, @Query('status') status?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_definitions
       WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY code ASC`,
      [tenantId, status || null],
    );
    return {
      data: res.rows.map(this.mapShift),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('shifts')
  async createShift(
    @Req() req: Request,
    @Body() body: CreateShiftDefinitionRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    this.validateShift(body);
    const res = await pool.query(
      `INSERT INTO hrm_schema.shift_definitions (
        tenant_id, code, name, start_time, end_time, break_minutes, cross_midnight,
        grace_late_minutes, grace_early_minutes, status, break_start_time, break_end_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        tenantId,
        body.code,
        body.name,
        body.startTime,
        body.endTime,
        body.breakMinutes ?? 0,
        body.crossMidnight ?? false,
        body.graceLateMinutes ?? 10,
        body.graceEarlyMinutes ?? 5,
        body.status || 'ACTIVE',
        body.breakStartTime || null,
        body.breakEndTime || null,
      ],
    );
    return {
      data: this.mapShift(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('shifts/:shiftId')
  async getShift(@Req() req: Request, @Param('shiftId') shiftId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, shiftId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_SHIFT_NOT_FOUND',
        message: 'Shift definition not found',
      });
    }
    return {
      data: this.mapShift(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('shifts/:shiftId')
  async updateShift(
    @Req() req: Request,
    @Param('shiftId') shiftId: string,
    @Body() body: UpdateShiftDefinitionRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    const res = await hrmTransaction(pool, async (db) => {
      const current = await db.query(
        `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, requireUuid(shiftId, 'shiftId')],
      );
      if (!current.rows[0]) throw new NotFoundException('Không tìm thấy ca');
      const merged = { ...this.mapShift(current.rows[0]), ...body };
      this.validateShift(merged);
      const assignments = await db.query(
        `SELECT effective_from,effective_to FROM hrm_schema.shift_assignments WHERE tenant_id=$1 AND shift_id=$2 ORDER BY effective_from`,
        [tenantId, shiftId],
      );
      for (const assignment of assignments.rows)
        await assertOpenRange(
          db,
          tenantId,
          isoDate(assignment.effective_from),
          assignment.effective_to ? isoDate(assignment.effective_to) : null,
        );
      return db.query(
        `UPDATE hrm_schema.shift_definitions SET
        name = COALESCE($3, name),
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        break_minutes = COALESCE($6, break_minutes),
        cross_midnight = COALESCE($7, cross_midnight),
        grace_late_minutes = COALESCE($8, grace_late_minutes),
        grace_early_minutes = COALESCE($9, grace_early_minutes),
        status = COALESCE($10, status),
        break_start_time = $11, break_end_time = $12,
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
        [
          tenantId,
          shiftId,
          body.name,
          body.startTime,
          body.endTime,
          body.breakMinutes,
          body.crossMidnight,
          body.graceLateMinutes,
          body.graceEarlyMinutes,
          body.status,
          merged.breakStartTime || null,
          merged.breakEndTime || null,
        ],
      );
    });
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_SHIFT_NOT_FOUND',
        message: 'Shift definition not found',
      });
    }
    return {
      data: this.mapShift(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('shifts/:shiftId')
  async deleteShift(@Req() req: Request, @Param('shiftId') shiftId: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    // Soft deactivate per spec
    await pool.query(
      `UPDATE hrm_schema.shift_definitions SET status = 'INACTIVE', updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, shiftId],
    );
    return {
      data: { success: true, message: 'Shift deactivated successfully' },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Shift Assignment APIs (P2_S3_HRM_API.md § 10.2)
  // --------------------------------------------------------------------------

  @Get('shift-assignments')
  async listAllShiftAssignments(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('shift_id') shiftId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.shift.read');
    const res = await pool.query(
      `SELECT sa.*, sd.code as shift_code, sd.name as shift_name, sd.start_time, sd.end_time,
              e.full_name as employee_name, e.employee_code
       FROM hrm_schema.shift_assignments sa
       LEFT JOIN hrm_schema.shift_definitions sd ON sa.shift_id = sd.id
       LEFT JOIN hrm_schema.employee_directory e ON sa.employee_id = e.employee_id AND e.tenant_id = sa.tenant_id
       WHERE sa.tenant_id = $1
         AND ($2::uuid IS NULL OR sa.employee_id = $2)
         AND ($3::uuid IS NULL OR sa.shift_id = $3)
       ORDER BY sa.effective_from DESC`,
      [tenantId, employeeId || null, shiftId || null],
    );
    return {
      data: res.rows.map((row) => ({
        ...this.mapAssignment(row),
        shiftCode: row.shift_code as string | undefined,
        shiftName: row.shift_name as string | undefined,
        startTime: row.start_time as string | undefined,
        endTime: row.end_time as string | undefined,
        employeeName: row.employee_name as string | undefined,
        employeeCode: row.employee_code as string | undefined,
      })),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Get('employees/:employeeId/shift-assignments')
  async listEmployeeAssignments(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.shift.read',
      'hrm.self.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_assignments
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY effective_from DESC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map(this.mapAssignment),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('employees/:employeeId/shift-assignments')
  async createEmployeeAssignment(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateShiftAssignmentRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );

    requireUuid(employeeId, 'employeeId');
    requireUuid(body.shiftId, 'shiftId');
    requireDate(body.effectiveFrom, 'effectiveFrom');
    if (
      body.effectiveTo &&
      requireDate(body.effectiveTo, 'effectiveTo') < body.effectiveFrom
    )
      throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu');
    const res = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const shift = await db.query(
        `SELECT id FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE`,
        [tenantId, body.shiftId],
      );
      if (!shift.rowCount)
        throw new BadRequestException(
          'Ca không thuộc tenant hoặc đã ngừng sử dụng',
        );
      await assertOpenRange(
        db,
        tenantId,
        body.effectiveFrom,
        body.effectiveTo || null,
      );
      if (body.positionId) {
        const position = await db.query(
          `SELECT id FROM core_schema.organization_nodes WHERE id=$1 AND category='position' AND status='active' AND deleted_at IS NULL`,
          [requireUuid(body.positionId, 'positionId')],
        );
        if (!position.rowCount)
          throw new BadRequestException('Vị trí không thuộc tenant');
      }
      // Reject temporal overlap per spec
      const overlap = await db.query(
        `SELECT id FROM hrm_schema.shift_assignments
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'ACTIVE'
         AND daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') &&
             daterange($3::date, COALESCE($4::date, 'infinity'::date), '[]')`,
        [tenantId, employeeId, body.effectiveFrom, body.effectiveTo || null],
      );
      if (overlap.rows.length > 0) {
        throw new BadRequestException({
          code: 'HRM_SHIFT_ASSIGNMENT_OVERLAP',
          message:
            'Shift assignment overlaps with an existing active assignment',
        });
      }

      return db.query(
        `INSERT INTO hrm_schema.shift_assignments (
        tenant_id, employee_id, position_id, shift_id, effective_from, effective_to, source, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
      RETURNING *`,
        [
          tenantId,
          employeeId,
          body.positionId || null,
          body.shiftId,
          body.effectiveFrom,
          body.effectiveTo || null,
          body.source || 'MANUAL',
        ],
      );
    });
    return {
      data: this.mapAssignment(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private validateShift(body: CreateShiftDefinitionRequest) {
    requireText(body.code, 'code', 50);
    requireText(body.name, 'name', 255);
    const minutes = (value: string) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))
        throw new BadRequestException('Giờ ca không hợp lệ');
      return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    };
    const start = minutes(body.startTime),
      end = minutes(body.endTime) + (body.crossMidnight ? 1440 : 0);
    if (end <= start || end - start > 1440)
      throw new BadRequestException('Khoảng giờ ca không hợp lệ');
    for (const n of [
      body.breakMinutes ?? 0,
      body.graceEarlyMinutes ?? 5,
      body.graceLateMinutes ?? 10,
    ])
      if (!Number.isInteger(n) || n < 0 || n >= end - start)
        throw new BadRequestException('Số phút cấu hình không hợp lệ');
    if (body.breakMinutes) {
      if (!body.breakStartTime || !body.breakEndTime)
        throw new BadRequestException(
          'Cần giờ bắt đầu và kết thúc nghỉ giữa ca',
        );
      let bs = minutes(body.breakStartTime),
        be = minutes(body.breakEndTime);
      if (body.crossMidnight && bs < start) bs += 1440;
      if (body.crossMidnight && be <= start) be += 1440;
      if (bs < start || be > end || be <= bs || be - bs !== body.breakMinutes)
        throw new BadRequestException(
          'Khoảng nghỉ phải nằm trong ca và khớp số phút nghỉ',
        );
    } else if (body.breakStartTime || body.breakEndTime)
      throw new BadRequestException('Ca không nghỉ phải để trống giờ nghỉ');
  }

  private mapShift(row: Record<string, unknown>): HrmShiftDefinition {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      code: row.code as string,
      name: row.name as string,
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      breakMinutes: row.break_minutes as number,
      breakStartTime: row.break_start_time as string | null,
      breakEndTime: row.break_end_time as string | null,
      crossMidnight: Boolean(row.cross_midnight),
      graceLateMinutes: row.grace_late_minutes as number,
      graceEarlyMinutes: row.grace_early_minutes as number,
      status: row.status as any,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAssignment(row: Record<string, unknown>): HrmShiftAssignment {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      positionId: row.position_id as string | null,
      shiftId: row.shift_id as string,
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
      source: row.source as any,
      status: row.status as any,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
