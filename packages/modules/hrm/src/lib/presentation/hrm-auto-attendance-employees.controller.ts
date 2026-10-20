import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { parseAutoAttendanceEmployeeInput } from '../domain/auto-attendance-settings.js';
import { autoAttendanceEmployeesReady } from '../infrastructure/hrm-auto-attendance.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { todayInVietnam } from '../infrastructure/hrm-timesheet-month.js';

const PERMISSION = 'hrm.time.configure';

const SELECT_ROWS = `
  SELECT a.id, a.employee_id, p.employee_code, e.full_name, a.weekdays,
         to_char(a.from_date,'YYYY-MM-DD') AS from_date, to_char(a.to_date,'YYYY-MM-DD') AS to_date,
         a.reason, a.created_at, a.updated_at, a.removed_at
    FROM hrm_schema.auto_attendance_employees a
    LEFT JOIN hrm_schema.employee_profiles p ON p.tenant_id = a.tenant_id AND p.employee_id = a.employee_id
    LEFT JOIN core_schema.employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id`;

interface Row {
  id: string;
  employee_id: string;
  employee_code: string | null;
  full_name: string | null;
  weekdays: (number | string)[] | null;
  from_date: string;
  to_date: string | null;
  reason: string;
  created_at: Date;
  updated_at: Date;
  removed_at: Date | null;
}

const iso = (value: Date | null) => (value instanceof Date ? value.toISOString() : null);

function present(row: Row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    weekdays: row.weekdays ? row.weekdays.map(Number) : null,
    fromDate: row.from_date,
    toDate: row.to_date,
    reason: row.reason,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    removedAt: iso(row.removed_at),
  };
}

const NOT_READY =
  'Cơ sở dữ liệu HRM chưa được cập nhật (migration 0066); chạy migration trước khi cấu hình chấm công tự động theo nhân viên';

/**
 * Chấm công tự động theo từng nhân viên (người không chấm công ngoài đời), bổ sung cho cấu hình chung của tenant.
 * Mỗi nhân viên một cấu hình đang áp dụng; sửa hay gỡ đều ghi nhật ký và giữ lại dòng cũ làm lịch sử cấu hình kèm lý do.
 * Giờ vào/ra sinh ra là sự kiện chấm công như hằng ngày, không ghi chú riêng.
 */
@Controller('v1/auto-attendance-employees')
export class HrmAutoAttendanceEmployeesController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get()
  async list(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, PERMISSION);
    if (!(await autoAttendanceEmployeesReady(pool))) return { data: { active: [], history: [] }, ready: false };
    const rows = await pool.query<Row>(
      `${SELECT_ROWS} WHERE a.tenant_id = $1 ORDER BY a.updated_at DESC LIMIT 500`,
      [tenantId],
    );
    return {
      data: {
        active: rows.rows.filter((r) => !r.removed_at).map(present),
        history: rows.rows.filter((r) => r.removed_at).map(present),
      },
      ready: true,
    };
  }

  /** Thêm hoặc sửa cấu hình của một nhân viên (mỗi nhân viên chỉ có một cấu hình đang áp dụng). */
  @Put()
  async save(@Req() req: Request, @Body() body: unknown) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    const parsed = parseAutoAttendanceEmployeeInput(body, todayInVietnam());
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    if (!(await autoAttendanceEmployeesReady(pool))) throw new BadRequestException(NOT_READY);
    const { employeeId, weekdays, fromDate, toDate, reason } = parsed.value;
    const saved = await hrmTransaction(pool, async (db) => {
      const exists = await db.query(
        `SELECT 1 FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL`,
        [tenantId, employeeId],
      );
      if (!exists.rowCount) throw new BadRequestException('Không tìm thấy nhân viên');
      const previous = (
        await db.query<Row>(`${SELECT_ROWS} WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.removed_at IS NULL`, [
          tenantId,
          employeeId,
        ])
      ).rows[0];
      const res = previous
        ? await db.query<{ id: string }>(
            `UPDATE hrm_schema.auto_attendance_employees
                SET weekdays=$2::smallint[], from_date=$3::date, to_date=$4::date, reason=$5, updated_by=$6, updated_at=now()
              WHERE id=$1 RETURNING id`,
            [previous.id, weekdays, fromDate, toDate, reason, principal.userId],
          )
        : await db.query<{ id: string }>(
            `INSERT INTO hrm_schema.auto_attendance_employees
               (tenant_id, employee_id, weekdays, from_date, to_date, reason, created_by, updated_by)
             VALUES ($1,$2,$3::smallint[],$4::date,$5::date,$6,$7,$7) RETURNING id`,
            [tenantId, employeeId, weekdays, fromDate, toDate, reason, principal.userId],
          );
      const id = res.rows[0].id;
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        previous ? 'AUTO_ATTENDANCE_EMPLOYEE_UPDATED' : 'AUTO_ATTENDANCE_EMPLOYEE_ADDED',
        id,
        {
          employeeId,
          before: previous ? present(previous) : null,
          after: { weekdays, fromDate, toDate, reason },
        },
      );
      return (await db.query<Row>(`${SELECT_ROWS} WHERE a.id=$1`, [id])).rows[0];
    });
    return { data: present(saved) };
  }

  /** Gỡ nhân viên: chốt ngày kết thúc là hôm qua và giữ dòng làm lịch sử; giờ công đã sinh được giữ nguyên. */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    if (!(await autoAttendanceEmployeesReady(pool))) throw new BadRequestException(NOT_READY);
    const removed = await hrmTransaction(pool, async (db) => {
      const previous = (
        await db.query<Row>(`${SELECT_ROWS} WHERE a.tenant_id=$1 AND a.id=$2 AND a.removed_at IS NULL`, [tenantId, id])
      ).rows[0];
      if (!previous) throw new NotFoundException('Không tìm thấy cấu hình đang áp dụng');
      const today = todayInVietnam();
      const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      await db.query(
        `UPDATE hrm_schema.auto_attendance_employees
            SET to_date = LEAST(COALESCE(to_date, $2::date), $2::date), removed_at=now(), removed_by=$3, updated_by=$3, updated_at=now()
          WHERE id=$1`,
        [id, yesterday, principal.userId],
      );
      await lifecycleAudit(db, tenantId, principal.userId, 'AUTO_ATTENDANCE_EMPLOYEE_REMOVED', id, {
        employeeId: previous.employee_id,
        before: present(previous),
      });
      return (await db.query<Row>(`${SELECT_ROWS} WHERE a.id=$1`, [id])).rows[0];
    });
    return { data: present(removed) };
  }
}
