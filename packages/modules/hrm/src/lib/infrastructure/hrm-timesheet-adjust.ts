import type { AdjustTimesheetRequest } from '@enterprise-platform/contracts-hrm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { assertLifecycleVersion, timestamp } from './hrm-lifecycle.js';
import { requireText } from './hrm-validation.js';

export type AdjustTimesheetInput = Omit<AdjustTimesheetRequest, 'expectedUpdatedAt'> & {
  /** Bỏ trống: dùng phiên bản hiện tại của dòng (điều chỉnh theo ngày từ bảng công tháng). */
  expectedUpdatedAt?: string;
};

/**
 * Điều chỉnh tay một dòng công (số công hoặc phút công hưởng lương) của kỳ chưa khóa, có căn cứ bắt buộc và audit.
 * Dòng điều chỉnh được giữ qua các lần tính lại; nếu số liệu nguồn đổi thì dòng bị đánh dấu cần rà soát lại.
 * Dùng chung cho POST timesheets/:id/adjust và điều chỉnh theo ngày trên bảng công tháng. Phải chạy trong giao dịch.
 */
export async function adjustTimesheetLine(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  id: string,
  body: AdjustTimesheetInput,
): Promise<{ rows: Record<string, unknown>[] }> {
  const current = await db.query(
    `SELECT t.*,p.status AS period_status FROM hrm_schema.timesheets t JOIN hrm_schema.timesheet_periods p ON p.id=t.period_id AND p.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE OF p,t`,
    [tenantId, id],
  );
  if (!current.rows[0]) throw new NotFoundException('Không tìm thấy dòng công');
  if (current.rows[0].period_status === 'LOCKED') throw new BadRequestException('Kỳ công đã khóa');
  assertLifecycleVersion(current.rows[0], body.expectedUpdatedAt ?? timestamp(current.rows[0].updated_at));
  requireText(body.reason, 'Căn cứ điều chỉnh', 2000);
  if ((body.paidMinutes ?? 0) > current.rows[0].scheduled_minutes || (body.workdayUnits ?? 0) > 1)
    throw new BadRequestException('Điều chỉnh vượt định mức ca');
  const scheduled = Number(current.rows[0].scheduled_minutes);
  const paid =
    body.paidMinutes ??
    (body.workdayUnits !== undefined
      ? Math.round(body.workdayUnits * scheduled)
      : Number(current.rows[0].paid_minutes));
  const units = scheduled ? Math.round((paid / scheduled) * 10000) / 10000 : 0;
  if (body.workdayUnits !== undefined && Math.abs(body.workdayUnits - units) > 0.005)
    throw new BadRequestException('Số công và phút công hưởng lương không khớp');
  const changed = await db.query(
    `UPDATE hrm_schema.timesheets SET
        workday_units = COALESCE($3, workday_units),
        paid_minutes = COALESCE($4, paid_minutes),
        status = COALESCE($5, status),
        is_manually_adjusted = true,
        adjustment_needs_review = false,
        adjusted_by = $6,
        adjusted_reason = $7,
        updated_at = GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
    [tenantId, id, units, paid, 'ADJUSTED', actorId, body.reason],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'TIMESHEET_ADJUSTED',$3,$4)`,
    [tenantId, actorId, id, JSON.stringify({ before: current.rows[0], request: body })],
  );
  return changed;
}
