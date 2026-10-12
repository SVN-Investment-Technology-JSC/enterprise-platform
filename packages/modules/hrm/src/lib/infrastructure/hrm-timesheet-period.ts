import { pendingCustomRequestCount } from './hrm-custom-request.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { isoDate } from './hrm-time.js';

/**
 * Luật khóa / mở lại kỳ công, dùng chung cho API kỳ công cũ (/timesheet-periods/:id/lock|reopen)
 * và API chốt tháng (/timesheet-months/:month/close|reopen). Phải chạy trong một giao dịch.
 */
export async function lockTimesheetPeriod(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  id: string,
  actorId: string,
): Promise<Record<string, unknown>> {
  const period = await db.query(
    `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, id],
  );
  if (!period.rows[0]) throw new NotFoundException('Không tìm thấy kỳ công');
  if (period.rows[0].status === 'LOCKED') return period.rows[0];
  const ready = await db.query(
    `SELECT $2::date < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ended, EXISTS(SELECT 1 FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$3) AS has_lines`,
    [tenantId, period.rows[0].to_date, id],
  );
  if (!ready.rows[0].ended || !ready.rows[0].has_lines)
    throw new BadRequestException('Chỉ khóa kỳ công đã kết thúc và có dữ liệu');
  if (!period.rows[0].calculated_at)
    throw new BadRequestException(
      'Cần tính lại bảng công sau thay đổi dữ liệu nguồn',
    );
  const issues = await db.query(
    `SELECT id FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND status='ABNORMAL' LIMIT 1`,
    [tenantId, id],
  );
  if (issues.rowCount)
    throw new BadRequestException(
      'Cần giải trình các dòng bất thường trước khi khóa kỳ',
    );
  const pending = await db.query(
    `SELECT id FROM hrm_schema.attendance_corrections WHERE tenant_id=$1 AND status='PENDING' AND request_date BETWEEN $2 AND $3 UNION ALL SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3 AND to_date>=$2 UNION ALL SELECT id FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND status='PENDING' AND work_date BETWEEN $2 AND $3 UNION ALL SELECT id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3 AND to_date>=$2 UNION ALL SELECT id FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND status IN ('PENDING','PEER_CONFIRMED') AND from_date<=$3 AND to_date>=$2 LIMIT 1`,
    [tenantId, period.rows[0].from_date, period.rows[0].to_date],
  );
  if (
    pending.rowCount ||
    (await pendingCustomRequestCount(
      db,
      tenantId,
      isoDate(period.rows[0].from_date),
      isoDate(period.rows[0].to_date),
    ))
  )
    throw new BadRequestException('Còn đơn chờ duyệt trong kỳ công');
  await lifecycleAudit(db, tenantId, actorId, 'TIMESHEET_PERIOD_LOCKED', id, {
    before: period.rows[0],
  });
  const locked = await db.query(
    `UPDATE hrm_schema.timesheet_periods SET status='LOCKED',locked_by=$3,locked_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenantId, id, actorId],
  );
  return locked.rows[0];
}

export async function reopenTimesheetPeriod(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  id: string,
  actorId: string,
  reason: string,
): Promise<Record<string, unknown>> {
  await db.query(
    `SELECT id FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND timesheet_period_id=$2 ORDER BY id FOR UPDATE`,
    [tenantId, id],
  );
  const runs = await db.query(
    `SELECT r.id,r.status FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND p.timesheet_period_id=$2 ORDER BY r.id FOR UPDATE OF r`,
    [tenantId, id],
  );
  if (runs.rows.some((r) => r.status === 'FINALIZED'))
    throw new BadRequestException(
      'Bảng công đã dùng cho lương chốt; cần quy trình điều chỉnh kỳ sau',
    );
  const before = await db.query(
    'SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [tenantId, id],
  );
  if (!before.rowCount) throw new NotFoundException('Không tìm thấy kỳ công');
  if (before.rows[0].status !== 'LOCKED')
    throw new ConflictException('Chỉ mở lại kỳ đã khóa');
  const result = await db.query(
    `UPDATE hrm_schema.timesheet_periods SET
        status = 'REOPENED', calculated_at=NULL, reopened_by = $3, reopened_at = now(), reopen_reason = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
    [tenantId, id, actorId, reason],
  );
  await db.query(
    `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status<>'CANCELLED'`,
    [tenantId, runs.rows.map((r) => r.id)],
  );
  await lifecycleAudit(
    db,
    tenantId,
    actorId,
    'TIMESHEET_PERIOD_REOPENED',
    id,
    { before: before.rows[0], reason },
  );
  return result.rows[0];
}
