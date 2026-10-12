import type { HrmPayrollTrace, HrmPayrollTraceDay } from '@enterprise-platform/contracts-hrm';
import { NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { timesheetFingerprint } from './hrm-payroll-calculation.js';
import { isoDate } from './hrm-time.js';

type Db = Pick<PoolClient, 'query'>;

/** Các đầu vào hệ thống của lương mà bảng công quyết định, đối chiếu với tổng từng ngày. */
const RECONCILED: readonly [input: string, total: keyof HrmPayrollTrace['totals']][] = [
  ['SCHEDULED_MINUTES', 'scheduledMinutes'],
  ['PAID_MINUTES', 'paidMinutes'],
  ['WORKED_MINUTES', 'workedMinutes'],
  ['OT_MINUTES', 'otMinutes'],
  ['LATE_MINUTES', 'lateMinutes'],
  ['EARLY_MINUTES', 'earlyMinutes'],
  ['TRIP_ALLOWANCE_AMOUNT', 'tripAllowanceAmount'],
];

/**
 * Truy vết lương của một nhân viên trong một lần tính: từng ngày công của kỳ công đã khóa (kèm đơn từ tác động), tổng
 * từng đầu vào hệ thống, và đối soát với con số đã dùng để tính lương. Lệch nghĩa là bảng công đã đổi sau khi tính.
 */
export async function payrollTrace(
  db: Db,
  tenant: string,
  runId: string,
  employeeId: string,
): Promise<HrmPayrollTrace> {
  const runResult = await db.query(
    `SELECT r.id,r.status,r.calculated_at,r.timesheet_fingerprint,p.from_date,p.to_date,p.timesheet_period_id
       FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND r.id=$2`,
    [tenant, runId],
  );
  const run = runResult.rows[0];
  if (!run) throw new NotFoundException('Không tìm thấy lần tính lương');
  const person = (
    await db.query(
      `SELECT employee_code,full_name FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
      [tenant, employeeId],
    )
  ).rows[0];
  if (!person) throw new NotFoundException('Không tìm thấy nhân viên');
  const rows = await db.query(
    `SELECT work_date,status,scheduled_minutes,worked_minutes,paid_minutes,ot_minutes,late_minutes,early_leave_minutes,workday_units,
            is_manually_adjusted,calculation_snapshot,to_jsonb(timesheets)->'sources' AS sources
       FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND employee_id=$3 ORDER BY work_date`,
    [tenant, run.timesheet_period_id, employeeId],
  );
  const item = (
    await db.query(
      `SELECT calculation_snapshot FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND employee_id=$3 AND source_type='FORMULA' LIMIT 1`,
      [tenant, runId, employeeId],
    )
  ).rows[0];
  const inputs = (item?.calculation_snapshot?.inputs ?? null) as Record<string, number | string> | null;

  const days: HrmPayrollTraceDay[] = rows.rows.map((r) => ({
    date: isoDate(r.work_date),
    status: String(r.status),
    scheduledMinutes: Number(r.scheduled_minutes),
    workedMinutes: Number(r.worked_minutes),
    paidMinutes: Number(r.paid_minutes),
    otMinutes: Number(r.ot_minutes),
    lateMinutes: Number(r.late_minutes),
    earlyMinutes: Number(r.early_leave_minutes),
    workdayUnits: Number(r.workday_units),
    tripAllowanceAmount: Number(r.calculation_snapshot?.tripAllowanceAmount ?? 0),
    adjusted: r.is_manually_adjusted === true,
    anomalies: Array.isArray(r.calculation_snapshot?.anomalies) ? (r.calculation_snapshot.anomalies as string[]) : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
  }));
  const totals = {
    scheduledMinutes: 0,
    paidMinutes: 0,
    workedMinutes: 0,
    otMinutes: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    workdayUnits: 0,
    tripAllowanceAmount: 0,
  };
  for (const d of days) {
    totals.scheduledMinutes += d.scheduledMinutes;
    totals.paidMinutes += d.paidMinutes;
    totals.workedMinutes += d.workedMinutes;
    totals.otMinutes += d.otMinutes;
    totals.lateMinutes += d.lateMinutes;
    totals.earlyMinutes += d.earlyMinutes;
    totals.workdayUnits += d.workdayUnits;
    totals.tripAllowanceAmount += d.tripAllowanceAmount;
  }
  totals.workdayUnits = Math.round(totals.workdayUnits * 100) / 100;

  const differences: string[] = [];
  if (inputs)
    for (const [input, key] of RECONCILED) {
      const used = Number(inputs[input] ?? 0);
      if (Math.abs(used - totals[key]) > 0.01)
        differences.push(`${input}: lương dùng ${used}, bảng công hiện tại ${totals[key]}`);
    }
  const stale = run.timesheet_fingerprint
    ? run.timesheet_fingerprint !== (await timesheetFingerprint(db, tenant, run.timesheet_period_id))
    : false;
  return {
    run: {
      id: run.id,
      status: run.status,
      calculatedAt: run.calculated_at ? new Date(run.calculated_at).toISOString() : null,
      stale,
    },
    period: { from: isoDate(run.from_date), to: isoDate(run.to_date), timesheetPeriodId: run.timesheet_period_id },
    employee: { id: employeeId, code: person.employee_code ?? '', name: person.full_name ?? '' },
    inputs,
    totals,
    days,
    reconciled: Boolean(inputs) && differences.length === 0 && !stale,
    differences,
  };
}
