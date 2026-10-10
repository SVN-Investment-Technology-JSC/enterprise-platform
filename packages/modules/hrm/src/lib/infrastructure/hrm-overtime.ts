import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOtRequestPayload } from '@enterprise-platform/contracts-hrm';
import {
  assertOpenDate,
  isoDate,
  lockEmployee,
  resolvePolicy,
  dayKindOf,
  shiftForDate,
} from './hrm-time.js';
import { localMinutesOfDay } from './hrm-leave-day-preview.js';
import { requireDate } from './hrm-validation.js';
import { assertNoRequestOverlap } from './hrm-request-overlap.js';

/**
 * Phần của đơn OT mà việc kiểm tra và tính hệ số cần: nhân viên, ngày và giờ làm thêm.
 * Lý do (danh mục) và mô tả (tự do) không ảnh hưởng đến kiểm tra này; loại OT cũng do hệ thống suy ra, không nhận từ client.
 */
export type OtScheduleInput = Pick<
  CreateOtRequestPayload,
  'employeeId' | 'workDate' | 'startTime' | 'endTime' | 'plannedMinutes'
>;

/** Lý do đã chọn từ danh mục (đã qua `resolveRequestReason`) và mô tả tự do của đơn OT. */
export interface OtReasonInput {
  readonly reasonId: string;
  readonly reasonName: string;
  /** Bản chụp "có lương" của lý do lúc tạo đơn; OT không lương không cộng vào bảng công. */
  readonly paid: boolean;
  /** Mô tả tự do (cột reason cũ); null nếu để trống. */
  readonly description: string | null;
}

/**
 * Kiểm tra đơn OT theo chính sách OT hiệu lực và suy ra loại OT, hệ số.
 * - Loại ngày (làm việc / nghỉ hằng tuần hoặc theo lịch phân ca / lễ) lấy từ `dayKindOf`; ban đêm theo khung giờ của chính sách.
 * - Một đơn không được vắt qua ranh giới ngày/đêm hay đổi loại ngày: người dùng tách thành nhiều đơn để áp đúng hệ số.
 * - Ngày làm việc: OT phải nằm ngoài ca của nhân viên. Tạo mới (không có `excludeId`) còn kiểm tra không chồng ngày nghỉ, công tác.
 * Trả về `kind` (WEEKDAY, WEEKEND, HOLIDAY, NIGHT) và `rate` (ot_rate_multiplier) để lưu vào đơn.
 */
export async function validateOt(
  db: PoolClient,
  tenant: string,
  body: OtScheduleInput,
  excludeId?: string,
) {
  requireDate(body.workDate, 'workDate');
  const minutes = (time: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time))
      throw new BadRequestException('Giờ OT không hợp lệ');
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  };
  const start = minutes(body.startTime),
    end = minutes(body.endTime),
    duration = (end - start + 1440) % 1440;
  if (!duration || duration !== body.plannedMinutes)
    throw new BadRequestException('Số phút OT phải khớp giờ đăng ký');
  await assertOpenDate(db, tenant, body.workDate);
  const policy = await resolvePolicy(
    db,
    tenant,
    'OT',
    body.workDate,
    body.employeeId,
  );
  if (!policy)
    throw new BadRequestException(
      'Cần chính sách OT có hiệu lực trước khi đăng ký',
    );
  const config = policy.config_json;
  for (const field of [
    'dailyLimitMinutes',
    'weeklyLimitMinutes',
    'monthlyLimitMinutes',
    'yearlyLimitMinutes',
  ])
    if (!Number.isInteger(config[field]) || Number(config[field]) < 0)
      throw new BadRequestException(`Chính sách OT thiếu giới hạn ${field}`);
  // Loại ngày nhận biết lịch phân ca (ngày nghỉ/lễ theo lịch), rồi mới tới lịch làm việc chung và ngày nghỉ hằng tuần.
  const dayKind =
    (await dayKindOf(db, tenant, body.workDate, body.employeeId)) || 'WORK';
  if (dayKind === 'WORK') {
    // OT phải nằm ngoài ca làm việc của chính nhân viên ngày đó.
    const attendance = await resolvePolicy(
      db,
      tenant,
      'ATTENDANCE',
      body.workDate,
      body.employeeId,
    );
    const timeZone = String(
      attendance?.config_json?.timezone || 'Asia/Ho_Chi_Minh',
    );
    const shift = await shiftForDate(
      db,
      tenant,
      body.employeeId,
      body.workDate,
      timeZone,
    );
    if (shift) {
      const shiftStart = localMinutesOfDay(shift.window.start, timeZone);
      const shiftEnd =
        shiftStart +
        (Date.parse(shift.window.end) - Date.parse(shift.window.start)) / 60000;
      for (const offset of [0, 1440])
        if (
          start + offset < shiftEnd &&
          start + offset + duration > shiftStart
        )
          throw new BadRequestException(
            'Giờ làm thêm nằm trong ca làm việc của bạn; OT chỉ được đăng ký ngoài ca',
          );
    }
  }
  const nightStart = Number(config.nightStartMinute ?? 1320),
    nightEnd = Number(config.nightEndMinute ?? 360);
  if (
    !Number.isInteger(nightStart) ||
    !Number.isInteger(nightEnd) ||
    nightStart <= nightEnd ||
    nightStart > 1439 ||
    nightEnd < 0
  )
    throw new BadRequestException('Khung giờ OT đêm không hợp lệ');
  let nightMinutes = 0;
  for (let i = 0; i < duration; i++) {
    const m = (start + i) % 1440;
    if (m >= nightStart || m < nightEnd) nightMinutes++;
  }
  if (nightMinutes && nightMinutes !== duration)
    throw new BadRequestException(
      'Tách đơn tại ranh giới giờ ngày/đêm để áp dụng đúng hệ số',
    );
  if (end < start && end > 0) {
    const tomorrow = new Date(body.workDate + 'T00:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    await assertOpenDate(db, tenant, date);
    if (
      ((await dayKindOf(db, tenant, date, body.employeeId)) || 'WORK') !==
        dayKind ||
      (await resolvePolicy(db, tenant, 'OT', date, body.employeeId))?.id !==
        policy.id
    )
      throw new BadRequestException(
        'Tách đơn tại 00:00 khi thay đổi loại ngày hoặc chính sách OT',
      );
  }
  // Tạo đơn mới: OT không được trùng ngày nghỉ phép hoặc công tác (đang chờ / đã duyệt).
  // Bước duyệt (có excludeId) không kiểm tra lại để đơn cũ tồn đọng vẫn xử lý được.
  if (!excludeId)
    await assertNoRequestOverlap(db, tenant, body.employeeId, {
      kind: 'ot',
      fromDate: body.workDate,
      // OT qua nửa đêm kết thúc vào ngày kế tiếp; giờ bắt đầu / kết thúc để chốt chặn xét theo giờ, không chỉ theo ngày.
      toDate:
        end <= start
          ? new Date(Date.parse(body.workDate + 'T00:00:00Z') + 86400000)
              .toISOString()
              .slice(0, 10)
          : body.workDate,
      startTime: body.startTime.slice(0, 5),
      endTime: body.endTime.slice(0, 5),
    });
  // Đơn công tác không cho OT chỉ chặn khi giờ OT chồng giờ công tác (xét theo giờ như chốt chặn chồng đơn).
  const blockedTrip = await db.query(
    `SELECT id FROM hrm_schema.business_trip_requests
      WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED') AND allow_ot=false
        AND tsrange(from_date + COALESCE(start_time,'00:00'::time),
                    CASE WHEN end_time IS NULL THEN (to_date + 1)::timestamp ELSE to_date + end_time END,'[)')
         && tsrange($3::date + $4::time,
                    $3::date + $5::time + CASE WHEN $5::time<=$4::time THEN interval '1 day' ELSE interval '0 day' END,'[)')
      LIMIT 1`,
    [tenant, body.employeeId, body.workDate, body.startTime, body.endTime],
  );
  if (blockedTrip.rowCount)
    throw new BadRequestException(
      'Đơn công tác trong thời gian này không cho phép OT',
    );
  const kind = nightMinutes
    ? 'NIGHT'
    : dayKind === 'HOLIDAY'
      ? 'HOLIDAY'
      : dayKind === 'OFF'
        ? 'WEEKEND'
        : 'WEEKDAY';
  const rate = Number(
    config[
      nightMinutes && dayKind === 'HOLIDAY'
        ? 'nightHolidayRate'
        : nightMinutes && dayKind === 'OFF'
          ? 'nightOffRate'
          : {
              HOLIDAY: 'holidayRate',
              WEEKEND: 'offRate',
              NIGHT: 'nightRate',
              WEEKDAY: 'weekdayRate',
            }[kind]
    ],
  );
  if (!Number.isFinite(rate) || rate < 1 || rate > 10)
    throw new BadRequestException('Hệ số OT chưa được cấu hình hợp lệ');
  const duplicate = await db.query(
    `SELECT id FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED') AND ($4::uuid IS NULL OR id<>$4) AND
    tsrange(work_date+start_time,work_date+end_time+CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0 day' END,'[)') && tsrange($3::date+$5::time,$3::date+$6::time+CASE WHEN $6::time<=$5::time THEN interval '1 day' ELSE interval '0 day' END,'[)')`,
    [
      tenant,
      body.employeeId,
      body.workDate,
      excludeId || null,
      body.startTime,
      body.endTime,
    ],
  );
  if (duplicate.rowCount)
    throw new ConflictException('Trùng thời gian đăng ký OT');
  const totals = await db.query(
    `WITH requested AS (SELECT $3::date+$5::time AS starts,$3::date+$6::time+CASE WHEN $6::time<=$5::time THEN interval '1 day' ELSE interval '0 day' END AS ends),
    dates AS (SELECT starts::date AS date FROM requested UNION SELECT (ends-interval '1 microsecond')::date FROM requested),
    windows AS (SELECT DISTINCT unit,date_trunc(unit,date::timestamp) AS starts,date_trunc(unit,date::timestamp)+('1 '||unit)::interval AS ends FROM dates CROSS JOIN (VALUES('day'),('week'),('month'),('year')) u(unit)),
    events AS (SELECT work_date+start_time AS starts,work_date+end_time+CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0 day' END AS ends FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED') AND ($4::uuid IS NULL OR id<>$4) UNION ALL SELECT starts,ends FROM requested)
    SELECT w.unit,COALESCE(sum(GREATEST(0,extract(epoch FROM LEAST(e.ends,w.ends)-GREATEST(e.starts,w.starts)))/60),0) AS total FROM windows w LEFT JOIN events e ON e.starts<w.ends AND e.ends>w.starts GROUP BY w.unit,w.starts,w.ends`,
    [
      tenant,
      body.employeeId,
      body.workDate,
      excludeId || null,
      body.startTime,
      body.endTime,
    ],
  );
  const limits: Record<string, string> = {
    day: 'dailyLimitMinutes',
    week: 'weeklyLimitMinutes',
    month: 'monthlyLimitMinutes',
    year: 'yearlyLimitMinutes',
  };
  for (const row of totals.rows)
    if (Number(row.total) > Number(config[limits[row.unit]]))
      throw new BadRequestException(
        `Vượt giới hạn OT ${row.unit} (kể cả đơn chờ duyệt)`,
      );
  return { policyId: policy.id, kind, rate, duration };
}
/**
 * Tạo đơn OT. `reason` là lý do đã chọn từ danh mục (+ mô tả tự do) do handler tạo đơn xác định qua `resolveRequestReason`;
 * không truyền thì đơn không gắn lý do (reason_id null, có lương) và mô tả lấy từ `body.reason` kiểu cũ nếu có.
 */
export async function createOvertime(
  db: PoolClient,
  tenant: string,
  body: OtScheduleInput,
  reason?: OtReasonInput,
) {
  await lockEmployee(db, tenant, body.employeeId);
  const rule = await validateOt(db, tenant, body);
  const legacy = (body as { reason?: unknown }).reason;
  const description = reason
    ? reason.description
    : typeof legacy === 'string'
      ? legacy.trim()
      : null;
  const result = await db.query(
    `INSERT INTO hrm_schema.ot_requests (tenant_id,employee_id,work_date,start_time,end_time,planned_minutes,ot_type,ot_rate_multiplier,reason,reason_id,reason_name,paid,policy_version_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      tenant,
      body.employeeId,
      body.workDate,
      body.startTime,
      body.endTime,
      rule.duration,
      rule.kind,
      rule.rate,
      // Cột reason NOT NULL: mô tả để trống lưu chuỗi rỗng.
      description ?? '',
      reason?.reasonId ?? null,
      reason?.reasonName ?? null,
      reason?.paid ?? true,
      rule.policyId,
    ],
  );
  return result.rows[0];
}
export async function approveOvertime(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
) {
  const result = await db.query(
    `SELECT * FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenant, id],
  );
  const ot = result.rows[0];
  if (!ot) throw new NotFoundException('Không tìm thấy đơn OT');
  if (ot.status === 'APPROVED') return ot;
  if (ot.status !== 'PENDING')
    throw new ConflictException('Đơn OT không còn chờ duyệt');
  await lockEmployee(db, tenant, ot.employee_id);
  const rule = await validateOt(
    db,
    tenant,
    {
      employeeId: ot.employee_id,
      workDate: isoDate(ot.work_date),
      startTime: ot.start_time,
      endTime: ot.end_time,
      plannedMinutes: ot.planned_minutes,
    },
    id,
  );
  const updated = await db.query(
    `UPDATE hrm_schema.ot_requests SET status='APPROVED',approved_minutes=planned_minutes,ot_rate_multiplier=$4,policy_version_id=$5,approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, actor, rule.rate, rule.policyId],
  );
  return updated.rows[0];
}
