import { BadRequestException, NotFoundException } from '@nestjs/common';
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

export interface LeaveBalanceDelta {
  /** Change of `remaining`. Required so every caller states its effect on the available balance. */
  readonly remaining: number;
  readonly pending?: number;
  readonly used?: number;
  readonly accrued?: number;
  readonly adjusted?: number;
  readonly opening?: number;
}

const DELTA_FIELDS = [
  'remaining',
  'pending',
  'used',
  'accrued',
  'adjusted',
  'opening',
] as const;

/**
 * Single entry point for mutating leave_balances. Always scoped by tenant_id.
 * `minRemaining` (e.g. -negative_limit) is an optional invariant: the update is
 * rejected when it would push `remaining` below it. Callers that must record a
 * correction regardless of the limit (expiry, carry-over) omit it.
 */
export async function applyLeaveDelta(
  db: PoolClient,
  tenant: string,
  balanceId: string,
  delta: LeaveBalanceDelta,
  options: { minRemaining?: number } = {},
): Promise<{ remaining: number }> {
  for (const field of DELTA_FIELDS) {
    const value = delta[field] ?? 0;
    if (!Number.isFinite(value))
      throw new BadRequestException('Giá trị biến động quỹ phép không hợp lệ');
  }
  const result = await db.query(
    `UPDATE hrm_schema.leave_balances SET
       pending=GREATEST(0,pending+$3),
       used=used+$4,
       accrued=accrued+$5,
       adjusted=adjusted+$6,
       opening_balance=opening_balance+$7,
       remaining=remaining+$8,
       updated_at=now()
     WHERE tenant_id=$1 AND id=$2
       AND ($9::numeric IS NULL OR remaining+$8>=$9)
     RETURNING remaining`,
    [
      tenant,
      balanceId,
      delta.pending ?? 0,
      delta.used ?? 0,
      delta.accrued ?? 0,
      delta.adjusted ?? 0,
      delta.opening ?? 0,
      delta.remaining,
      options.minRemaining ?? null,
    ],
  );
  if (!result.rows[0]) {
    const exists = await db.query(
      `SELECT 1 FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND id=$2`,
      [tenant, balanceId],
    );
    if (!exists.rowCount)
      throw new NotFoundException('Không tìm thấy quỹ phép trong tenant');
    throw new BadRequestException('Biến động vượt hạn mức âm phép');
  }
  return { remaining: Number(result.rows[0].remaining) };
}
