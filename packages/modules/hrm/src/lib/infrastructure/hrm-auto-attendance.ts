import type { Pool, PoolClient } from 'pg';
import {
  EMPTY_AUTO_ATTENDANCE,
  appliesOnDate,
  type AutoAttendanceSettings,
} from '../domain/auto-attendance-settings.js';
import { hrmTransaction } from './hrm-transaction.js';
import {
  dayContextForDate,
  recalculateAttendance,
  resolvePolicy,
} from './hrm-time.js';
import { resolveRuleDays } from './hrm-work-schedule-resolve.js';

/** Nguồn của sự kiện chấm công do hệ thống tự sinh theo ca (cấu hình "Chấm công tự động" đang bật). */
export const AUTO_ATTENDANCE_SOURCE = 'AUTO';

interface Candidate {
  employeeId: string;
  date: string;
}

const vnDate = (ms: number) =>
  new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
const shiftDays = (date: string, delta: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000)
    .toISOString()
    .slice(0, 10);

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** Bảng cấu hình (migration 0055) đã có chưa; tenant chưa chạy migration thì không sinh gì và không báo lỗi. */
export async function autoAttendanceSettingsReady(db: Queryable, _tenant: string): Promise<boolean> {
  const res = await db.query(`SELECT to_regclass('hrm_schema.auto_attendance_settings') IS NOT NULL AS ok`);
  return res.rows[0]?.ok === true;
}

/** Cấu hình chấm công tự động của tenant; chưa lưu lần nào thì là tắt. Gọi sau khi đã kiểm tra bảng tồn tại. */
export async function loadAutoAttendanceSettings(db: Queryable, tenant: string): Promise<AutoAttendanceSettings> {
  const res = await db.query(
    `SELECT enabled, weekdays, to_char(enabled_from, 'YYYY-MM-DD') AS enabled_from
       FROM hrm_schema.auto_attendance_settings WHERE tenant_id = $1`,
    [tenant],
  );
  const row = res.rows[0];
  if (!row) return { ...EMPTY_AUTO_ATTENDANCE };
  return {
    enabled: row.enabled === true,
    weekdays: (row.weekdays as (number | string)[]).map(Number),
    enabledFrom: (row.enabled_from as string | null) ?? null,
  };
}

/**
 * Ngày làm việc có ca (lịch từng ngày trước, rồi lịch định kỳ khi ngày đó không có lịch từng ngày) rơi vào thứ đã chọn
 * trong cấu hình chấm công tự động. Không phụ thuộc cờ trên phân ca nên bật/tắt không cần phân ca lại.
 */
async function candidatesOf(
  db: PoolClient,
  tenant: string,
  from: string,
  to: string,
  settings: AutoAttendanceSettings,
): Promise<Candidate[]> {
  const start = settings.enabledFrom && settings.enabledFrom > from ? settings.enabledFrom : from;
  if (start > to) return [];
  const explicit = await db.query(
    `SELECT w.employee_id, to_char(w.work_date,'YYYY-MM-DD') AS date, w.day_type
       FROM hrm_schema.employee_work_days w
       JOIN hrm_schema.employee_profiles p ON p.tenant_id=w.tenant_id AND p.employee_id=w.employee_id AND p.deleted_at IS NULL
      WHERE w.tenant_id=$1 AND w.status='ACTIVE' AND w.work_date BETWEEN $2::date AND $3::date
        AND w.work_date>=p.join_date AND (p.inactive_from IS NULL OR w.work_date<p.inactive_from)`,
    [tenant, start, to],
  );
  const taken = new Set<string>();
  const out: Candidate[] = [];
  for (const r of explicit.rows) {
    taken.add(`${r.employee_id}:${r.date}`);
    if (r.day_type === 'SHIFT' && appliesOnDate(settings, r.date)) out.push({ employeeId: r.employee_id, date: r.date });
  }
  const hasRule = await db.query(
    `SELECT EXISTS(SELECT 1 FROM hrm_schema.work_schedule_rules WHERE tenant_id=$1 AND status='ACTIVE') AS ok`,
    [tenant],
  );
  if (hasRule.rows[0]?.ok !== true) return out;
  const employees = await db.query(
    `SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date<=$2::date`,
    [tenant, to],
  );
  const ruleDays = await resolveRuleDays(
    db,
    tenant,
    employees.rows.map((r) => r.employee_id as string),
    start,
    to,
  );
  for (const d of ruleDays)
    if (d.dayType === 'SHIFT' && !taken.has(`${d.employeeId}:${d.date}`) && appliesOnDate(settings, d.date))
      out.push({ employeeId: d.employeeId, date: d.date });
  return out;
}

/**
 * Sinh sự kiện chấm công vào/ra đúng giờ bắt đầu/kết thúc ca cho các ngày thuộc cấu hình "Chấm công tự động".
 * Chỉ sinh khi ca đã kết thúc, ngày chưa có sự kiện chấm công nào (kể cả đã bị hủy bởi giải trình thì vẫn coi là có
 * xử lý tay), không có đơn nghỉ/công tác đã duyệt trong ngày và kỳ công chưa khóa. Chạy lặp lại không tạo trùng.
 */
export async function generateAutoAttendance(
  db: PoolClient,
  tenant: string,
  from: string,
  to: string,
  now = new Date(),
): Promise<{ generated: number }> {
  const today = vnDate(now.getTime());
  const upper = to < today ? to : today;
  if (from > upper) return { generated: 0 };
  // Tenant chưa chạy migration 0055 hoặc chưa bật thì bỏ qua, không làm hỏng tính công.
  if (!(await autoAttendanceSettingsReady(db, tenant))) return { generated: 0 };
  const settings = await loadAutoAttendanceSettings(db, tenant);
  if (!settings.enabled || settings.weekdays.length === 0) return { generated: 0 };
  const candidates = await candidatesOf(db, tenant, from, upper, settings);
  if (!candidates.length) return { generated: 0 };
  const locked = await db.query(
    `SELECT to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND status='LOCKED' AND to_date>=$2::date AND from_date<=$3::date`,
    [tenant, from, upper],
  );
  const isLocked = (date: string) =>
    locked.rows.some((p) => date >= p.from_date && date <= p.to_date);
  let generated = 0;
  for (const { employeeId, date } of candidates) {
    if (isLocked(date)) continue;
    const existing = await db.query(
      `SELECT 1 FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3::date LIMIT 1`,
      [tenant, employeeId, date],
    );
    if (existing.rowCount) continue;
    const covered = await db.query(
      `SELECT 1 FROM hrm_schema.leave_request_days d JOIN hrm_schema.leave_requests r ON r.id=d.request_id AND r.tenant_id=d.tenant_id WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED' AND d.work_date=$3::date
       UNION ALL
       SELECT 1 FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND $3::date BETWEEN from_date AND to_date
       LIMIT 1`,
      [tenant, employeeId, date],
    );
    if (covered.rowCount) continue;
    const policy = await resolvePolicy(db, tenant, 'ATTENDANCE', date, employeeId);
    const timezone = String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh');
    const { shift } = await dayContextForDate(db, tenant, employeeId, date, timezone);
    if (!shift) continue;
    const startMs = Date.parse(shift.window.start);
    const endMs = Date.parse(shift.window.end);
    if (!(endMs > startMs) || endMs > now.getTime()) continue;
    const evidence = JSON.stringify({
      auto: true,
      shiftId: shift.id,
      policyVersionId: policy?.id ?? null,
      timezone,
    });
    const inserted = await db.query(
      `INSERT INTO hrm_schema.attendance_events (tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence)
       VALUES ($1,$2,$3::date,'IN',to_timestamp($4/1000.0),$6,$7,$8),($1,$2,$3::date,'OUT',to_timestamp($5/1000.0),$6,$9,$8)
       ON CONFLICT (tenant_id,source,external_event_id) DO NOTHING`,
      [
        tenant,
        employeeId,
        date,
        startMs,
        endMs,
        AUTO_ATTENDANCE_SOURCE,
        `auto:${employeeId}:${date}:IN`,
        evidence,
        `auto:${employeeId}:${date}:OUT`,
      ],
    );
    if (!inserted.rowCount) continue;
    await recalculateAttendance(db, tenant, employeeId, date, timezone, AUTO_ATTENDANCE_SOURCE);
    generated++;
  }
  return { generated };
}

/** Việc nền của worker: bù cho vài ngày gần nhất (ca vừa kết thúc, hoặc worker tạm dừng). */
export async function runAutoAttendance(
  pool: Pool,
  tenant: string,
  now = new Date(),
  lookbackDays = 3,
) {
  const today = vnDate(now.getTime());
  return hrmTransaction(pool, (db) =>
    generateAutoAttendance(db, tenant, shiftDays(today, -lookbackDays), today, now),
  );
}
