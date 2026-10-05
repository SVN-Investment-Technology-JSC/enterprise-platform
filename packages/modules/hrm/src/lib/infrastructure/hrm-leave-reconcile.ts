import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface LeaveReconcileRow {
  balanceId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  remaining: number;
  ledgerSum: number;
  ledgerDifference: number;
  formulaDifference: number;
}

export function summarizeReconciliation(
  year: number,
  rows: Record<string, unknown>[],
) {
  const all: LeaveReconcileRow[] = rows.map((r) => {
    const remaining = Number(r.remaining),
      ledgerSum = Number(r.ledger_sum),
      formula = Number(r.formula);
    return {
      balanceId: String(r.id),
      employeeId: String(r.employee_id),
      leaveTypeId: String(r.leave_type_id),
      year: Number(r.year),
      remaining,
      ledgerSum,
      ledgerDifference: Math.round((remaining - ledgerSum) * 100) / 100,
      formulaDifference: Math.round((remaining - formula) * 100) / 100,
    };
  });
  const mismatches = all.filter(
    (r) =>
      Math.abs(r.ledgerDifference) > 0.005 ||
      Math.abs(r.formulaDifference) > 0.005,
  );
  return {
    year,
    checked: all.length,
    mismatchCount: mismatches.length,
    mismatches,
  };
}

/** Read-only: compares leave_balances.remaining with the ledger sum and with opening+accrued+adjusted-used. */
export async function reconcileLeaveBalances(
  db: Queryable,
  tenant: string,
  year: number,
) {
  const result = await db.query(
    `SELECT b.id,b.employee_id,b.leave_type_id,b.year,b.remaining,
       COALESCE(l.total,0) AS ledger_sum,
       b.opening_balance+b.accrued+b.adjusted-b.used AS formula
     FROM hrm_schema.leave_balances b
     LEFT JOIN (SELECT employee_id,leave_type_id,balance_year,sum(days_changed) AS total FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND balance_year IS NOT NULL GROUP BY 1,2,3) l
       ON l.employee_id=b.employee_id AND l.leave_type_id=b.leave_type_id AND l.balance_year=b.year
     WHERE b.tenant_id=$1 AND b.year=$2 ORDER BY b.employee_id,b.leave_type_id`,
    [tenant, year],
  );
  return summarizeReconciliation(year, result.rows);
}

/** Read-only: remaining leave per type for one employee at a date (input for offboarding; never pays out). */
export async function leaveBalanceAtDate(
  db: Queryable,
  tenant: string,
  employeeId: string,
  date: string,
) {
  const year = Number(date.slice(0, 4));
  const result = await db.query(
    `SELECT t.id,t.code,t.name,t.unit,b.remaining,b.pending,
       COALESCE((SELECT sum(c.amount-c.used-c.reserved-c.expired) FROM hrm_schema.leave_carryovers c WHERE c.tenant_id=b.tenant_id AND c.employee_id=b.employee_id AND c.leave_type_id=b.leave_type_id AND c.target_year=b.year AND c.expires_on<$4::date),0) AS expired_carry
     FROM hrm_schema.leave_balances b JOIN hrm_schema.leave_types t ON t.id=b.leave_type_id AND t.tenant_id=b.tenant_id
     WHERE b.tenant_id=$1 AND b.employee_id=$2 AND b.year=$3 AND t.deduct_balance=true ORDER BY t.code`,
    [tenant, employeeId, year, date],
  );
  const items = result.rows.map((r) => {
    const remaining = Number(r.remaining),
      pending = Number(r.pending),
      expiredCarryover = Number(r.expired_carry);
    return {
      leaveTypeId: r.id as string,
      code: r.code as string,
      name: r.name as string,
      unit: r.unit as string,
      year,
      remaining,
      pending,
      expiredCarryover,
      remainingAtDate: Math.max(
        0,
        Math.round((remaining - pending - expiredCarryover) * 100) / 100,
      ),
    };
  });
  return { employeeId, asOfDate: date, items };
}

/** Read-only checklist for the end-of-year leave tasks. */
export async function yearEndChecklist(
  db: Queryable,
  tenant: string,
  today: string,
  carryoverEnabled: boolean,
) {
  const year = Number(today.slice(0, 4));
  const daysToYearEnd = Math.round(
    (Date.parse(`${year}-12-31`) - Date.parse(today)) / 86400000,
  );
  const [types, carry, expired, rec] = await Promise.all([
    db.query(
      `SELECT code,name,max_carryover_days,carryover_expiry_month FROM hrm_schema.leave_types WHERE tenant_id=$1 AND active=true AND carryover_allowed=true ORDER BY code`,
      [tenant],
    ),
    db.query(
      `SELECT target_year,count(*)::int AS n FROM hrm_schema.leave_carryovers WHERE tenant_id=$1 AND target_year IN ($2,$3) GROUP BY 1`,
      [tenant, year, year + 1],
    ),
    db.query(
      `SELECT count(*)::int AS n FROM hrm_schema.leave_carryovers WHERE tenant_id=$1 AND expires_on<$2::date AND amount-used-reserved-expired>0`,
      [tenant, today],
    ),
    reconcileLeaveBalances(db, tenant, year),
  ]);
  const created = (y: number) =>
    carry.rows.find((r) => r.target_year === y)?.n ?? 0;
  return {
    year,
    daysToYearEnd,
    carryoverEnabled,
    carryoverTypes: types.rows.map((t) => ({
      code: t.code as string,
      name: t.name as string,
      maxCarryoverDays: Number(t.max_carryover_days),
      expiryMonth: Number(t.carryover_expiry_month),
    })),
    carryoversCurrentYear: created(year),
    carryoversNextYear: created(year + 1),
    expiredPendingCount: expired.rows[0].n as number,
    reconcileMismatchCount: rec.mismatchCount,
    warnCarryoverOff: !carryoverEnabled && daysToYearEnd <= 60,
  };
}
