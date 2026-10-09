import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOtRequestPayload } from '@enterprise-platform/contracts-hrm';
import {
  assertOpenDate,
  effectiveDayKind,
  isoDate,
  lockEmployee,
  resolvePolicy,
  shiftForDate,
} from './hrm-time.js';
import { localMinutesOfDay } from './hrm-leave-day-preview.js';
import { requireDate, requireText } from './hrm-validation.js';
import { assertNoRequestOverlap } from './hrm-request-overlap.js';

export async function validateOt(
  db: PoolClient,
  tenant: string,
  body: CreateOtRequestPayload,
  excludeId?: string,
) {
  requireDate(body.workDate, 'workDate');
  requireText(body.reason, 'reason', 2000);
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
  const calendar = await db.query(
    `SELECT to_char(work_date,'YYYY-MM-DD') AS date,day_kind FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date BETWEEN $2::date AND $2::date+1`,
    [tenant, body.workDate],
  );
  // Lịch làm việc ưu tiên; nếu không có thì ngày nghỉ hằng tuần của chính sách chấm công (Chủ nhật...) là ngày OFF.
  const attendance = await resolvePolicy(
    db,
    tenant,
    'ATTENDANCE',
    body.workDate,
    body.employeeId,
  );
  const dayKind =
    effectiveDayKind(
      body.workDate,
      calendar.rows.find((r) => r.date === body.workDate)?.day_kind,
      attendance?.config_json,
    ) || 'WORK';
  if (dayKind === 'WORK') {
    // OT phải nằm ngoài ca làm việc của chính nhân viên ngày đó.
    const timeZone = String(attendance?.config_json?.timezone || 'Asia/Ho_Chi_Minh');
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
  if (end < start && end > 0) {
    const tomorrow = new Date(body.workDate + 'T00:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await assertOpenDate(db, tenant, tomorrow.toISOString().slice(0, 10));
  }
  // Tạo đơn mới: OT không được trùng ngày nghỉ phép hoặc công tác (đang chờ / đã duyệt).
  // Bước duyệt (có excludeId) không kiểm tra lại để đơn cũ tồn đọng vẫn xử lý được.
  if (!excludeId)
    await assertNoRequestOverlap(db, tenant, body.employeeId, {
      kind: 'ot',
      fromDate: body.workDate,
      toDate: end < start && end > 0
        ? new Date(Date.parse(body.workDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
        : body.workDate,
    });
  // Loại OT chỉ là trường thông tin do người dùng chọn từ danh mục Loại OT: phải là mục đang sử dụng.
  // Hệ thống không suy ra loại từ ngày hay giờ đêm, không tham gia tính công / lương.
  const kind = String(body.otType ?? 'WEEKDAY').trim().toUpperCase();
  const declared = (
    await db.query(
      `SELECT name,active FROM hrm_schema.request_reasons
        WHERE tenant_id=$1 AND kind='OT_TYPE' AND upper(code)=$2 AND deleted_at IS NULL`,
      [tenant, kind],
    )
  ).rows[0];
  if (!declared)
    throw new BadRequestException('Loại OT không có trong danh mục Loại OT');
  if (!declared.active)
    throw new BadRequestException(
      `Loại OT "${declared.name}" đang ngừng sử dụng; hãy chọn loại OT khác`,
    );
  // Đơn từ chỉ tác động bảng công: không có hệ số lương, lưu hệ số trung tính 1.
  const rate = 1;
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
  const unitNames: Record<string, string> = {
    day: 'ngày',
    week: 'tuần',
    month: 'tháng',
    year: 'năm',
  };
  for (const row of totals.rows) {
    const limit = Number(config[limits[row.unit]]);
    if (Number(row.total) > limit)
      throw new BadRequestException(
        `Vượt giới hạn OT ${unitNames[row.unit] ?? row.unit}: tổng ${Math.round(Number(row.total))} phút (gồm đơn này và các đơn chờ duyệt / đã duyệt), tối đa ${limit} phút`,
      );
  }
  return { policyId: policy.id, kind, rate, duration };
}
export async function createOvertime(
  db: PoolClient,
  tenant: string,
  body: CreateOtRequestPayload,
) {
  await lockEmployee(db, tenant, body.employeeId);
  const rule = await validateOt(db, tenant, body);
  const result = await db.query(
    `INSERT INTO hrm_schema.ot_requests (tenant_id,employee_id,work_date,start_time,end_time,planned_minutes,ot_type,ot_rate_multiplier,reason,policy_version_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      tenant,
      body.employeeId,
      body.workDate,
      body.startTime,
      body.endTime,
      rule.duration,
      rule.kind,
      rule.rate,
      body.reason,
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
      otType: ot.ot_type,
      reason: ot.reason,
    },
    id,
  );
  const updated = await db.query(
    `UPDATE hrm_schema.ot_requests SET status='APPROVED',approved_minutes=planned_minutes,ot_rate_multiplier=$4,policy_version_id=$5,approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, actor, rule.rate, rule.policyId],
  );
  return updated.rows[0];
}
