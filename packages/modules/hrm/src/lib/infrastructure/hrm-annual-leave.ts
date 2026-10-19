import type { PoolClient } from 'pg';
import {
  eligibilityStart,
  lastWorkingDayFromInactive,
  monthlyEntitlement,
  type AnnualLeavePolicy,
  type MonthEntitlement,
  type SeniorityTier,
} from '../domain/annual-leave-entitlement.js';
import { OFFICIAL_CONTRACT_TYPES } from './hrm-contracts.js';
import { isoDate } from './hrm-time.js';

/** Lịch cộng phép tính theo ngày ký HĐLĐ, kèm các mốc thâm niên. */
export interface ContractSchedule {
  readonly id: string;
  readonly leaveTypeId: string;
  readonly advanceAllowed: boolean;
  readonly policy: AnnualLeavePolicy;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function loadSeniorityTiers(
  db: Pick<PoolClient, 'query'>,
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

/** Lịch có hiệu lực giao với năm (kể cả hai đầu). */
function overlapsYear(schedule: ContractSchedule, year: number): boolean {
  return (
    schedule.policy.effectiveFrom <= `${year}-12-31` &&
    (!schedule.policy.effectiveTo || schedule.policy.effectiveTo >= `${year}-01-01`)
  );
}

/** Các lịch theo HĐ của loại nghỉ có hiệu lực giao với năm. */
export async function contractSchedulesForYear(
  db: Pick<PoolClient, 'query'>,
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
  db: Pick<PoolClient, 'query'>,
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

/** Gộp phép từng tháng của nhiều phiên bản lịch trong cùng năm (thâm niên không cộng trùng giữa các phiên bản). */
export function mergeMonths(lists: MonthEntitlement[][]): MonthEntitlement[] {
  // Thâm niên cộng nguyên ngày theo mốc nên không được cộng trùng giữa các phiên bản lịch:
  // lấy luỹ kế cao nhất của các phiên bản đến từng tháng rồi tính phần tăng thêm.
  const cumulative = lists.map((l) => {
    let total = 0;
    return l.map((m) => (total = Math.round((total + m.seniority) * 100) / 100));
  });
  let previousSeniority = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const parts = lists.map((l) => l[i]);
    const seniorityCumulative = Math.max(...cumulative.map((c) => c[i]));
    const seniority =
      Math.round((seniorityCumulative - previousSeniority) * 100) / 100;
    previousSeniority = seniorityCumulative;
    return {
      month: i + 1,
      counted: parts.some((p) => p.counted),
      base: Math.round(parts.reduce((n, p) => n + p.base, 0) * 100) / 100,
      seniority,
      tierYears: Math.max(0, ...parts.map((p) => p.tierYears)),
    };
  });
}

const EMPTY_MONTHS = (): MonthEntitlement[] =>
  Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    counted: false,
    base: 0,
    seniority: 0,
    tierYears: 0,
  }));

/**
 * Quỹ phép của MỘT nhân viên trong năm, tính thuần từ các lịch của năm, ngày ký HĐLĐ chính thức đầu tiên và ngày làm việc
 * cuối cùng. Không đọc cơ sở dữ liệu: cả luồng tính từng người lẫn luồng tính hàng loạt dùng chung hàm này.
 */
export function entitlementOf(
  schedules: readonly ContractSchedule[],
  signDate: string | null,
  year: number,
  lastWorkingDay: string | null,
): EmployeeEntitlement {
  if (!schedules.length)
    return {
      signDate: null,
      startDate: null,
      lastWorkingDay,
      advanceAllowed: false,
      months: EMPTY_MONTHS(),
      hasPolicy: false,
    };
  const current = schedules[schedules.length - 1];
  return {
    signDate,
    startDate: signDate
      ? eligibilityStart(signDate, current.policy.startOffsetMonths)
      : null,
    lastWorkingDay,
    advanceAllowed: current.advanceAllowed,
    months: signDate
      ? mergeMonths(
          schedules.map((s) =>
            monthlyEntitlement(s.policy, signDate, year, lastWorkingDay),
          ),
        )
      : EMPTY_MONTHS(),
    hasPolicy: true,
  };
}

/** Ngày ký HĐLĐ chính thức đầu tiên của nhiều nhân viên trong MỘT truy vấn (cùng quy tắc `firstOfficialContractSignDate`). */
export async function loadSignDates(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeIds: readonly string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>(employeeIds.map((id) => [id, null]));
  if (!employeeIds.length) return map;
  const rows = await db.query(
    `SELECT employee_id,min(sign_date) AS sign_date FROM hrm_schema.employment_contracts
      WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND parent_contract_id IS NULL AND deleted_at IS NULL
        AND sign_date IS NOT NULL AND contract_type = ANY($3::text[]) AND status IN ('ACTIVE','TERMINATED')
      GROUP BY employee_id`,
    [tenant, employeeIds, OFFICIAL_CONTRACT_TYPES],
  );
  for (const row of rows.rows)
    map.set(row.employee_id, row.sign_date ? isoDate(row.sign_date) : null);
  return map;
}

/** Ngày làm việc cuối cùng (nghỉ việc) của nhiều nhân viên trong MỘT truy vấn; null = còn làm. */
export async function loadLastWorkingDays(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeIds: readonly string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>(employeeIds.map((id) => [id, null]));
  if (!employeeIds.length) return map;
  const rows = await db.query(
    `SELECT employee_id,inactive_from FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[])`,
    [tenant, employeeIds],
  );
  for (const row of rows.rows)
    map.set(
      row.employee_id,
      lastWorkingDayFromInactive(row.inactive_from ? isoDate(row.inactive_from) : null),
    );
  return map;
}

/**
 * Lịch theo HĐ của nhiều (loại nghỉ, năm) trong HAI truy vấn (lịch và mốc thâm niên). Khoá: `${loại nghỉ}:${năm}`.
 */
export async function loadContractSchedules(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  keys: readonly { leaveTypeId: string; year: number }[],
): Promise<Map<string, ContractSchedule[]>> {
  const result = new Map<string, ContractSchedule[]>();
  const typeIds = [...new Set(keys.map((k) => k.leaveTypeId))];
  if (!typeIds.length) return result;
  const rows = await db.query(
    `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id = ANY($2::uuid[]) AND accrual_basis='CONTRACT_SIGN_DATE' ORDER BY effective_from`,
    [tenant, typeIds],
  );
  const tiers = await loadSeniorityTiers(
    db,
    tenant,
    rows.rows.map((r) => r.id),
  );
  const all = rows.rows.map((r) => toContractSchedule(r, tiers.get(r.id)));
  for (const { leaveTypeId, year } of keys) {
    const key = `${leaveTypeId}:${year}`;
    if (!result.has(key))
      result.set(
        key,
        all.filter((s) => s.leaveTypeId === leaveTypeId && overlapsYear(s, year)),
      );
  }
  return result;
}

/**
 * Quỹ phép theo chính sách HĐ của một nhân viên trong năm.
 * `lastWorkingDay` undefined → đọc từ hồ sơ (nghỉ việc); null → bỏ qua (dự kiến).
 */
export async function employeeEntitlement(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  lastWorkingDay?: string | null,
): Promise<EmployeeEntitlement> {
  const schedules = await contractSchedulesForYear(db, tenant, leaveTypeId, year);
  const last =
    lastWorkingDay === undefined
      ? await employeeLastWorkingDay(db, tenant, employeeId)
      : lastWorkingDay;
  if (!schedules.length) return entitlementOf([], null, year, last);
  const signDate = (await loadSignDates(db, tenant, [employeeId])).get(employeeId) ?? null;
  return entitlementOf(schedules, signDate, year, last);
}

export interface UsableEntitlement {
  /** Phần quỹ chưa ghi sổ nhưng được dùng ngay (cộng chưa chạy, ứng phép); không âm. */
  readonly extra: number;
  readonly projected: number | null;
  readonly projectedSeniority: number;
  readonly advanceAllowed: boolean;
  /** Số ngày phép đã tích luỹ đến thời điểm hiện tại theo chính sách (không tính ứng trước). */
  readonly entitledToDate: number | null;
}

/**
 * Phần quỹ được phép dùng theo chính sách:
 * - cho ứng phép: tới hết tháng 12 (trừ khi đã nghỉ việc);
 * - không cho ứng: tới tháng hiện tại.
 * Trả 0 khi loại nghỉ không có lịch theo HĐ. `accruedInLedger` là số đã ghi sổ phép năm đó.
 */
export function usableFrom(
  ent: EmployeeEntitlement,
  year: number,
  accruedInLedger: number,
  today: string,
): UsableEntitlement {
  if (!ent.hasPolicy)
    return {
      extra: 0,
      projected: null,
      projectedSeniority: 0,
      advanceAllowed: false,
      entitledToDate: null,
    };
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
  const projectedSeniority = ent.months.reduce((n, m) => n + m.seniority, 0);
  const accruedLimit =
    year < currentYear ? 12 : year > currentYear ? 0 : currentMonth;
  const entitledToDate = ent.months
    .filter((m) => m.month <= accruedLimit)
    .reduce((n, m) => n + m.base + m.seniority, 0);
  return {
    extra: Math.max(0, round2(usable - accruedInLedger)),
    projected: round2(projected),
    projectedSeniority: round2(projectedSeniority),
    advanceAllowed: ent.advanceAllowed,
    entitledToDate: round2(entitledToDate),
  };
}

/** Như `usableFrom` nhưng tự đọc chính sách và hồ sơ của một nhân viên. */
export async function unpostedUsableEntitlement(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  accruedInLedger: number,
  today: string,
): Promise<UsableEntitlement> {
  const ent = await employeeEntitlement(db, tenant, employeeId, leaveTypeId, year);
  return usableFrom(ent, year, accruedInLedger, today);
}

/**
 * Số ngày phép của các đơn đang chờ duyệt (đã giữ quỹ, quỹ chưa trừ) theo (nhân viên, loại nghỉ, năm) trong MỘT truy vấn.
 * Khoá: `${nhân viên}:${loại nghỉ}:${năm}`. Cùng quy tắc với `pendingReservedDays` (từng người).
 */
export async function loadPendingReserved(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeIds: readonly string[],
  leaveTypeIds: readonly string[],
  years: readonly number[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!employeeIds.length || !leaveTypeIds.length || !years.length) return map;
  const rows = await db.query(
    `SELECT r.employee_id,r.leave_type_id,extract(year FROM d.work_date)::int AS year,COALESCE(sum(d.quantity),0)::float AS days
       FROM hrm_schema.leave_request_days d
       JOIN hrm_schema.leave_requests r ON r.id=d.request_id AND r.tenant_id=d.tenant_id
      WHERE r.tenant_id=$1 AND r.employee_id = ANY($2::uuid[]) AND r.leave_type_id = ANY($3::uuid[])
        AND r.status='PENDING'
        AND extract(year FROM d.work_date)::int = ANY($4::int[])
      GROUP BY r.employee_id,r.leave_type_id,extract(year FROM d.work_date)::int`,
    [tenant, employeeIds, leaveTypeIds, years],
  );
  for (const row of rows.rows)
    map.set(`${row.employee_id}:${row.leave_type_id}:${row.year}`, Number(row.days));
  return map;
}

export interface EnrichedLeaveBalance {
  readonly projected_entitlement: number | null;
  readonly projected_seniority: number;
  readonly available: number;
  /** Ngày phép của đơn đang chờ duyệt (từ leave_requests); `leave_balances.pending` không còn được ghi khi gửi đơn. */
  readonly pending_reserved: number;
  readonly advance_allowed: boolean;
  /** Số ngày phép đã tích luỹ đến nay theo chính sách (không tính ứng phép). */
  readonly entitled_to_date: number | null;
  /** Ngày ký HĐLĐ chính thức đầu tiên (căn cứ tính phép); null khi chưa có. */
  readonly sign_date: string | null;
  /** Ngày bắt đầu hưởng phép = ngày ký HĐ + số tháng bắt đầu của chính sách. */
  readonly eligible_from: string | null;
  /** Mốc thâm niên cao nhất đã đạt trong năm (số năm), 0 nếu chưa có. */
  readonly seniority_tier_years: number;
}

/**
 * Bổ sung quỹ dự kiến, thâm niên và số ngày có thể dùng (gồm phần ứng phép) cho các dòng leave_balances.
 * Dùng số lượng truy vấn CỐ ĐỊNH (không phụ thuộc số dòng): lịch + mốc thâm niên, ngày ký HĐ, ngày nghỉ việc
 * đều nạp một lần cho cả danh sách rồi tính trong bộ nhớ.
 */
export async function enrichLeaveBalances<T extends Record<string, any>>(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  rows: T[],
): Promise<(T & EnrichedLeaveBalance)[]> {
  if (!rows.length) return [];
  const today = isoDate(
    (await db.query('SELECT CURRENT_DATE AS today')).rows[0].today,
  );
  const employeeIds = [...new Set(rows.map((r) => String(r.employee_id)))];
  const leaveTypeIds = [...new Set(rows.map((r) => String(r.leave_type_id)))];
  const years = [...new Set(rows.map((r) => Number(r.year)))];
  const schedules = await loadContractSchedules(
    db,
    tenant,
    rows.map((r) => ({ leaveTypeId: String(r.leave_type_id), year: Number(r.year) })),
  );
  const hasAnyPolicy = [...schedules.values()].some((list) => list.length > 0);
  const [signDates, lastDays] = hasAnyPolicy
    ? await Promise.all([
        loadSignDates(db, tenant, employeeIds),
        loadLastWorkingDays(db, tenant, employeeIds),
      ])
    : [new Map<string, string | null>(), new Map<string, string | null>()];
  // Đơn nghỉ đang chờ duyệt đã chiếm quỹ: trừ khỏi số có thể dùng để form và chốt chặn gửi đơn khớp nhau.
  const pending = await loadPendingReserved(db, tenant, employeeIds, leaveTypeIds, years);
  return rows.map((row) => {
    const year = Number(row.year);
    const list = schedules.get(`${row.leave_type_id}:${year}`) ?? [];
    const ent = entitlementOf(
      list,
      signDates.get(String(row.employee_id)) ?? null,
      year,
      lastDays.get(String(row.employee_id)) ?? null,
    );
    const usable = usableFrom(ent, year, Number(row.accrued), today);
    const reserved = pending.get(`${row.employee_id}:${row.leave_type_id}:${year}`) ?? 0;
    return {
      ...row,
      projected_entitlement: usable.projected,
      projected_seniority: usable.projectedSeniority,
      advance_allowed: usable.advanceAllowed,
      entitled_to_date: usable.entitledToDate,
      sign_date: ent.signDate,
      eligible_from: ent.startDate,
      seniority_tier_years: Math.max(0, ...ent.months.map((m) => m.tierYears)),
      available: round2(Number(row.remaining) + usable.extra - reserved),
      pending_reserved: reserved,
    };
  });
}
