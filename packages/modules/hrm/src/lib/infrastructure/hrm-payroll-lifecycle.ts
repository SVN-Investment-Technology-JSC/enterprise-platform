import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { assertLifecycleVersion } from './hrm-lifecycle.js';

/** Lock periods before runs, consistently with calculation/finalization. */
export async function invalidatePayrollRange(
  db: PoolClient,
  tenant: string,
  from: string,
  to: string | null = null,
) {
  const periods = await db.query(
    `SELECT id,status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND to_date>=$2::date AND ($3::date IS NULL OR from_date<=$3::date) ORDER BY id FOR UPDATE`,
    [tenant, from, to],
  );
  const ids = periods.rows.map((row) => row.id);
  const runs = await db.query(
    `SELECT id,status FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [tenant, ids],
  );
  if (
    periods.rows.some((row) => ['LOCKED', 'PAID'].includes(row.status)) ||
    runs.rows.some((row) => row.status === 'FINALIZED')
  )
    throw new ConflictException(
      'Đầu vào ảnh hưởng kỳ lương đã chốt; ghi nhận thay đổi ở kỳ sau',
    );
  await db.query(
    `UPDATE hrm_schema.payroll_runs SET status='DRAFT',calculated_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status NOT IN ('FINALIZED','CANCELLED')`,
    [tenant, runs.rows.map((row) => row.id)],
  );
}

export async function lockEmptyPayrollPeriod(
  db: PoolClient,
  tenant: string,
  id: string,
  expectedUpdatedAt: string,
) {
  const result = await db.query(
    'SELECT * FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [tenant, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy kỳ lương');
  assertLifecycleVersion(row, expectedUpdatedAt);
  const used = await db.query(
    `SELECT EXISTS(SELECT 1 FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=$2) OR EXISTS(SELECT 1 FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND payroll_period_id=$2) AS used`,
    [tenant, id],
  );
  if (row.status !== 'OPEN' || used.rows[0].used)
    throw new ConflictException(
      'Chỉ sửa/xóa kỳ trống chưa phát sinh lần tính hoặc lịch thu hồi tạm ứng',
    );
  return row;
}
