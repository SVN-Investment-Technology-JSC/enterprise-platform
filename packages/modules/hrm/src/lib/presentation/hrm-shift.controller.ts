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
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shifts')
  async createShift(@Req() req: Request, @Body() body: CreateShiftDefinitionRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.shift_definitions (
        tenant_id, code, name, start_time, end_time, break_minutes, cross_midnight,
        grace_late_minutes, grace_early_minutes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        tenantId,
        body.code,
        body.name,
        body.startTime,
        body.endTime,
        body.breakMinutes ?? 60,
        body.crossMidnight ?? false,
        body.graceLateMinutes ?? 10,
        body.graceEarlyMinutes ?? 5,
        body.status || 'ACTIVE',
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
      throw new NotFoundException({ code: 'HRM_SHIFT_NOT_FOUND', message: 'Shift definition not found' });
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.shift_definitions SET
        name = COALESCE($3, name),
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        break_minutes = COALESCE($6, break_minutes),
        cross_midnight = COALESCE($7, cross_midnight),
        grace_late_minutes = COALESCE($8, grace_late_minutes),
        grace_early_minutes = COALESCE($9, grace_early_minutes),
        status = COALESCE($10, status),
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
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_SHIFT_NOT_FOUND', message: 'Shift definition not found' });
    }
    return {
      data: this.mapShift(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('shifts/:shiftId')
  async deleteShift(@Req() req: Request, @Param('shiftId') shiftId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
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
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT sa.*, sd.code as shift_code, sd.name as shift_name, sd.start_time, sd.end_time,
              e.full_name as employee_name, e.employee_code
       FROM hrm_schema.shift_assignments sa
       LEFT JOIN hrm_schema.shift_definitions sd ON sa.shift_id = sd.id
       LEFT JOIN hrm_schema.employee_profiles e ON sa.employee_id = e.id
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
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('employees/:employeeId/shift-assignments')
  async listEmployeeAssignments(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_assignments
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY effective_from DESC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map(this.mapAssignment),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('employees/:employeeId/shift-assignments')
  async createEmployeeAssignment(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateShiftAssignmentRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');

    // Reject temporal overlap per spec
    const overlap = await pool.query(
      `SELECT id FROM hrm_schema.shift_assignments
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'ACTIVE'
         AND daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') &&
             daterange($3::date, COALESCE($4::date, 'infinity'::date), '[]')`,
      [tenantId, employeeId, body.effectiveFrom, body.effectiveTo || null],
    );
    if (overlap.rows.length > 0) {
      throw new BadRequestException({
        code: 'HRM_SHIFT_ASSIGNMENT_OVERLAP',
        message: 'Shift assignment overlaps with an existing active assignment',
      });
    }

    const res = await pool.query(
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
    return {
      data: this.mapAssignment(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
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
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      source: row.source as any,
      status: row.status as any,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
