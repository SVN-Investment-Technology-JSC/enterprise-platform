import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  HrmLeaveSettlement,
  HrmLeaveSettlementStatus,
} from '@enterprise-platform/contracts-hrm';
import {
  monthEnd,
  monthStart,
  previousDate,
  sumEntitlement,
} from '../domain/annual-leave-entitlement.js';
import {
  contractSchedulesForYear,
  employeeEntitlement,
} from './hrm-annual-leave.js';
import { accrueContractMonth } from './hrm-leave-accrual.js';
import { applyLeaveDelta, ensureLeaveBalance } from './hrm-leave-balance.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { isoDate } from './hrm-time.js';
import { requireText, requireUuid } from './hrm-validation.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LeaveSettlementLine {
  readonly leaveTypeId: string;
  readonly year: number;
  readonly lastWorkingDay: string;
  readonly signDate: string | null;
  /** Quỹ thực hưởng tới ngày nghỉ (định mức + thâm niên). */
  readonly entitled: number;
  readonly seniority: number;
  readonly accruedInLedger: number;
  readonly used: number;
  readonly pending: number;
  readonly remaining: number;
  /** Số dư sau khi tính lại quỹ thực hưởng. */
  readonly settledRemaining: number;
  readonly excess: number;
  readonly unused: number;
}

/** Đơn nghỉ khiến chưa thể quyết toán: đơn chờ duyệt hoặc đơn đã duyệt sau ngày nghỉ. */
export async function settlementBlockers(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  inactiveFrom: string,
): Promise<string[]> {
  const rows = await db.query(
    `SELECT count(*) FILTER (WHERE r.status='PENDING')::int AS pending,
            count(*) FILTER (WHERE r.status='APPROVED' AND r.to_date>=$3::date)::int AS after
     FROM hrm_schema.leave_requests r JOIN hrm_schema.leave_types t ON t.id=r.leave_type_id AND t.tenant_id=r.tenant_id
     WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.deleted_at IS NULL AND t.deduct_balance=true`,
    [tenant, employeeId, inactiveFrom],
  );
  const blockers: string[] = [];
  const { pending, after } = rows.rows[0];
  if (pending)
    blockers.push(
      `Còn ${pending} đơn nghỉ trừ quỹ đang chờ duyệt; cần duyệt hoặc huỷ trước`,
    );
  if (after)
    blockers.push(
      `Còn ${after} đơn nghỉ đã duyệt có ngày từ ngày ngừng làm việc; cần huỷ trước`,
    );
  return blockers;
}

/** Loại nghỉ trừ quỹ có lịch cộng phép theo HĐ trong năm. */
async function contractLeaveTypes(
  db: PoolClient,
  tenant: string,
  year: number,
): Promise<string[]> {
  const rows = await db.query(
    `SELECT DISTINCT s.leave_type_id FROM hrm_schema.leave_accrual_schedules s JOIN hrm_schema.leave_types t ON t.id=s.leave_type_id AND t.tenant_id=s.tenant_id
     WHERE s.tenant_id=$1 AND s.accrual_basis='CONTRACT_SIGN_DATE' AND t.deduct_balance=true
       AND s.effective_from<=make_date($2,12,31) AND (s.effective_to IS NULL OR s.effective_to>=make_date($2,1,1))`,
    [tenant, year],
  );
  return rows.rows.map((r) => r.leave_type_id);
}

async function postedContractAccrual(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<number> {
  const row = (
    await db.query(
      `SELECT COALESCE(sum(x.days_changed),0) AS posted FROM hrm_schema.leave_transactions x JOIN hrm_schema.leave_accrual_schedules s ON s.id=x.accrual_schedule_id AND s.tenant_id=x.tenant_id
       WHERE x.tenant_id=$1 AND x.employee_id=$2 AND x.leave_type_id=$3 AND x.balance_year=$4 AND s.accrual_basis='CONTRACT_SIGN_DATE'
         AND x.transaction_type IN ('ACCRUAL','SENIORITY_ACCRUAL')`,
      [tenant, employeeId, leaveTypeId, year],
    )
  ).rows[0];
  return Number(row.posted);
}

/** Tính quyết toán (không ghi dữ liệu). */
export async function computeLeaveSettlement(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  inactiveFrom: string,
): Promise<LeaveSettlementLine[]> {
  const lastWorkingDay = previousDate(inactiveFrom);
  const year = Number(lastWorkingDay.slice(0, 4));
  const lines: LeaveSettlementLine[] = [];
  for (const leaveTypeId of await contractLeaveTypes(db, tenant, year)) {
    const ent = await employeeEntitlement(
      db,
      tenant,
      employeeId,
      leaveTypeId,
      year,
      lastWorkingDay,
    );
    const totals = sumEntitlement(ent.months);
    const balance = (
      await db.query(
        `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
        [tenant, employeeId, leaveTypeId, year],
      )
    ).rows[0];
    const posted = await postedContractAccrual(
      db,
      tenant,
      employeeId,
      leaveTypeId,
      year,
    );
    const remaining = Number(balance?.remaining ?? 0);
    const settledRemaining = round2(remaining - posted + totals.total);
    lines.push({
      leaveTypeId,
      year,
      lastWorkingDay,
      signDate: ent.signDate,
      entitled: totals.total,
      seniority: totals.seniority,
      accruedInLedger: posted,
      used: Number(balance?.used ?? 0),
      pending: Number(balance?.pending ?? 0),
      remaining,
      settledRemaining,
      excess: round2(Math.max(0, -settledRemaining)),
      unused: round2(Math.max(0, settledRemaining)),
    });
  }
  return lines;
}

/**
 * Đơn giá một ngày phép = lương cơ bản hiệu lực ngày làm việc cuối ÷ số ngày
 * công chuẩn của tháng (bỏ ngày nghỉ/lễ theo lịch làm việc và Chủ nhật).
 */
export async function leaveDailyRate(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  date: string,
): Promise<number> {
  const salary = (
    await db.query(
      `SELECT base_salary FROM hrm_schema.employee_salary_profiles WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('ACTIVE','SUPERSEDED')
         AND effective_from<=$3::date AND (effective_to IS NULL OR effective_to>=$3::date) ORDER BY effective_from DESC LIMIT 1`,
      [tenant, employeeId, date],
    )
  ).rows[0];
  if (!salary) return 0;
  const year = Number(date.slice(0, 4)),
    month = Number(date.slice(5, 7));
  const days = (
    await db.query(
      `SELECT count(*)::int AS days FROM generate_series($2::date,$3::date,'1 day') d
       LEFT JOIN hrm_schema.work_calendar c ON c.tenant_id=$1 AND c.work_date=d::date
       WHERE COALESCE(c.day_kind, CASE WHEN extract(isodow FROM d)=7 THEN 'OFF' ELSE 'WORK' END)='WORK'`,
      [tenant, monthStart(year, month), monthEnd(year, month)],
    )
  ).rows[0].days;
  return days ? round2(Number(salary.base_salary) / days) : 0;
}

/**
 * Quyết toán phép khi nghỉ việc, chạy trong transaction ngừng nhân viên:
 * cộng bù các tháng còn thiếu, thu hồi phép đã cộng vượt quỹ thực hưởng, và nếu
 * đã dùng vượt thì ghi RECOVERY + khoản khấu trừ chờ đưa vào kỳ lương.
 */
export async function settleLeaveOnTermination(
  db: PoolClient,
  tenant: string,
  actor: string,
  employeeId: string,
  inactiveFrom: string,
) {
  const blockers = await settlementBlockers(db, tenant, employeeId, inactiveFrom);
  if (blockers.length) throw new ConflictException(blockers.join('. '));
  const lastWorkingDay = previousDate(inactiveFrom);
  const year = Number(lastWorkingDay.slice(0, 4)),
    lastMonth = Number(lastWorkingDay.slice(5, 7));
  const settlements = [];
  for (const leaveTypeId of await contractLeaveTypes(db, tenant, year)) {
    const existing = await db.query(
      `SELECT * FROM hrm_schema.leave_settlements WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 AND status<>'REVERSED'`,
      [tenant, employeeId, leaveTypeId, year],
    );
    if (existing.rowCount) {
      settlements.push(existing.rows[0]);
      continue;
    }
    for (const schedule of await contractSchedulesForYear(
      db,
      tenant,
      leaveTypeId,
      year,
    ))
      for (let m = 1; m <= lastMonth; m++)
        await accrueContractMonth(
          db,
          tenant,
          actor,
          employeeId,
          schedule,
          `${year}-${String(m).padStart(2, '0')}`,
          lastWorkingDay,
        );
    const [line] = (
      await computeLeaveSettlement(db, tenant, employeeId, inactiveFrom)
    ).filter((l) => l.leaveTypeId === leaveTypeId);
    const balance = await ensureLeaveBalance(
      db,
      tenant,
      employeeId,
      leaveTypeId,
      year,
    );
    const ledger = async (
      days: number,
      after: number,
      key: string,
      note: string,
    ) => {
      const row = await db.query(
        `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,balance_year,operation_key,note,actor_id)
         VALUES ($1,$2,$3,'RECOVERY',$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, employeeId, leaveTypeId, days, after, year, key, note, actor],
      );
      return row.rows[0].id as string;
    };
    // Phép đã cộng cho thời gian sau ngày nghỉ (ngừng làm việc lùi ngày).
    const over = round2(line.accruedInLedger - line.entitled);
    if (over > 0.005) {
      const updated = await applyLeaveDelta(db, tenant, balance.id, {
        accrued: -over,
        remaining: -over,
      });
      await ledger(
        -over,
        updated.remaining,
        `settle-over:${employeeId}:${leaveTypeId}:${year}`,
        `Thu hồi ${over} ngày phép đã cộng cho thời gian sau ngày nghỉ việc`,
      );
    }
    let recoveryTransactionId: string | null = null;
    if (line.excess > 0) {
      const updated = await applyLeaveDelta(db, tenant, balance.id, {
        adjusted: line.excess,
        remaining: line.excess,
      });
      recoveryTransactionId = await ledger(
        line.excess,
        updated.remaining,
        `settle-recovery:${employeeId}:${leaveTypeId}:${year}`,
        `Thu hồi ${line.excess} ngày phép dùng vượt quỹ thực hưởng khi nghỉ việc; chuyển khấu trừ lương`,
      );
    }
    const dailyRate =
      line.excess > 0
        ? await leaveDailyRate(db, tenant, employeeId, lastWorkingDay)
        : 0;
    const inserted = await db.query(
      `INSERT INTO hrm_schema.leave_settlements (tenant_id,employee_id,leave_type_id,year,termination_date,entitled_days,used_days,excess_days,unused_days,daily_rate,recovery_amount,recovery_transaction_id,status,note,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        tenant,
        employeeId,
        leaveTypeId,
        year,
        lastWorkingDay,
        line.entitled,
        line.used,
        line.excess,
        line.unused,
        dailyRate,
        Math.round(line.excess * dailyRate),
        recoveryTransactionId,
        line.excess > 0 ? 'PENDING' : 'CLOSED',
        line.signDate
          ? null
          : 'Chưa có HĐLĐ chính thức đã ký; quỹ thực hưởng tính là 0',
        actor,
      ],
    );
    await lifecycleAudit(
      db,
      tenant,
      actor,
      'LEAVE_SETTLED',
      inserted.rows[0].id,
      { employeeId, line, dailyRate },
    );
    settlements.push(inserted.rows[0]);
  }
  return settlements;
}

export function mapSettlement(row: Record<string, any>): HrmLeaveSettlement {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeCode: row.employee_code ?? undefined,
    employeeName: row.employee_name ?? undefined,
    leaveTypeId: row.leave_type_id,
    leaveTypeName: row.leave_type_name ?? undefined,
    year: Number(row.year),
    terminationDate: isoDate(row.termination_date),
    entitledDays: Number(row.entitled_days),
    usedDays: Number(row.used_days),
    excessDays: Number(row.excess_days),
    unusedDays: Number(row.unused_days),
    dailyRate: Number(row.daily_rate),
    recoveryAmount: Number(row.recovery_amount),
    payrollPeriodId: row.payroll_period_id ?? null,
    payrollPeriodCode: row.period_code ?? null,
    payrollRunId: row.payroll_run_id ?? null,
    status: row.status as HrmLeaveSettlementStatus,
    note: row.note ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function lockSettlement(db: PoolClient, tenant: string, id: string) {
  requireUuid(id, 'Quyết toán phép');
  const row = (
    await db.query(
      `SELECT * FROM hrm_schema.leave_settlements WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenant, id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy quyết toán phép');
  return row;
}

/** Gắn khoản thu hồi vào kỳ lương (có thể điều chỉnh số tiền kèm lý do), hoặc gỡ khỏi kỳ. */
export async function scheduleSettlement(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
  body: {
    payrollPeriodId: string | null;
    recoveryAmount?: number;
    reason: string;
  },
) {
  const reason = requireText(body.reason, 'Lý do', 1000);
  const before = await lockSettlement(db, tenant, id);
  if (!['PENDING', 'SCHEDULED'].includes(before.status))
    throw new ConflictException('Quyết toán không còn chờ khấu trừ');
  let periodId: string | null = null;
  if (body.payrollPeriodId) {
    periodId = requireUuid(body.payrollPeriodId, 'Kỳ lương');
    const period = (
      await db.query(
        `SELECT status FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
        [tenant, periodId],
      )
    ).rows[0];
    if (!period) throw new NotFoundException('Không tìm thấy kỳ lương');
    if (!['OPEN', 'PROCESSING'].includes(period.status))
      throw new ConflictException('Kỳ lương đã khóa');
  }
  if (before.payroll_period_id) {
    const finalized = await db.query(
      `SELECT 1 FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND payroll_period_id=$2 AND status IN ('FINALIZED','APPROVED')`,
      [tenant, before.payroll_period_id],
    );
    if (finalized.rowCount)
      throw new ConflictException('Kỳ lương đã chốt; không đổi khoản thu hồi');
  }
  const amount =
    body.recoveryAmount === undefined
      ? Number(before.recovery_amount)
      : Number(body.recoveryAmount);
  if (!Number.isFinite(amount) || amount < 0)
    throw new BadRequestException('Số tiền thu hồi phải là số không âm');
  const updated = await db.query(
    `UPDATE hrm_schema.leave_settlements SET payroll_period_id=$3,recovery_amount=$4,status=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, periodId, amount, periodId ? 'SCHEDULED' : 'PENDING'],
  );
  await lifecycleAudit(db, tenant, actor, 'LEAVE_SETTLEMENT_SCHEDULED', id, {
    before,
    after: updated.rows[0],
    reason,
  });
  return updated.rows[0];
}

/** Miễn khấu trừ tiền; giao dịch thu hồi trong sổ phép giữ nguyên làm lịch sử. */
export async function waiveSettlement(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
  reasonText: string,
) {
  const reason = requireText(reasonText, 'Lý do', 1000);
  const before = await lockSettlement(db, tenant, id);
  if (!['PENDING', 'SCHEDULED'].includes(before.status))
    throw new ConflictException('Quyết toán không còn chờ khấu trừ');
  const updated = await db.query(
    `UPDATE hrm_schema.leave_settlements SET status='WAIVED',payroll_period_id=NULL,note=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, reason],
  );
  await lifecycleAudit(db, tenant, actor, 'LEAVE_SETTLEMENT_WAIVED', id, {
    before,
    reason,
  });
  return updated.rows[0];
}
