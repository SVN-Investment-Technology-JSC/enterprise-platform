import type { PoolClient } from 'pg';
import type {
  HrmAttendanceMonitor,
  HrmBoardDay,
  HrmMonitorRow,
  HrmMonitorStatus,
  HrmMonitorSummary,
} from '@enterprise-platform/contracts-hrm';
import { DEFAULT_TIMEZONE, loadBoard } from './hrm-timesheet-board.js';
import {
  findMonthPeriods,
  monthInfoOf,
  parseMonth,
  todayInVietnam,
} from './hrm-timesheet-month.js';

type Db = Pick<PoolClient, 'query'>;

/** Các trạng thái cần người quản lý/nhân sự để mắt tới. */
export const MONITOR_ATTENTION: readonly HrmMonitorStatus[] = [
  'NOT_CHECKED_IN',
  'ABSENT',
  'LATE',
  'EARLY_LEAVE',
  'LATE_EARLY',
  'MISSING_PUNCH',
];

const LEAVE_STATUSES = ['ANNUAL_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE'];

const toMinutes = (hm: string | null): number | null => {
  const match = hm ? /^(\d{2}):(\d{2})/.exec(hm) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Giờ hiện tại theo múi giờ của công ty, tính bằng phút từ 00:00. */
export function nowMinutesIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

export interface MonitorContext {
  /** Ngày đang xem (YYYY-MM-DD). */
  readonly date: string;
  /** Hôm nay theo giờ công ty (YYYY-MM-DD). */
  readonly today: string;
  /** Giờ hiện tại (phút từ 00:00) theo giờ công ty. */
  readonly nowMinutes: number;
}

/**
 * Trạng thái giám sát của một ngày công. Dựa trên kết quả ngày công đã có (ca, giờ chấm, đơn nghỉ/công tác) và thêm
 * yếu tố thời gian thực của HÔM NAY: chưa tới giờ ca thì chưa tính là vắng, quá giờ ca chưa chấm vào là "chưa chấm công",
 * qua giờ kết thúc ca mà chưa chấm ra là "thiếu lượt chấm". Ngày đã qua không chấm công là "vắng".
 */
export function classifyMonitorDay(day: HrmBoardDay, ctx: MonitorContext): HrmMonitorStatus {
  if (day.status === 'HOLIDAY' || day.status === 'OFF') return 'DAY_OFF';
  if (day.status === 'NO_SCHEDULE' || (day.kind === 'NO_SCHEDULE' && !day.leave && !day.tripId))
    return 'NO_SCHEDULE';
  const hasIn = Boolean(day.checkIn);
  const hasOut = Boolean(day.checkOut);
  const forgot = day.anomalies.some((a) => a === 'MISSING_CHECK_IN' || a === 'MISSING_CHECK_OUT');
  // Nghỉ hoặc công tác cả ngày (không có lỗi chấm công đi kèm).
  if (!forgot && !hasIn && !hasOut) {
    if (day.tripId || day.status === 'TRIP') return 'ON_TRIP';
    if (day.leave || LEAVE_STATUSES.includes(day.status)) return 'ON_LEAVE';
  }
  if (!hasIn && !hasOut) {
    if (ctx.date > ctx.today) return 'UPCOMING';
    if (ctx.date < ctx.today) return 'ABSENT';
    const start = toMinutes(day.shiftStart);
    return start !== null && ctx.nowMinutes < start ? 'UPCOMING' : 'NOT_CHECKED_IN';
  }
  if (hasIn !== hasOut) {
    // Chỉ có một lượt: hôm nay còn trong giờ ca thì đang làm việc, quá giờ ca (hoặc ngày đã qua) là thiếu lượt chấm.
    if (!hasIn) return 'MISSING_PUNCH';
    if (ctx.date < ctx.today) return 'MISSING_PUNCH';
    const start = toMinutes(day.shiftStart);
    const end = toMinutes(day.shiftEnd);
    const overnight = start !== null && end !== null && end <= start;
    if (!overnight && end !== null && ctx.nowMinutes > end) return 'MISSING_PUNCH';
    return day.lateMinutes > 0 ? 'LATE' : 'CHECKED_IN';
  }
  if (day.lateMinutes > 0 && day.earlyLeaveMinutes > 0) return 'LATE_EARLY';
  if (day.earlyLeaveMinutes > 0) return 'EARLY_LEAVE';
  if (day.lateMinutes > 0) return 'LATE';
  return 'COMPLETED';
}

/** Tổng hợp các thẻ số liệu từ danh sách dòng. */
export function summarizeMonitor(rows: readonly HrmMonitorRow[]): HrmMonitorSummary {
  const count = (statuses: readonly HrmMonitorStatus[]) =>
    rows.filter((r) => statuses.includes(r.status)).length;
  const checkedIn = rows.filter((r) => Boolean(r.checkIn)).length;
  const working = rows.filter((r) => r.status !== 'DAY_OFF' && r.status !== 'NO_SCHEDULE');
  return {
    totalPeople: rows.length,
    scheduled: working.length,
    checkedIn,
    notCheckedIn: count(['NOT_CHECKED_IN', 'ABSENT']),
    late: count(['LATE', 'LATE_EARLY']),
    earlyLeave: count(['EARLY_LEAVE', 'LATE_EARLY']),
    onLeave: count(['ON_LEAVE']),
    onTrip: count(['ON_TRIP']),
    missingPunch: count(['MISSING_PUNCH']),
  };
}

/**
 * Cấp dưới (trực tiếp và gián tiếp) của một người quản lý theo sơ đồ tổ chức Core: những người giữ chức danh có
 * "Báo cáo cho" là chức danh của người quản lý, rồi tiếp tục đi xuống. Ô ghi đè "Báo cáo cho" trên phân công thắng giá trị
 * của chức danh. Trả rỗng khi Core chưa có cột "Báo cáo cho".
 */
export async function loadTeamEmployeeIds(
  db: Db,
  tenantId: string,
  managerEmployeeId: string,
): Promise<string[]> {
  const column = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'core_schema' AND table_name = 'organization_nodes' AND column_name = 'reports_to_position_id'`,
  );
  if (!column.rows.length) return [];
  const today = `(now() AT TIME ZONE '${DEFAULT_TIMEZONE}')::date`;
  const active = (alias: string) => `${alias}.deleted_at IS NULL AND ${alias}.status = 'active'
      AND (${alias}.start_date IS NULL OR ${alias}.start_date <= ${today})
      AND (${alias}.end_date IS NULL OR ${alias}.end_date >= ${today})`;
  const result = await db.query(
    `WITH RECURSIVE mine AS (
       SELECT a.node_id AS position_id, 0 AS lvl
         FROM core_schema.employees e
         JOIN core_schema.organization_node_assignments a ON a.user_id = e.user_id AND ${active('a')}
        WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL
       UNION
       SELECT a2.node_id, m.lvl + 1
         FROM mine m
         JOIN core_schema.organization_node_assignments a2 ON ${active('a2')}
         JOIN core_schema.organization_nodes n2 ON n2.id = a2.node_id AND n2.deleted_at IS NULL AND n2.category = 'position'
        WHERE COALESCE(a2.reports_to_position_override_id, n2.reports_to_position_id) = m.position_id AND m.lvl < 20
     )
     SELECT DISTINCT e.id AS employee_id
       FROM mine m
       JOIN core_schema.organization_node_assignments a ON a.node_id = m.position_id AND ${active('a')}
       JOIN core_schema.employees e ON e.user_id = a.user_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
      WHERE m.lvl > 0 AND e.id <> $2`,
    [tenantId, managerEmployeeId],
  );
  return result.rows.map((r) => String(r.employee_id));
}

export interface LoadMonitorInput {
  readonly date: string;
  /** null: toàn công ty; danh sách: chỉ các nhân viên này. */
  readonly employeeIds: readonly string[] | null;
  readonly scope: 'ALL' | 'TEAM';
  readonly now?: Date;
}

/** Giám sát chấm công của MỘT ngày cho các nhân viên trong phạm vi. */
export async function loadAttendanceMonitor(
  db: Db,
  tenantId: string,
  input: LoadMonitorInput,
): Promise<HrmAttendanceMonitor> {
  const now = input.now ?? new Date();
  const today = todayInVietnam(now);
  const date = input.date;
  const people = await db.query(
    `SELECT d.employee_id
       FROM hrm_schema.employee_directory d
       JOIN hrm_schema.employee_profiles p ON p.tenant_id=d.tenant_id AND p.employee_id=d.employee_id
      WHERE d.tenant_id=$1 AND d.deleted_at IS NULL AND d.join_date<=$2::date
        AND (p.inactive_from IS NULL OR p.inactive_from>$2::date)
        AND ($3::uuid[] IS NULL OR d.employee_id = ANY($3::uuid[]))
      ORDER BY d.employee_code, d.employee_id`,
    [tenantId, date, input.employeeIds ? [...input.employeeIds] : null],
  );
  const ids = people.rows.map((r) => String(r.employee_id));
  const range = parseMonth(date.slice(0, 7));
  const month = monthInfoOf(range, await findMonthPeriods(db, tenantId, range));
  const board = await loadBoard(db, tenantId, {
    from: date,
    to: date,
    employeeIds: ids,
    today,
    lockedPeriodId: month.state === 'LOCKED' ? month.periodId : null,
    periodId: month.periodId,
  });
  const ctx: MonitorContext = { date, today, nowMinutes: nowMinutesIn(DEFAULT_TIMEZONE, now) };
  const rows: HrmMonitorRow[] = board.employees
    .map((employee) => {
      const day = employee.days[date];
      if (!day) return null;
      return {
        employeeId: employee.employeeId,
        employeeCode: employee.employeeCode,
        employeeName: employee.employeeName,
        departmentName: employee.departmentName,
        positionName: employee.positionName,
        status: classifyMonitorDay(day, ctx),
        shiftCode: day.shiftCode,
        shiftName: day.shiftName,
        shiftStart: day.shiftStart,
        shiftEnd: day.shiftEnd,
        checkIn: day.checkIn,
        checkOut: day.checkOut,
        lateMinutes: day.lateMinutes,
        earlyLeaveMinutes: day.earlyLeaveMinutes,
        leaveName: day.leave?.reasonName ?? null,
        leaveDays: day.leave?.days ?? 0,
        requests: day.requests ?? [],
      } satisfies HrmMonitorRow;
    })
    .filter((row): row is HrmMonitorRow => row !== null);
  return {
    date,
    today,
    generatedAt: now.toISOString(),
    scope: input.scope,
    summary: summarizeMonitor(rows),
    rows,
  };
}
