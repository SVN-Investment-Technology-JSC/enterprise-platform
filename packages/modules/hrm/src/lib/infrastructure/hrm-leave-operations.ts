import { applyLeaveDelta, ensureLeaveBalance } from './hrm-leave-balance.js';
import {
  reserveCarryover,
  transitionCarryover,
} from './hrm-leave-carryover.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  assertOpenDate,
  effectiveDayKind,
  isUnassignedSunday,
  isoDate,
  lockEmployee,
  resolvePolicy,
  shiftForDate,
} from './hrm-time.js';
import { requireDate, requireText, requireUuid } from './hrm-validation.js';
import { unpostedUsableEntitlement } from './hrm-annual-leave.js';
import { assertNoRequestOverlap } from './hrm-request-overlap.js';
import { leaveDayWeight } from './hrm-leave-day-preview.js';

async function todayInDb(db: PoolClient): Promise<string> {
  return isoDate((await db.query('SELECT CURRENT_DATE AS today')).rows[0].today);
}
import type { CreateLeaveRequestPayload } from '@enterprise-platform/contracts-hrm';

export { ensureLeaveBalance, applyLeaveDelta } from './hrm-leave-balance.js';
export async function leaveDays(
  db: PoolClient,
  tenant: string,
  body: CreateLeaveRequestPayload,
) {
  requireDate(body.fromDate, 'fromDate');
  requireDate(body.toDate, 'toDate');
  requireUuid(body.employeeId, 'employeeId');
  requireUuid(body.leaveTypeId, 'leaveTypeId');
  requireText(body.reason, 'reason', 2000);
  if (
    body.toDate < body.fromDate ||
    Date.parse(body.toDate) - Date.parse(body.fromDate) > 366 * 86400000 ||
    !Number.isFinite(body.duration) ||
    body.duration <= 0
  )
    throw new BadRequestException('Khoảng nghỉ hoặc số lượng không hợp lệ');
  const typeResult = await db.query(
    `SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 AND active=true AND deleted_at IS NULL`,
    [tenant, body.leaveTypeId],
  );
  const type = typeResult.rows[0];
  if (!type)
    throw new NotFoundException('Không tìm thấy loại nghỉ đang áp dụng');
  if (type.requires_attachment && !body.attachmentFileId)
    throw new BadRequestException('Loại nghỉ yêu cầu chứng từ đính kèm');
  if (body.attachmentFileId) {
    const attachment = await db.query(
      `SELECT id FROM hrm_schema.attachments WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND status='READY' AND deleted_at IS NULL`,
      [
        tenant,
        body.employeeId,
        requireUuid(body.attachmentFileId, 'attachmentFileId'),
      ],
    );
    if (!attachment.rowCount)
      throw new BadRequestException(
        'Chứng từ chưa tải lên hoặc không thuộc nhân viên',
      );
  }
  const dates = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date,c.day_kind FROM generate_series($2::date,$3::date,'1 day') d LEFT JOIN hrm_schema.work_calendar c ON c.tenant_id=$1 AND c.work_date=d::date`,
    [tenant, body.fromDate, body.toDate],
  );
  const days: { date: string; quantity: number; paidMinutes: number }[] = [];
  for (const day of dates.rows) {
    await assertOpenDate(db, tenant, day.date);
    const policy = await resolvePolicy(
      db,
      tenant,
      'ATTENDANCE',
      day.date,
      body.employeeId,
    );
    // Ngày nghỉ hằng tuần (chính sách chấm công) không bị trừ phép; work_calendar nếu có thì ưu tiên.
    const dayKind = effectiveDayKind(day.date, day.day_kind, policy?.config_json);
    if (dayKind === 'OFF' || dayKind === 'HOLIDAY') continue;
    const shift = await shiftForDate(
      db,
      tenant,
      body.employeeId,
      day.date,
      String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh'),
    );
    if (!shift) {
      // Chủ nhật chưa phân ca là ngày trống: không trừ phép, không báo thiếu ca.
      if (isUnassignedSunday(day.date, dayKind, false)) continue;
      throw new BadRequestException(
        `Chưa phân ca ngày ${day.date}; không thể xác định định mức phép`,
      );
    }
    const minutes =
      (Date.parse(shift.window.end) - Date.parse(shift.window.start)) / 60000 -
      shift.window.breakMinutes;
    days.push({
      date: day.date,
      quantity: type.unit === 'HOURS' ? minutes / 60 : leaveDayWeight(minutes),
      paidMinutes: type.paid ? minutes : 0,
    });
  }
  if (!days.length)
    throw new BadRequestException('Khoảng nghỉ không có ngày làm việc');
  const total = days.reduce((sum, d) => sum + d.quantity, 0);
  if (days.length === 1 && body.duration <= total) {
    if (type.unit === 'DAYS' && ![0.5, 1].includes(body.duration))
      throw new BadRequestException(
        'Nghỉ theo ngày hỗ trợ nửa ngày hoặc cả ngày',
      );
    days[0].paidMinutes = Math.round(
      (days[0].paidMinutes * body.duration) / total,
    );
    days[0].quantity = body.duration;
  } else if (Math.abs(total - body.duration) > 0.005)
    throw new BadRequestException(
      `Số lượng nghỉ theo lịch làm việc là ${total} ${type.unit === 'HOURS' ? 'giờ' : 'ngày'}`,
    );
  return { type, days };
}
export async function createLeave(
  db: PoolClient,
  tenant: string,
  actor: string,
  body: CreateLeaveRequestPayload,
) {
  await lockEmployee(db, tenant, body.employeeId);
  const { type, days } = await leaveDays(db, tenant, body);
  // Nghỉ phép, công tác, làm thêm giờ đều ảnh hưởng bảng lương: không chồng ngày với đơn khác chờ duyệt / đã duyệt.
  await assertNoRequestOverlap(db, tenant, body.employeeId, {
    kind: 'leave',
    fromDate: body.fromDate,
    toDate: body.toDate,
  });
  const years = new Map<number, number>();
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    years.set(year, (years.get(year) || 0) + day.quantity);
  }
  // Quỹ phép chỉ áp dụng cho phép năm: nghỉ không lương không bao giờ kiểm tra/trừ quỹ.
  const deductsBalance = Boolean(type.deduct_balance) && type.paid !== false;
  if (deductsBalance)
    for (const [year, amount] of years) {
      const balance = await ensureLeaveBalance(
        db,
        tenant,
        body.employeeId,
        body.leaveTypeId,
        year,
      );
      const usable = await unpostedUsableEntitlement(
        db,
        tenant,
        body.employeeId,
        body.leaveTypeId,
        year,
        Number(balance.accrued),
        await todayInDb(db),
      );
      if (
        Number(balance.remaining) +
          usable.extra -
          amount <
        -Number(type.negative_limit) - 0.005
      )
        throw new BadRequestException(
          usable.projected === null || usable.advanceAllowed
            ? `Quỹ phép năm ${year} không đủ`
            : `Quỹ phép năm ${year} không đủ: loại nghỉ không cho ứng phép, chỉ dùng phần đã tích luỹ đến tháng hiện tại`,
        );
    }
  const result = await db.query(
    `INSERT INTO hrm_schema.leave_requests (tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,attachment_file_id,balance_reserved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      tenant,
      body.employeeId,
      body.leaveTypeId,
      body.fromDate,
      body.toDate,
      body.duration,
      body.reason,
      body.attachmentFileId || null,
      deductsBalance,
    ],
  );
  for (const day of days)
    await db.query(
      `INSERT INTO hrm_schema.leave_request_days (request_id,tenant_id,work_date,quantity,paid_minutes) VALUES ($1,$2,$3,$4,$5)`,
      [result.rows[0].id, tenant, day.date, day.quantity, day.paidMinutes],
    );
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'LEAVE_SUBMITTED',$3,$4)`,
    [tenant, actor, result.rows[0].id, JSON.stringify({ days })],
  );
  return result.rows[0];
}
export async function transitionLeave(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
  target: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  reason?: string,
) {
  const result = await db.query(
    `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenant, id],
  );
  const leave = result.rows[0];
  if (!leave) throw new NotFoundException('Không tìm thấy đơn nghỉ');
  if (leave.status === target) return leave;
  if (
    leave.status !== 'PENDING' &&
    !(leave.status === 'APPROVED' && target === 'CANCELLED')
  )
    throw new ConflictException('Trạng thái đơn không cho phép thao tác này');
  await lockEmployee(db, tenant, leave.employee_id);
  const dates = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
    [leave.from_date, leave.to_date],
  );
  for (const day of dates.rows) await assertOpenDate(db, tenant, day.date);
  const allocations = await db.query(
    `SELECT extract(year FROM work_date)::int AS year,sum(quantity)::numeric AS amount FROM hrm_schema.leave_request_days WHERE request_id=$1 AND tenant_id=$2 GROUP BY 1`,
    [id, tenant],
  );
  const parts = allocations.rows.length
    ? allocations.rows
    : [
        {
          year: Number(isoDate(leave.from_date).slice(0, 4)),
          amount: Number(leave.duration),
        },
      ];
  // Legacy approved requests deducted a balance even before the reservation marker existed.
  const reserved =
    leave.balance_reserved ||
    (leave.status === 'APPROVED' && !allocations.rows.length);
  if (reserved)
    for (const part of parts) {
      const balance = await ensureLeaveBalance(
        db,
        tenant,
        leave.employee_id,
        leave.leave_type_id,
        part.year,
      );
      const amount = Number(part.amount);
      if (target === 'APPROVED' && !leave.pending_held) {
        // Đơn không giữ chỗ khi gửi: kiểm tra quỹ tại thời điểm duyệt.
        const limit = await db.query(
          `SELECT negative_limit FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2`,
          [tenant, leave.leave_type_id],
        );
        const usable = await unpostedUsableEntitlement(
          db,
          tenant,
          leave.employee_id,
          leave.leave_type_id,
          part.year,
          Number(balance.accrued),
          await todayInDb(db),
        );
        if (
          Number(balance.remaining) + usable.extra - amount <
          -Number(limit.rows[0]?.negative_limit ?? 0) - 0.005
        )
          throw new BadRequestException(
            `Quỹ phép năm ${part.year} không đủ để duyệt đơn`,
          );
      }
      const usedDelta =
          target === 'APPROVED'
            ? amount
            : leave.status === 'APPROVED'
              ? -amount
              : 0;
      const pendingDelta =
        leave.status === 'PENDING' && leave.pending_held ? -amount : 0;
      const updated = await applyLeaveDelta(db, tenant, balance.id, {
        pending: pendingDelta,
        used: usedDelta,
        remaining: -usedDelta,
      });
      if (usedDelta)
        await db.query(
          `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,reference_request_id,note,balance_year,operation_key,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            tenant,
            leave.employee_id,
            leave.leave_type_id,
            usedDelta > 0 ? 'USAGE' : 'REVERSAL',
            -usedDelta,
            updated.remaining,
            id,
            reason || target,
            part.year,
            `${id}:${target}:${part.year}`,
            actor,
          ],
        );
    }
  if (
    target === 'APPROVED' &&
    leave.status === 'PENDING' &&
    leave.balance_reserved &&
    !leave.pending_held
  ) {
    // Phép chuyển chỉ được phân bổ khi duyệt (không giữ chỗ lúc gửi đơn).
    const dayRows = await db.query(
      `SELECT to_char(work_date,'YYYY-MM-DD') AS date,quantity FROM hrm_schema.leave_request_days WHERE request_id=$1 AND tenant_id=$2`,
      [id, tenant],
    );
    const days = dayRows.rows.map((r) => ({
      date: r.date as string,
      quantity: Number(r.quantity),
    }));
    for (const part of parts)
      await reserveCarryover(
        db,
        tenant,
        leave.employee_id,
        leave.leave_type_id,
        id,
        days,
        part.year,
      );
  }
  await transitionCarryover(
    db,
    tenant,
    actor,
    id,
    target,
    new Date().toISOString().slice(0, 10),
  );
  const updated = await db.query(
    `UPDATE hrm_schema.leave_requests SET status=$3::varchar,approved_by=$4,approved_at=now(),applied_at=CASE WHEN $3::varchar='APPROVED' THEN now() ELSE applied_at END,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, target, actor],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,$3,$4,$5)`,
    [
      tenant,
      actor,
      `LEAVE_${target}`,
      id,
      JSON.stringify({ reason, previousStatus: leave.status }),
    ],
  );
  return updated.rows[0];
}
