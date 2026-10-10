import type { PoolClient } from 'pg';
import { resolveRuleDays } from './hrm-work-schedule-resolve.js';

/**
 * Tra ca của một nhân viên tại một ngày (dùng chung cho tính công, đơn nghỉ, chấm công, dashboard).
 * Nguồn duy nhất là chức năng Phân ca làm việc:
 *   1. lịch từng ngày (employee_work_days): ngoại lệ, ngày lễ, lịch gán theo khoảng ngày;
 *   2. lịch định kỳ không có ngày kết thúc: nhân viên > phòng ban gần nhất > toàn công ty
 *      (xem hrm-work-schedule-resolve.ts).
 * Không có dòng nào thì nhân viên chưa có ca ngày đó. Các bảng gán ca cũ (shift_assignments,
 * unit_shift_assignments) không còn được dùng để tra ca.
 * Lịch từng ngày đã tự giải quyết ưu tiên giữa mẫu, ngoại lệ và ngày lễ lúc ghi (xem hrm-work-schedule.ts).
 */
export type ShiftSource = 'SCHEDULE' | 'RULE';
export type ScheduleDayType = 'SHIFT' | 'OFF' | 'HOLIDAY';

export interface PickedShift<T> {
  source: ShiftSource;
  row: T;
  unitId: string | null;
  depth: number | null;
}

const SHIFT_COLUMNS = (assignment: string) => `s.*, ${assignment},
    (($3::date + s.start_time) AT TIME ZONE $4) AS starts_at,
    (($3::date + s.end_time + CASE WHEN s.cross_midnight THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS ends_at,
    (($3::date + s.break_start_time + CASE WHEN s.cross_midnight AND s.break_start_time<s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_starts_at,
    (($3::date + s.break_end_time + CASE WHEN s.cross_midnight AND s.break_end_time<=s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_ends_at`;

export interface ResolvedShiftRow {
  [column: string]: unknown;
  assignment_id: string | null;
}

/** Tenant đã có bảng lịch từng ngày (bảng chỉ được thêm, không bị xoá nên chỉ cache kết quả dương). */
const scheduleReady = new Set<string>();
export async function workScheduleTableExists(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
) {
  if (scheduleReady.has(tenantId)) return true;
  const r = await db.query(
    `SELECT to_regclass('hrm_schema.employee_work_days') IS NOT NULL AS ready`,
  );
  const ready = r.rows[0]?.ready === true;
  if (ready) scheduleReady.add(tenantId);
  return ready;
}

export interface ResolvedDay {
  picked: PickedShift<ResolvedShiftRow> | null;
  /** Loại ngày theo lịch phân ca; null nếu nhân viên chưa có lịch nào cho ngày đó. */
  scheduleDayType: ScheduleDayType | null;
  /** Ngày lễ theo phạm vi (company_holidays): có hưởng lương hay không; null nếu không phải ngày lễ từ lịch phân ca. */
  holidayPaid?: boolean | null;
}

export async function resolveShiftRow(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
): Promise<PickedShift<ResolvedShiftRow> | null> {
  return (await resolveDay(db, tenantId, employeeId, date, timezone)).picked;
}

/** Lớp lịch định kỳ: ca (hoặc OFF) mà lịch định kỳ hiệu lực quy định cho ngày đó; null nếu không có. */
async function resolveRuleLayer(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
): Promise<{ dayType: 'OFF' } | { dayType: 'SHIFT'; picked: PickedShift<ResolvedShiftRow> } | null> {
  const [rule] = await resolveRuleDays(db, tenantId, [employeeId], date, date);
  if (!rule) return null;
  if (rule.dayType === 'OFF') return { dayType: 'OFF' };
  const shift = await db.query(
    `SELECT ${SHIFT_COLUMNS('NULL::uuid AS assignment_id')} FROM hrm_schema.shift_definitions s WHERE s.tenant_id = $1 AND s.id = $2`,
    [tenantId, rule.shiftId, date, timezone],
  );
  if (!shift.rows[0]) return null;
  return {
    dayType: 'SHIFT',
    picked: { source: 'RULE', row: shift.rows[0] as ResolvedShiftRow, unitId: null, depth: null },
  };
}

/**
 * Ca hiệu lực (cùng cột thời gian đã quy đổi theo múi giờ) và loại ngày theo lịch phân ca.
 * Ngày OFF tường minh trong lịch thì không có ca (picked = null).
 */
export async function resolveDay(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
): Promise<ResolvedDay> {
  if (await workScheduleTableExists(db, tenantId)) {
    const scheduled = await db.query(
      `SELECT w.day_type, h.paid AS holiday_paid, ${SHIFT_COLUMNS('w.id AS assignment_id')}
         FROM hrm_schema.employee_work_days w
         LEFT JOIN hrm_schema.shift_definitions s ON s.id = w.shift_id AND s.tenant_id = w.tenant_id
         LEFT JOIN hrm_schema.company_holidays h ON h.id = w.holiday_id AND h.tenant_id = w.tenant_id
        WHERE w.tenant_id = $1 AND w.employee_id = $2 AND w.work_date = $3::date AND w.status = 'ACTIVE'`,
      [tenantId, employeeId, date, timezone],
    );
    const row = scheduled.rows[0];
    if (row) {
      const dayType = row.day_type as ScheduleDayType;
      const holidayPaid = typeof row.holiday_paid === 'boolean' ? row.holiday_paid : null;
      if (dayType === 'OFF') return { picked: null, scheduleDayType: 'OFF' };
      if (row.id)
        return {
          picked: { source: 'SCHEDULE', row: row as ResolvedShiftRow, unitId: null, depth: null },
          scheduleDayType: dayType,
          holidayPaid,
        };
      // Ngày lễ không lưu ca thường lệ: lấy ca mà lịch định kỳ quy định cho ngày đó (nếu có),
      // để tính công trả lương ngày lễ theo số phút của ca như công thức hiện có.
      const underlying = dayType === 'HOLIDAY' ? await resolveRuleLayer(db, tenantId, employeeId, date, timezone) : null;
      return {
        picked: underlying?.dayType === 'SHIFT' ? underlying.picked : null,
        scheduleDayType: dayType,
        holidayPaid,
      };
    }
  }
  const rule = await resolveRuleLayer(db, tenantId, employeeId, date, timezone);
  if (rule?.dayType === 'OFF') return { picked: null, scheduleDayType: 'OFF' };
  if (rule?.dayType === 'SHIFT') return { picked: rule.picked, scheduleDayType: 'SHIFT' };
  return { picked: null, scheduleDayType: null };
}
