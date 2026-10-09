import type { PoolClient } from 'pg';
import {
  eligibilityStart,
  lastWorkingDayFromInactive,
  monthlyEntitlement,
  type AnnualLeavePolicy,
  type MonthEntitlement,
  type SeniorityTier,
} from '../domain/annual-leave-entitlement.js';
import { firstOfficialContractSignDate } from './hrm-contracts.js';
import { isoDate } from './hrm-time.js';

/** Lịch cộng phép tính theo ngày ký HĐLĐ, kèm các mốc thâm niên. */
export interface ContractSchedule {
  readonly id: string;
  readonly leaveTypeId: string;
  readonly advanceAllowed: boolean;
  readonly policy: AnnualLeavePolicy;
}

export async function loadSeniorityTiers(
  db: PoolClient,
  tenant: string,
  scheduleIds: readonly string[],
): Promise<Map<string, SeniorityTier[]>> {
  const map = new Map<string, SeniorityTier[]>();
  if (!scheduleIds.length) return map;
  const rows = await db.query(
    `SELECT schedule_id,min_years,bonus_days FROM hrm_schema.leave_seniority_tiers WHERE tenant_id=$1 AND schedule_id = ANY($2::uuid[]) ORDER BY min_years`,
    [tenant, scheduleIds],
  );
  for (const row of rows.rows) {
    const list = map.get(row.schedule_id) ?? [];
    list.push({
      minYears: Number(row.min_years),
      bonusDays: Number(row.bonus_days),
    });
    map.set(row.schedule_id, list);
  }
  return map;
}

export function toContractSchedule(
  row: Record<string, any>,
  tiers: SeniorityTier[] = [],
): ContractSchedule {
  return {
    id: row.id,
    leaveTypeId: row.leave_type_id,
    advanceAllowed: Boolean(row.advance_allowed),
    policy: {
      annualDays: Number(row.annual_days ?? 0),
      startOffsetMonths: Number(row.start_offset_months ?? 0),
      tiers,
      effectiveFrom: isoDate(row.effective_from),
      effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    },
  };
}

/** Các lịch theo HĐ của loại nghỉ có hiệu lực giao với năm. */
export async function contractSchedulesForYear(
  db: PoolClient,
  tenant: string,
  leaveTypeId: string,
  year: number,
): Promise<ContractSchedule[]> {
  const rows = await db.query(
    `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND accrual_basis='CONTRACT_SIGN_DATE'
       AND effective_from<=make_date($3,12,31) AND (effective_to IS NULL OR effective_to>=make_date($3,1,1)) ORDER BY effective_from`,
    [tenant, leaveTypeId, year],
  );
  const tiers = await loadSeniorityTiers(
    db,
    tenant,
    rows.rows.map((r) => r.id),
  );
  return rows.rows.map((r) => toContractSchedule(r, tiers.get(r.id)));
}

export interface EmployeeEntitlement {
  readonly signDate: string | null;
  readonly startDate: string | null;
  readonly lastWorkingDay: string | null;
  readonly advanceAllowed: boolean;
  /** Tổng phép theo tháng (cộng các phiên bản lịch trong năm). */
  readonly months: MonthEntitlement[];
  readonly hasPolicy: boolean;
}

export async function employeeLastWorkingDay(
  db: PoolClient,
  tenant: string,
  employeeId: string,
): Promise<string | null> {
  const row = (
    await db.query(
      `SELECT inactive_from FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2`,
      [tenant, employeeId],
    )
  ).rows[0];
  return lastWorkingDayFromInactive(
    row?.inactive_from ? isoDate(row.inactive_from) : null,
  );
}

function mergeMonths(lists: MonthEntitlement[][]): MonthEntitlement[] {
  return Array.from({ length: 12 }, (_, i) => {
    const parts = lists.map((l) => l[i]);
    return {
      month: i + 1,
      counted: parts.some((p) => p.counted),
      base: Math.round(parts.reduce((n, p) => n + p.base, 0) * 100) / 100,
      seniority:
        Math.round(parts.reduce((n, p) => n + p.seniority, 0) * 100) / 100,
      tierYears: Math.max(0, ...parts.map((p) => p.tierYears)),
    };
  });
}

/**
 * Quỹ phép theo chính sách HĐ của một nhân viên trong năm.
 * `lastWorkingDay` undefined → đọc từ hồ sơ (nghỉ việc); null → bỏ qua (dự kiến).
 */
export async function employeeEntitlement(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  lastWorkingDay?: string | null,
): Promise<EmployeeEntitlement> {
  const schedules = await contractSchedulesForYear(
    db,
    tenant,
    leaveTypeId,
    year,
  );
  const last =
    lastWorkingDay === undefined
      ? await employeeLastWorkingDay(db, tenant, employeeId)
      : lastWorkingDay;
  const empty = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    counted: false,
    base: 0,
    seniority: 0,
    tierYears: 0,
  }));
  if (!schedules.length)
    return {
      signDate: null,
      startDate: null,
      lastWorkingDay: last,
      advanceAllowed: false,
      months: empty,
      hasPolicy: false,
    };
  const signDate = await firstOfficialContractSignDate(db, tenant, employeeId);
  const current = schedules[schedules.length - 1];
  return {
    signDate,
    startDate: signDate
      ? eligibilityStart(signDate, current.policy.startOffsetMonths)
      : null,
    lastWorkingDay: last,
    advanceAllowed: current.advanceAllowed,
    months: signDate
      ? mergeMonths(
          schedules.map((s) =>
            monthlyEntitlement(s.policy, signDate, year, last),
          ),
        )
      : empty,
    hasPolicy: true,
  };
}

/**
 * Phần quỹ chưa ghi sổ nhưng được phép dùng ngay:
 * - cho ứng phép: tới hết tháng 12 (trừ khi đã nghỉ việc);
 * - không cho ứng: tới tháng hiện tại.
 * Trả 0 khi loại nghỉ không có lịch theo HĐ.
 */
export async function unpostedUsableEntitlement(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  accruedInLedger: number,
  today: string,
): Promise<{ extra: number; projected: number | null; advanceAllowed: boolean }> {
  const ent = await employeeEntitlement(
    db,
    tenant,
    employeeId,
    leaveTypeId,
    year,
  );
  if (!ent.hasPolicy) return { extra: 0, projected: null, advanceAllowed: false };
  const currentYear = Number(today.slice(0, 4)),
    currentMonth = Number(today.slice(5, 7));
  const through = ent.advanceAllowed
    ? 12
    : year < currentYear
      ? 12
      : year > currentYear
        ? 0
        : currentMonth;
  const usable = ent.months
    .filter((m) => m.month <= through)
    .reduce((n, m) => n + m.base + m.seniority, 0);
  const projected = ent.months.reduce((n, m) => n + m.base + m.seniority, 0);
  return {
    extra: Math.max(0, Math.round((usable - accruedInLedger) * 100) / 100),
    projected: Math.round(projected * 100) / 100,
    advanceAllowed: ent.advanceAllowed,
  };
}

/** Bổ sung quỹ dự kiến và số ngày có thể dùng (gồm phần ứng phép) cho các dòng leave_balances. */
export async function enrichLeaveBalances<T extends Record<string, any>>(
  db: PoolClient,
  tenant: string,
  rows: T[],
): Promise<
  (T & {
    projected_entitlement: number | null;
    available: number;
    advance_allowed: boolean;
  })[]
> {
  const today = isoDate(
    (await db.query('SELECT CURRENT_DATE AS today')).rows[0].today,
  );
  const out = [];
  for (const row of rows) {
    const usable = await unpostedUsableEntitlement(
      db,
      tenant,
      row.employee_id,
      row.leave_type_id,
      Number(row.year),
      Number(row.accrued),
      today,
    );
    out.push({
      ...row,
      projected_entitlement: usable.projected,
      advance_allowed: usable.advanceAllowed,
      available:
        Math.round(
          (Number(row.remaining) + usable.extra) * 100,
        ) / 100,
    });
  }
  return out;
}
