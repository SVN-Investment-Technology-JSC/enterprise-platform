import type { PoolClient } from 'pg';
import { isoDate } from './hrm-time.js';
import {
  advanceHeadroom,
  projectedYearEntitlement,
  type AccrualTiming,
  type BasisDateSource,
  type PolicyContract,
  type PolicyEmployee,
  type PolicySchedule,
  type SeniorityMilestone,
} from './hrm-leave-policy.js';

type Queryable = Pick<PoolClient, 'query'>;

export function toPolicySchedule(
  row: Record<string, unknown>,
  milestones: readonly SeniorityMilestone[] = [],
): PolicySchedule {
  return {
    accrualFrequency: String(row.accrual_frequency),
    accrualAmount: Number(row.accrual_amount),
    prorationRule: (row.proration_rule as string | null) ?? null,
    seniorityBonusYears: Number(row.seniority_bonus_years ?? 0),
    seniorityBonusDays: Number(row.seniority_bonus_days ?? 0),
    effectiveFrom: isoDate(row.effective_from),
    effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    basisDateSource: ((row.basis_date_source as string) ||
      'JOIN_DATE') as BasisDateSource,
    startDelayMonths: Number(row.start_delay_months ?? 0),
    accrualTiming: ((row.accrual_timing as string) ||
      'END_OF_MONTH') as AccrualTiming,
    milestones,
  };
}

/** Mốc thâm niên theo lịch (đã lọc tenant), nhóm theo schedule_id. */
export async function loadMilestones(
  db: Queryable,
  tenant: string,
  scheduleIds: readonly string[],
): Promise<Map<string, SeniorityMilestone[]>> {
  const map = new Map<string, SeniorityMilestone[]>();
  if (!scheduleIds.length) return map;
  const rows = (
    await db.query(
      `SELECT schedule_id,years,extra_days FROM hrm_schema.leave_seniority_milestones WHERE tenant_id=$1 AND schedule_id=ANY($2::uuid[]) ORDER BY years`,
      [tenant, scheduleIds],
    )
  ).rows;
  for (const r of rows) {
    const list = map.get(r.schedule_id) ?? [];
    list.push({ years: Number(r.years), extraDays: Number(r.extra_days) });
    map.set(r.schedule_id, list);
  }
  return map;
}

/** Lịch cộng phép của một loại nghỉ giao với năm `year`, kèm mốc thâm niên. */
export async function loadYearSchedules(
  db: Queryable,
  tenant: string,
  leaveTypeId: string,
  year: number,
): Promise<{ id: string; schedule: PolicySchedule }[]> {
  const rows = (
    await db.query(
      `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND effective_from<=$4::date AND (effective_to IS NULL OR effective_to>=$3::date)`,
      [tenant, leaveTypeId, `${year}-01-01`, `${year}-12-31`],
    )
  ).rows;
  const ms = await loadMilestones(
    db,
    tenant,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id as string,
    schedule: toPolicySchedule(r, ms.get(r.id) ?? []),
  }));
}

export async function loadEmployeePolicy(
  db: Queryable,
  tenant: string,
  employeeId: string,
): Promise<PolicyEmployee | null> {
  const profile = (
    await db.query(
      `SELECT join_date,inactive_from,employment_status FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL`,
      [tenant, employeeId],
    )
  ).rows[0];
  if (!profile) return null;
  const contracts = await loadContracts(db, tenant, [employeeId]);
  return {
    joinDate: isoDate(profile.join_date),
    contracts: contracts.get(employeeId) ?? [],
    terminationDate:
      profile.inactive_from &&
      ['RESIGNED', 'TERMINATED'].includes(profile.employment_status)
        ? isoDate(profile.inactive_from)
        : null,
  };
}

export async function loadContracts(
  db: Queryable,
  tenant: string,
  employeeIds: readonly string[],
): Promise<Map<string, PolicyContract[]>> {
  const map = new Map<string, PolicyContract[]>();
  if (!employeeIds.length) return map;
  const rows = (
    await db.query(
      `SELECT employee_id,contract_type,sign_date,effective_from,effective_to,status FROM hrm_schema.employment_contracts WHERE tenant_id=$1 AND employee_id=ANY($2::uuid[]) AND deleted_at IS NULL`,
      [tenant, employeeIds],
    )
  ).rows;
  for (const r of rows) {
    const list = map.get(r.employee_id) ?? [];
    list.push({
      contractType: String(r.contract_type),
      signDate: r.sign_date ? isoDate(r.sign_date) : null,
      effectiveFrom: isoDate(r.effective_from),
      effectiveTo: r.effective_to ? isoDate(r.effective_to) : null,
      status: String(r.status),
    });
    map.set(r.employee_id, list);
  }
  return map;
}

/** Ngày hiện tại theo múi giờ tenant (automation_settings.timezone), không dùng UTC thô. */
export async function tenantToday(
  db: Queryable,
  tenant: string,
): Promise<string> {
  const row = (
    await db.query(
      `SELECT to_char(now() AT TIME ZONE COALESCE((SELECT timezone FROM hrm_schema.automation_settings WHERE tenant_id=$1),'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') AS today`,
      [tenant],
    )
  ).rows[0];
  return row?.today ?? new Date().toISOString().slice(0, 10);
}

/**
 * Phần có thể ứng thêm (quỹ cả năm dự kiến - đã cộng) cho một nhân viên/loại nghỉ/năm.
 * Trả 0 khi loại nghỉ tắt ứng phép hoặc chưa có lịch/mốc tính phép.
 */
export async function loadAdvanceHeadroom(
  db: Queryable,
  tenant: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  accruedSoFar: number,
  allowAdvance: boolean,
  today?: string,
): Promise<number> {
  if (!allowAdvance) return 0;
  const employee = await loadEmployeePolicy(db, tenant, employeeId);
  if (!employee) return 0;
  const schedules = (await loadYearSchedules(db, tenant, leaveTypeId, year)).map(
    (s) => s.schedule,
  );
  const asOf = today ?? (await tenantToday(db, tenant));
  const projected = projectedYearEntitlement(schedules, employee, year, asOf);
  return advanceHeadroom(true, projected, accruedSoFar);
}

