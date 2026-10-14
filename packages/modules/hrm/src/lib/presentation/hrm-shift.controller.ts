import {
  assertLifecycleVersion,
  lifecycleAudit,
  timestamp,
} from '../infrastructure/hrm-lifecycle.js';
import type {
  CreateShiftDefinitionRequest,
  HrmShiftDefinition,
  UpdateShiftDefinitionRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  ConflictException,
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
import type { PoolClient } from 'pg';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { workScheduleTableExists } from '../infrastructure/hrm-shift-resolution.js';
import { ruleTableExists } from '../infrastructure/hrm-work-schedule-resolve.js';
import { requireText, requireUuid } from '../infrastructure/hrm-validation.js';
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    this.validateShift(body);
    const code = String(body.code).trim();
    const res = await hrmTransaction(pool, async (db) => {
      const duplicate = await db.query(
        `SELECT 1 FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND lower(code)=lower($2) LIMIT 1`,
        [tenantId, code],
      );
      if (duplicate.rowCount)
        throw new ConflictException({
          code: 'HRM_SHIFT_CODE_EXISTS',
          message: `Mã ca "${code}" đã tồn tại; chọn mã khác.`,
        });
      const created = await db.query(
        `INSERT INTO hrm_schema.shift_definitions (
        tenant_id, code, name, start_time, end_time, break_minutes, cross_midnight,
        grace_late_minutes, grace_early_minutes, status, break_start_time, break_end_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
        [
          tenantId,
          code,
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
      await lifecycleAudit(db, tenantId, principal.userId, 'SHIFT_CREATED', created.rows[0].id, {
        after: created.rows[0],
      });
      return created;
    });
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    const res = await hrmTransaction(pool, async (db) => {
      const current = await db.query(
        `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, requireUuid(shiftId, 'shiftId')],
      );
      if (!current.rows[0]) throw new NotFoundException('Không tìm thấy ca');
      assertLifecycleVersion(current.rows[0], body.expectedUpdatedAt);
      const merged = { ...this.mapShift(current.rows[0]), ...body };
      this.validateShift(merged);
      // Ca đang được dùng trong lịch phân ca (từng ngày hoặc lịch định kỳ còn hiệu lực).
      const inUse =
        ((await workScheduleTableExists(db, tenantId)) &&
          (
            await db.query(
              `SELECT 1 FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND shift_id=$2 AND status='ACTIVE' LIMIT 1`,
              [tenantId, shiftId],
            )
          ).rowCount) ||
        ((await ruleTableExists(db, tenantId)) &&
          (
            await db.query(
              `SELECT 1 FROM hrm_schema.work_schedule_rule_days d JOIN hrm_schema.work_schedule_rules r ON r.id = d.rule_id
                WHERE r.tenant_id=$1 AND d.shift_id=$2 AND r.status='ACTIVE' AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE) LIMIT 1`,
              [tenantId, shiftId],
            )
          ).rowCount);
      const timingKeys = [
        'startTime',
        'endTime',
        'breakMinutes',
        'crossMidnight',
        'graceLateMinutes',
        'graceEarlyMinutes',
        'breakStartTime',
        'breakEndTime',
      ] as const;
      const original = this.mapShift(current.rows[0]);
      const normalize = (v: unknown) =>
        typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)
          ? v + ':00'
          : (v ?? '');
      const changesTiming = timingKeys.some(
        (key) =>
          body[key] !== undefined &&
          normalize(body[key]) !== normalize(original[key]),
      );
      // Ngừng ca đang được dùng trong lịch từ hôm nay trở đi sẽ làm các ngày đó mất ca: phải đổi lịch trước.
      if (body.status === 'INACTIVE' && current.rows[0].status !== 'INACTIVE') {
        const futureUse =
          ((await workScheduleTableExists(db, tenantId)) &&
            (
              await db.query(
                `SELECT 1 FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND shift_id=$2 AND status='ACTIVE' AND work_date >= CURRENT_DATE LIMIT 1`,
                [tenantId, shiftId],
              )
            ).rowCount) ||
          ((await ruleTableExists(db, tenantId)) &&
            (
              await db.query(
                `SELECT 1 FROM hrm_schema.work_schedule_rule_days d JOIN hrm_schema.work_schedule_rules r ON r.id = d.rule_id
                  WHERE r.tenant_id=$1 AND d.shift_id=$2 AND r.status='ACTIVE' AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE) LIMIT 1`,
                [tenantId, shiftId],
              )
            ).rowCount);
        if (futureUse)
          throw new ConflictException({
            code: 'HRM_SHIFT_IN_USE',
            message: 'Ca đang được dùng trong lịch phân ca từ hôm nay; đổi lịch sang ca khác trước khi ngừng ca này.',
          });
      }
      if (changesTiming && inUse)
        throw new ConflictException(
          'Ca đã được phân công; tạo mã ca mới để thay đổi khung giờ hoặc quy định công.',
        );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SHIFT_UPDATED',
        shiftId,
        { before: current.rows[0], changes: body },
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
        updated_at = GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
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
  async deleteShift(
    @Req() req: Request,
    @Param('shiftId') shiftId: string,
    @Body() body?: { expectedUpdatedAt?: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.manage',
    );
    requireUuid(shiftId, 'shiftId');
    const result = await hrmTransaction(pool, async (db) => {
      const current = await db.query(
        `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, shiftId],
      );
      if (!current.rows[0]) throw new NotFoundException('Không tìm thấy ca làm việc');
      if (body?.expectedUpdatedAt) {
        assertLifecycleVersion(current.rows[0], body.expectedUpdatedAt);
      }
      const inUse = await this.isShiftInUse(db, tenantId, shiftId);
      if (inUse) {
        if (current.rows[0].status !== 'INACTIVE') {
          await db.query(
            `UPDATE hrm_schema.shift_definitions SET status='INACTIVE', updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
             WHERE tenant_id=$1 AND id=$2`,
            [tenantId, shiftId],
          );
          await lifecycleAudit(
            db,
            tenantId,
            principal.userId,
            'SHIFT_UPDATED',
            shiftId,
            { before: current.rows[0], changes: { status: 'INACTIVE' } },
          );
        }
        return {
          deleted: false,
          status: 'INACTIVE',
          code: current.rows[0].code,
          message: `Ca "${current.rows[0].code}" đã phát sinh dữ liệu (lịch phân ca / chấm công) nên không thể xóa vĩnh viễn; hệ thống đã chuyển sang Ngừng dùng.`,
        };
      }
      await db.query(
        `DELETE FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2`,
        [tenantId, shiftId],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SHIFT_DELETED',
        shiftId,
        { before: current.rows[0] },
      );
      return {
        deleted: true,
        status: 'DELETED',
        code: current.rows[0].code,
        message: `Đã xóa ca ${current.rows[0].code}.`,
      };
    });
    return {
      data: { id: shiftId, ...result },
      message: result.message,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private async isShiftInUse(
    db: Pick<PoolClient, 'query'>,
    tenantId: string,
    shiftId: string,
  ): Promise<boolean> {
    if (await workScheduleTableExists(db, tenantId)) {
      const r1 = await db.query(
        `SELECT 1 FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND shift_id=$2 LIMIT 1`,
        [tenantId, shiftId],
      );
      if (r1.rowCount) return true;
    }
    if (await ruleTableExists(db, tenantId)) {
      const r2 = await db.query(
        `SELECT 1 FROM hrm_schema.work_schedule_rule_days WHERE shift_id=$1 LIMIT 1`,
        [shiftId],
      );
      if (r2.rowCount) return true;
    }
    const r3 = await db
      .query(
        `SELECT 1 FROM hrm_schema.shift_assignments WHERE tenant_id=$1 AND shift_id=$2 LIMIT 1`,
        [tenantId, shiftId],
      )
      .catch(() => ({ rowCount: 0 }));
    if (r3.rowCount) return true;

    const r4 = await db
      .query(
        `SELECT 1 FROM hrm_schema.timesheet_entries WHERE tenant_id=$1 AND shift_id=$2 LIMIT 1`,
        [tenantId, shiftId],
      )
      .catch(() => ({ rowCount: 0 }));
    if (r4.rowCount) return true;

    const r5 = await db
      .query(
        `SELECT 1 FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND (current_shift_id=$2 OR requested_shift_id=$2) LIMIT 1`,
        [tenantId, shiftId],
      )
      .catch(() => ({ rowCount: 0 }));
    if (r5.rowCount) return true;

    const r6 = await db
      .query(
        `SELECT 1 FROM hrm_schema.company_holidays WHERE tenant_id=$1 AND shift_id=$2 LIMIT 1`,
        [tenantId, shiftId],
      )
      .catch(() => ({ rowCount: 0 }));
    if (r6.rowCount) return true;

    return false;
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
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }
}
