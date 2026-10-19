import { assertQuotaOnApprove } from './hrm-request-quota.js';
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
  displayDate,
  assertOpenRange,
  effectiveDayKind,
  isUnassignedSunday,
  isoDate,
  lockEmployee,
  resolvePolicy,
  scheduleDayTypeOf,
  shiftForDate,
} from './hrm-time.js';
import { applyScheduleDayKind } from '../domain/work-schedule.js';
import { requireDate, requireUuid } from './hrm-validation.js';
import { descriptionColumn, pickDescription } from './hrm-request-reason-input.js';
import { unpostedUsableEntitlement } from './hrm-annual-leave.js';
import { assertNoRequestOverlap } from './hrm-request-overlap.js';
import { leaveDayWeight } from './hrm-leave-day-preview.js';

async function todayInDb(db: PoolClient): Promise<string> {
  return isoDate((await db.query('SELECT CURRENT_DATE AS today')).rows[0].today);
}
import type { CreateLeaveRequestPayload } from '@enterprise-platform/contracts-hrm';
import { calendarDatesOf, resolveRequestTime } from './hrm-request-time.js';

import { pendingReservedDays } from './hrm-leave-balance.js';

export { ensureLeaveBalance, applyLeaveDelta } from './hrm-leave-balance.js';
/** Thời gian đã chốt của đơn nghỉ (sau khi server tính theo ca). */
export interface LeaveTime {
  readonly fromDate: string;
  readonly toDate: string;
  readonly duration: number;
  /** Có khi đơn gửi theo "từ ngày giờ đến ngày giờ" (ISO UTC); null với cách cũ (ngày + số ngày). */
  readonly fromAt: string | null;
  readonly toAt: string | null;
}

export async function leaveDays(
  db: PoolClient,
  tenant: string,
  body: CreateLeaveRequestPayload,
) {
  requireUuid(body.employeeId, 'employeeId');
  requireUuid(body.leaveTypeId, 'leaveTypeId');
  // Lý do nghỉ là loại nghỉ (leaveTypeId); mô tả tự do là tùy chọn (`description`, bí danh cũ `reason`).
  pickDescription(body);
  // Thời gian: "từ ngày giờ đến ngày giờ" (server tính số ngày/giờ theo ca) hoặc cách cũ (khoảng ngày + số ngày).
  const timed = body.fromAt !== undefined || body.toAt !== undefined;
  let legacy: { fromDate: string; toDate: string; duration: number } | null = null;
  if (!timed) {
    const fromDate = requireDate(body.fromDate, 'fromDate');
    const toDate = requireDate(body.toDate, 'toDate');
    const duration = body.duration;
    if (
      toDate < fromDate ||
      Date.parse(toDate) - Date.parse(fromDate) > 366 * 86400000 ||
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      throw new BadRequestException('Khoảng nghỉ hoặc số lượng không hợp lệ');
    legacy = { fromDate, toDate, duration };
  }
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
  if (timed) return timedLeaveDays(db, tenant, body, type);
  const { fromDate, toDate, duration } = legacy!;
  const dates = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date,c.day_kind FROM generate_series($2::date,$3::date,'1 day') d LEFT JOIN hrm_schema.work_calendar c ON c.tenant_id=$1 AND c.work_date=d::date`,
    [tenant, fromDate, toDate],
  );
  const days: { date: string; quantity: number; paidMinutes: number }[] = [];
  // Kiểm tra kỳ công một lần cho cả khoảng nghỉ (trước đây mỗi ngày một lần, mỗi lần khoá và cập nhật dòng kỳ công).
  await assertOpenRange(db, tenant, fromDate, toDate);
  for (const day of dates.rows) {
    const policy = await resolvePolicy(
      db,
      tenant,
      'ATTENDANCE',
      day.date,
      body.employeeId,
    );
    // Ngày nghỉ hằng tuần (chính sách chấm công) không bị trừ phép; work_calendar nếu có thì ưu tiên.
    // Lịch phân ca tường minh của nhân viên (nghỉ / lễ / làm bù) thắng cả hai.
    const dayKind = applyScheduleDayKind(
      effectiveDayKind(day.date, day.day_kind, policy?.config_json),
      await scheduleDayTypeOf(db, tenant, body.employeeId, day.date),
    );
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
        `Chưa phân ca ngày ${displayDate(day.date)}; không thể xác định định mức phép`,
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
  if (days.length === 1 && duration <= total) {
    if (type.unit === 'DAYS' && ![0.5, 1].includes(duration))
      throw new BadRequestException(
        'Nghỉ theo ngày hỗ trợ nửa ngày hoặc cả ngày',
      );
    days[0].paidMinutes = Math.round(
      (days[0].paidMinutes * duration) / total,
    );
    days[0].quantity = duration;
  } else if (Math.abs(total - duration) > 0.005)
    throw new BadRequestException(
      `Số lượng nghỉ theo lịch làm việc là ${total} ${type.unit === 'HOURS' ? 'giờ' : 'ngày'}`,
    );
  const time: LeaveTime = { fromDate, toDate, duration, fromAt: null, toAt: null };
  return { type, days, time };
}

/**
 * Đơn nghỉ theo "từ ngày giờ đến ngày giờ": số ngày/giờ do server tính theo ca của nhân viên
 * (`resolveRequestTime`), không tin số client tự tính. Client gửi kèm `duration` thì phải khớp.
 */
async function timedLeaveDays(
  db: PoolClient,
  tenant: string,
  body: CreateLeaveRequestPayload,
  type: Record<string, any>,
) {
  const { timezone, fromMs, toMs, result } = await resolveRequestTime(
    db,
    tenant,
    body.employeeId,
    body.fromAt,
    body.toAt,
    type.unit === 'HOURS' ? 'HOURS' : 'DAYS',
  );
  if (result.errors.length) throw new BadRequestException(result.errors.join(' '));
  const days: { date: string; quantity: number; paidMinutes: number }[] = [];
  for (const day of result.days) {
    if (day.minutes <= 0) continue;
    await assertOpenDate(db, tenant, day.date);
    days.push({
      date: day.date,
      quantity: day.quantity,
      paidMinutes: type.paid ? day.minutes : 0,
    });
  }
  const duration = Math.round(days.reduce((sum, d) => sum + d.quantity, 0) * 100) / 100;
  if (
    body.duration !== undefined &&
    (typeof body.duration !== 'number' || Math.abs(body.duration - duration) > 0.005)
  )
    throw new BadRequestException(
      `Số lượng nghỉ theo thời gian đã chọn là ${duration} ${type.unit === 'HOURS' ? 'giờ' : 'ngày'}`,
    );
  const calendar = calendarDatesOf(fromMs, toMs, timezone);
  const time: LeaveTime = {
    fromDate: [calendar[0], days[0].date].sort()[0],
    toDate: [calendar[calendar.length - 1], days[days.length - 1].date].sort().pop() as string,
    duration,
    fromAt: new Date(fromMs).toISOString(),
    toAt: new Date(toMs).toISOString(),
  };
  return { type, days, time };
}
export async function createLeave(
  db: PoolClient,
  tenant: string,
  actor: string,
  body: CreateLeaveRequestPayload,
) {
  await lockEmployee(db, tenant, body.employeeId);
  const { type, days, time } = await leaveDays(db, tenant, body);
  // Nghỉ phép, công tác, làm thêm giờ đều ảnh hưởng bảng lương: không chồng ngày với đơn khác chờ duyệt / đã duyệt.
  await assertNoRequestOverlap(db, tenant, body.employeeId, {
    kind: 'leave',
    fromDate: time.fromDate,
    toDate: time.toDate,
    fromAt: time.fromAt,
    toAt: time.toAt,
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
      // Đơn nghỉ khác đang chờ duyệt cũng đã "chiếm" quỹ: không cho nhiều đơn cùng vượt quỹ rồi mới lỗi lúc duyệt.
      const pending = await pendingReservedDays(db, tenant, body.employeeId, body.leaveTypeId, year);
      const available = Number(balance.remaining) + usable.extra - pending;
      const fmt = (n: number) => String(Math.round(n * 100) / 100);
      const detail = `còn ${fmt(Number(balance.remaining) + usable.extra)} ngày, đang chờ duyệt ${fmt(pending)} ngày, đơn này ${fmt(amount)} ngày`;
      // Chưa có quỹ phép năm hoặc quỹ bằng 0: không có gì để trừ, không được lập đơn, kể cả khi loại nghỉ có hạn mức âm.
      if (available <= 0.005)
        throw new BadRequestException(
          usable.projected !== null && !usable.advanceAllowed
            ? `Quỹ phép năm ${year} không đủ (${detail}): loại nghỉ không cho ứng phép, chỉ dùng phần đã tích luỹ đến tháng hiện tại`
            : `Chưa có quỹ phép năm ${year} khả dụng (quỹ hiện bằng 0): không thể lập đơn nghỉ phép năm. Liên hệ nhân sự để cấp phép hoặc chọn lý do nghỉ khác.`,
        );
      // Phép năm không cho âm: bỏ qua hạn mức âm đã cấu hình; loại nghỉ khác dùng hạn mức âm của chính nó.
      const negativeLimit = type.is_annual ? 0 : Number(type.negative_limit);
      if (available - amount < -negativeLimit - 0.005)
        throw new BadRequestException(
          usable.projected === null || usable.advanceAllowed
            ? `Quỹ phép năm ${year} không đủ (${detail})`
            : `Quỹ phép năm ${year} không đủ (${detail}): loại nghỉ không cho ứng phép, chỉ dùng phần đã tích luỹ đến tháng hiện tại`,
        );
    }
  const base = [
    tenant,
    body.employeeId,
    body.leaveTypeId,
    time.fromDate,
    time.toDate,
    time.duration,
    descriptionColumn(pickDescription(body)),
    body.attachmentFileId || null,
    deductsBalance,
  ];
  // Cột from_at/to_at (migration 0047) chỉ ghi khi đơn gửi theo từ ngày giờ đến ngày giờ.
  const result = time.fromAt
    ? await db.query(
        `INSERT INTO hrm_schema.leave_requests (tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,attachment_file_id,balance_reserved,from_at,to_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [...base, time.fromAt, time.toAt],
      )
    : await db.query(
        `INSERT INTO hrm_schema.leave_requests (tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,attachment_file_id,balance_reserved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        base,
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
  if (target === 'APPROVED') await assertQuotaOnApprove(db, tenant, 'leave', leave);
  await assertOpenRange(db, tenant, isoDate(leave.from_date), isoDate(leave.to_date));
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
          `SELECT CASE WHEN is_annual THEN 0 ELSE negative_limit END AS negative_limit FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2`,
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
