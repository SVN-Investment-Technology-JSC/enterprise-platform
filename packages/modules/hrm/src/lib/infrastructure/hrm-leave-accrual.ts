import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ensureLeaveBalance } from './hrm-leave-operations.js';
import { isoDate, lockEmployee } from './hrm-time.js';

/** Explicit, restartable monthly close. Its operation key makes retries harmless. */
export async function accrueMonth(
  db: PoolClient,
  tenant: string,
  actor: string,
  month: string,
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException('Tháng phải có định dạng YYYY-MM');
  const start = `${month}-01`,
    endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  const end = endDate.toISOString().slice(0, 10),
    monthNo = endDate.getUTCMonth() + 1,
    year = endDate.getUTCFullYear();
  if (endDate.getTime() > Date.now())
    throw new BadRequestException('Chỉ chốt cộng phép khi tháng đã kết thúc');
  const schedules = await db.query(
    `SELECT s.* FROM hrm_schema.leave_accrual_schedules s JOIN hrm_schema.leave_types t ON t.id=s.leave_type_id AND t.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND t.active=true AND s.effective_from<=$3::date AND (s.effective_to IS NULL OR s.effective_to>=date_trunc('year',$2::date)::date)`,
    [tenant, start, end],
  );
  const employees = await db.query(
    `SELECT employee_id,join_date FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date<=$2::date AND employment_status NOT IN ('RESIGNED','TERMINATED') ORDER BY employee_id`,
    [tenant, end],
  );
  let credited = 0,
    skipped = 0;
  for (const employee of employees.rows) {
    await lockEmployee(db, tenant, employee.employee_id);
    for (const schedule of schedules.rows) {
      const key = `accrual:${schedule.id}:${employee.employee_id}:${month}`;
      if (
        (
          await db.query(
            `SELECT id FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND operation_key=$2`,
            [tenant, key],
          )
        ).rowCount
      ) {
        skipped++;
        continue;
      }
      const join = isoDate(employee.join_date),
        joinMonth = Number(join.slice(5, 7));
      const due =
        schedule.accrual_frequency === 'MONTHLY' ||
        (schedule.accrual_frequency === 'QUARTERLY' && monthNo % 3 === 0) ||
        (schedule.accrual_frequency === 'YEARLY' && monthNo === 12);
      const periodStart =
        schedule.accrual_frequency === 'YEARLY'
          ? `${year}-01-01`
          : schedule.accrual_frequency === 'QUARTERLY'
            ? `${year}-${String(Math.floor((monthNo - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
            : start;
      const effectiveStart = [
        periodStart,
        join,
        isoDate(schedule.effective_from),
      ]
        .sort()
        .pop()!;
      const effectiveEnd = schedule.effective_to
        ? [end, isoDate(schedule.effective_to)].sort()[0]
        : end;
      let amount =
        due && effectiveStart <= effectiveEnd
          ? Number(schedule.accrual_amount)
          : 0;
      if (schedule.accrual_frequency === 'MILESTONE')
        throw new BadRequestException(
          'Lịch mốc cần quy định mốc cụ thể; chưa thể tự động cộng',
        );
      if (schedule.proration_rule === 'BY_JOIN_DATE') {
        amount *=
          Math.max(
            0,
            Date.parse(effectiveEnd) - Date.parse(effectiveStart) + 86400000,
          ) /
          (Date.parse(end) - Date.parse(periodStart) + 86400000);
      } else if (schedule.proration_rule && schedule.proration_rule !== 'NONE')
        throw new BadRequestException('Quy tắc phân bổ phép chưa được hỗ trợ');
      const seniority = year - Number(join.slice(0, 4));
      const anniversary = `${year}${join.slice(4)}`;
      if (
        monthNo === joinMonth &&
        Number(schedule.seniority_bonus_years) > 0 &&
        anniversary >= isoDate(schedule.effective_from) &&
        (!schedule.effective_to ||
          anniversary <= isoDate(schedule.effective_to))
      )
        amount +=
          Math.floor(seniority / Number(schedule.seniority_bonus_years)) *
          Number(schedule.seniority_bonus_days);
      amount = Math.round(amount * 100) / 100;
      if (amount <= 0) continue;
      const balance = await ensureLeaveBalance(
        db,
        tenant,
        employee.employee_id,
        schedule.leave_type_id,
        year,
      );
      const updated = await db.query(
        `UPDATE hrm_schema.leave_balances SET accrued=accrued+$2,remaining=remaining+$2,updated_at=now() WHERE id=$1 RETURNING remaining`,
        [balance.id, amount],
      );
      await db.query(
        `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,accrual_schedule_id,note,balance_year,operation_key,actor_id)
        VALUES ($1,$2,$3,'ACCRUAL',$4,$5,$6,$7,$8,$9,$10)`,
        [
          tenant,
          employee.employee_id,
          schedule.leave_type_id,
          amount,
          updated.rows[0].remaining,
          schedule.id,
          `Cộng phép ${month}`,
          year,
          key,
          actor,
        ],
      );
      credited++;
    }
  }
  return { month, credited, skipped };
}
