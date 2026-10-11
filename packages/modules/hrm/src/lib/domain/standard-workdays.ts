/**
 * Công chuẩn của kỳ (mẫu số tính lương theo công). Cấu hình trong chính sách lương, có hiệu lực theo ngày:
 *  - DYNAMIC: công chuẩn động, bằng số ngày công thực tế của tháng (trừ ngày nghỉ hằng tuần; ngày lễ hưởng lương vẫn tính theo lịch phân ca).
 *  - FIXED: công chuẩn cố định `standardWorkdays` ngày, tháng nhiều hay ít ngày nghỉ vẫn giữ nguyên.
 *  - MINUTES: định mức phút cũ (`standardMinutes`), chỉ còn ở phiên bản cấu hình đã lưu trước đây.
 * Một nguồn duy nhất cho bảng công (hiển thị công chuẩn) và bảng lương (STANDARD_PERIOD_MINUTES, STANDARD_WORKDAYS).
 */
export type StandardWorkMode = 'DYNAMIC' | 'FIXED' | 'MINUTES';

export interface StandardWorkSetting {
  readonly mode: StandardWorkMode;
  /** Số ngày công chuẩn cố định (chỉ với FIXED). */
  readonly workdays: number | null;
  /** Số phút chuẩn cố định (chỉ với MINUTES). */
  readonly minutes: number | null;
}

export const MAX_STANDARD_WORKDAYS = 31;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Đọc cấu hình công chuẩn từ config_json của chính sách lương; thiếu cấu hình thì công chuẩn động. */
export function standardWorkSetting(config: Record<string, unknown> | null | undefined): StandardWorkSetting {
  const mode = config?.standardWorkMode;
  const workdays = Number(config?.standardWorkdays);
  const minutes = Number(config?.standardMinutes);
  if (mode === 'FIXED' && Number.isFinite(workdays) && workdays > 0)
    return { mode: 'FIXED', workdays: round2(workdays), minutes: null };
  if (mode === 'DYNAMIC') return { mode: 'DYNAMIC', workdays: null, minutes: null };
  if (mode === undefined && Number.isInteger(minutes) && minutes > 0)
    return { mode: 'MINUTES', workdays: null, minutes };
  return { mode: 'DYNAMIC', workdays: null, minutes: null };
}

/** Kiểm tra cấu hình do người dùng gửi; trả thông báo lỗi tiếng Việt hoặc null nếu hợp lệ. */
export function validateStandardWork(input: {
  standardWorkMode?: unknown;
  standardWorkdays?: unknown;
  standardMinutes?: unknown;
}): string | null {
  const { standardWorkMode: mode, standardWorkdays: days, standardMinutes: minutes } = input;
  if (mode !== undefined && mode !== 'DYNAMIC' && mode !== 'FIXED' && mode !== 'MINUTES')
    return 'Chế độ công chuẩn không hợp lệ';
  if (mode === 'FIXED') {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1 || n > MAX_STANDARD_WORKDAYS || Math.round(n * 2) !== n * 2)
      return `Công chuẩn cố định phải từ 1 đến ${MAX_STANDARD_WORKDAYS} ngày, bước 0,5`;
  } else if (days !== undefined && days !== null && days !== '') {
    return 'Chỉ chế độ công chuẩn cố định mới có số ngày công chuẩn';
  }
  if (mode === 'MINUTES' || (mode === undefined && minutes !== undefined)) {
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < 1 || n > 90720) return 'Định mức phút của kỳ phải từ 1 đến 90720';
  } else if (minutes !== undefined && minutes !== null && minutes !== '') {
    return 'Định mức phút chỉ dùng cho chế độ phút cố định';
  }
  return null;
}

export interface StandardWorkContext {
  /** Tổng phút theo lịch của nhân viên trong kỳ và số ngày có lịch làm việc. */
  readonly scheduledMinutes: number;
  readonly scheduledDays: number;
  /** Nhân viên vào hoặc nghỉ việc giữa kỳ: công chuẩn động lấy theo công chuẩn của kỳ (không lấy công của chính họ). */
  readonly partialPeriod: boolean;
  /** Tổng phút theo lịch lớn nhất trong các nhân viên của kỳ. */
  readonly periodStandardMinutes: number;
}

export interface StandardWorkResult {
  readonly mode: StandardWorkMode;
  /** Mẫu số phút của kỳ (STANDARD_PERIOD_MINUTES). */
  readonly minutes: number;
  /** Công chuẩn tính theo ngày công (STANDARD_WORKDAYS). */
  readonly workdays: number;
}

/** Số phút trung bình của một ngày công của nhân viên (ca 8 giờ trừ nghỉ trưa thường là 480). */
export function averageDayMinutes(ctx: Pick<StandardWorkContext, 'scheduledMinutes' | 'scheduledDays'>): number {
  return ctx.scheduledDays > 0 ? ctx.scheduledMinutes / ctx.scheduledDays : 0;
}

/** Công chuẩn của một nhân viên trong kỳ lương theo cấu hình. */
export function resolveStandardWork(setting: StandardWorkSetting, ctx: StandardWorkContext): StandardWorkResult {
  const day = averageDayMinutes(ctx);
  let minutes: number;
  if (setting.mode === 'MINUTES') minutes = setting.minutes ?? 0;
  else if (setting.mode === 'FIXED') minutes = Math.round((setting.workdays ?? 0) * day);
  else minutes = ctx.partialPeriod && ctx.periodStandardMinutes > 0 ? ctx.periodStandardMinutes : ctx.scheduledMinutes;
  return { mode: setting.mode, minutes, workdays: day > 0 ? round2(minutes / day) : 0 };
}

/** Công chuẩn hiển thị trên bảng công của một nhân viên: cố định theo cấu hình, hoặc động theo số ngày có lịch trong tháng. */
export function boardStandardWorkdays(
  setting: StandardWorkSetting,
  scheduledDays: number,
  dayMinutes = 480,
): number {
  if (setting.mode === 'FIXED') return setting.workdays ?? 0;
  if (setting.mode === 'MINUTES') return round2((setting.minutes ?? 0) / dayMinutes);
  return scheduledDays;
}
