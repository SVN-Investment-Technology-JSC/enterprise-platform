import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { calculateAttendance } from '../domain/attendance-calculation.js';
import { isoDate, isoTime, resolvePolicy, shiftForDate } from './hrm-time.js';

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
      const shift = await shiftForDate(
        db,
        tenant,
        employee.employee_id,
        day.date,
        timezone,
      );
      const events = await db.query(
        `SELECT id,event_kind,occurred_at FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id IS NULL ORDER BY occurred_at,id`,
        [tenant, employee.employee_id, day.date],
      );
      const calculation = calculateAttendance(
        events.rows.map((e) => ({
          id: e.id,
          kind: e.event_kind,
          at: isoTime(e.occurred_at)!,
        })),
        shift?.window || null,
      );
      const attendance = await db.query(
        `SELECT id FROM hrm_schema.attendances WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3`,
        [tenant, employee.employee_id, day.date],
      );
      const leaves = await db.query(
        `SELECT r.id,d.quantity,d.paid_minutes FROM hrm_schema.leave_requests r JOIN hrm_schema.leave_request_days d ON d.request_id=r.id AND d.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED' AND d.work_date=$3`,
        [tenant, employee.employee_id, day.date],
      );
      const legacyLeaves = await db.query(
        `SELECT r.id FROM hrm_schema.leave_requests r WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED' AND $3::date BETWEEN r.from_date AND r.to_date AND NOT EXISTS(SELECT 1 FROM hrm_schema.leave_request_days d WHERE d.request_id=r.id)`,
        [tenant, employee.employee_id, day.date],
      );
      const trips = await db.query(
        `SELECT id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND $3::date BETWEEN from_date AND to_date`,
        [tenant, employee.employee_id, day.date],
      );
      const ots = await db.query(
        `SELECT *, (($3::date+start_time) AT TIME ZONE $4) AS starts_at,(($3::date+end_time+CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS ends_at FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND status='APPROVED'`,
        [tenant, employee.employee_id, day.date, timezone],
      );
      let otMinutes = 0,
        weightedOtMinutes = 0;
      const overlap = (a: number, b: number, c: number, d: number) =>
        Math.max(0, Math.min(b, d) - Math.max(a, c));
      for (const ot of ots.rows) {
        let actualMs = 0;
        const start = Date.parse(isoTime(ot.starts_at)!),
          end = Date.parse(isoTime(ot.ends_at)!);
        for (const session of calculation.sessions) {
          const a = Math.max(start, Date.parse(session.start)),
            b = Math.min(end, Date.parse(session.end));
          if (b > a)
            actualMs +=
              b -
              a -
              (shift && day.day_kind !== 'OFF' && day.day_kind !== 'HOLIDAY'
                ? overlap(
                    a,
                    b,
                    Date.parse(shift.window.start),
                    Date.parse(shift.window.end),
                  )
                : 0);
        }
        const actual = Math.max(0, Math.floor(actualMs / 60000)),
          billable = Math.min(actual, Number(ot.approved_minutes));
        await db.query(
          `UPDATE hrm_schema.ot_requests SET actual_minutes=$3,billable_ot_minutes=$4,timesheet_updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tenant, ot.id, actual, billable],
        );
        otMinutes += billable;
        weightedOtMinutes += billable * Number(ot.ot_rate_multiplier);
      }
      const scheduled = calculation.scheduledMinutes;
      const leaveMinutes = leaves.rows.reduce(
        (sum, r) => sum + Number(r.paid_minutes),
        0,
      );
      const off = day.day_kind === 'OFF',
        holiday = day.day_kind === 'HOLIDAY';
      const issues = calculation.anomalies.filter(
        (a) => a !== 'NO_SHIFT' || (!off && (!holiday || day.holiday_paid)),
      );
      if (legacyLeaves.rowCount) issues.push('LEGACY_LEAVE_REQUIRES_REVIEW');
      if (leaves.rowCount && trips.rowCount) issues.push('LEAVE_TRIP_OVERLAP');
      let paid = off
        ? 0
        : holiday
          ? day.holiday_paid
            ? scheduled
            : 0
          : Math.min(
              scheduled,
              calculation.workedMinutes +
                leaveMinutes +
                (trips.rowCount ? scheduled : 0),
            );
      if (!Number.isFinite(paid)) paid = 0;
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
      const snapshot = {
        ...calculation,
        anomalies: issues,
        timezone,
        shift,
        dayKind: day.day_kind || 'WORK',
        leaveMinutes,
        weightedOtMinutes,
        leaveIds: leaves.rows.map((r) => r.id),
        tripIds: trips.rows.map((r) => r.id),
        otIds: ots.rows.map((r) => r.id),
        policyVersionId: policy?.id || null,
      };
      await db.query(
        `INSERT INTO hrm_schema.timesheets (tenant_id,period_id,employee_id,work_date,shift_id,attendance_id,leave_request_id,business_trip_request_id,scheduled_minutes,worked_minutes,paid_minutes,ot_minutes,late_minutes,early_leave_minutes,workday_units,status,calculation_snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (period_id,employee_id,work_date) DO UPDATE SET shift_id=EXCLUDED.shift_id,attendance_id=EXCLUDED.attendance_id,leave_request_id=EXCLUDED.leave_request_id,business_trip_request_id=EXCLUDED.business_trip_request_id,
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
          calculation.lateMinutes,
          calculation.earlyMinutes,
          scheduled ? Math.round((paid / scheduled) * 100) / 100 : 0,
          status,
          JSON.stringify(snapshot),
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
