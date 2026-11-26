import type { PoolClient } from 'pg';
import { isoDate, pickPolicyVersion, shiftOf, type ResolvableVersion } from './hrm-time.js';
import {
  workScheduleTableExists,
  type PickedShift,
  type ResolvedShiftRow,
  type ScheduleDayType,
} from './hrm-shift-resolution.js';
import { resolveRuleDays, type RuleDay } from './hrm-work-schedule-resolve.js';

type Db = Pick<PoolClient, 'query'>;

/** Nhân viên và các ngày của kỳ cần tính; dùng chung quy tắc "ngày nằm trong thời gian làm việc". */
export interface TimesheetScope {
  readonly employees: readonly { employee_id: string; join_date: unknown; inactive_from: unknown }[];
  readonly dates: readonly string[];
}

export const isEmployedOn = (
  employee: { join_date: unknown; inactive_from: unknown },
  date: string,
): boolean => !(date < isoDate(employee.join_date) || (employee.inactive_from && date >= isoDate(employee.inactive_from)));

const key = (employeeId: string, date: string) => `${employeeId}|${date}`;

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Các ngày của [from, to] nằm trong [min, max] (YYYY-MM-DD, so sánh chuỗi). */
function datesWithin(from: string, to: string, min: string, max: string): string[] {
  const out: string[] = [];
  for (let d = from > min ? from : min, end = to < max ? to : max; d <= end; d = nextDay(d)) out.push(d);
  return out;
}

function pushTo<T>(map: Map<string, T[]>, k: string, value: T) {
  const list = map.get(k);
  if (list) list.push(value);
  else map.set(k, [value]);
}

export interface PunchRow {
  readonly id: string;
  readonly event_kind: any;
  readonly occurred_at: unknown;
  readonly source: string | null;
}
export type LeaveRow = Record<string, any>;
export type TripRow = Record<string, any>;
export type OtRow = Record<string, any>;

export interface DayContext {
  readonly shift: ReturnType<typeof shiftOf> | null;
  readonly scheduleDayType: ScheduleDayType | null;
  readonly holidayPaid: boolean | null | undefined;
}

export interface TimesheetInputs {
  /** Chính sách chấm công hiệu lực của nhân viên tại ngày (cùng luật với resolvePolicy, tính trong bộ nhớ). */
  policy(date: string, employeeId: string): { id: string; config_json: Record<string, unknown> } | undefined;
  /** Ca và loại ngày theo lịch phân ca (cùng luật với dayContextForDate, tra từ dữ liệu đã nạp). */
  dayContext(employeeId: string, date: string, timezone: string): DayContext;
  punches(employeeId: string, date: string): PunchRow[];
  correctionIds(employeeId: string, date: string): string[];
  attendanceId(employeeId: string, date: string): string | null;
  leaves(employeeId: string, date: string): LeaveRow[];
  legacyLeaves(employeeId: string, date: string): { id: string }[];
  trips(employeeId: string, date: string): TripRow[];
  shiftChanges(employeeId: string, date: string): { id: string }[];
  ots(employeeId: string, date: string): OtRow[];
}

const SHIFT_TIME_COLUMNS = `
    s.id, s.check_in_before_minutes, s.check_out_after_minutes, s.break_minutes, s.grace_late_minutes, s.grace_early_minutes,
    to_char($2::date + g.n, 'YYYY-MM-DD') AS the_date,
    (($2::date + g.n + s.start_time) AT TIME ZONE $4) AS starts_at,
    (($2::date + g.n + s.end_time + CASE WHEN s.cross_midnight THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS ends_at,
    (($2::date + g.n + s.break_start_time + CASE WHEN s.cross_midnight AND s.break_start_time<s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_starts_at,
    (($2::date + g.n + s.break_end_time + CASE WHEN s.cross_midnight AND s.break_end_time<=s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_ends_at`;

/**
 * Nạp một lần mọi dữ liệu đầu vào để tính công cả kỳ, thay cho hàng chục truy vấn cho từng cặp (nhân viên, ngày).
 * Số truy vấn chỉ phụ thuộc số loại dữ liệu và số ngày của kỳ (lịch định kỳ tra theo từng ngày để giữ đúng phòng ban
 * hiệu lực của ngày đó), không tăng theo số nhân viên. Phải gọi sau khi sinh chấm công tự động.
 */
export async function loadTimesheetInputs(
  db: Db,
  tenant: string,
  from: string,
  to: string,
  scope: TimesheetScope,
): Promise<TimesheetInputs> {
  const employeeIds = scope.employees.map((e) => e.employee_id);

  // 1) Chính sách chấm công hiệu lực trong kỳ.
  const versionRows = (
    await db.query(
      `SELECT v.id, v.config_json, v.version_no, to_char(v.effective_from,'YYYY-MM-DD') AS effective_from, to_char(v.effective_to,'YYYY-MM-DD') AS effective_to, p.code AS policy_code
         FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id
        WHERE p.tenant_id=$1 AND p.policy_type='ATTENDANCE' AND p.status='ACTIVE' AND v.status IN ('ACTIVE','SUPERSEDED')
          AND v.effective_from<=$3::date AND (v.effective_to IS NULL OR v.effective_to>=$2::date)
        ORDER BY v.effective_from DESC, v.version_no DESC`,
      [tenant, from, to],
    )
  ).rows as (ResolvableVersion & { effective_from: string; effective_to: string | null })[];
  const versionsByDate = new Map<string, typeof versionRows>();
  const policy: TimesheetInputs['policy'] = (date, employeeId) => {
    let rows = versionsByDate.get(date);
    if (!rows) {
      rows = versionRows.filter((v) => v.effective_from <= date && (!v.effective_to || v.effective_to >= date));
      versionsByDate.set(date, rows);
    }
    return pickPolicyVersion(rows, 'ATTENDANCE', date, employeeId) as { id: string; config_json: Record<string, unknown> } | undefined;
  };
  // Múi giờ của từng ngày công theo chính sách; lỗi chính sách trùng hiệu lực báo ở đây, cùng thông điệp như trước.
  const policyCache = new Map<string, ReturnType<TimesheetInputs['policy']>>();
  const timezones = new Set<string>();
  for (const employee of scope.employees)
    for (const date of scope.dates) {
      if (!isEmployedOn(employee, date)) continue;
      const picked = policy(date, employee.employee_id);
      policyCache.set(key(employee.employee_id, date), picked);
      timezones.add(String(picked?.config_json.timezone || 'Asia/Ho_Chi_Minh'));
    }

  // 2) Lịch phân ca: lịch từng ngày, lịch định kỳ (tra theo từng ngày) và định nghĩa ca.
  const scheduleReady = employeeIds.length > 0 && (await workScheduleTableExists(db, tenant));
  const explicit = new Map<string, { day_type: ScheduleDayType; holiday_paid: unknown; id: string; shift_id: string | null }>();
  const ruleByDay = new Map<string, RuleDay>();
  const shiftIds = new Set<string>();
  if (scheduleReady) {
    const days = await db.query(
      `SELECT w.employee_id, to_char(w.work_date,'YYYY-MM-DD') AS the_date, w.day_type, h.paid AS holiday_paid, w.id, w.shift_id
         FROM hrm_schema.employee_work_days w
         LEFT JOIN hrm_schema.company_holidays h ON h.id = w.holiday_id AND h.tenant_id = w.tenant_id
        WHERE w.tenant_id=$1 AND w.employee_id = ANY($2::uuid[]) AND w.work_date BETWEEN $3::date AND $4::date AND w.status='ACTIVE'`,
      [tenant, employeeIds, from, to],
    );
    for (const r of days.rows) {
      explicit.set(key(r.employee_id, r.the_date), r as never);
      if (r.shift_id) shiftIds.add(r.shift_id);
    }
    // Phòng ban hiệu lực tính theo ngày đang tra, nên gọi theo từng ngày (số truy vấn bằng số ngày của kỳ).
    for (const date of scope.dates)
      for (const r of await resolveRuleDays(db, tenant, employeeIds, date, date)) {
        ruleByDay.set(key(r.employeeId, r.date), r);
        if (r.shiftId) shiftIds.add(r.shiftId);
      }
  }
  const shiftRows = new Map<string, Record<string, unknown>>();
  if (shiftIds.size)
    for (const timezone of timezones) {
      const res = await db.query(
        `SELECT ${SHIFT_TIME_COLUMNS}
           FROM hrm_schema.shift_definitions s
           CROSS JOIN generate_series(0, ($3::date - $2::date)) AS g(n)
          WHERE s.tenant_id = $1 AND s.id = ANY($5::uuid[])`,
        [tenant, from, to, timezone, [...shiftIds]],
      );
      for (const r of res.rows) shiftRows.set(`${timezone}|${r.id}|${r.the_date}`, r);
    }
  const shiftRowOf = (timezone: string, shiftId: string, date: string) => shiftRows.get(`${timezone}|${shiftId}|${date}`);
  const pickedOf = (source: 'SCHEDULE' | 'RULE', row: Record<string, unknown>, assignmentId: string | null): PickedShift<ResolvedShiftRow> => ({
    source,
    row: { ...row, assignment_id: assignmentId } as ResolvedShiftRow,
    unitId: null,
    depth: null,
  });
  /** Lớp lịch định kỳ (cùng luật với resolveRuleLayer). */
  const ruleLayer = (employeeId: string, date: string, timezone: string) => {
    const rule = ruleByDay.get(key(employeeId, date));
    if (!rule) return null;
    if (rule.dayType === 'OFF') return { dayType: 'OFF' as const };
    const row = rule.shiftId ? shiftRowOf(timezone, rule.shiftId, date) : undefined;
    return row ? { dayType: 'SHIFT' as const, picked: pickedOf('RULE', row, null) } : null;
  };
  const dayContext: TimesheetInputs['dayContext'] = (employeeId, date, timezone) => {
    const toContext = (picked: PickedShift<ResolvedShiftRow> | null, scheduleDayType: ScheduleDayType | null, holidayPaid?: boolean | null): DayContext => ({
      shift: picked ? shiftOf(picked) : null,
      scheduleDayType,
      holidayPaid,
    });
    if (scheduleReady) {
      const row = explicit.get(key(employeeId, date));
      if (row) {
        const dayType = row.day_type;
        const holidayPaid = typeof row.holiday_paid === 'boolean' ? row.holiday_paid : null;
        if (dayType === 'OFF') return toContext(null, 'OFF');
        const shiftRow = row.shift_id ? shiftRowOf(timezone, row.shift_id, date) : undefined;
        if (shiftRow) return toContext(pickedOf('SCHEDULE', shiftRow, row.id), dayType, holidayPaid);
        const underlying = dayType === 'HOLIDAY' ? ruleLayer(employeeId, date, timezone) : null;
        return toContext(underlying?.dayType === 'SHIFT' ? underlying.picked : null, dayType, holidayPaid);
      }
    }
    const rule = ruleLayer(employeeId, date, timezone);
    if (rule?.dayType === 'OFF') return toContext(null, 'OFF');
    if (rule?.dayType === 'SHIFT') return toContext(rule.picked, 'SHIFT');
    return toContext(null, null);
  };

  // 3) Dữ liệu chấm công và đơn từ của cả kỳ.
  const punchMap = new Map<string, PunchRow[]>();
  const correctionMap = new Map<string, Set<string>>();
  const events = await db.query(
    `SELECT e.id, e.employee_id, to_char(e.work_date,'YYYY-MM-DD') AS the_date, e.event_kind, e.occurred_at, e.source,
            e.voided_by_correction_id::text AS voided_cid, to_jsonb(e)->'evidence'->>'correctionId' AS evidence_cid
       FROM hrm_schema.attendance_events e
      WHERE e.tenant_id=$1 AND e.employee_id = ANY($2::uuid[]) AND e.work_date BETWEEN $3::date AND $4::date
      ORDER BY e.occurred_at, e.id`,
    [tenant, employeeIds, from, to],
  );
  for (const r of events.rows) {
    const k = key(r.employee_id, r.the_date);
    const cid = r.voided_cid ?? r.evidence_cid;
    if (!r.voided_cid) pushTo(punchMap, k, r as PunchRow);
    if (cid) {
      const set = correctionMap.get(k) ?? new Set<string>();
      set.add(String(cid));
      correctionMap.set(k, set);
    }
  }

  const attendanceMap = new Map<string, string>();
  const attendances = await db.query(
    `SELECT id, employee_id, to_char(work_date,'YYYY-MM-DD') AS the_date FROM hrm_schema.attendances
      WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND work_date BETWEEN $3::date AND $4::date`,
    [tenant, employeeIds, from, to],
  );
  for (const r of attendances.rows) attendanceMap.set(key(r.employee_id, r.the_date), r.id);

  const leaveMap = new Map<string, LeaveRow[]>();
  const leaves = await db.query(
    `SELECT r.id, r.employee_id, to_char(d.work_date,'YYYY-MM-DD') AS the_date, d.quantity, d.paid_minutes,
            to_jsonb(r)->>'from_at' AS from_at, to_jsonb(r)->>'to_at' AS to_at, t.name AS reason_name
       FROM hrm_schema.leave_requests r
       LEFT JOIN hrm_schema.leave_types t ON t.id=r.leave_type_id AND t.tenant_id=r.tenant_id
       JOIN hrm_schema.leave_request_days d ON d.request_id=r.id AND d.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND r.employee_id = ANY($2::uuid[]) AND r.status='APPROVED' AND d.work_date BETWEEN $3::date AND $4::date
      ORDER BY r.created_at, r.id`,
    [tenant, employeeIds, from, to],
  );
  for (const r of leaves.rows) pushTo(leaveMap, key(r.employee_id, r.the_date), r);

  const legacyMap = new Map<string, { id: string }[]>();
  const legacy = await db.query(
    `SELECT r.id, r.employee_id, to_char(r.from_date,'YYYY-MM-DD') AS from_date, to_char(r.to_date,'YYYY-MM-DD') AS to_date
       FROM hrm_schema.leave_requests r
      WHERE r.tenant_id=$1 AND r.employee_id = ANY($2::uuid[]) AND r.status='APPROVED' AND r.from_date<=$4::date AND r.to_date>=$3::date
        AND NOT EXISTS(SELECT 1 FROM hrm_schema.leave_request_days d WHERE d.request_id=r.id)
      ORDER BY r.created_at, r.id`,
    [tenant, employeeIds, from, to],
  );
  for (const r of legacy.rows)
    for (const date of datesWithin(r.from_date, r.to_date, from, to)) pushTo(legacyMap, key(r.employee_id, date), { id: r.id });

  const tripMap = new Map<string, TripRow[]>();
  const trips = await db.query(
    `SELECT id, employee_id, destination, business_trip_type, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date,
            to_jsonb(business_trip_requests)->>'from_at' AS from_at, to_jsonb(business_trip_requests)->>'to_at' AS to_at
       FROM hrm_schema.business_trip_requests
      WHERE tenant_id=$1 AND employee_id = ANY($2::uuid[]) AND status='APPROVED' AND from_date<=$4::date AND to_date>=$3::date
      ORDER BY created_at, id`,
    [tenant, employeeIds, from, to],
  );
  for (const r of trips.rows)
    for (const date of datesWithin(r.from_date, r.to_date, from, to)) pushTo(tripMap, key(r.employee_id, date), r);

  const shiftChangeMap = new Map<string, { id: string }[]>();
  const shiftChanges = await db.query(
    `SELECT id, employee_id, swap_with_employee_id, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date
       FROM hrm_schema.shift_change_requests
      WHERE tenant_id=$1 AND status='APPROVED' AND applied_at IS NOT NULL AND from_date<=$4::date AND to_date>=$3::date
        AND (employee_id = ANY($2::uuid[]) OR swap_with_employee_id = ANY($2::uuid[]))
      ORDER BY approved_at, id`,
    [tenant, employeeIds, from, to],
  );
  for (const r of shiftChanges.rows)
    for (const date of datesWithin(r.from_date, r.to_date, from, to)) {
      pushTo(shiftChangeMap, key(r.employee_id, date), { id: r.id });
      if (r.swap_with_employee_id && r.swap_with_employee_id !== r.employee_id)
        pushTo(shiftChangeMap, key(r.swap_with_employee_id, date), { id: r.id });
    }

  const otMap = new Map<string, OtRow[]>();
  const ots = await db.query(
    `SELECT o.*, to_char(o.work_date,'YYYY-MM-DD') AS the_date
       FROM hrm_schema.ot_requests o
      WHERE o.tenant_id=$1 AND o.employee_id = ANY($2::uuid[]) AND o.work_date BETWEEN $3::date AND $4::date AND o.status='APPROVED'
      ORDER BY o.created_at, o.id`,
    [tenant, employeeIds, from, to],
  );
  for (const r of ots.rows) pushTo(otMap, key(r.employee_id, r.the_date), r);

  return {
    policy: (date, employeeId) => (policyCache.has(key(employeeId, date)) ? policyCache.get(key(employeeId, date)) : policy(date, employeeId)),
    dayContext,
    punches: (e, d) => punchMap.get(key(e, d)) ?? [],
    correctionIds: (e, d) => [...(correctionMap.get(key(e, d)) ?? [])].sort(),
    attendanceId: (e, d) => attendanceMap.get(key(e, d)) ?? null,
    leaves: (e, d) => leaveMap.get(key(e, d)) ?? [],
    legacyLeaves: (e, d) => legacyMap.get(key(e, d)) ?? [],
    trips: (e, d) => tripMap.get(key(e, d)) ?? [],
    shiftChanges: (e, d) => shiftChangeMap.get(key(e, d)) ?? [],
    ots: (e, d) => otMap.get(key(e, d)) ?? [],
  };
}
