import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  calculateAttendance,
  type ShiftWindow,
} from '../domain/attendance-calculation.js';
import {
  resolveDay,
  workScheduleTableExists,
  type ScheduleDayType,
} from './hrm-shift-resolution.js';
import { applyScheduleDayKind } from '../domain/work-schedule.js';
import { resolveRuleDays } from './hrm-work-schedule-resolve.js';

export function isoDate(value: unknown): string {
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
}
/** Weekly day-off days (0=Sunday..6=Saturday) configured on the ATTENDANCE policy. */
export function weeklyOffDaysOf(
  config: Record<string, unknown> | null | undefined,
): number[] {
  const raw = config?.weeklyOffDays;
  return Array.isArray(raw)
    ? raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
}
/** Explicit work_calendar entries win; otherwise the weekly day-off applies. */
export function effectiveDayKind(
  date: string,
  calendarKind: string | null | undefined,
  config: Record<string, unknown> | null | undefined,
): string | null {
  if (calendarKind) return calendarKind;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weeklyOffDaysOf(config).includes(weekday) ? 'OFF' : null;
}
/** Loại ngày hiệu lực (work_calendar > ngày nghỉ hằng tuần của chính sách); null = ngày làm việc thường. */
export async function dayKindOf(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  date: string,
  employeeId?: string,
): Promise<string | null> {
  const calendar = await db.query(
    `SELECT day_kind FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date=$2::date`,
    [tenantId, date],
  );
  let config: Record<string, unknown> | undefined;
  try {
    config = (
      await resolvePolicy(db as PoolClient, tenantId, 'ATTENDANCE', date, employeeId)
    )?.config_json;
  } catch {
    config = undefined; // chính sách xung đột: không suy luận ngày nghỉ hằng tuần
  }
  const base = effectiveDayKind(date, calendar.rows[0]?.day_kind, config);
  if (!employeeId) return base;
  return applyScheduleDayKind(base, await scheduleDayTypeOf(db, tenantId, employeeId, date));
}
/**
 * Loại ngày theo lịch phân ca của nhân viên: lịch từng ngày (ngoại lệ, ngày lễ, gán theo khoảng) trước,
 * rồi lịch định kỳ không kết thúc; null nếu chưa có lịch nào (hoặc tenant chưa migrate).
 */
export async function scheduleDayTypeOf(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  employeeId: string,
  date: string,
): Promise<ScheduleDayType | null> {
  if (!(await workScheduleTableExists(db, tenantId))) return null;
  const r = await db.query(
    `SELECT day_type FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3::date AND status='ACTIVE'`,
    [tenantId, employeeId, date],
  );
  if (r.rows[0]) return r.rows[0].day_type as ScheduleDayType;
  const [rule] = await resolveRuleDays(db, tenantId, [employeeId], date, date);
  return rule ? rule.dayType : null;
}
export function isoTime(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}
export async function lockEmployee(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
) {
  const found = await db.query(
    `SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL`,
    [tenantId, employeeId],
  );
  if (!found.rowCount)
    throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `hrm:${tenantId}:${employeeId}`,
  ]);
}
export async function assertOpenDate(
  db: PoolClient,
  tenantId: string,
  date: string,
) {
  return assertOpenRange(db, tenantId, date, date);
}
export async function assertOpenRange(
  db: PoolClient,
  tenantId: string,
  from: string,
  to: string | null = null,
) {
  const periods = await db.query(
    `SELECT id,status FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND from_date<=COALESCE($3::date,'infinity'::date) AND to_date >= $2::date ORDER BY from_date FOR UPDATE`,
    [tenantId, from, to],
  );
  if (periods.rows.some((p) => p.status === 'LOCKED'))
    throw new ConflictException(
      'Kỳ công đã khóa; cần mở lại kỳ trước khi thay đổi dữ liệu',
    );
  await db.query(
    `UPDATE hrm_schema.timesheet_periods SET calculated_at=NULL WHERE tenant_id=$1 AND from_date<=COALESCE($3::date,'infinity'::date) AND to_date >= $2::date`,
    [tenantId, from, to],
  );
}
export interface ResolvableVersion {
  id: string;
  config_json: Record<string, unknown>;
  version_no?: number;
  effective_from?: unknown;
  effective_to?: unknown;
  policy_code?: string;
}
/** Employee-scoped versions override company-wide ones; more than one in the same tier is a conflict. */
export function pickPolicyVersion(
  rows: ResolvableVersion[],
  type: string,
  date: string,
  employeeId?: string,
) {
  const ids = (r: ResolvableVersion) =>
    Array.isArray(r.config_json?.employeeIds)
      ? (r.config_json.employeeIds as string[])
      : [];
  const scoped = rows.filter((r) => ids(r).length && ids(r).includes(employeeId!));
  const tier = scoped.length ? scoped : rows.filter((r) => !ids(r).length);
  if (tier.length > 1)
    throw new ConflictException(
      `Có nhiều chính sách ${type} cùng hiệu lực ngày ${date}: ` +
        tier
          .map(
            (r) =>
              `${r.policy_code ?? 'chính sách'} v${r.version_no ?? '?'} (${isoDate(r.effective_from)} - ${r.effective_to ? isoDate(r.effective_to) : 'chưa kết thúc'})`,
          )
          .join('; ') +
        '. Cần điều chỉnh phạm vi/ngày áp dụng tại Cấu hình công và thiết bị.',
    );
  return tier[0];
}
export async function resolvePolicy(
  db: PoolClient,
  tenantId: string,
  type: string,
  date: string,
  employeeId?: string,
) {
  const result = await db.query(
    `SELECT v.id, v.config_json, v.version_no, v.effective_from, v.effective_to, p.code AS policy_code FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id
    WHERE p.tenant_id=$1 AND p.policy_type=$2 AND p.status='ACTIVE' AND v.status IN ('ACTIVE','SUPERSEDED')
    AND v.effective_from<=$3::date AND (v.effective_to IS NULL OR v.effective_to>=$3::date)
    ORDER BY v.effective_from DESC, v.version_no DESC`,
    [tenantId, type, date],
  );
  return pickPolicyVersion(result.rows, type, date, employeeId) as
    | { id: string; config_json: Record<string, unknown> }
    | undefined;
}
export async function shiftForDate(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
) {
  return (await dayContextForDate(db, tenantId, employeeId, date, timezone)).shift;
}
/** Ca dự kiến cùng loại ngày theo lịch phân ca (OFF/HOLIDAY tường minh thì không có ca). */
export async function dayContextForDate(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
) {
  // Lịch từng ngày > ngoại lệ cá nhân > ca đơn vị trực tiếp > ca đơn vị cha (xem hrm-shift-resolution.ts).
  const { picked, scheduleDayType, holidayPaid } = await resolveDay(db, tenantId, employeeId, date, timezone);
  return { shift: picked ? shiftOf(picked) : null, scheduleDayType, holidayPaid };
}
function shiftOf(picked: NonNullable<Awaited<ReturnType<typeof resolveDay>>['picked']>) {
  const row = picked.row;
  return {
    id: row.id as string,
    assignmentId: row.assignment_id as string | null,
    source: picked.source,
    unitId: picked.unitId,
    before: row.check_in_before_minutes as number,
    after: row.check_out_after_minutes as number,
    window: {
      start: isoTime(row.starts_at)!,
      end: isoTime(row.ends_at)!,
      breakStart: isoTime(row.break_starts_at),
      breakEnd: isoTime(row.break_ends_at),
      breakMinutes: row.break_minutes,
      graceLateMinutes: row.grace_late_minutes,
      graceEarlyMinutes: row.grace_early_minutes,
    } as ShiftWindow,
  };
}
export async function timeContext(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  at: string,
) {
  // The configured time zone is resolved before assigning a civil work date.
  const local = await db.query(
    `SELECT to_char(($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS date`,
    [at],
  );
  let policy = await resolvePolicy(
    db,
    tenantId,
    'ATTENDANCE',
    local.rows[0].date,
    employeeId,
  );
  const timezone = String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new BadRequestException('Múi giờ chính sách không hợp lệ');
  }
  const dates = await db.query(
    `SELECT to_char(($1::timestamptz AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS today,
    to_char(($1::timestamptz AT TIME ZONE $2)::date-1, 'YYYY-MM-DD') AS yesterday`,
    [at, timezone],
  );
  const { today, yesterday } = dates.rows[0];
  const current = await shiftForDate(db, tenantId, employeeId, today, timezone);
  const previous = await shiftForDate(
    db,
    tenantId,
    employeeId,
    yesterday,
    timezone,
  );
  const timestamp = Date.parse(at);
  const includes = (s: NonNullable<typeof current>) =>
    timestamp >= Date.parse(s.window.start) - s.before * 60000 &&
    timestamp <= Date.parse(s.window.end) + s.after * 60000;
  const candidates = [
    { date: today as string, shift: current },
    { date: yesterday as string, shift: previous },
  ].filter((c) => c.shift && includes(c.shift));
  const inside = candidates.filter(
    (c) =>
      timestamp >= Date.parse(c.shift!.window.start) &&
      timestamp < Date.parse(c.shift!.window.end),
  );
  const matched = inside.length ? inside : candidates;
  if (matched.length > 1)
    throw new ConflictException(
      'Thời điểm chấm công thuộc hai cửa sổ ca; cần điều chỉnh quy định ca',
    );
  const date = matched[0]?.date || (today as string);
  policy = await resolvePolicy(db, tenantId, 'ATTENDANCE', date, employeeId);
  if (policy?.config_json.timezone && policy.config_json.timezone !== timezone)
    throw new ConflictException(
      'Thay đổi múi giờ giữa hai ca cần được đối soát trước khi chấm công',
    );
  return {
    date,
    shift: matched[0]?.shift || null,
    timezone,
    policy,
  };
}
export async function recalculateAttendance(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
  source = 'WEB_PORTAL',
) {
  const shift = await shiftForDate(db, tenantId, employeeId, date, timezone);
  const events = await db.query(
    `SELECT id,event_kind,occurred_at FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id IS NULL ORDER BY occurred_at,id`,
    [tenantId, employeeId, date],
  );
  const calculation = calculateAttendance(
    events.rows.map((r) => ({
      id: r.id,
      kind: r.event_kind,
      at: isoTime(r.occurred_at)!,
    })),
    shift?.window || null,
  );
  const result = await db.query(
    `INSERT INTO hrm_schema.attendances (tenant_id,employee_id,work_date,check_in_at,check_out_at,attendance_source,status,worked_minutes,scheduled_minutes,late_minutes,early_minutes,calculation_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (tenant_id,employee_id,work_date) DO UPDATE SET check_in_at=EXCLUDED.check_in_at,check_out_at=EXCLUDED.check_out_at,status=EXCLUDED.status,
    worked_minutes=EXCLUDED.worked_minutes,scheduled_minutes=EXCLUDED.scheduled_minutes,late_minutes=EXCLUDED.late_minutes,early_minutes=EXCLUDED.early_minutes,
    calculation_snapshot=EXCLUDED.calculation_snapshot,attendance_source=EXCLUDED.attendance_source,updated_at=now() RETURNING *`,
    [
      tenantId,
      employeeId,
      date,
      calculation.firstIn,
      calculation.lastOut,
      source,
      calculation.status,
      calculation.workedMinutes,
      calculation.scheduledMinutes,
      calculation.lateMinutes,
      calculation.earlyMinutes,
      JSON.stringify({ ...calculation, timezone, shift }),
    ],
  );
  return result.rows[0];
}
