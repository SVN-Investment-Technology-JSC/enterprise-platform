/**
 * Giờ làm theo ngày của đơn công tác. Người đi công tác khai tùy chọn khung giờ từng ngày: giờ dự kiến khi đăng ký trước,
 * giờ thực tế bổ sung sau chuyến đi. Chỉ quản lý trực tiếp hoặc người duyệt dự phòng của đơn mới xác nhận giờ thực tế (không
 * có tự duyệt). Giờ thực tế đã duyệt được tách thành giờ trong ca (theo ca của nhân viên trong ngày) và giờ làm thêm; giờ
 * làm thêm ghi vào `overtime_blocks` để tính trần làm thêm và quỹ nghỉ bù. Ngày không khai tính theo ca của nhân viên như
 * trước đây. Chưa duyệt giờ thực tế thì chỉ hiển thị dự kiến, không vào lương hay quỹ.
 */
import type {
  HrmTripDayLine,
  HrmTripDayLines,
  HrmTripDayWindow,
  HrmTripDayLineStatus,
  DecideHrmTripDayLinesRequest,
  SaveHrmTripDayLinesRequest,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { formatLocalMinutes, localMinutes } from '../domain/overtime-classification.js';
import {
  classifyTripDay,
  restsNextMorning,
  validateWindows,
  type DayWindow,
  type NightWindow,
  type TripDayClassification,
} from '../domain/trip-day-hours.js';
import { isDesignatedDirectApprover } from './hrm-approval-policy.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { loadOvertimeCompPolicy, overtimeSchemaReady } from './hrm-overtime-blocks.js';
import { assertOpenRange, dayContextForDate, isoDate, resolvePolicy } from './hrm-time.js';

const MAX_TRIP_DAYS = 92;
const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const round2 = (n: number) => Math.round(n * 100) / 100;

const todayInVietnam = () => new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
const monthOf = (date: string) => date.slice(0, 7);

interface TripRow {
  id: string;
  employee_id: string;
  from_date: unknown;
  to_date: unknown;
  status: string;
}

interface LineRow {
  id: string;
  trip_request_id: string;
  work_date: unknown;
  planned_windows: unknown;
  actual_windows: unknown;
  status: HrmTripDayLineStatus;
  decision_note: string | null;
  scheduled_minutes: number | null;
  normal_minutes: number | null;
  ot_minutes: number | null;
  night_minutes: number | null;
}

const windowsOf = (value: unknown): DayWindow[] | null => {
  if (!Array.isArray(value)) return null;
  return value
    .filter((w): w is { from: string; to: string } => typeof w === 'object' && w !== null && typeof (w as DayWindow).from === 'string' && typeof (w as DayWindow).to === 'string')
    .map((w) => ({ from: w.from, to: w.to }));
};

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`) && out.length <= MAX_TRIP_DAYS; ms += 86400000)
    out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

async function timezoneOf(db: PoolClient, tenant: string, date: string, employeeId: string): Promise<string> {
  const attendance = await resolvePolicy(db, tenant, 'ATTENDANCE', date, employeeId);
  return String(attendance?.config_json?.timezone || DEFAULT_TIMEZONE);
}

/** Số phút ca của nhân viên trong ngày theo lịch phân ca; 0 khi ngày không có ca (chủ nhật, ngày nghỉ, lễ). */
async function scheduledMinutesOf(db: PoolClient, tenant: string, employeeId: string, date: string, timezone: string): Promise<number> {
  const { shift } = await dayContextForDate(db, tenant, employeeId, date, timezone);
  if (!shift) return 0;
  const start = Date.parse(shift.window.start);
  const end = Date.parse(shift.window.end);
  const bs = shift.window.breakStart ? Date.parse(shift.window.breakStart) : 0;
  const be = shift.window.breakEnd ? Date.parse(shift.window.breakEnd) : 0;
  // Ca có khung nghỉ giữa ca thì trừ phần nghỉ nằm trong ca; ca chỉ khai số phút nghỉ thì trừ số phút đó.
  const breakMs = be > bs ? Math.max(0, Math.min(end, be) - Math.max(start, bs)) : Number(shift.window.breakMinutes ?? 0) * 60000;
  return Math.max(0, Math.floor((end - start - breakMs) / 60000));
}

async function nightWindowOf(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  date: string,
): Promise<{ night: NightWindow | null; enabled: boolean; policyVersionId: string | null }> {
  const { policy, policyVersionId } = await loadOvertimeCompPolicy(db, tenant, monthOf(date), employeeId);
  return {
    enabled: policy.enabled,
    policyVersionId,
    night: policy.declaredNightWindow
      ? { startMinute: policy.nightStartMinute, endMinute: policy.nightEndMinute }
      : null,
  };
}

async function loadTrip(db: PoolClient, tenant: string, tripId: string, lock = false): Promise<TripRow> {
  const found = await db.query(
    `SELECT id,employee_id,from_date,to_date,status FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
    [tenant, tripId],
  );
  if (!found.rows[0]) throw new NotFoundException('Không tìm thấy đơn công tác');
  return found.rows[0] as TripRow;
}

const viewOf = (
  date: string,
  line: LineRow | undefined,
  preview: TripDayClassification | null,
  restHint: boolean,
): HrmTripDayLine => ({
  date,
  plannedWindows: (windowsOf(line?.planned_windows) ?? []) as HrmTripDayWindow[],
  actualWindows: (windowsOf(line?.actual_windows) ?? []) as HrmTripDayWindow[],
  status: line?.status ?? 'PLANNED',
  decisionNote: line?.decision_note ?? null,
  scheduledMinutes: preview?.scheduledMinutes ?? line?.scheduled_minutes ?? 0,
  normalMinutes: line?.status === 'ACTUAL_APPROVED' ? (line.normal_minutes ?? 0) : (preview?.normalMinutes ?? 0),
  otMinutes: line?.status === 'ACTUAL_APPROVED' ? (line.ot_minutes ?? 0) : (preview?.otMinutes ?? 0),
  nightMinutes: line?.status === 'ACTUAL_APPROVED' ? (line.night_minutes ?? 0) : (preview?.nightMinutes ?? 0),
  restsNextMorning: restHint,
});

/** Các ngày của đơn công tác kèm giờ khai và kết quả tách ca, làm thêm (xem trước cho đến khi giờ thực tế được duyệt). */
export async function loadTripDayLines(db: PoolClient, tenant: string, tripId: string): Promise<HrmTripDayLines> {
  const trip = await loadTrip(db, tenant, tripId);
  const from = isoDate(trip.from_date);
  const to = isoDate(trip.to_date);
  const stored = await db.query(
    `SELECT id,trip_request_id,work_date,planned_windows,actual_windows,status,decision_note,scheduled_minutes,normal_minutes,ot_minutes,night_minutes
       FROM hrm_schema.business_trip_day_lines WHERE tenant_id=$1 AND trip_request_id=$2`,
    [tenant, tripId],
  );
  const byDate = new Map<string, LineRow>(stored.rows.map((r: LineRow) => [isoDate(r.work_date), r]));
  const dates = datesBetween(from, to);
  const timezone = await timezoneOf(db, tenant, from, trip.employee_id);
  const effective = new Map<string, DayWindow[] | null>();
  for (const date of dates) {
    const line = byDate.get(date);
    effective.set(date, windowsOf(line?.actual_windows) ?? windowsOf(line?.planned_windows));
  }
  const lines: HrmTripDayLine[] = [];
  for (const date of dates) {
    const line = byDate.get(date);
    const windows = effective.get(date);
    let preview: TripDayClassification | null = null;
    if (windows && windows.length > 0) {
      const scheduled = await scheduledMinutesOf(db, tenant, trip.employee_id, date, timezone);
      const { night } = await nightWindowOf(db, tenant, trip.employee_id, date);
      preview = classifyTripDay({ windows, scheduledMinutes: scheduled, night });
    }
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    lines.push(viewOf(date, line, preview, restsNextMorning(effective.get(next))));
  }
  return { tripId, employeeId: trip.employee_id, fromDate: from, toDate: to, tripStatus: trip.status, lines };
}

function normalizeWindows(input: unknown, date: string): DayWindow[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestException(`Ngày ${date}: danh sách khung giờ không hợp lệ`);
  const windows = input.map((w) => ({ from: String((w as DayWindow)?.from ?? '').trim(), to: String((w as DayWindow)?.to ?? '').trim() }));
  const invalid = validateWindows(windows);
  if (invalid) throw new BadRequestException(`Ngày ${date}: ${invalid}`);
  return windows;
}

/**
 * Lưu giờ khai từng ngày. `PLANNED` (dự kiến, đăng ký trước chuyến đi) chỉ để xem trước, không vào lương hay quỹ.
 * `ACTUAL` (thực tế, sau chuyến đi) gửi chờ quản lý trực tiếp hoặc người duyệt dự phòng xác nhận; chỉ cho các ngày đã qua của
 * đơn công tác đã duyệt, tháng chưa chốt công. Giờ thực tế đã duyệt không sửa lại ở đây (xử lý sửa sau).
 */
export async function saveTripDayLines(
  db: PoolClient,
  tenant: string,
  actor: string,
  employeeId: string,
  tripId: string,
  body: SaveHrmTripDayLinesRequest,
): Promise<HrmTripDayLines> {
  const mode = body.mode === 'ACTUAL' ? 'ACTUAL' : body.mode === 'PLANNED' ? 'PLANNED' : null;
  if (!mode) throw new BadRequestException('Cần chọn khai giờ dự kiến hoặc giờ thực tế');
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new BadRequestException('Chưa có ngày nào để lưu');
  const trip = await loadTrip(db, tenant, tripId, true);
  if (trip.employee_id !== employeeId) throw new ForbiddenException('Chỉ người đi công tác hoặc người lập hộ được khai giờ');
  if (!['PENDING', 'APPROVED'].includes(trip.status)) throw new ConflictException('Đơn công tác không còn hiệu lực để khai giờ');
  if (mode === 'ACTUAL' && trip.status !== 'APPROVED')
    throw new ConflictException('Giờ thực tế chỉ khai được sau khi đơn công tác đã được duyệt');
  const from = isoDate(trip.from_date);
  const to = isoDate(trip.to_date);
  const today = todayInVietnam();
  const seen = new Set<string>();
  for (const line of body.lines) {
    const date = String(line?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to)
      throw new BadRequestException(`Ngày ${date || '(trống)'} nằm ngoài thời gian đơn công tác (${from} đến ${to})`);
    if (seen.has(date)) throw new BadRequestException(`Ngày ${date} bị khai trùng`);
    seen.add(date);
    const windows = normalizeWindows(line.windows, date);
    const existing = (
      await db.query(
        `SELECT id,status FROM hrm_schema.business_trip_day_lines WHERE tenant_id=$1 AND trip_request_id=$2 AND work_date=$3 FOR UPDATE`,
        [tenant, tripId, date],
      )
    ).rows[0] as { id: string; status: HrmTripDayLineStatus } | undefined;
    if (mode === 'PLANNED') {
      if (existing && existing.status !== 'PLANNED')
        throw new ConflictException(`Ngày ${date} đã khai giờ thực tế; không sửa giờ dự kiến`);
      if (windows.length === 0) {
        if (existing) await db.query(`DELETE FROM hrm_schema.business_trip_day_lines WHERE id=$1`, [existing.id]);
        continue;
      }
      await db.query(
        `INSERT INTO hrm_schema.business_trip_day_lines (tenant_id,trip_request_id,employee_id,work_date,planned_windows,status)
         VALUES ($1,$2,$3,$4,$5::jsonb,'PLANNED')
         ON CONFLICT (trip_request_id,work_date) DO UPDATE SET planned_windows=EXCLUDED.planned_windows,updated_at=now()`,
        [tenant, tripId, employeeId, date, JSON.stringify(windows)],
      );
      continue;
    }
    if (date > today) throw new BadRequestException(`Ngày ${date} chưa tới nên chưa khai được giờ thực tế`);
    if (existing?.status === 'ACTUAL_APPROVED')
      throw new ConflictException(`Ngày ${date} đã được duyệt giờ thực tế; cần người duyệt hoặc HR điều chỉnh`);
    await assertOpenRange(db, tenant, date, date);
    if (windows.length === 0) {
      // Bỏ khai thực tế: về theo ca của nhân viên (giữ giờ dự kiến nếu có).
      if (existing)
        await db.query(
          `UPDATE hrm_schema.business_trip_day_lines SET actual_windows=NULL,status='PLANNED',submitted_by=NULL,submitted_at=NULL,decided_by=NULL,decided_at=NULL,decision_note=NULL,updated_at=now() WHERE id=$1`,
          [existing.id],
        );
      continue;
    }
    await db.query(
      `INSERT INTO hrm_schema.business_trip_day_lines (tenant_id,trip_request_id,employee_id,work_date,actual_windows,status,submitted_by,submitted_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,'ACTUAL_PENDING',$6,now())
       ON CONFLICT (trip_request_id,work_date) DO UPDATE SET actual_windows=EXCLUDED.actual_windows,status='ACTUAL_PENDING',
         submitted_by=EXCLUDED.submitted_by,submitted_at=now(),decided_by=NULL,decided_at=NULL,decision_note=NULL,updated_at=now()`,
      [tenant, tripId, employeeId, date, JSON.stringify(windows), actor],
    );
  }
  await lifecycleAudit(db, tenant, actor, mode === 'ACTUAL' ? 'TRIP_DAY_LINES_ACTUAL_SUBMITTED' : 'TRIP_DAY_LINES_PLANNED_SAVED', tripId, {
    mode,
    dates: [...seen],
  });
  return loadTripDayLines(db, tenant, tripId);
}

/** Ghi các đoạn làm thêm của một dòng ngày đã duyệt vào `overtime_blocks` (xóa ca cũ của dòng trước, giữ ca đã sửa tay). */
async function syncTripDayBlocks(
  db: PoolClient,
  tenant: string,
  line: { id: string; employee_id: string; date: string; classification: TripDayClassification },
  timezone: string,
  policyVersionId: string | null,
  enabled: boolean,
): Promise<number> {
  await db.query(`DELETE FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND trip_day_line_id=$2 AND source<>'MANUAL'`, [tenant, line.id]);
  if (!enabled || !(await overtimeSchemaReady(db))) return 0;
  const base = localMinutes(`${line.date}T00:00`);
  let written = 0;
  for (const seg of line.classification.otSegments) {
    const hours = round2(seg.minutes / 60);
    if (hours <= 0) continue;
    const night = round2(seg.nightMinutes / 60);
    const ot = round2(hours - night);
    await db.query(
      `INSERT INTO hrm_schema.overtime_blocks
         (tenant_id,ot_request_id,trip_day_line_id,employee_id,period_month,start_at,end_at,hours,crosses_midnight,rule_set,policy_version_id,
          rest_fraction_suggested,ot_hours_suggested,night_hours_suggested,ot_hours_final,night_hours_final,source)
       VALUES ($1,NULL,$2,$3,$4,($5::text)::timestamp AT TIME ZONE ($6::text),($7::text)::timestamp AT TIME ZONE ($6::text),$8,$9,'DECLARED',$10,
               0,$11,$12,$11,$12,'CT_DECLARED')
       ON CONFLICT (tenant_id,trip_day_line_id,start_at) WHERE trip_day_line_id IS NOT NULL DO UPDATE SET
         end_at=EXCLUDED.end_at,hours=EXCLUDED.hours,crosses_midnight=EXCLUDED.crosses_midnight,policy_version_id=EXCLUDED.policy_version_id,
         ot_hours_suggested=EXCLUDED.ot_hours_suggested,night_hours_suggested=EXCLUDED.night_hours_suggested,
         ot_hours_final=CASE WHEN hrm_schema.overtime_blocks.source='MANUAL' THEN hrm_schema.overtime_blocks.ot_hours_final ELSE EXCLUDED.ot_hours_final END,
         night_hours_final=CASE WHEN hrm_schema.overtime_blocks.source='MANUAL' THEN hrm_schema.overtime_blocks.night_hours_final ELSE EXCLUDED.night_hours_final END,
         updated_at=now()`,
      [
        tenant,
        line.id,
        line.employee_id,
        monthOf(line.date),
        formatLocalMinutes(base + seg.start),
        timezone,
        formatLocalMinutes(base + seg.end),
        hours,
        seg.end > 1440,
        policyVersionId,
        ot,
        night,
      ],
    );
    written += 1;
  }
  return written;
}

/**
 * Quản lý trực tiếp hoặc người duyệt dự phòng của đơn công tác duyệt hoặc từ chối giờ thực tế. Không có tự duyệt:
 * người khai giờ không duyệt giờ của chính mình, kể cả khi tenant cho phép tự duyệt các đơn khác.
 */
export async function decideTripDayLines(
  db: PoolClient,
  tenant: string,
  actor: string,
  tripId: string,
  body: DecideHrmTripDayLinesRequest,
): Promise<HrmTripDayLines> {
  const decision = body.decision === 'APPROVE' ? 'APPROVE' : body.decision === 'REJECT' ? 'REJECT' : null;
  if (!decision) throw new BadRequestException('Cần chọn duyệt hoặc từ chối');
  const note = String(body.note ?? '').trim();
  if (decision === 'REJECT' && !note) throw new BadRequestException('Cần nhập lý do khi từ chối giờ thực tế');
  if (note.length > 2000) throw new BadRequestException('Ghi chú tối đa 2000 ký tự');
  const trip = await loadTrip(db, tenant, tripId, true);
  if (trip.status !== 'APPROVED') throw new ConflictException('Đơn công tác không còn hiệu lực');
  const own = await db.query(
    `SELECT 1 FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2 AND user_id=$3`,
    [tenant, trip.employee_id, actor],
  );
  if (own.rowCount) throw new ForbiddenException('Không được tự duyệt giờ làm của chính mình');
  if (!(await isDesignatedDirectApprover(db, tenant, 'business_trip', tripId, trip.employee_id, actor)))
    throw new ForbiddenException('Chỉ quản lý trực tiếp hoặc người duyệt dự phòng của đơn công tác mới xác nhận giờ thực tế');
  const wanted = Array.isArray(body.dates) && body.dates.length > 0 ? body.dates.map(String) : null;
  const pending = await db.query(
    `SELECT id,work_date,actual_windows FROM hrm_schema.business_trip_day_lines
      WHERE tenant_id=$1 AND trip_request_id=$2 AND status='ACTUAL_PENDING' AND ($3::date[] IS NULL OR work_date=ANY($3::date[]))
      ORDER BY work_date FOR UPDATE`,
    [tenant, tripId, wanted],
  );
  if (pending.rowCount === 0) throw new ConflictException('Không có ngày nào đang chờ xác nhận giờ thực tế');
  const timezone = await timezoneOf(db, tenant, isoDate(trip.from_date), trip.employee_id);
  for (const row of pending.rows as { id: string; work_date: unknown; actual_windows: unknown }[]) {
    const date = isoDate(row.work_date);
    await assertOpenRange(db, tenant, date, date);
    if (decision === 'REJECT') {
      await db.query(
        `UPDATE hrm_schema.business_trip_day_lines SET status='ACTUAL_REJECTED',decided_by=$2,decided_at=now(),decision_note=$3,updated_at=now() WHERE id=$1`,
        [row.id, actor, note],
      );
      await db.query(`DELETE FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND trip_day_line_id=$2 AND source<>'MANUAL'`, [tenant, row.id]);
      continue;
    }
    const windows = windowsOf(row.actual_windows) ?? [];
    const scheduled = await scheduledMinutesOf(db, tenant, trip.employee_id, date, timezone);
    const { night, enabled, policyVersionId } = await nightWindowOf(db, tenant, trip.employee_id, date);
    const classification = classifyTripDay({ windows, scheduledMinutes: scheduled, night });
    await db.query(
      `UPDATE hrm_schema.business_trip_day_lines SET status='ACTUAL_APPROVED',decided_by=$2,decided_at=now(),decision_note=$3,
         scheduled_minutes=$4,normal_minutes=$5,ot_minutes=$6,night_minutes=$7,updated_at=now() WHERE id=$1`,
      [row.id, actor, note || null, classification.scheduledMinutes, classification.normalMinutes, classification.otMinutes, classification.nightMinutes],
    );
    await syncTripDayBlocks(db, tenant, { id: row.id, employee_id: trip.employee_id, date, classification }, timezone, policyVersionId, enabled);
  }
  await lifecycleAudit(db, tenant, actor, decision === 'APPROVE' ? 'TRIP_DAY_LINES_APPROVED' : 'TRIP_DAY_LINES_REJECTED', tripId, {
    dates: (pending.rows as { work_date: unknown }[]).map((r) => isoDate(r.work_date)),
    note,
  });
  return loadTripDayLines(db, tenant, tripId);
}

/** Người này có được xác nhận giờ thực tế của đơn không (để giao diện hiện nút duyệt). Không đọc ghi dữ liệu. */
export async function canDecideTripDayLines(db: PoolClient, tenant: string, userId: string, tripId: string): Promise<boolean> {
  const found = await db.query(`SELECT employee_id,status FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2`, [tenant, tripId]);
  const trip = found.rows[0] as { employee_id: string; status: string } | undefined;
  if (!trip || trip.status !== 'APPROVED') return false;
  const own = await db.query(
    `SELECT 1 FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2 AND user_id=$3`,
    [tenant, trip.employee_id, userId],
  );
  if (own.rowCount) return false;
  return isDesignatedDirectApprover(db, tenant, 'business_trip', tripId, trip.employee_id, userId);
}

/** Đơn công tác bị hủy hiệu lực: xóa ca làm thêm sinh từ giờ thực tế và đưa các ngày đã xác nhận về trạng thái bị từ chối. */
export async function voidTripDayLines(db: PoolClient, tenant: string, actor: string, tripId: string, reason: string): Promise<void> {
  await db.query(
    `DELETE FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND trip_day_line_id IN (SELECT id FROM hrm_schema.business_trip_day_lines WHERE tenant_id=$1 AND trip_request_id=$2)`,
    [tenant, tripId],
  );
  await db.query(
    `UPDATE hrm_schema.business_trip_day_lines SET status='ACTUAL_REJECTED',decided_by=$3,decided_at=now(),decision_note=$4,updated_at=now()
      WHERE tenant_id=$1 AND trip_request_id=$2 AND status IN ('ACTUAL_PENDING','ACTUAL_APPROVED')`,
    [tenant, tripId, actor, `Đơn công tác đã hủy hiệu lực: ${reason}`.slice(0, 2000)],
  );
}
