import type { HrmOvertimeMonthSummary } from '@enterprise-platform/contracts-hrm';
import type { PoolClient } from 'pg';
import { addMonths } from '../domain/comp-off-ledger.js';
import { monthlyCapConfigOf, parseOvertimeCompPolicy, type OvertimeCompPolicy } from '../domain/overtime-comp-policy.js';
import { summarizeOvertimeMonth } from '../domain/overtime-monthly-cap.js';
import { ensureBlocksForMonth, loadOvertimeCompPolicy, snapshotColumnReady } from './hrm-overtime-blocks.js';
import { isoDate } from './hrm-time.js';

type Db = Pick<PoolClient, 'query'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Số liệu làm thêm một nhân viên trong một tháng, đủ để tính lương và quy đổi nghỉ bù (không kèm tên). */
export interface EmployeeOvertimeFigures {
  readonly employeeId: string;
  readonly actualOtHours: number;
  readonly countedOtHours: number;
  readonly nightHours: number;
  readonly excessOtHours: number;
  readonly compDays: number;
  readonly payrollHours: number;
  readonly nightRestDays: number;
  readonly blockCount: number;
}

/**
 * Ảnh chụp ghi vào `timesheet_periods.policy_snapshot` khi chốt công: cấu hình đã dùng và số liệu từng nhân viên.
 * Từ lúc chốt, lương và chuyển đổi nghỉ bù đọc ảnh này, không đọc lại chính sách hiện tại.
 */
export interface OvertimeCompSnapshot {
  readonly version: 1;
  readonly month: string;
  readonly capturedAt: string;
  readonly policyVersionId: string | null;
  readonly policy: OvertimeCompPolicy;
  readonly employees: Record<string, EmployeeOvertimeFigures>;
}

/** Tháng dương lịch của một kỳ công; null nếu kỳ không trùng đúng một tháng (kỳ tùy chỉnh cũ). */
export function calendarMonthOfPeriod(period: { from_date: unknown; to_date: unknown }): string | null {
  const from = isoDate(period.from_date);
  const to = isoDate(period.to_date);
  const month = from.slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return from === `${month}-01` && to === `${month}-${String(last).padStart(2, '0')}` ? month : null;
}

/**
 * Số liệu làm thêm của tháng cho các nhân viên có ca phân loại hoặc ngày nghỉ sau ca đêm trong tháng.
 * Trần năm áp theo giờ đã tính lương của các tháng trước trong cùng năm (mỗi tháng áp trần tháng của chính sách đang xét).
 */
export async function overtimeMonthFigures(
  db: Db,
  tenant: string,
  month: string,
  policy: OvertimeCompPolicy,
  employeeIds?: readonly string[],
): Promise<EmployeeOvertimeFigures[]> {
  const year = month.slice(0, 4);
  const ids = employeeIds?.length ? [...employeeIds] : null;
  const blocks = await db.query(
    `SELECT employee_id,period_month,sum(ot_hours_final)::float AS ot,sum(night_hours_final)::float AS night,count(*)::int AS n
       FROM hrm_schema.overtime_blocks
      WHERE tenant_id=$1 AND period_month>=$2 AND period_month<=$3 AND ($4::uuid[] IS NULL OR employee_id=ANY($4))
      GROUP BY employee_id,period_month`,
    [tenant, `${year}-01`, month, ids],
  );
  const rests = await db.query(
    `SELECT employee_id,sum(fraction)::float AS days FROM hrm_schema.night_rest_days
      WHERE tenant_id=$1 AND to_char(rest_date,'YYYY-MM')=$2 AND ($3::uuid[] IS NULL OR employee_id=ANY($3)) GROUP BY employee_id`,
    [tenant, month, ids],
  );
  const byEmployee = new Map<string, Map<string, { ot: number; night: number; n: number }>>();
  for (const row of blocks.rows) {
    const months = byEmployee.get(row.employee_id) ?? new Map();
    months.set(row.period_month, { ot: Number(row.ot), night: Number(row.night), n: Number(row.n) });
    byEmployee.set(row.employee_id, months);
  }
  const restDays = new Map<string, number>(rests.rows.map((r) => [r.employee_id as string, Number(r.days)]));
  for (const id of restDays.keys()) if (!byEmployee.has(id)) byEmployee.set(id, new Map());
  const config = monthlyCapConfigOf(policy);
  const out: EmployeeOvertimeFigures[] = [];
  for (const [employeeId, months] of byEmployee) {
    let yearToDate = 0;
    let current = summarizeOvertimeMonth({ otHours: 0, nightHours: 0 }, config);
    for (let m = `${year}-01`; m <= month; m = addMonths(m, 1)) {
      const figures = months.get(m) ?? { ot: 0, night: 0, n: 0 };
      current = summarizeOvertimeMonth(
        { otHours: figures.ot, nightHours: figures.night, yearToDateCountedOtHours: yearToDate },
        config,
      );
      if (m < month) yearToDate += current.countedOtHours;
    }
    const here = months.get(month);
    out.push({
      employeeId,
      actualOtHours: current.actualOtHours,
      countedOtHours: current.countedOtHours,
      nightHours: current.nightHours,
      excessOtHours: current.excessOtHours,
      compDays: current.compDays,
      payrollHours: current.payrollHours,
      nightRestDays: round2(restDays.get(employeeId) ?? 0),
      blockCount: here?.n ?? 0,
    });
  }
  return out.filter((f) => f.blockCount > 0 || f.nightRestDays > 0).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

/** Gắn mã và tên nhân viên vào số liệu để hiển thị. */
export async function withEmployeeNames(
  db: Db,
  tenant: string,
  month: string,
  figures: readonly EmployeeOvertimeFigures[],
): Promise<HrmOvertimeMonthSummary[]> {
  const names = await db.query(
    `SELECT employee_id,employee_code,full_name FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=ANY($2::uuid[])`,
    [tenant, figures.map((f) => f.employeeId)],
  );
  const map = new Map(names.rows.map((r) => [r.employee_id as string, r]));
  return figures
    .map((f) => ({
      ...f,
      month,
      employeeCode: (map.get(f.employeeId)?.employee_code as string | undefined) ?? null,
      employeeName: (map.get(f.employeeId)?.full_name as string | undefined) ?? null,
    }))
    .sort((a, b) => (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '') || a.employeeId.localeCompare(b.employeeId));
}

/**
 * Chụp chính sách và số liệu làm thêm của tháng vào kỳ công. Gọi khi khóa kỳ (cùng giao dịch). Kỳ không trùng một tháng
 * dương lịch, hoặc tháng chưa bật quy tắc, thì không chụp (policy_snapshot giữ NULL: lương dùng cách tính cũ).
 * Trả ảnh đã ghi hoặc null.
 */
export async function snapshotOvertimeComp(
  db: Db,
  tenant: string,
  actor: string,
  period: { id: string; from_date: unknown; to_date: unknown },
): Promise<OvertimeCompSnapshot | null> {
  const month = calendarMonthOfPeriod(period);
  if (!month) return null;
  const { policy, policyVersionId } = await loadOvertimeCompPolicy(db, tenant, month);
  // Chưa bật quy tắc: không chụp (policy_snapshot giữ NULL), lương và chuyển đổi coi như chưa bật.
  if (!policy.enabled) return null;
  await ensureBlocksForMonth(db, tenant, month, actor);
  const figures = await overtimeMonthFigures(db, tenant, month, policy);
  const snapshot: OvertimeCompSnapshot = {
    version: 1,
    month,
    capturedAt: new Date().toISOString(),
    policyVersionId,
    policy,
    employees: Object.fromEntries(figures.map((f) => [f.employeeId, f])),
  };
  await db.query(`UPDATE hrm_schema.timesheet_periods SET policy_snapshot=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [
    tenant,
    period.id,
    JSON.stringify(snapshot),
  ]);
  return snapshot;
}

/** Xóa ảnh chụp khi mở lại kỳ công: chốt lại sẽ chụp theo chính sách và số liệu mới. */
export async function clearOvertimeCompSnapshot(db: Db, tenant: string, periodId: string): Promise<void> {
  if (!(await snapshotColumnReady(db))) return;
  await db.query(`UPDATE hrm_schema.timesheet_periods SET policy_snapshot=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenant, periodId]);
}

/** Đọc ảnh chụp của kỳ công; null nếu chưa có hoặc không đúng định dạng. */
export function readOvertimeCompSnapshot(raw: unknown): OvertimeCompSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<OvertimeCompSnapshot> & { policy?: Record<string, unknown> };
  if (value.version !== 1 || typeof value.month !== 'string' || !value.employees) return null;
  return {
    version: 1,
    month: value.month,
    capturedAt: String(value.capturedAt ?? ''),
    policyVersionId: value.policyVersionId ?? null,
    // Đọc lại qua bộ đọc cấu hình để thiếu khóa thì có mặc định thay vì lỗi.
    policy: parseOvertimeCompPolicy({ overtimeComp: value.policy ?? {} }),
    employees: value.employees,
  };
}

/** Đầu vào lương liên quan làm thêm của một nhân viên: theo ảnh chụp khi bật quy tắc, ngược lại theo số cũ. */
export interface PayrollOvertimeInputs {
  readonly OT_COUNTED_MINUTES: number;
  readonly NIGHT_MINUTES: number;
  readonly OT_EXCESS_MINUTES: number;
  readonly NIGHT_REST_DAYS: number;
}

export function payrollOvertimeInputs(
  snapshot: OvertimeCompSnapshot | null,
  employeeId: string,
  legacyOtMinutes: number,
): PayrollOvertimeInputs {
  if (!snapshot?.policy.enabled)
    return { OT_COUNTED_MINUTES: legacyOtMinutes, NIGHT_MINUTES: 0, OT_EXCESS_MINUTES: 0, NIGHT_REST_DAYS: 0 };
  const f = snapshot.employees[employeeId];
  return {
    OT_COUNTED_MINUTES: Math.round((f?.countedOtHours ?? 0) * 60),
    NIGHT_MINUTES: Math.round((f?.nightHours ?? 0) * 60),
    OT_EXCESS_MINUTES: Math.round((f?.excessOtHours ?? 0) * 60),
    NIGHT_REST_DAYS: f?.nightRestDays ?? 0,
  };
}
