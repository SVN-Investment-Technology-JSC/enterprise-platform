import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { applyLeaveDelta } from './hrm-leave-balance.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { lockEmployee } from './hrm-time.js';
import { lockAccrualConfiguration } from './hrm-leave-schedule.js';

/** Maps PostgreSQL unique violation on (tenant_id, code) to HTTP 409. */
export function rethrowDuplicateLeaveCode(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException('Mã loại nghỉ đã tồn tại');
  throw error;
}

/** Lowercase, strip Vietnamese diacritics and punctuation. */
export function normalizeLeaveName(name: string) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Names are similar when equal after normalisation, or all words of the shorter appear in the longer. */
export function areSimilarLeaveNames(a: string, b: string) {
  const x = normalizeLeaveName(a),
    y = normalizeLeaveName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = x.split(' '),
    ty = y.split(' ');
  const [small, big] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
  return small.length >= 2 && small.every((t) => big.includes(t));
}

export function findSimilarLeaveTypes(
  types: { id: string; code: string; name: string }[],
) {
  const pairs: { a: (typeof types)[number]; b: (typeof types)[number] }[] = [];
  for (let i = 0; i < types.length; i++)
    for (let j = i + 1; j < types.length; j++)
      if (areSimilarLeaveNames(types[i].name, types[j].name))
        pairs.push({ a: types[i], b: types[j] });
  return pairs;
}

/** Moves balances, ledger, requests, carry-overs and schedules from source to target in the caller's transaction. */
export async function mergeLeaveTypes(
  db: PoolClient,
  tenant: string,
  actor: string,
  sourceId: string,
  targetId: string,
  reason: string,
) {
  if (sourceId === targetId)
    throw new BadRequestException('Loại nguồn và loại đích phải khác nhau');
  await lockAccrualConfiguration(db, tenant);
  const rows = (
    await db.query(
      `SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
      [tenant, [sourceId, targetId]],
    )
  ).rows;
  const source = rows.find((r) => r.id === sourceId),
    target = rows.find((r) => r.id === targetId);
  if (!source || !target)
    throw new NotFoundException('Không tìm thấy loại nghỉ nguồn hoặc đích');
  if (source.merged_into_id)
    throw new ConflictException('Loại nguồn đã được gộp trước đó');
  if (!target.active)
    throw new ConflictException('Loại đích đang ngừng áp dụng');
  if (source.unit !== target.unit)
    throw new BadRequestException(
      'Hai loại nghỉ khác đơn vị tính (ngày/giờ); không thể gộp',
    );
  // Phép năm là lý do duy nhất của tenant: không gộp vào/ra khỏi lý do phép năm.
  if (Boolean(source.is_annual) !== Boolean(target.is_annual))
    throw new ConflictException(
      'Không thể gộp lý do phép năm với lý do nghỉ khác',
    );
  if (
    source.deduct_balance !== target.deduct_balance ||
    source.paid !== target.paid
  )
    throw new BadRequestException(
      'Hai loại nghỉ khác chế độ hưởng lương hoặc trừ quỹ; không thể gộp',
    );
  const clash = await db.query(
    `SELECT 1 FROM hrm_schema.leave_carryovers s JOIN hrm_schema.leave_carryovers t ON t.tenant_id=s.tenant_id AND t.employee_id=s.employee_id AND t.target_year=s.target_year AND t.leave_type_id=$3 WHERE s.tenant_id=$1 AND s.leave_type_id=$2 LIMIT 1`,
    [tenant, sourceId, targetId],
  );
  if (clash.rowCount)
    throw new ConflictException(
      'Cả hai loại cùng có phép chuyển năm của một nhân viên; xử lý hết hạn phép chuyển trước khi gộp',
    );
  const balances = await db.query(
    `SELECT * FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$2 ORDER BY employee_id,year`,
    [tenant, sourceId],
  );
  for (const b of balances.rows) {
    await lockEmployee(db, tenant, b.employee_id);
    await db.query(
      `INSERT INTO hrm_schema.leave_balances (tenant_id,employee_id,leave_type_id,year) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [tenant, b.employee_id, targetId, b.year],
    );
    const t = (
      await db.query(
        `SELECT id FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 FOR UPDATE`,
        [tenant, b.employee_id, targetId, b.year],
      )
    ).rows[0];
    await applyLeaveDelta(db, tenant, t.id, {
      opening: Number(b.opening_balance),
      accrued: Number(b.accrued),
      used: Number(b.used),
      pending: Number(b.pending),
      adjusted: Number(b.adjusted),
      remaining: Number(b.remaining),
    });
    await db.query(
      `DELETE FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND id=$2`,
      [tenant, b.id],
    );
  }
  const moved = async (sql: string) =>
    (await db.query(sql, [tenant, sourceId, targetId])).rowCount ?? 0;
  const transactions = await moved(
    `UPDATE hrm_schema.leave_transactions SET leave_type_id=$3 WHERE tenant_id=$1 AND leave_type_id=$2`,
  );
  const requests = await moved(
    `UPDATE hrm_schema.leave_requests SET leave_type_id=$3 WHERE tenant_id=$1 AND leave_type_id=$2`,
  );
  const carryovers = await moved(
    `UPDATE hrm_schema.leave_carryovers SET leave_type_id=$3 WHERE tenant_id=$1 AND leave_type_id=$2`,
  );
  // Schedules overlapping a target schedule would double-accrue: leave them on the (now inactive) source.
  const schedules = await moved(
    `UPDATE hrm_schema.leave_accrual_schedules s SET leave_type_id=$3,updated_at=now() WHERE s.tenant_id=$1 AND s.leave_type_id=$2 AND NOT EXISTS (SELECT 1 FROM hrm_schema.leave_accrual_schedules t WHERE t.tenant_id=s.tenant_id AND t.leave_type_id=$3 AND daterange(t.effective_from,COALESCE(t.effective_to,'infinity'::date),'[]') && daterange(s.effective_from,COALESCE(s.effective_to,'infinity'::date),'[]'))`,
  );
  await db.query(
    `UPDATE hrm_schema.leave_types SET active=false,merged_into_id=$3,merged_at=now(),updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2`,
    [tenant, sourceId, targetId],
  );
  const result = {
    sourceId,
    targetId,
    balances: balances.rowCount ?? 0,
    transactions,
    requests,
    carryovers,
    schedulesMoved: schedules,
  };
  await lifecycleAudit(db, tenant, actor, 'LEAVE_TYPE_MERGED', sourceId, {
    ...result,
    sourceCode: source.code,
    targetCode: target.code,
    reason,
  });
  return result;
}
