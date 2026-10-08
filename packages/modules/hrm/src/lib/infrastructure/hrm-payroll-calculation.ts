import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  evaluatePayroll,
  type PayrollComponent,
} from '../domain/payroll-formula.js';
import { isoDate, resolvePolicy } from './hrm-time.js';

export const payrollItemTypes = [
  'EARNING',
  'ALLOWANCE',
  'OVERTIME',
  'STATUTORY_DEDUCTION',
  'TAX_DEDUCTION',
  'ADVANCE_DEDUCTION',
  'OTHER_DEDUCTION',
  'NET_PAY',
];
export const payrollSystemInputs = [
  'BASE_SALARY',
  'PRORATED_BASE_PAY',
  'SCHEDULED_MINUTES',
  'STANDARD_PERIOD_MINUTES',
  'PAID_MINUTES',
  'WORKED_MINUTES',
  'OT_MINUTES',
  'WEIGHTED_OT_MINUTES',
  'LATE_MINUTES',
  'EARLY_MINUTES',
  'WORKDAY_UNITS',
  'ADVANCE_DUE',
  'LEAVE_RECOVERY_DUE',
  'MANUAL_EARNINGS',
  'MANUAL_DEDUCTIONS',
  'REGISTERED_DEPENDENT_COUNT',
];

export async function calculatePayroll(
  db: PoolClient,
  tenant: string,
  runId: string,
) {
  const result = await db.query(
    `SELECT r.*,p.timesheet_period_id,p.from_date,p.to_date,t.status AS timesheet_status FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p ON p.id=r.payroll_period_id AND p.tenant_id=r.tenant_id LEFT JOIN hrm_schema.timesheet_periods t ON t.id=p.timesheet_period_id AND t.tenant_id=p.tenant_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r,p`,
    [tenant, runId],
  );
  const run = result.rows[0];
  if (!run) throw new NotFoundException('Không tìm thấy lần tính lương');
  if (['FINALIZED', 'APPROVED', 'CANCELLED'].includes(run.status))
    throw new BadRequestException(
      'Lần lương đã duyệt/chốt không được tính lại',
    );
  if (run.timesheet_status !== 'LOCKED')
    throw new BadRequestException('Cần bảng công đã khóa');
  const from = isoDate(run.from_date),
    to = isoDate(run.to_date);
  const employees = await db.query(
    `SELECT DISTINCT t.employee_id,e.join_date FROM hrm_schema.timesheets t JOIN hrm_schema.employee_profiles e ON e.tenant_id=t.tenant_id AND e.employee_id=t.employee_id WHERE t.tenant_id=$1 AND t.period_id=$2 ORDER BY t.employee_id`,
    [tenant, run.timesheet_period_id],
  );
  if (!employees.rowCount)
    throw new BadRequestException('Bảng công không có nhân viên');
  await db.query(
    `DELETE FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND source_type<>'MANUAL_ADJUSTMENT'`,
    [tenant, runId],
  );
  await db.query(
    `DELETE FROM hrm_schema.payroll_employee_totals WHERE tenant_id=$1 AND payroll_run_id=$2`,
    [tenant, runId],
  );
  for (const employee of employees.rows) {
    const employeeId = employee.employee_id;
    const policy = await resolvePolicy(db, tenant, 'PAYROLL', from, employeeId),
      endPolicy = await resolvePolicy(db, tenant, 'PAYROLL', to, employeeId);
    if (!policy && !endPolicy)
      throw new BadRequestException(
        'Không tìm thấy chính sách lương hiệu lực cho nhân viên',
      );
    const activePolicy = (endPolicy || policy)!;
    const config = activePolicy.config_json;
    if (isoDate(employee.join_date) > from && !config.standardMinutes)
      throw new BadRequestException(
        'Nhân viên vào giữa kỳ: cần định mức phút chuẩn của cả kỳ trong cấu hình lương',
      );
    const components = config.components as PayrollComponent[];
    if (
      !Array.isArray(components) ||
      components.some((c) => !payrollItemTypes.includes(c.type))
    )
      throw new BadRequestException('Thành phần công thức lương không hợp lệ');
    if (components.filter((c) => c.type === 'NET_PAY').length !== 1)
      throw new BadRequestException('Cần đúng một công thức NET_PAY');
    const inputsResult = await db.query(
      `SELECT inputs FROM hrm_schema.payroll_employee_inputs WHERE tenant_id=$1 AND employee_id=$2 AND effective_from<=$3::date ORDER BY effective_from DESC LIMIT 1`,
      [tenant, employeeId, from],
    );
    const custom = (inputsResult.rows[0]?.inputs || {}) as Record<
      string,
      number | string
    >;
    const defaults = (config.inputs || {}) as Record<string, number | string>;
    for (const values of [custom, defaults])
      if (Object.keys(values).some((k) => payrollSystemInputs.includes(k)))
        throw new BadRequestException(
          'Tham số tùy chỉnh không được ghi đè dữ liệu công/lương hệ thống',
        );
    const rows = await db.query(
      `SELECT * FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND employee_id=$3 ORDER BY work_date`,
      [tenant, run.timesheet_period_id, employeeId],
    );
    const salary = await db.query(
      `SELECT * FROM hrm_schema.employee_salary_profiles WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('ACTIVE','SUPERSEDED') AND effective_from<=$4::date AND (effective_to IS NULL OR effective_to>=$3::date)`,
      [tenant, employeeId, from, to],
    );
    const sum = (key: string) =>
      rows.rows.reduce((n, r) => n + Number(r[key] || 0), 0);
    const scheduled = sum('scheduled_minutes');
    if (!scheduled)
      throw new BadRequestException(
        `Nhân viên ${employeeId} thiếu định mức công trong kỳ`,
      );
    let weightedSalary = 0,
      prorated = 0;
    const standardMinutes = Number(config.standardMinutes || scheduled);
    if (!Number.isInteger(standardMinutes) || standardMinutes <= 0)
      throw new BadRequestException(
        'Định mức phút chuẩn kỳ lương không hợp lệ',
      );
    for (const day of rows.rows) {
      if (!Number(day.scheduled_minutes)) continue;
      const date = isoDate(day.work_date),
        profiles = salary.rows.filter(
          (p) =>
            isoDate(p.effective_from) <= date &&
            (!p.effective_to || isoDate(p.effective_to) >= date),
        );
      if (profiles.length !== 1)
        throw new BadRequestException(
          `Hồ sơ lương bị thiếu/trùng cho nhân viên ${employeeId}, ngày ${date}`,
        );
      if (profiles[0].currency !== 'VND')
        throw new BadRequestException(
          'Kỳ tính hiện tại yêu cầu VND; cần tách kỳ theo tiền tệ',
        );
      if (config.salaryType !== profiles[0].salary_type)
        throw new BadRequestException(
          'Loại GROSS/NET của hồ sơ lương không khớp cấu hình công thức',
        );
      weightedSalary +=
        (Number(profiles[0].base_salary) * Number(day.scheduled_minutes)) /
        scheduled;
      prorated +=
        (Number(profiles[0].base_salary) * Number(day.paid_minutes)) /
        standardMinutes;
    }
    const advances = await db.query(
      `SELECT COALESCE(sum(d.scheduled_amount),0) AS due FROM hrm_schema.salary_advance_deductions d JOIN hrm_schema.salary_advance_requests a ON a.id=d.advance_request_id AND a.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND d.payroll_period_id=$2 AND a.employee_id=$3 AND d.status='SCHEDULED'`,
      [tenant, run.payroll_period_id, employeeId],
    );
    const manual = await db.query(
      `SELECT item_type,amount FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND employee_id=$3 AND source_type='MANUAL_ADJUSTMENT'`,
      [tenant, runId, employeeId],
    );
    // Thu hồi phép dùng vượt khi nghỉ việc: cộng vào khấu trừ khác của kỳ.
    const leaveRecoveries = await db.query(
      `SELECT id,excess_days,recovery_amount FROM hrm_schema.leave_settlements WHERE tenant_id=$1 AND payroll_period_id=$2 AND employee_id=$3 AND status='SCHEDULED' ORDER BY id`,
      [tenant, run.payroll_period_id, employeeId],
    );
    const leaveRecoveryDue =
      Math.round(
        leaveRecoveries.rows.reduce(
          (n, r) => n + Number(r.recovery_amount),
          0,
        ) * 100,
      ) / 100;
    const deductions = [
      'STATUTORY_DEDUCTION',
      'TAX_DEDUCTION',
      'ADVANCE_DEDUCTION',
      'OTHER_DEDUCTION',
    ];
    const dependents = await db.query(
      `SELECT id FROM hrm_schema.employee_dependents WHERE tenant_id=$1 AND employee_id=$2 AND effective_from<=$3::date AND (effective_to IS NULL OR effective_to>=$3::date) ORDER BY id`,
      [tenant, employeeId, to],
    );
    const beneficiary = (
      await db.query(
        `SELECT employee_code,full_name,bank_account_number,bank_name,bank_branch FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
        [tenant, employeeId],
      )
    ).rows[0];
    const input: Record<string, number | string> = {
      ...defaults,
      ...custom,
      REGISTERED_DEPENDENT_COUNT: dependents.rowCount || 0,
      BASE_SALARY: Math.round(weightedSalary * 100) / 100,
      PRORATED_BASE_PAY: Math.round(prorated * 100) / 100,
      SCHEDULED_MINUTES: scheduled,
      STANDARD_PERIOD_MINUTES: standardMinutes,
      PAID_MINUTES: sum('paid_minutes'),
      WORKED_MINUTES: sum('worked_minutes'),
      OT_MINUTES: sum('ot_minutes'),
      WEIGHTED_OT_MINUTES:
        Math.round(
          rows.rows.reduce(
            (n, r) =>
              n + Number(r.calculation_snapshot?.weightedOtMinutes || 0),
            0,
          ) * 100,
        ) / 100,
      LATE_MINUTES: sum('late_minutes'),
      EARLY_MINUTES: sum('early_leave_minutes'),
      WORKDAY_UNITS: Math.round(sum('workday_units') * 100) / 100,
      ADVANCE_DUE: Number(advances.rows[0].due),
      MANUAL_EARNINGS: manual.rows
        .filter((r) => !deductions.includes(r.item_type))
        .reduce((n, r) => n + Number(r.amount), 0),
      LEAVE_RECOVERY_DUE: leaveRecoveryDue,
      MANUAL_DEDUCTIONS:
        manual.rows
          .filter((r) => deductions.includes(r.item_type))
          .reduce((n, r) => n + Number(r.amount), 0) + leaveRecoveryDue,
    };
    let calculated: ReturnType<typeof evaluatePayroll>;
    try {
      calculated = evaluatePayroll(components, input);
    } catch (error) {
      throw new BadRequestException(
        `Công thức nhân viên ${employeeId}: ${error instanceof Error ? error.message : 'không hợp lệ'}`,
      );
    }
    if (calculated.some((c) => c.amount < 0))
      throw new BadRequestException(
        'Thành phần lương/khấu trừ phải là số không âm',
      );
    const total = (types: string[]) =>
      Math.round(
        calculated
          .filter((c) => types.includes(c.type))
          .reduce((n, c) => n + c.amount, 0) * 100,
      ) / 100;
    const gross =
        total(['EARNING', 'ALLOWANCE', 'OVERTIME']) +
        Number(input.MANUAL_EARNINGS),
      deduction = total(deductions) + Number(input.MANUAL_DEDUCTIONS),
      net = total(['NET_PAY']);
    if (Math.abs(gross - deduction - net) > 0.011)
      throw new BadRequestException(
        'NET_PAY không khớp tổng thu nhập trừ khấu trừ',
      );
    if (
      Math.abs(total(['ADVANCE_DEDUCTION']) - Number(input.ADVANCE_DUE)) > 0.011
    )
      throw new BadRequestException(
        'Công thức khấu trừ ứng lương không khớp lịch thu hồi',
      );
    for (const item of calculated)
      await db.query(
        `INSERT INTO hrm_schema.payroll_items (tenant_id,payroll_run_id,employee_id,item_code,item_type,description,amount,source_type,policy_version_id,calculation_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,'FORMULA',$8,$9)`,
        [
          tenant,
          runId,
          employeeId,
          item.code,
          item.type,
          item.name,
          item.amount,
          activePolicy.id,
          JSON.stringify({
            formula: item.formula,
            inputs: input,
            components: calculated,
            dependentIds: dependents.rows.map((r) => r.id),
            dependentCutoff: to,
          }),
        ],
      );
    for (const recovery of leaveRecoveries.rows)
      await db.query(
        `INSERT INTO hrm_schema.payroll_items (tenant_id,payroll_run_id,employee_id,item_code,item_type,description,quantity,rate,amount,source_type,source_id) VALUES ($1,$2,$3,'LEAVE_RECOVERY','OTHER_DEDUCTION',$4,$5,$6,$7,'LEAVE_RECOVERY',$8)`,
        [
          tenant,
          runId,
          employeeId,
          `Thu hồi ${Number(recovery.excess_days)} ngày phép dùng vượt khi nghỉ việc`,
          Number(recovery.excess_days),
          Number(recovery.excess_days)
            ? Number(recovery.recovery_amount) / Number(recovery.excess_days)
            : 0,
          Number(recovery.recovery_amount),
          recovery.id,
        ],
      );
    await db.query(
      `INSERT INTO hrm_schema.payroll_employee_totals (tenant_id,payroll_run_id,employee_id,gross_salary,total_allowance,total_ot_pay,total_statutory_deductions,personal_income_tax,advance_deductions,other_deductions,net_salary,beneficiary_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tenant,
        runId,
        employeeId,
        gross,
        total(['ALLOWANCE']),
        total(['OVERTIME']),
        total(['STATUTORY_DEDUCTION']),
        total(['TAX_DEDUCTION']),
        total(['ADVANCE_DEDUCTION']),
        total(['OTHER_DEDUCTION']) + Number(input.MANUAL_DEDUCTIONS),
        net,
        JSON.stringify(beneficiary),
      ],
    );
  }
  const updated = await db.query(
    `UPDATE hrm_schema.payroll_runs SET status='CALCULATED',calculation_version='HRM_FORMULA_V1',calculated_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, runId],
  );
  return updated.rows[0];
}
