import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { calculateAttendance } from '../domain/attendance-calculation.js';
import {
  coveredMinutesOf,
  resolveDayOutcome,
  type DayLeaveInput,
  type DayShiftBounds,
  type DayTripInput,
} from '../domain/timesheet-day.js';
import { applyScheduleDayKind } from '../domain/work-schedule.js';
import { dayTripAllowance, loadActiveRates } from './hrm-trip-allowance.js';
import { zonedMs } from './hrm-timesheet-board.js';
import {
  dayContextForDate,
  effectiveDayKind,
  isUnassignedSunday,
  isoDate,
  isoTime,
  resolvePolicy,
} from './hrm-time.js';

/** Một đơn tác động tới ngày công (lưu ở timesheets.sources để truy vết từ ô công về đơn gốc). */
export interface TimesheetSource {
  kind: 'LEAVE' | 'OT' | 'TRIP' | 'CORRECTION' | 'SHIFT_CHANGE';
  id: string;
  minutes: number | null;
  label: string | null;
}

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const msOf = (value: unknown): number | null => {
  if (!value) return null;
  const ms = Date.parse(String(value instanceof Date ? value.toISOString() : value));
  return Number.isFinite(ms) ? ms : null;
};
const intervalOf = (from: unknown, to: unknown) => {
  const a = msOf(from);
  const b = msOf(to);
  return a != null && b != null && b > a ? { startMs: a, endMs: b } : null;
};
const boundsOf = (window: {
  start: string;
  end: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
}): DayShiftBounds => ({
  startMs: Date.parse(window.start),
  endMs: Date.parse(window.end),
  breakStartMs: window.breakStart ? Date.parse(window.breakStart) : null,
  breakEndMs: window.breakEnd ? Date.parse(window.breakEnd) : null,
  graceLateMinutes: Number(window.graceLateMinutes ?? 0),
  graceEarlyMinutes: Number(window.graceEarlyMinutes ?? 0),
});

export async function calculateTimesheet(
  db: PoolClient,
  tenant: string,
  periodId: string,
) {
  const periodResult = await db.query(
    `SELECT * FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenant, periodId],
  );
  const period = periodResult.rows[0];
  if (!period) throw new NotFoundException('Không tìm thấy kỳ công');
  if (period.status === 'LOCKED')
    throw new BadRequestException('Kỳ công đã khóa');
  const dates = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date,c.day_kind,c.paid AS holiday_paid FROM generate_series($2::date,$3::date,'1 day') d LEFT JOIN hrm_schema.work_calendar c ON c.tenant_id=$1 AND c.work_date=d::date ORDER BY d`,
    [tenant, period.from_date, period.to_date],
  );
  const employees = await db.query(
    `SELECT employee_id,join_date,inactive_from FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date<=$2::date ORDER BY employee_id`,
    [tenant, period.to_date],
  );
  // Remove obsolete automatic rows, retaining every manual decision for review.
  // The enclosing period lock serializes recalculation, adjustments and closure.
  const invalid = await db.query(
    `SELECT t.* FROM hrm_schema.timesheets t WHERE t.tenant_id=$1 AND t.period_id=$2 AND NOT EXISTS(SELECT 1 FROM hrm_schema.employee_profiles e WHERE e.tenant_id=t.tenant_id AND e.employee_id=t.employee_id AND e.deleted_at IS NULL AND e.join_date<=t.work_date AND (e.inactive_from IS NULL OR t.work_date<e.inactive_from)) FOR UPDATE`,
    [tenant, periodId],
  );
  for (const row of invalid.rows) {
    if (row.is_manually_adjusted) {
      await db.query(
        `UPDATE hrm_schema.timesheets SET scheduled_minutes=0,worked_minutes=0,ot_minutes=0,late_minutes=0,early_leave_minutes=0,status=CASE WHEN calculation_snapshot->>'employmentEligible'='false' AND NOT adjustment_needs_review THEN 'ADJUSTED' ELSE 'ABNORMAL' END,adjustment_needs_review=adjustment_needs_review OR calculation_snapshot->>'employmentEligible' IS DISTINCT FROM 'false',calculation_snapshot=jsonb_build_object('employmentEligible',false,'anomalies',jsonb_build_array('OUTSIDE_EMPLOYMENT')),updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2`,
        [tenant, row.id],
      );
    } else {
      await db.query(
        'DELETE FROM hrm_schema.timesheets WHERE tenant_id=$1 AND id=$2',
        [tenant, row.id],
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,action,entity_id,detail) VALUES($1,'TIMESHEET_OUTSIDE_EMPLOYMENT_REMOVED',$2,$3)`,
        [tenant, row.id, JSON.stringify({ before: row, periodId })],
      );
    }
  }
  // Mức công tác phí theo hình thức công tác (đóng băng vào dòng công khi chốt kỳ).
  const tripRates = await loadActiveRates(db, tenant);
  for (const employee of employees.rows)
    for (const day of dates.rows) {
      if (
        day.date < isoDate(employee.join_date) ||
        (employee.inactive_from && day.date >= isoDate(employee.inactive_from))
      )
        continue;
      const policy = await resolvePolicy(
        db,
        tenant,
        'ATTENDANCE',
        day.date,
        employee.employee_id,
      );
      const timezone = String(
        policy?.config_json.timezone || 'Asia/Ho_Chi_Minh',
      );
      const dayContext = await dayContextForDate(
        db,
        tenant,
        employee.employee_id,
        day.date,
        timezone,
      );
      const shift = dayContext.shift;
      // Lịch phân ca tường minh (nghỉ / lễ / làm bù) thắng ngày nghỉ hằng tuần của chính sách.
      const scheduledKind = applyScheduleDayKind(
        effectiveDayKind(day.date, day.day_kind, policy?.config_json),
        dayContext.scheduleDayType,
      );
      // Chủ nhật chưa phân ca là ngày trống (cùng quy tắc với bảng công xem trực tiếp và đơn nghỉ).
      const dayKind =
        scheduledKind !== 'OFF' &&
        scheduledKind !== 'HOLIDAY' &&
        isUnassignedSunday(day.date, scheduledKind, Boolean(shift))
          ? 'OFF'
          : scheduledKind;
      const events = await db.query(
        `SELECT id,event_kind,occurred_at FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id IS NULL ORDER BY occurred_at,id`,
        [tenant, employee.employee_id, day.date],
      );
      const punches = events.rows.map((e) => ({
        id: e.id,
        kind: e.event_kind,
        at: isoTime(e.occurred_at)!,
      }));
      // Cửa sổ ca lỗi không làm hỏng cả kỳ: ngày đó thành bất thường INVALID_SHIFT để xử lý riêng.
      let invalidShift = false;
      let calculation: ReturnType<typeof calculateAttendance>;
      try {
        calculation = calculateAttendance(punches, shift?.window || null);
      } catch {
        invalidShift = true;
        calculation = calculateAttendance(punches, null);
      }
      const attendance = await db.query(
        `SELECT id FROM hrm_schema.attendances WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3`,
        [tenant, employee.employee_id, day.date],
      );
      const leaves = await db.query(
        `SELECT r.id,d.quantity,d.paid_minutes,to_jsonb(r)->>'from_at' AS from_at,to_jsonb(r)->>'to_at' AS to_at,t.name AS reason_name FROM hrm_schema.leave_requests r LEFT JOIN hrm_schema.leave_types t ON t.id=r.leave_type_id AND t.tenant_id=r.tenant_id JOIN hrm_schema.leave_request_days d ON d.request_id=r.id AND d.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED' AND d.work_date=$3`,
        [tenant, employee.employee_id, day.date],
      );
      const legacyLeaves = await db.query(
        `SELECT r.id FROM hrm_schema.leave_requests r WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED' AND $3::date BETWEEN r.from_date AND r.to_date AND NOT EXISTS(SELECT 1 FROM hrm_schema.leave_request_days d WHERE d.request_id=r.id)`,
        [tenant, employee.employee_id, day.date],
      );
      const trips = await db.query(
        `SELECT id,destination,business_trip_type,to_jsonb(business_trip_requests)->>'from_at' AS from_at,to_jsonb(business_trip_requests)->>'to_at' AS to_at FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND $3::date BETWEEN from_date AND to_date ORDER BY created_at,id`,
        [tenant, employee.employee_id, day.date],
      );
      const correctionRows = await db.query(
        `SELECT DISTINCT cid FROM (
           SELECT voided_by_correction_id::text AS cid FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id IS NOT NULL
           UNION ALL SELECT to_jsonb(e)->'evidence'->>'correctionId' FROM hrm_schema.attendance_events e WHERE e.tenant_id=$1 AND e.employee_id=$2 AND e.work_date=$3 AND e.voided_by_correction_id IS NULL
         ) x WHERE cid IS NOT NULL ORDER BY cid`,
        [tenant, employee.employee_id, day.date],
      );
      const shiftChangeRows = await db.query(
        `SELECT id FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND status='APPROVED' AND applied_at IS NOT NULL AND (employee_id=$2 OR swap_with_employee_id=$2) AND $3::date BETWEEN from_date AND to_date ORDER BY approved_at,id`,
        [tenant, employee.employee_id, day.date],
      );
      const ots = await db.query(
        `SELECT * FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND status='APPROVED' ORDER BY created_at,id`,
        [tenant, employee.employee_id, day.date],
      );
      // Tăng ca tính theo khoảng thời gian ĐÃ DUYỆT trong đơn (từ ngày giờ đến ngày giờ, kể cả qua nửa đêm), không phụ thuộc
      // giờ chấm ra: ví dụ 22:00 đến 02:00 hôm sau là 4 giờ. Đơn chọn lý do không lương (paid=false) vẫn là đơn hợp lệ
      // nhưng không cộng vào ot_minutes nên không sinh tiền tăng ca. Đơn cũ chưa có paid tính là có lương.
      let otMinutes = 0,
        weightedOtMinutes = 0;
      for (const ot of ots.rows) {
        const approved = Math.max(0, Number(ot.approved_minutes));
        const billable = ot.paid !== false ? approved : 0;
        await db.query(
          `UPDATE hrm_schema.ot_requests SET actual_minutes=$3,billable_ot_minutes=$4,timesheet_updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tenant, ot.id, approved, billable],
        );
        otMinutes += billable;
        weightedOtMinutes += billable * Number(ot.ot_rate_multiplier);
      }
      const scheduled = calculation.scheduledMinutes;
      const off = dayKind === 'OFF',
        holiday = dayKind === 'HOLIDAY';
      // Lịch lễ công ty (work_calendar) có dòng thì dùng cờ của nó; ngày lễ theo phòng ban/nhân viên chỉ có ở
      // lịch phân ca nên lấy cờ có lương từ company_holidays.
      const holidayPaid = day.day_kind
        ? Boolean(day.holiday_paid)
        : (dayContext.holidayPaid ?? false);
      const leaveInputs: DayLeaveInput[] = [
        ...leaves.rows.map((r) => ({
          days: Number(r.quantity),
          paidMinutes: Number(r.paid_minutes),
          interval: intervalOf(r.from_at, r.to_at),
        })),
        ...legacyLeaves.rows.map(() => ({ days: 1, paidMinutes: 0, interval: null, legacy: true })),
      ];
      const dayStartMs = zonedMs(day.date, '00:00:00', timezone);
      const dayEndMs = zonedMs(nextDay(day.date), '00:00:00', timezone);
      const tripInputs: DayTripInput[] = trips.rows.map((r) => {
        const interval = intervalOf(r.from_at, r.to_at);
        return {
          interval,
          dayMinutes: interval
            ? Math.max(0, Math.round((Math.min(interval.endMs, dayEndMs) - Math.max(interval.startMs, dayStartMs)) / 60000))
            : null,
        };
      });
      const outcome = resolveDayOutcome({
        off,
        holiday,
        holidayPaid,
        shift: shift ? boundsOf(shift.window) : null,
        scheduledMinutes: scheduled,
        workedMinutes: calculation.workedMinutes,
        lateMinutes: calculation.lateMinutes,
        earlyMinutes: calculation.earlyMinutes,
        firstInMs: msOf(calculation.firstIn),
        lastOutMs: msOf(calculation.lastOut),
        anomalies: calculation.anomalies,
        leaves: leaveInputs,
        trips: tripInputs,
        hasOt: ots.rows.length > 0,
      });
      const leaveMinutes = leaves.rows.reduce(
        (sum, r) => sum + Number(r.paid_minutes),
        0,
      );
      const issues = [...outcome.issues];
      if (invalidShift) issues.push('INVALID_SHIFT');
      const paid = outcome.paidMinutes;
      const status = issues.length
        ? 'ABNORMAL'
        : off
          ? 'OFF'
          : holiday
            ? 'HOLIDAY'
            : leaves.rowCount
              ? 'LEAVE'
              : trips.rowCount
                ? 'BUSINESS_TRIP'
                : paid
                  ? 'NORMAL'
                  : 'ABSENT';
      // Công tác phí: chỉ ngày làm việc có ca (cùng điều kiện với công tác được tính công); ngày nghỉ chồng công tác
      // đã bị đánh dấu bất thường nên không tính tiền cho tới khi được xử lý.
      const tripAllowance =
        !off && !holiday && !leaves.rowCount && shift
          ? dayTripAllowance(
              tripRates,
              day.date,
              scheduled,
              trips.rows.map((r, i) => ({
                requestId: String(r.id),
                tripType: String(r.business_trip_type || 'DOMESTIC'),
                coveredMinutes: coveredMinutesOf(boundsOf(shift.window), scheduled, [], [tripInputs[i]]).minutes,
              })),
            )
          : [];
      const tripAllowanceAmount = tripAllowance.reduce((n, t) => n + t.amount, 0);
      const sources: TimesheetSource[] = [
        ...leaves.rows.map((r) => ({
          kind: 'LEAVE' as const,
          id: String(r.id),
          minutes: Number(r.paid_minutes),
          label: (r.reason_name as string | null) ?? null,
        })),
        ...trips.rows.map((r) => ({
          kind: 'TRIP' as const,
          id: String(r.id),
          minutes: null,
          label: (r.destination as string | null) ?? null,
        })),
        ...ots.rows.map((r) => ({
          kind: 'OT' as const,
          id: String(r.id),
          minutes: Number(r.approved_minutes),
          label: null,
        })),
        ...correctionRows.rows.map((r) => ({
          kind: 'CORRECTION' as const,
          id: String(r.cid),
          minutes: null,
          label: null,
        })),
        ...shiftChangeRows.rows.map((r) => ({
          kind: 'SHIFT_CHANGE' as const,
          id: String(r.id),
          minutes: null,
          label: null,
        })),
      ];
      const snapshot = {
        ...calculation,
        lateMinutes: outcome.lateMinutes,
        earlyMinutes: outcome.earlyMinutes,
        coveredMinutes: outcome.coveredMinutes,
        notes: calculation.anomalies.filter((a) => !issues.includes(a)),
        tripAllowance,
        tripAllowanceAmount,
        tripAllowanceMissingRate: tripAllowance.filter((t) => t.rate == null).map((t) => t.tripType),
        anomalies: issues,
        timezone,
        shift,
        dayKind: dayKind || 'WORK',
        leaveMinutes,
        weightedOtMinutes,
        leaveIds: leaves.rows.map((r) => r.id),
        tripIds: trips.rows.map((r) => r.id),
        otIds: ots.rows.map((r) => r.id),
        policyVersionId: policy?.id || null,
      };
      await db.query(
        `INSERT INTO hrm_schema.timesheets (tenant_id,period_id,employee_id,work_date,shift_id,attendance_id,leave_request_id,business_trip_request_id,scheduled_minutes,worked_minutes,paid_minutes,ot_minutes,late_minutes,early_leave_minutes,workday_units,status,calculation_snapshot,ot_request_id,sources)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (period_id,employee_id,work_date) DO UPDATE SET shift_id=EXCLUDED.shift_id,attendance_id=EXCLUDED.attendance_id,leave_request_id=EXCLUDED.leave_request_id,business_trip_request_id=EXCLUDED.business_trip_request_id,ot_request_id=EXCLUDED.ot_request_id,sources=EXCLUDED.sources,
      scheduled_minutes=EXCLUDED.scheduled_minutes,worked_minutes=EXCLUDED.worked_minutes,
      paid_minutes=CASE WHEN hrm_schema.timesheets.is_manually_adjusted THEN hrm_schema.timesheets.paid_minutes ELSE EXCLUDED.paid_minutes END,
      ot_minutes=EXCLUDED.ot_minutes,late_minutes=EXCLUDED.late_minutes,early_leave_minutes=EXCLUDED.early_leave_minutes,
      workday_units=CASE WHEN hrm_schema.timesheets.is_manually_adjusted THEN hrm_schema.timesheets.workday_units ELSE EXCLUDED.workday_units END,
      status=CASE WHEN NOT hrm_schema.timesheets.is_manually_adjusted THEN EXCLUDED.status WHEN hrm_schema.timesheets.adjustment_needs_review OR hrm_schema.timesheets.calculation_snapshot IS DISTINCT FROM EXCLUDED.calculation_snapshot THEN 'ABNORMAL' ELSE 'ADJUSTED' END,
      adjustment_needs_review=hrm_schema.timesheets.is_manually_adjusted AND (hrm_schema.timesheets.adjustment_needs_review OR hrm_schema.timesheets.calculation_snapshot IS DISTINCT FROM EXCLUDED.calculation_snapshot),
      calculation_snapshot=EXCLUDED.calculation_snapshot,updated_at=GREATEST(clock_timestamp(),hrm_schema.timesheets.updated_at+interval '1 millisecond')`,
        [
          tenant,
          periodId,
          employee.employee_id,
          day.date,
          shift?.id || null,
          attendance.rows[0]?.id || null,
          leaves.rows[0]?.id || null,
          trips.rows[0]?.id || null,
          off ? 0 : scheduled,
          calculation.workedMinutes,
          paid,
          otMinutes,
          outcome.lateMinutes,
          outcome.earlyMinutes,
          scheduled ? Math.round((paid / scheduled) * 100) / 100 : 0,
          status,
          JSON.stringify(snapshot),
          ots.rows[0]?.id || null,
          JSON.stringify(sources),
        ],
      );
    }
  await db.query(
    `UPDATE hrm_schema.timesheet_periods SET calculated_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant, periodId],
  );
  const totals = await db.query(
    `SELECT count(*)::int AS count,count(*) FILTER(WHERE status='ABNORMAL')::int AS abnormal FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2`,
    [tenant, periodId],
  );
  return totals.rows[0] as { count: number; abnormal: number };
}
