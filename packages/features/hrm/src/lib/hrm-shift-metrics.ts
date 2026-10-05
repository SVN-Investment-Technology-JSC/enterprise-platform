export interface ShiftAssignmentLike {
  readonly employeeId: string;
  readonly status?: string | null;
  readonly effectiveFrom?: string | null;
  readonly effectiveTo?: string | null;
}

export interface ShiftTimeLike {
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly breakMinutes?: number | null;
  readonly crossMidnight?: boolean | null;
}

function toMinutes(value?: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Công chuẩn (giờ) của một ca = (giờ kết thúc - giờ bắt đầu [+24h nếu qua đêm] - phút nghỉ) / 60,
 * làm tròn 2 chữ số, không âm. Trả về null nếu thiếu giờ bắt đầu/kết thúc.
 */
export function computeShiftStandardHours(shift: ShiftTimeLike): number | null {
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);
  if (start === null || end === null) return null;
  let span = end - start;
  if (shift.crossMidnight || span < 0) span += 24 * 60;
  const net = Math.max(0, span - Math.max(0, shift.breakMinutes ?? 0));
  return Math.round((net / 60) * 100) / 100;
}

export interface ShiftCoverage {
  readonly assignedEmployees: number;
  readonly totalEmployees: number;
  readonly coveragePercent: number;
}

/**
 * Đếm DISTINCT employeeId đang có phân ca hiệu lực tại `today` (YYYY-MM-DD).
 * Nếu truyền danh sách nhân viên, chỉ tính nhân viên thuộc danh sách đó nên độ phủ không vượt 100%.
 */
export function computeShiftCoverage(
  assignments: readonly ShiftAssignmentLike[],
  employeeIds: readonly string[],
  today: string,
): ShiftCoverage {
  const known = new Set(employeeIds);
  const assigned = new Set<string>();
  for (const a of assignments) {
    if (a.status && a.status !== 'ACTIVE') continue;
    if (a.effectiveFrom && a.effectiveFrom.slice(0, 10) > today) continue;
    if (a.effectiveTo && a.effectiveTo.slice(0, 10) < today) continue;
    if (known.size > 0 && !known.has(a.employeeId)) continue;
    assigned.add(a.employeeId);
  }
  const total = known.size;
  const percent = total > 0 ? Math.min(100, Math.round((assigned.size / total) * 100)) : 0;
  return { assignedEmployees: assigned.size, totalEmployees: total, coveragePercent: percent };
}

export function shiftStatusLabel(status?: string | null): string {
  return status === 'ACTIVE' ? 'Đang dùng' : status === 'INACTIVE' ? 'Tạm dừng' : (status ?? '');
}
