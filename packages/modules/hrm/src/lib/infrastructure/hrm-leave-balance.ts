import type { PoolClient } from 'pg';
export async function ensureLeaveBalance(
  db: PoolClient,
  tenant: string,
  employee: string,
  type: string,
  year: number,
) {
  await db.query(
    `INSERT INTO hrm_schema.leave_balances (tenant_id,employee_id,leave_type_id,year) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [tenant, employee, type, year],
  );
  const result = await db.query(
    `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 FOR UPDATE`,
    [tenant, employee, type, year],
  );
  return result.rows[0];
}
