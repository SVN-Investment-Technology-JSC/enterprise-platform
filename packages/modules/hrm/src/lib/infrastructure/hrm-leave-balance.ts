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

/**
 * Số ngày phép của các đơn nghỉ ĐANG CHỜ DUYỆT (cùng nhân viên, loại nghỉ, năm) mà quỹ phép chưa trừ.
 * `leave_balances.remaining` chỉ giảm khi đơn được duyệt nên nếu không tính phần này, nhiều đơn chờ duyệt có thể
 * cùng vượt quỹ và chỉ lỗi lúc duyệt. Theo migration 0035, đơn mới không còn ghi trạng thái giữ chỗ
 * vào sổ cái; vì vậy mọi đơn PENDING của cùng quỹ đều phải được tính.
 */
export async function pendingReservedDays(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employee: string,
  type: string,
  year: number,
): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(sum(d.quantity),0)::float AS days
       FROM hrm_schema.leave_request_days d
       JOIN hrm_schema.leave_requests r ON r.id=d.request_id AND r.tenant_id=d.tenant_id
      WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.leave_type_id=$3
        AND r.status='PENDING'
        AND extract(year FROM d.work_date)::int=$4`,
    [tenant, employee, type, year],
  );
  return Number(result.rows[0]?.days ?? 0);
}

/**
 * Quỹ phép của một nhân viên trong một năm: mọi dòng đã có trong sổ, cộng một dòng mặc định toàn 0 cho mỗi lý do
 * phép năm đang áp dụng mà nhân viên chưa có dòng quỹ năm đó (chưa chốt cộng phép lần nào). Dòng mặc định không ghi
 * DB; `enrichLeaveBalances` bổ sung phần quỹ dự kiến theo HĐLĐ nên form đơn nghỉ vẫn thấy phép được hưởng.
 */
export async function listEmployeeLeaveBalanceRows(
  db: PoolClient,
  tenant: string,
  employee: string,
  year: number,
) {
  const result = await db.query(
    `SELECT COALESCE(lb.id::text, '') AS id, lt.tenant_id, $2::uuid AS employee_id, lt.id AS leave_type_id, $3::int AS year,
            COALESCE(lb.opening_balance, 0) AS opening_balance, COALESCE(lb.accrued, 0) AS accrued,
            COALESCE(lb.used, 0) AS used, COALESCE(lb.pending, 0) AS pending,
            COALESCE(lb.adjusted, 0) AS adjusted, COALESCE(lb.remaining, 0) AS remaining,
            COALESCE(lb.seniority_days, 0) AS seniority_days, COALESCE(lb.carryover_remaining, 0) AS carryover_remaining,
            lb.carryover_expiry_date, COALESCE(lb.max_negative_allowed, 2.0) AS max_negative_allowed,
            COALESCE(lb.created_at, now()) AS created_at, COALESCE(lb.updated_at, now()) AS updated_at,
            (lb.id IS NOT NULL) AS has_balance
       FROM hrm_schema.leave_types lt
       LEFT JOIN hrm_schema.leave_balances lb ON lb.tenant_id = lt.tenant_id AND lb.employee_id = $2::uuid
         AND lb.leave_type_id = lt.id AND lb.year = $3::int
      WHERE lt.tenant_id = $1 AND lt.deleted_at IS NULL
        AND (lb.id IS NOT NULL OR (lt.is_annual AND lt.active))
      ORDER BY lt.name`,
    [tenant, employee, year],
  );
  return result.rows;
}

/**
 * Số ngày phép "Còn lại" hiển thị trong danh sách quỹ phép của HR.
 * Có chính sách HĐLĐ: số dùng được hiện tại (`available` = phần đã ghi sổ + phần đến hạn chưa ghi - đơn chờ duyệt), kể cả
 * nhân viên chưa có dòng quỹ của năm, để khớp với Bàn làm việc và form xin nghỉ. Không lấy định mức cả năm trừ đã dùng.
 * Không có chính sách: số `remaining` ghi sổ.
 */
export function displayedRemainingDays(
  row: { projected_entitlement?: unknown; available?: unknown; remaining?: unknown },
  entitlement: number,
  used: number,
): number {
  const hasPolicy = row.projected_entitlement != null;
  const value = hasPolicy ? Number(row.available ?? entitlement - used) : Number(row.remaining || 0);
  return Math.round(value * 100) / 100;
}
