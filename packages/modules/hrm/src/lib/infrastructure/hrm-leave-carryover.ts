import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { isoDate, lockEmployee } from './hrm-time.js';
import { requireDate } from './hrm-validation.js';
import { applyLeaveDelta, ensureLeaveBalance } from './hrm-leave-balance.js';

export async function reserveCarryover(
  db: PoolClient,
  tenant: string,
  employee: string,
  type: string,
  requestId: string,
  days: { date: string; quantity: number }[],
  year: number,
) {
  const carries = await db.query(
    `SELECT * FROM hrm_schema.leave_carryovers WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND target_year=$4 ORDER BY expires_on FOR UPDATE`,
    [tenant, employee, type, year],
  );
  const allAvailable = carries.rows.reduce(
    (n, c) =>
      n +
      Number(c.amount) -
      Number(c.used) -
      Number(c.reserved) -
      Number(c.expired),
    0,
  );
  let allocated = 0;
  for (const day of days.filter((d) => Number(d.date.slice(0, 4)) === year)) {
    let need = day.quantity;
    for (const carry of carries.rows) {
      if (isoDate(carry.expires_on) < day.date) continue;
      const available =
          Number(carry.amount) -
          Number(carry.used) -
          Number(carry.reserved) -
          Number(carry.expired),
        take = Math.min(need, available);
      if (take <= 0) continue;
      await db.query(
        `UPDATE hrm_schema.leave_carryovers SET reserved=reserved+$2 WHERE id=$1`,
        [carry.id, take],
      );
      await db.query(
        `INSERT INTO hrm_schema.leave_carryover_usage (request_id,carryover_id,amount,state) VALUES ($1,$2,$3,'RESERVED') ON CONFLICT (request_id,carryover_id) DO UPDATE SET amount=hrm_schema.leave_carryover_usage.amount+EXCLUDED.amount`,
        [requestId, carry.id, take],
      );
      carry.reserved = Number(carry.reserved) + take;
      need -= take;
      allocated += take;
    }
  }
  return { allAvailable, allocated };
}
export async function transitionCarryover(
  db: PoolClient,
  tenant: string,
  actor: string,
  requestId: string,
  target: string,
  asOf: string,
) {
  const usages = await db.query(
    `SELECT u.*,c.tenant_id,c.employee_id,c.leave_type_id,c.target_year,c.expires_on FROM hrm_schema.leave_carryover_usage u JOIN hrm_schema.leave_carryovers c ON c.id=u.carryover_id WHERE u.request_id=$1 AND c.tenant_id=$2 AND u.state<>'REVERSED' FOR UPDATE OF u,c`,
    [requestId, tenant],
  );
  for (const usage of usages.rows) {
    const amount = Number(usage.amount),
      reserved = usage.state === 'RESERVED' ? amount : 0,
      used = usage.state === 'USED' ? amount : 0;
    if (target === 'APPROVED') {
      if (usage.state === 'USED') continue;
      await db.query(
        `UPDATE hrm_schema.leave_carryovers SET reserved=reserved-$2,used=used+$2 WHERE id=$1`,
        [usage.carryover_id, amount],
      );
      await db.query(
        `UPDATE hrm_schema.leave_carryover_usage SET state='USED' WHERE request_id=$1 AND carryover_id=$2`,
        [requestId, usage.carryover_id],
      );
    } else {
      const expired = isoDate(usage.expires_on) < asOf ? amount : 0;
      await db.query(
        `UPDATE hrm_schema.leave_carryovers SET reserved=reserved-$2,used=used-$3,expired=expired+$4 WHERE id=$1`,
        [usage.carryover_id, reserved, used, expired],
      );
      await db.query(
        `UPDATE hrm_schema.leave_carryover_usage SET state='REVERSED' WHERE request_id=$1 AND carryover_id=$2`,
        [requestId, usage.carryover_id],
      );
      if (expired) {
        const balance = await ensureLeaveBalance(
          db,
          tenant,
          usage.employee_id,
          usage.leave_type_id,
          usage.target_year,
        );
        const updated = await applyLeaveDelta(db, tenant, balance.id, {
          adjusted: -expired,
          remaining: -expired,
        });
        await db.query(
          `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,reference_request_id,balance_year,note,actor_id) VALUES ($1,$2,$3,'CARRYOVER_EXPIRE',$4,$5,$6,$7,'Phép chuyển được trả sau hạn sử dụng',$8)`,
          [
            tenant,
            usage.employee_id,
            usage.leave_type_id,
            -expired,
            updated.remaining,
            requestId,
            usage.target_year,
            actor,
          ],
        );
      }
    }
  }
}
export async function carryoverYear(
  db: PoolClient,
  tenant: string,
  actor: string,
  targetYear: number,
) {
  if (
    !Number.isInteger(targetYear) ||
    targetYear < 2000 ||
    targetYear > new Date().getFullYear()
  )
    throw new BadRequestException('Chỉ chuyển phép vào năm đã bắt đầu');
  const types = await db.query(
    `SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND active=true AND carryover_allowed=true`,
    [tenant],
  );
  const employees = await db.query(
    `SELECT DISTINCT employee_id FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND year=$2 ORDER BY employee_id`,
    [tenant, targetYear - 1],
  );
  let count = 0;
  for (const employee of employees.rows) {
    await lockEmployee(db, tenant, employee.employee_id);
    for (const type of types.rows) {
      const existing = await db.query(
        `SELECT id FROM hrm_schema.leave_carryovers WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND target_year=$4`,
        [tenant, employee.employee_id, type.id, targetYear],
      );
      if (existing.rowCount) continue;
      const before = await ensureLeaveBalance(
        db,
        tenant,
        employee.employee_id,
        type.id,
        targetYear - 1,
      );
      if (Number(before.pending) > 0)
        throw new BadRequestException(
          'Còn đơn nghỉ chờ duyệt năm trước; cần xử lý trước khi chuyển phép',
        );
      const amount = Math.max(
        0,
        Math.min(Number(before.remaining), Number(type.max_carryover_days)),
      );
      const month = Number(type.carryover_expiry_month);
      if (!Number.isInteger(month) || month < 1 || month > 12)
        throw new BadRequestException(
          'Tháng hết hạn chuyển phép phải từ 1 đến 12',
        );
      const expires = new Date(Date.UTC(targetYear, month, 0))
        .toISOString()
        .slice(0, 10);
      await db.query(
        `INSERT INTO hrm_schema.leave_carryovers (tenant_id,employee_id,leave_type_id,source_year,target_year,amount,expires_on) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          tenant,
          employee.employee_id,
          type.id,
          targetYear - 1,
          targetYear,
          amount,
          expires,
        ],
      );
      if (!amount) continue;
      const next = await ensureLeaveBalance(
        db,
        tenant,
        employee.employee_id,
        type.id,
        targetYear,
      );
      const source = await applyLeaveDelta(db, tenant, before.id, {
        adjusted: -amount,
        remaining: -amount,
      });
      const target = await applyLeaveDelta(db, tenant, next.id, {
        opening: amount,
        remaining: amount,
      });
      for (const [year, change, balance] of [
        [targetYear - 1, -amount, source.remaining],
        [targetYear, amount, target.remaining],
      ])
        await db.query(
          `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,balance_year,operation_key,note,actor_id) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,'Chuyển phép năm',$8)`,
          [
            tenant,
            employee.employee_id,
            type.id,
            change,
            balance,
            year,
            `carry:${employee.employee_id}:${type.id}:${targetYear}:${year}`,
            actor,
          ],
        );
      count++;
    }
  }
  return { targetYear, count };
}
export async function expireCarryovers(
  db: PoolClient,
  tenant: string,
  actor: string,
  date: string,
) {
  requireDate(date, 'date');
  if (date > new Date().toISOString().slice(0, 10))
    throw new BadRequestException(
      'Không hết hạn phép trước thời điểm hiện tại',
    );
  const candidates = await db.query(
    `SELECT id,employee_id FROM hrm_schema.leave_carryovers WHERE tenant_id=$1 AND expires_on<$2::date ORDER BY employee_id`,
    [tenant, date],
  );
  let count = 0;
  for (const candidate of candidates.rows) {
    await lockEmployee(db, tenant, candidate.employee_id);
    const result = await db.query(
      `SELECT * FROM hrm_schema.leave_carryovers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenant, candidate.id],
    );
    const carry = result.rows[0];
    const amount =
      Number(carry.amount) -
      Number(carry.reserved) -
      Number(carry.used) -
      Number(carry.expired);
    if (amount <= 0) continue;
    const balance = await ensureLeaveBalance(
      db,
      tenant,
      carry.employee_id,
      carry.leave_type_id,
      carry.target_year,
    );
    const updated = await applyLeaveDelta(db, tenant, balance.id, {
      adjusted: -amount,
      remaining: -amount,
    });
    await db.query(
      `UPDATE hrm_schema.leave_carryovers SET expired=expired+$2 WHERE id=$1`,
      [carry.id, amount],
    );
    await db.query(
      `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,balance_year,note,actor_id) VALUES ($1,$2,$3,'CARRYOVER_EXPIRE',$4,$5,$6,'Hết hạn phép chuyển',$7)`,
      [
        tenant,
        carry.employee_id,
        carry.leave_type_id,
        -amount,
        updated.remaining,
        carry.target_year,
        actor,
      ],
    );
    count++;
  }
  return { date, count };
}
