import type { PoolClient } from 'pg';
import {
  effectiveDayKind,
  resolvePolicy,
  shiftForDate,
} from './hrm-time.js';

/** Một ngày công đầy đủ (8 giờ) làm mốc quy đổi ca ngắn (ví dụ thứ Bảy nửa ngày) ra ngày phép. */
export const FULL_DAY_MINUTES = 480;

/**
 * Trọng số ngày phép của một ngày làm việc: ca ngắn hơn ngày công chuẩn được quy
 * về bội số 0.5 gần nhất (ca 4h = 0.5), tối đa 1 ngày.
 */
export function leaveDayWeight(shiftMinutes: number): number {
  if (!Number.isFinite(shiftMinutes) || shiftMinutes <= 0) return 0;
  const half = Math.round((shiftMinutes / FULL_DAY_MINUTES) * 2) / 2;
  return Math.min(1, Math.max(0.5, half));
}

export function localMinutesOfDay(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export interface LeaveDayPreview {
  date: string;
  /** WORK: ngày làm việc; OFF/HOLIDAY: không tính phép; NO_SHIFT: chưa phân ca. */
  kind: 'WORK' | 'OFF' | 'HOLIDAY' | 'NO_SHIFT';
  weight: number;
  shiftMinutes: number;
  startMinutes: number | null;
  endMinutes: number | null;
  breakStartMinutes: number | null;
  breakEndMinutes: number | null;
}

/** Liệt kê từng ngày trong khoảng nghỉ với ca làm việc thực tế của nhân viên (không ném lỗi khi thiếu ca). */
export async function previewLeaveDays(
  db: PoolClient,
  tenant: string,
  employeeId: string,
  fromDate: string,
  toDate: string,
): Promise<LeaveDayPreview[]> {
  const dates = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date,c.day_kind FROM generate_series($2::date,$3::date,'1 day') d LEFT JOIN hrm_schema.work_calendar c ON c.tenant_id=$1 AND c.work_date=d::date`,
    [tenant, fromDate, toDate],
  );
  const out: LeaveDayPreview[] = [];
  for (const day of dates.rows) {
    const policy = await resolvePolicy(
      db,
      tenant,
      'ATTENDANCE',
      day.date,
      employeeId,
    );
    const base = {
      date: day.date as string,
      weight: 0,
      shiftMinutes: 0,
      startMinutes: null,
      endMinutes: null,
      breakStartMinutes: null,
      breakEndMinutes: null,
    };
    const kind = effectiveDayKind(day.date, day.day_kind, policy?.config_json);
    if (kind === 'OFF' || kind === 'HOLIDAY') {
      out.push({ ...base, kind });
      continue;
    }
    const timeZone = String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh');
    const shift = await shiftForDate(db, tenant, employeeId, day.date, timeZone);
    if (!shift) {
      out.push({ ...base, kind: 'NO_SHIFT' });
      continue;
    }
    const w = shift.window;
    const shiftMinutes =
      (Date.parse(w.end) - Date.parse(w.start)) / 60000 - w.breakMinutes;
    out.push({
      date: day.date,
      kind: 'WORK',
      weight: leaveDayWeight(shiftMinutes),
      shiftMinutes,
      startMinutes: localMinutesOfDay(w.start, timeZone),
      endMinutes: localMinutesOfDay(w.end, timeZone),
      breakStartMinutes: w.breakStart
        ? localMinutesOfDay(w.breakStart, timeZone)
        : null,
      breakEndMinutes: w.breakEnd ? localMinutesOfDay(w.breakEnd, timeZone) : null,
    });
  }
  return out;
}
