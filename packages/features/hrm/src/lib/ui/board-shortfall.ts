import type { HrmBoardDay, HrmBoardEmployee } from '@enterprise-platform/contracts-hrm';

const MISSING_PUNCH = ['MISSING_CHECK_IN', 'MISSING_CHECK_OUT'];
/** Số phút trong một giờ. */
const MINUTES_PER_HOUR = 60;

/** Sức chứa công của ngày theo ca: ca đủ ngày (từ 7 giờ) là 1, ca ngắn tính theo ngày công 480 phút (ca sáng T7 là 0.5). Khớp với máy chủ. */
export function dayCapacity(day: Pick<HrmBoardDay, 'scheduledMinutes'>): number {
  const m = Number(day.scheduledMinutes ?? 0);
  if (!(m > 0)) return 1;
  return m >= 420 ? 1 : Math.round((m / 480) * 100) / 100;
}

/**
 * Công thiếu của một ngày do đi trễ, về sớm hoặc làm chưa đủ ca: sức chứa của ngày trừ số công thực tế. Chỉ tính ngày có
 * công và không có đơn nghỉ nửa ngày; quên chấm công, vắng, nghỉ, lễ, công tác không tính vào đây.
 */
export function dayShortfall(day: HrmBoardDay): number {
  if (day.status === 'ABSENT' || day.status === 'OFF' || day.status === 'HOLIDAY' || day.status === 'TRIP') return 0;
  if (day.leave && day.leave.days > 0) return 0;
  if (day.anomalies.some((a) => MISSING_PUNCH.includes(a))) return 0;
  const units = Math.round(Number(day.workdayUnits ?? 0) * 100) / 100;
  if (!(units > 0)) return 0;
  const lateOrEarly = day.lateMinutes > 0 || day.earlyLeaveMinutes > 0;
  const missing = dayCapacity(day) - units;
  if (!lateOrEarly && missing <= 0.005) return 0;
  return Math.max(0, Math.round(missing * 100) / 100);
}

/** Tổng công thiếu (đi trễ, về sớm) của một nhân viên trong tháng. */
export function employeeShortfall(employee: Pick<HrmBoardEmployee, 'days'>): number {
  const total = Object.values(employee.days).reduce((sum, d) => sum + dayShortfall(d), 0);
  return Math.round(total * 100) / 100;
}

/** Tổng công chưa trừ công thiếu: công thực tế cộng phần thiếu do đi trễ, về sớm. */
export function employeeGrossUnits(employee: Pick<HrmBoardEmployee, 'days' | 'totals'>): number {
  return Math.round((Number(employee.totals.workdayUnits ?? 0) + employeeShortfall(employee)) * 100) / 100;
}

/** Số giờ tăng ca dạng thập phân: 30 phút là 0.5, 90 phút là 1.5. */
export function otCoefficient(minutes: number | null | undefined): number {
  return Math.round((Number(minutes ?? 0) / MINUTES_PER_HOUR) * 100) / 100;
}
