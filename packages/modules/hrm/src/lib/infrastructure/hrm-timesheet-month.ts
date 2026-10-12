import { pendingCustomRequestCount } from './hrm-custom-request.js';
import type {
  HrmBoardMonthInfo,
  HrmMonthCloseBlocker,
  HrmMonthCloseItem,
  HrmMonthCloseState,
  HrmTimesheetMonthState,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { isoDate } from './hrm-time.js';
import { loadBoard } from './hrm-timesheet-board.js';
import { adjustTimesheetLine, type AdjustTimesheetInput } from './hrm-timesheet-adjust.js';
import { calculateTimesheet } from './hrm-timesheet-calculation.js';
import { lockTimesheetPeriod, reopenTimesheetPeriod } from './hrm-timesheet-period.js';
import { requireText } from './hrm-validation.js';

/**
 * Tháng công = tháng dương lịch (YYYY-MM). Kỳ công (timesheet_periods, mã YYYY-MM) chỉ được tạo khi cần chốt;
 * xem bảng công không cần kỳ. Chốt đơn từ và chốt công dùng lại luật khóa/mở lại sẵn có của kỳ công.
 */

type Db = Pick<PoolClient, 'query'>;

export interface MonthRange {
  month: string;
  from: string;
  to: string;
}

export function parseMonth(month: unknown): MonthRange {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: 'month: tháng không hợp lệ (YYYY-MM)',
    });
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
export function todayInVietnam(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

const label = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;
const vnDate = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export interface MonthPeriods {
  /** Kỳ công đúng bằng tháng dương lịch (nếu đã có). */
  exact: Record<string, any> | null;
  /** Kỳ công khác chồng lấn tháng (kỳ tùy chỉnh cũ). */
  others: Record<string, any>[];
}

export async function findMonthPeriods(
  db: Db,
  tenant: string,
  range: MonthRange,
  lock = false,
): Promise<MonthPeriods> {
  const res = await db.query(
    `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND ((from_date<=$3::date AND to_date>=$2::date) OR period_code=$4) ORDER BY from_date${lock ? ' FOR UPDATE' : ''}`,
    [tenant, range.from, range.to, range.month],
  );
  const exact =
    res.rows.find(
      (p) => isoDate(p.from_date) === range.from && isoDate(p.to_date) === range.to,
    ) ?? null;
  return { exact, others: res.rows.filter((p) => p !== exact) };
}

export function monthInfoOf(range: MonthRange, periods: MonthPeriods): HrmBoardMonthInfo {
  const p = periods.exact;
  const state: HrmTimesheetMonthState =
    p?.status === 'LOCKED' ? 'LOCKED' : p?.requests_closed_at ? 'REQUESTS_CLOSED' : 'OPEN';
  return {
    month: range.month,
    from: range.from,
    to: range.to,
    state,
    periodId: p?.id ?? null,
    requestsClosedAt: iso(p?.requests_closed_at),
    lockedAt: p?.status === 'LOCKED' ? iso(p.locked_at) : null,
    calculatedAt: iso(p?.calculated_at),
  };
}

function overlapBlocker(range: MonthRange, others: Record<string, any>[]): HrmMonthCloseBlocker[] {
  if (!others.length) return [];
  const o = others[0];
  return [
    {
      code: 'PERIOD_OVERLAP',
      message: `Tháng ${label(range.month)} trùng với kỳ công ${o.period_code} (${vnDate(isoDate(o.from_date))} - ${vnDate(isoDate(o.to_date))}) đã có; cần xóa hoặc điều chỉnh kỳ này trước khi chốt theo tháng`,
      count: others.length,
    },
  ];
}

/** Tạo (hoặc lấy) kỳ công của tháng dương lịch, khóa dòng kỳ; chồng lấn với kỳ khác thì 409. Phải chạy trong giao dịch. */
export async function ensureMonthPeriod(
  db: Db,
  tenant: string,
  range: MonthRange,
): Promise<Record<string, any>> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`timesheet-period:${tenant}`]);
  const periods = await findMonthPeriods(db, tenant, range, true);
  if (periods.others.length)
    throw new ConflictException({
      code: 'HRM_MONTH_PERIOD_OVERLAP',
      message: overlapBlocker(range, periods.others)[0].message,
    });
  if (periods.exact) return periods.exact;
  const created = await db.query(
    `INSERT INTO hrm_schema.timesheet_periods (tenant_id, period_code, from_date, to_date, status) VALUES ($1,$2,$3,$4,'OPEN') RETURNING *`,
    [tenant, range.month, range.from, range.to],
  );
  return created.rows[0];
}

const PENDING_LABELS: readonly [keyof PendingCounts, string][] = [
  ['leaves', 'đơn nghỉ'],
  ['ots', 'đơn làm thêm giờ'],
  ['trips', 'đơn công tác'],
  ['shiftChanges', 'đơn đổi ca'],
  ['corrections', 'đơn giải trình công'],
  ['customs', 'đơn thuộc loại đơn tuỳ chỉnh'],
];
interface PendingCounts {
  leaves: number;
  ots: number;
  trips: number;
  shiftChanges: number;
  corrections: number;
  customs: number;
}

/** Đơn còn chờ duyệt có ngày trong tháng (nghỉ, làm thêm giờ, công tác, đổi ca, giải trình công). Một truy vấn. */
export async function pendingRequestBlockers(
  db: Db,
  tenant: string,
  range: MonthRange,
): Promise<HrmMonthCloseBlocker[]> {
  const res = await db.query(
    `SELECT
       (SELECT count(*) FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3::date AND to_date>=$2::date)::int AS leaves,
       (SELECT count(*) FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND status='PENDING' AND work_date BETWEEN $2::date AND $3::date)::int AS ots,
       (SELECT count(*) FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3::date AND to_date>=$2::date)::int AS trips,
       (SELECT count(*) FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND status IN ('PENDING','PEER_CONFIRMED') AND from_date<=$3::date AND to_date>=$2::date)::int AS shift_changes,
       (SELECT count(*) FROM hrm_schema.attendance_corrections WHERE tenant_id=$1 AND status='PENDING' AND request_date BETWEEN $2::date AND $3::date)::int AS corrections`,
    [tenant, range.from, range.to],
  );
  const row = res.rows[0] ?? {};
  const counts: PendingCounts = {
    leaves: Number(row.leaves ?? 0),
    ots: Number(row.ots ?? 0),
    trips: Number(row.trips ?? 0),
    shiftChanges: Number(row.shift_changes ?? 0),
    corrections: Number(row.corrections ?? 0),
    customs: await pendingCustomRequestCount(db, tenant, range.from, range.to),
  };
  return PENDING_LABELS.filter(([k]) => counts[k] > 0).map(([k, name]) => ({
    code: 'PENDING_REQUESTS' as const,
    message: `Còn ${counts[k]} ${name} chờ duyệt trong tháng ${label(range.month)}`,
    count: counts[k],
  }));
}

/** Nhân viên có hiệu lực việc làm trong khoảng ngày (đã vào làm trước cuối tháng, chưa nghỉ trước đầu tháng). */
export async function employedEmployeeIds(
  db: Db,
  tenant: string,
  range: MonthRange,
): Promise<string[]> {
  const res = await db.query(
    `SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date<=$3::date AND (inactive_from IS NULL OR inactive_from>$2::date) ORDER BY employee_id`,
    [tenant, range.from, range.to],
  );
  return res.rows.map((r) => r.employee_id as string);
}

const MAX_BLOCKER_ITEMS = 200;

interface DayProblems {
  abnormal: { days: number; employees: number; items: HrmMonthCloseItem[] };
  unscheduled: { days: number; employees: number; items: HrmMonthCloseItem[] };
}

/** Ngày công bất thường và ngày chưa có ca theo kết quả tính trực tiếp (tháng chưa khóa), kèm chi tiết từng ngày. */
async function dayProblems(
  db: Db,
  tenant: string,
  range: MonthRange,
  periodId: string | null,
  today: string,
): Promise<DayProblems> {
  const out: DayProblems = {
    abnormal: { days: 0, employees: 0, items: [] },
    unscheduled: { days: 0, employees: 0, items: [] },
  };
  if (range.from > today) return out;
  const ids = await employedEmployeeIds(db, tenant, range);
  const board = await loadBoard(db, tenant, {
    from: range.from,
    to: range.to,
    employeeIds: ids,
    today,
    periodId,
  });
  for (const e of board.employees) {
    let abnormal = 0;
    let unscheduled = 0;
    for (const [date, day] of Object.entries(e.days)) {
      const bucket =
        day.status === 'ABNORMAL'
          ? out.abnormal
          : day.status === 'NO_SCHEDULE' && day.anomalies.includes('NO_SHIFT')
            ? out.unscheduled
            : null;
      if (!bucket) continue;
      bucket.days++;
      if (day.status === 'ABNORMAL') abnormal++;
      else unscheduled++;
      if (bucket.items.length < MAX_BLOCKER_ITEMS)
        bucket.items.push({
          employeeId: e.employeeId,
          employeeCode: e.employeeCode,
          employeeName: e.employeeName,
          date,
          codes: [...day.anomalies],
        });
    }
    if (abnormal) out.abnormal.employees++;
    if (unscheduled) out.unscheduled.employees++;
  }
  return out;
}

async function lockBlockers(
  db: Db,
  tenant: string,
  range: MonthRange,
  periods: MonthPeriods,
  today: string,
): Promise<HrmMonthCloseBlocker[]> {
  const out: HrmMonthCloseBlocker[] = [...overlapBlocker(range, periods.others)];
  if (range.to >= today)
    out.push({
      code: 'MONTH_NOT_ENDED',
      message: `Tháng ${label(range.month)} chưa kết thúc`,
      count: 1,
    });
  if (!periods.exact?.requests_closed_at)
    out.push({
      code: 'REQUESTS_NOT_CLOSED',
      message: `Cần chốt đơn từ tháng ${label(range.month)} trước khi chốt công`,
      count: 1,
    });
  if (!periods.others.length) {
    const problems = await dayProblems(db, tenant, range, periods.exact?.id ?? null, today);
    if (problems.abnormal.days)
      out.push({
        code: 'ABNORMAL_DAYS',
        message: `Còn ${problems.abnormal.days} ngày công bất thường (${problems.abnormal.employees} nhân viên) cần xử lý`,
        count: problems.abnormal.days,
        items: problems.abnormal.items,
      });
    if (problems.unscheduled.days)
      out.push({
        code: 'UNSCHEDULED_DAYS',
        message: `Còn ${problems.unscheduled.days} ngày làm việc chưa có ca (${problems.unscheduled.employees} nhân viên) cần phân ca`,
        count: problems.unscheduled.days,
        items: problems.unscheduled.items,
      });
  }
  return out;
}

/** Trạng thái chốt của tháng và những việc còn vướng (chỉ đọc, không tạo kỳ công). */
export async function monthCloseState(
  db: Db,
  tenant: string,
  range: MonthRange,
  today = todayInVietnam(),
): Promise<HrmMonthCloseState> {
  const periods = await findMonthPeriods(db, tenant, range);
  const month = monthInfoOf(range, periods);
  if (month.state === 'LOCKED') {
    const blocker: HrmMonthCloseBlocker = {
      code: 'ALREADY_LOCKED',
      message: `Tháng ${label(range.month)} đã chốt công`,
      count: 1,
    };
    return { month, blockersForRequests: [blocker], blockersForLock: [blocker] };
  }
  const blockersForRequests = [
    ...overlapBlocker(range, periods.others),
    ...(month.state === 'REQUESTS_CLOSED' ? [] : await pendingRequestBlockers(db, tenant, range)),
  ];
  return {
    month,
    blockersForRequests,
    blockersForLock: await lockBlockers(db, tenant, range, periods, today),
  };
}

function blocked(message: string, blockers: readonly HrmMonthCloseBlocker[]): ConflictException {
  return new ConflictException({
    code: 'HRM_MONTH_CLOSE_BLOCKED',
    message: `${message}: ${blockers.map((b) => b.message).join('; ')}`,
    blockers,
  });
}

/** Chốt đơn từ: từ lúc này không tạo, sửa hay duyệt đơn nào có ngày thuộc tháng (xem assertOpenRange). */
export async function closeMonthRequests(
  db: Db,
  tenant: string,
  actorId: string,
  range: MonthRange,
): Promise<void> {
  const period = await ensureMonthPeriod(db, tenant, range);
  if (period.status === 'LOCKED')
    throw new ConflictException(`Tháng ${label(range.month)} đã chốt công`);
  if (period.requests_closed_at) return;
  const pending = await pendingRequestBlockers(db, tenant, range);
  if (pending.length) throw blocked('Chưa thể chốt đơn từ', pending);
  await db.query(
    `UPDATE hrm_schema.timesheet_periods SET requests_closed_at=now(), requests_closed_by=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant, period.id, actorId],
  );
  await lifecycleAudit(db, tenant, actorId, 'TIMESHEET_REQUESTS_CLOSED', period.id, {
    month: range.month,
  });
}

/** Chốt công: tính lại bảng công rồi khóa kỳ (dùng calculateTimesheet và luật khóa sẵn có). */
export async function closeMonth(
  db: Db,
  tenant: string,
  actorId: string,
  range: MonthRange,
  today = todayInVietnam(),
): Promise<void> {
  const period = await ensureMonthPeriod(db, tenant, range);
  if (period.status === 'LOCKED')
    throw new ConflictException(`Tháng ${label(range.month)} đã chốt công`);
  const blockers = await lockBlockers(db, tenant, range, { exact: period, others: [] }, today);
  if (blockers.length) throw blocked('Chưa thể chốt công', blockers);
  const result = await calculateTimesheet(db as PoolClient, tenant, period.id);
  await lifecycleAudit(db, tenant, actorId, 'TIMESHEET_CALCULATED', period.id, {
    result,
    month: range.month,
  });
  if (result.abnormal > 0)
    throw blocked('Chưa thể chốt công', [
      {
        code: 'ABNORMAL_DAYS',
        message: `Sau khi tính, còn ${result.abnormal} dòng công bất thường (kể cả ngày làm việc chưa có ca) cần xử lý`,
        count: result.abnormal,
      },
    ]);
  await lockTimesheetPeriod(db, tenant, period.id, actorId);
  await lifecycleAudit(db, tenant, actorId, 'TIMESHEET_MONTH_CLOSED', period.id, {
    month: range.month,
    result,
  });
}

/** Mở lại tháng: mở khóa công (nếu đã chốt công) và bỏ chốt đơn từ, có lý do. Chặn nếu kỳ lương đã chốt (luật sẵn có). */
export async function reopenMonth(
  db: Db,
  tenant: string,
  actorId: string,
  range: MonthRange,
  reason: unknown,
): Promise<void> {
  const text = requireText(reason, 'Lý do mở lại', 2000);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`timesheet-period:${tenant}`]);
  const { exact } = await findMonthPeriods(db, tenant, range, true);
  if (!exact) throw new NotFoundException(`Tháng ${label(range.month)} chưa có dữ liệu chốt`);
  const wasLocked = exact.status === 'LOCKED';
  if (!wasLocked && !exact.requests_closed_at)
    throw new ConflictException(`Tháng ${label(range.month)} chưa chốt`);
  if (wasLocked) await reopenTimesheetPeriod(db, tenant, exact.id, actorId, text);
  await db.query(
    `UPDATE hrm_schema.timesheet_periods SET requests_closed_at=NULL, requests_closed_by=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant, exact.id],
  );
  await lifecycleAudit(db, tenant, actorId, 'TIMESHEET_MONTH_REOPENED', exact.id, {
    month: range.month,
    wasLocked,
    reason: text,
  });
}

/**
 * Tính công tháng (chưa khóa): ghi các dòng công kể cả ngày bất thường để người có quyền xem, điều chỉnh từng ngày,
 * rồi mới chốt. Không khóa kỳ; chốt công vẫn tính lại và giữ các dòng đã điều chỉnh.
 */
export async function calculateMonth(
  db: Db,
  tenant: string,
  actorId: string,
  range: MonthRange,
): Promise<{ count: number; abnormal: number }> {
  const period = await ensureMonthPeriod(db, tenant, range);
  if (period.status === 'LOCKED')
    throw new ConflictException(`Tháng ${label(range.month)} đã chốt công`);
  const result = await calculateTimesheet(db as PoolClient, tenant, period.id);
  await lifecycleAudit(db, tenant, actorId, 'TIMESHEET_CALCULATED', period.id, {
    result,
    month: range.month,
  });
  return result;
}

/** Điều chỉnh công một ngày của một nhân viên trong tháng chưa khóa (cần đã tính công). */
export async function adjustMonthDay(
  db: Db,
  tenant: string,
  actorId: string,
  range: MonthRange,
  employeeId: string,
  date: string,
  body: AdjustTimesheetInput,
): Promise<Record<string, unknown>> {
  if (date < range.from || date > range.to)
    throw new BadRequestException(`Ngày ${vnDate(date)} không thuộc tháng ${label(range.month)}`);
  const { exact } = await findMonthPeriods(db, tenant, range);
  if (!exact) throw new ConflictException(`Tháng ${label(range.month)} chưa tính công; cần bấm Tính công trước`);
  if (exact.status === 'LOCKED') throw new ConflictException(`Tháng ${label(range.month)} đã chốt công`);
  const line = await db.query(
    `SELECT id FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND employee_id=$3 AND work_date=$4::date`,
    [tenant, exact.id, employeeId, date],
  );
  if (!line.rows[0])
    throw new ConflictException(
      `Chưa có dòng công ngày ${vnDate(date)} của nhân viên này; cần bấm Tính công trước`,
    );
  const changed = await adjustTimesheetLine(db as PoolClient, tenant, actorId, line.rows[0].id, body);
  return changed.rows[0];
}
