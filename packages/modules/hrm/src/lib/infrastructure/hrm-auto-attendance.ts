import type { Pool, PoolClient } from 'pg';
import {
  EMPTY_AUTO_ATTENDANCE,
  appliesOnDate,
  appliesToEmployeeOnDate,
  type AutoAttendanceEmployeeRule,
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

/** Bảng cấu hình theo nhân viên (migration 0066) đã có chưa; chưa có thì chỉ chạy theo cấu hình chung của tenant. */
export async function autoAttendanceEmployeesReady(db: Queryable): Promise<boolean> {
  const res = await db.query(`SELECT to_regclass('hrm_schema.auto_attendance_employees') IS NOT NULL AS ok`);
  return res.rows[0]?.ok === true;
}

/** Các cấu hình theo nhân viên còn hiệu lực (chưa gỡ) và giao với khoảng ngày đang xét. */
export async function loadAutoAttendanceEmployeeRules(
  db: Queryable,
  tenant: string,
  from: string,
  to: string,
): Promise<AutoAttendanceEmployeeRule[]> {
  const res = await db.query(
    `SELECT employee_id, weekdays, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date
       FROM hrm_schema.auto_attendance_employees
      WHERE tenant_id=$1 AND removed_at IS NULL AND from_date<=$3::date AND (to_date IS NULL OR to_date>=$2::date)`,
    [tenant, from, to],
  );
  return res.rows.map((r) => ({
    employeeId: r.employee_id as string,
    weekdays: r.weekdays ? (r.weekdays as (number | string)[]).map(Number) : null,
    fromDate: r.from_date as string,
    toDate: (r.to_date as string | null) ?? null,
  }));
}

/**
 * Ngày làm việc có ca (lịch từng ngày trước, rồi lịch định kỳ khi ngày đó không có lịch từng ngày) mà `applies` chọn:
 * rơi vào thứ của cấu hình chung của tenant hoặc thuộc cấu hình riêng của nhân viên. `onlyEmployees` giới hạn phạm vi
 * khi tenant không bật cấu hình chung. Không phụ thuộc cờ trên phân ca nên bật/tắt không cần phân ca lại.
 */
async function candidatesOf(
  db: PoolClient,
  tenant: string,
  from: string,
  to: string,
  applies: (employeeId: string, date: string) => boolean,
  onlyEmployees: string[] | null,
): Promise<Candidate[]> {
  if (from > to) return [];
  const explicit = await db.query(
    `SELECT w.employee_id, to_char(w.work_date,'YYYY-MM-DD') AS date, w.day_type
       FROM hrm_schema.employee_work_days w
       JOIN hrm_schema.employee_profiles p ON p.tenant_id=w.tenant_id AND p.employee_id=w.employee_id AND p.deleted_at IS NULL
      WHERE w.tenant_id=$1 AND w.status='ACTIVE' AND w.work_date BETWEEN $2::date AND $3::date
        AND w.work_date>=p.join_date AND (p.inactive_from IS NULL OR w.work_date<p.inactive_from)
        AND ($4::uuid[] IS NULL OR w.employee_id = ANY($4::uuid[]))`,
    [tenant, from, to, onlyEmployees],
  );
  const taken = new Set<string>();
  const out: Candidate[] = [];
  for (const r of explicit.rows) {
    taken.add(`${r.employee_id}:${r.date}`);
    if (r.day_type === 'SHIFT' && applies(r.employee_id, r.date)) out.push({ employeeId: r.employee_id, date: r.date });
  }
  const hasRule = await db.query(
    `SELECT EXISTS(SELECT 1 FROM hrm_schema.work_schedule_rules WHERE tenant_id=$1 AND status='ACTIVE') AS ok`,
    [tenant],
  );
  if (hasRule.rows[0]?.ok !== true) return out;
  const employees = await db.query(
    `SELECT employee_id FROM hrm_schema.employee_profiles
      WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date<=$2::date AND ($3::uuid[] IS NULL OR employee_id = ANY($3::uuid[]))`,
    [tenant, to, onlyEmployees],
  );
  const ruleDays = await resolveRuleDays(
    db,
    tenant,
    employees.rows.map((r) => r.employee_id as string),
    from,
    to,
  );
  for (const d of ruleDays)
    if (d.dayType === 'SHIFT' && !taken.has(`${d.employeeId}:${d.date}`) && applies(d.employeeId, d.date))
      out.push({ employeeId: d.employeeId, date: d.date });
  return out;
}

/**
 * Sinh sự kiện chấm công vào/ra đúng giờ bắt đầu/kết thúc ca cho các ngày thuộc cấu hình "Chấm công tự động".
 * Sinh ngay từ đầu ngày (không chờ ca kết thúc, không phụ thuộc ngày đã có sự kiện chấm công khác hay đơn nghỉ/công tác),
 * miễn là ngày có ca trong lịch và kỳ công chưa khóa. Đơn nghỉ/công tác đã duyệt chèn lên phần tự động khi tính công
 * (xem `autoOnly` trong resolveDayOutcome). Chạy lặp lại không tạo trùng (khóa theo nhân viên và ngày).
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
  // Tenant chưa chạy migration 0055/0066 hoặc chưa bật gì thì bỏ qua, không làm hỏng tính công.
  const settings = (await autoAttendanceSettingsReady(db, tenant))
    ? await loadAutoAttendanceSettings(db, tenant)
    : { ...EMPTY_AUTO_ATTENDANCE };
  const tenantOn = settings.enabled && settings.weekdays.length > 0;
  const rules = (await autoAttendanceEmployeesReady(db))
    ? await loadAutoAttendanceEmployeeRules(db, tenant, from, upper)
    : [];
  if (!tenantOn && rules.length === 0) return { generated: 0 };
  const rulesOf = new Map<string, AutoAttendanceEmployeeRule[]>();
  for (const rule of rules) rulesOf.set(rule.employeeId, [...(rulesOf.get(rule.employeeId) ?? []), rule]);
  const applies = (employeeId: string, date: string) =>
    (tenantOn && appliesOnDate(settings, date)) ||
    (rulesOf.get(employeeId) ?? []).some((rule) => appliesToEmployeeOnDate(rule, date));
  const candidates = await candidatesOf(db, tenant, from, upper, applies, tenantOn ? null : [...rulesOf.keys()]);
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
    const policy = await resolvePolicy(db, tenant, 'ATTENDANCE', date, employeeId);
    const timezone = String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh');
    const { shift } = await dayContextForDate(db, tenant, employeeId, date, timezone);
    if (!shift) continue;
    const startMs = Date.parse(shift.window.start);
    const endMs = Date.parse(shift.window.end);
    if (!(endMs > startMs)) continue;
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
