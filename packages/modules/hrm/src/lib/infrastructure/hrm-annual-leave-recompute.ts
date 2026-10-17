import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { applyLeaveDelta, ensureLeaveBalance } from './hrm-leave-balance.js';
import {
  contractSchedulesForYear,
  entitlementOf,
  loadLastWorkingDays,
  loadSignDates,
} from './hrm-annual-leave.js';
import { isoDate, lockEmployee } from './hrm-time.js';

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Tiền tố khoá giao dịch điều chỉnh do đổi chính sách; phần cuối là tháng cuối cùng được tính (YYYY-MM). */
export const RECALC_BASE_KEY = 'recalc-base:';
export const RECALC_SENIORITY_KEY = 'recalc-seniority:';

export interface RecomputeResult {
  readonly year: number;
  readonly employees: number;
  readonly adjusted: number;
}

/**
 * Tính lại phép năm đã ghi sổ của MỘT năm theo chính sách hiện hành (gọi trong giao dịch khi lưu chính sách).
 * Số phải có = tổng phép định mức và thâm niên từ tháng 1 đến tháng hiện tại (năm cũ: đủ 12 tháng) theo lịch của năm,
 * so với số đã ghi sổ (cộng hằng tháng + các lần tính lại trước). Chênh lệch ghi thành giao dịch ADJUSTMENT,
 * không sửa hay xoá giao dịch cũ nên vẫn truy vết được. Năm chưa tới thì không có gì để tính.
 */
export async function recomputeAnnualLeaveYear(
  db: PoolClient,
  tenant: string,
  actor: string,
  leaveTypeId: string,
  year: number,
  note: string,
): Promise<RecomputeResult> {
  const today = isoDate(
    (await db.query('SELECT CURRENT_DATE AS today')).rows[0].today,
  );
  const currentYear = Number(today.slice(0, 4));
  if (year > currentYear) return { year, employees: 0, adjusted: 0 };
  const through = year < currentYear ? 12 : Number(today.slice(5, 7));
  const schedules = await contractSchedulesForYear(db, tenant, leaveTypeId, year);
  if (!schedules.length) return { year, employees: 0, adjusted: 0 };

  const rows = await db.query(
    `SELECT employee_id FROM hrm_schema.employee_profiles
      WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date<=make_date($2,12,31)
        AND (employment_status NOT IN ('RESIGNED','TERMINATED') OR inactive_from>=make_date($2,1,1))
     UNION
     SELECT employee_id FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$3 AND year=$2`,
    [tenant, year, leaveTypeId],
  );
  const ids = rows.rows.map((r) => String(r.employee_id)).sort();
  const [signDates, lastDays] = await Promise.all([
    loadSignDates(db, tenant, ids),
    loadLastWorkingDays(db, tenant, ids),
  ]);
  const stamp = `${year}-${String(through).padStart(2, '0')}`;
  let adjusted = 0;
  for (const employeeId of ids) {
    const signDate = signDates.get(employeeId) ?? null;
    // Chưa có HĐLĐ chính thức thì chính sách theo HĐ không tính được: giữ nguyên số đã ghi sổ.
    if (!signDate) continue;
    await lockEmployee(db, tenant, employeeId);
    const entitlement = entitlementOf(
      schedules,
      signDate,
      year,
      lastDays.get(employeeId) ?? null,
    );
    const counted = entitlement.months.filter((m) => m.month <= through);
    const target = {
      base: round2(counted.reduce((n, m) => n + m.base, 0)),
      seniority: round2(counted.reduce((n, m) => n + m.seniority, 0)),
    };
    const posted = (
      await db.query(
        `SELECT COALESCE(sum(days_changed) FILTER (WHERE transaction_type='ACCRUAL' OR operation_key LIKE $5),0) AS base,
                COALESCE(sum(days_changed) FILTER (WHERE transaction_type='SENIORITY_ACCRUAL' OR operation_key LIKE $6),0) AS seniority
           FROM hrm_schema.leave_transactions
          WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND balance_year=$4`,
        [
          tenant,
          employeeId,
          leaveTypeId,
          year,
          `${RECALC_BASE_KEY}%`,
          `${RECALC_SENIORITY_KEY}%`,
        ],
      )
    ).rows[0];
    for (const [prefix, label, delta] of [
      [RECALC_BASE_KEY, 'định mức', round2(target.base - Number(posted.base))],
      [
        RECALC_SENIORITY_KEY,
        'thâm niên',
        round2(target.seniority - Number(posted.seniority)),
      ],
    ] as const) {
      if (Math.abs(delta) < 0.005) continue;
      const balance = await ensureLeaveBalance(db, tenant, employeeId, leaveTypeId, year);
      const updated = await applyLeaveDelta(db, tenant, balance.id, {
        accrued: delta,
        remaining: delta,
      });
      await db.query(
        `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,accrual_schedule_id,note,balance_year,operation_key,actor_id)
         VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8,$9,$10)`,
        [
          tenant,
          employeeId,
          leaveTypeId,
          delta,
          updated.remaining,
          schedules[schedules.length - 1].id,
          `${note} (${label})`,
          year,
          `${prefix}${randomUUID()}:${stamp}`,
          actor,
        ],
      );
      adjusted++;
    }
  }
  return { year, employees: ids.length, adjusted };
}
