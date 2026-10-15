import type {
  HrmBoardEmployee,
  HrmBoardFlag,
  HrmBoardFlagCounts,
} from '@enterprise-platform/contracts-hrm';

export const BOARD_FLAGS: readonly HrmBoardFlag[] = ['LATE_EARLY', 'ABNORMAL', 'ABSENT', 'PENDING'];

/** Bộ lọc nhanh hợp lệ; rỗng hoặc 'ALL' là không lọc. Giá trị lạ báo lỗi thay vì bị bỏ qua âm thầm. */
export function parseBoardFlag(raw: string | undefined | null): HrmBoardFlag | null {
  const value = raw?.trim().toUpperCase();
  if (!value || value === 'ALL') return null;
  if ((BOARD_FLAGS as readonly string[]).includes(value)) return value as HrmBoardFlag;
  throw new RangeError(`flag không hợp lệ: ${raw}`);
}

/**
 * Các cờ của một nhân viên trong tháng. Cùng quy ước với nút lọc nhanh ở bảng công:
 * trễ/sớm theo phút của từng ngày, bất thường và vắng theo tổng tháng, chờ duyệt theo đơn từ gắn vào ngày.
 */
export function boardFlagsOf(employee: HrmBoardEmployee): Set<HrmBoardFlag> {
  const flags = new Set<HrmBoardFlag>();
  const days = Object.values(employee.days);
  if (days.some((d) => d.lateMinutes > 0 || d.earlyLeaveMinutes > 0)) flags.add('LATE_EARLY');
  if (employee.totals.abnormalDays > 0) flags.add('ABNORMAL');
  if (employee.totals.absentDays > 0) flags.add('ABSENT');
  if (days.some((d) => d.requests?.some((r) => r.status === 'PENDING'))) flags.add('PENDING');
  return flags;
}

export function emptyFlagCounts(total = 0): HrmBoardFlagCounts {
  return { ALL: total, LATE_EARLY: 0, ABNORMAL: 0, ABSENT: 0, PENDING: 0 };
}
