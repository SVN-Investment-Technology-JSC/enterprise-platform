import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ExistingDay, WorkDayType } from '../domain/work-schedule.js';
import { resolveScheduleBatch, type ScheduleDayRow } from './hrm-timesheet-board.js';
import { resolveRuleDays } from './hrm-work-schedule-resolve.js';

type Db = Pick<PoolClient, 'query'>;

/**
 * Phân ca và đơn từ phải khớp nhau: đổi ca, huỷ ca hoặc chuyển thành ngày OFF/lễ trên ngày đã có đơn nghỉ hoặc công tác
 * làm lệch công và phép (phút nghỉ hưởng lương đã chốt theo ca cũ, ngày nghỉ không còn ca để tính). Đơn đã duyệt chặn
 * thao tác; đơn đang chờ chỉ cảnh báo vì quyết định sau cùng nằm ở người duyệt.
 */
export interface ScheduleChange {
  employeeId: string;
  date: string;
  /** Trạng thái ngày sau thay đổi; null = bỏ lịch tường minh, quay về lịch định kỳ (huỷ lịch). */
  after: { dayType: WorkDayType; shiftId: string | null } | null;
}

export interface ScheduleRequestConflict {
  employeeId: string;
  date: string;
  kind: 'LEAVE' | 'TRIP';
  requestId: string;
  status: 'APPROVED' | 'PENDING';
}

const key = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** Ngày có đơn nghỉ hoặc công tác (đã duyệt hoặc đang chờ) của các nhân viên trong khoảng ngày. */
export async function listRequestDays(
  db: Db,
  tenantId: string,
  employeeIds: readonly string[],
  from: string,
  to: string,
): Promise<ScheduleRequestConflict[]> {
  if (!employeeIds.length) return [];
  const [leaves, trips] = await Promise.all([
    db.query(
      `SELECT r.id, r.employee_id, r.status, to_char(d.work_date,'YYYY-MM-DD') AS date
         FROM hrm_schema.leave_requests r
         JOIN hrm_schema.leave_request_days d ON d.request_id = r.id AND d.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.employee_id = ANY($2::uuid[]) AND r.status IN ('APPROVED','PENDING')
          AND d.work_date BETWEEN $3::date AND $4::date`,
      [tenantId, [...employeeIds], from, to],
    ),
    db.query(
      `SELECT r.id, r.employee_id, r.status, to_char(g.d,'YYYY-MM-DD') AS date
         FROM hrm_schema.business_trip_requests r
         CROSS JOIN LATERAL generate_series(GREATEST(r.from_date,$3::date), LEAST(r.to_date,$4::date), interval '1 day') g(d)
        WHERE r.tenant_id = $1 AND r.employee_id = ANY($2::uuid[]) AND r.status IN ('APPROVED','PENDING')
          AND r.from_date <= $4::date AND r.to_date >= $3::date`,
      [tenantId, [...employeeIds], from, to],
    ),
  ]);
  const out: ScheduleRequestConflict[] = [];
  for (const [rows, kind] of [
    [leaves.rows, 'LEAVE'],
    [trips.rows, 'TRIP'],
  ] as const)
    for (const r of rows)
      out.push({
        employeeId: r.employee_id,
        date: r.date,
        kind,
        requestId: r.id,
        status: r.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
      });
  return out;
}

/**
 * Các ngày thay đổi làm đổi ca thực tế và đang có đơn nghỉ/công tác trùng.
 * `existing` là các dòng lịch từng ngày đang hiệu lực của các ngày bị tác động (đúng như loadExisting).
 */
export async function findRequestConflicts(
  db: Db,
  tenantId: string,
  changes: readonly ScheduleChange[],
  existing: readonly ExistingDay[],
): Promise<ScheduleRequestConflict[]> {
  if (!changes.length) return [];
  const employeeIds = [...new Set(changes.map((c) => c.employeeId))];
  const dates = changes.map((c) => c.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  const requestDays = await listRequestDays(db, tenantId, employeeIds, from, to);
  const hits: ScheduleRequestConflict[] = [];
  const changeAt = new Map(changes.map((c) => [key(c.employeeId, c.date), c]));
  for (const r of requestDays) if (changeAt.has(key(r.employeeId, r.date))) hits.push(r);
  if (!hits.length) return [];

  // So ca thực tế trước và sau: chỉ ngày thật sự đổi ca/loại ngày mới là xung đột.
  const rules = await resolveRuleDays(db, tenantId, [...new Set(hits.map((h) => h.employeeId))], from, to);
  const ruleAt = new Map(rules.map((r) => [key(r.employeeId, r.date), r]));
  const rowAt = new Map<string, ScheduleDayRow>(
    existing.map((e) => [
      key(e.employeeId, e.date),
      { employeeId: e.employeeId, date: e.date, dayType: e.dayType, shiftId: e.shiftId, holidayPaid: null, holidayName: null },
    ]),
  );
  const always = () => true;
  return hits.filter((h) => {
    const k = key(h.employeeId, h.date);
    const before = resolveScheduleBatch(rowAt.get(k), ruleAt.get(k), always);
    const change = changeAt.get(k)!;
    const after = change.after
      ? { dayType: change.after.dayType, shiftId: change.after.shiftId }
      : (() => {
          const reverted = resolveScheduleBatch(undefined, ruleAt.get(k), always);
          return { dayType: reverted.scheduleDayType, shiftId: reverted.shiftId };
        })();
    // Ngày lễ không ghi ca thì giữ ca của lịch trước đó (xem createHoliday): không tính là đổi ca.
    const afterShift = after.dayType === 'HOLIDAY' && !after.shiftId ? before.shiftId : after.shiftId;
    if (before.scheduleDayType !== after.dayType) return true;
    return after.dayType === 'SHIFT' && before.shiftId !== afterShift;
  });
}

export function approvedConflicts(list: readonly ScheduleRequestConflict[]): ScheduleRequestConflict[] {
  return list.filter((c) => c.status === 'APPROVED');
}

/** 409 liệt kê đơn nghỉ/công tác đã duyệt đang vướng; người dùng phải huỷ/rút đơn hoặc chọn ngày khác. */
export function requestConflictException(list: readonly ScheduleRequestConflict[]): ConflictException {
  const approved = approvedConflicts(list);
  return new ConflictException({
    code: 'HRM_SCHEDULE_REQUEST_CONFLICT',
    message: `Có ${approved.length} ngày đã có đơn nghỉ hoặc công tác được duyệt; thay đổi ca các ngày này làm lệch công và phép. Huỷ đơn (đảo đơn đã duyệt) hoặc bỏ các ngày đó khỏi phạm vi rồi thử lại.`,
    requestConflictTotal: approved.length,
    requestConflicts: approved.slice(0, 100),
  });
}
