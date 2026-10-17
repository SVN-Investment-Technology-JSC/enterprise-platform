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

/** Số phút của một ngày công đầy đủ (ca hành chính 07:30-17:00 trừ nghỉ trưa 90 phút). */
export const STANDARD_DAY_MINUTES = 480;
/** Ca từ ngưỡng này trở lên (7 giờ) là ngày công đầy đủ; ca ngắn hơn là một phần ngày công. */
const FULL_DAY_MIN_MINUTES = 420;

/**
 * Sức chứa công của một ngày theo ca: ca đủ ngày là 1 công, ca ngắn tính theo tỷ lệ so với ngày công chuẩn
 * (ca sáng thứ Bảy 4 giờ là 0,5 công). Ngày không có ca là 0.
 */
export function dayCapacityUnits(scheduledMinutes: number): number {
  if (!(scheduledMinutes > 0)) return 0;
  if (scheduledMinutes >= FULL_DAY_MIN_MINUTES) return 1;
  return round2(scheduledMinutes / STANDARD_DAY_MINUTES);
}

/** Số công của một ngày: sức chứa công của ca nhân với tỷ lệ phút được trả lương trên phút theo ca (tối đa bằng sức chứa). */
export function dayWorkUnits(paidMinutes: number, scheduledMinutes: number): number {
  if (!(scheduledMinutes > 0)) return 0;
  return round2(dayCapacityUnits(scheduledMinutes) * Math.min(1, Math.max(0, paidMinutes) / scheduledMinutes));
}

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
  /** Tổng sức chứa công của các ngày có ca trong kỳ (ca đủ ngày là 1, ca nửa ngày là 0,5). */
  readonly scheduledUnits: number;
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

/**
 * Công chuẩn của một nhân viên trong kỳ lương theo cấu hình. Chế độ cố định và phút cũ quy đổi theo số phút trung bình
 * của một ngày công của chính nhân viên; chế độ động (không giữa kỳ) lấy tổng sức chứa công của các ngày có ca,
 * để ca nửa ngày (sáng T7) chỉ chiếm 0,5 công và khớp với số công của từng ngày.
 */
export function resolveStandardWork(setting: StandardWorkSetting, ctx: StandardWorkContext): StandardWorkResult {
  const day = averageDayMinutes(ctx);
  let minutes: number;
  if (setting.mode === 'MINUTES') minutes = setting.minutes ?? 0;
  else if (setting.mode === 'FIXED') minutes = Math.round((setting.workdays ?? 0) * day);
  else minutes = ctx.partialPeriod && ctx.periodStandardMinutes > 0 ? ctx.periodStandardMinutes : ctx.scheduledMinutes;
  const dynamicOwn = setting.mode === 'DYNAMIC' && !(ctx.partialPeriod && ctx.periodStandardMinutes > 0);
  return {
    mode: setting.mode,
    minutes,
    workdays: dynamicOwn ? round2(ctx.scheduledUnits) : day > 0 ? round2(minutes / day) : 0,
  };
}

/** Công chuẩn hiển thị trên bảng công của một nhân viên: cố định theo cấu hình, hoặc động theo tổng sức chứa công của các ngày có ca. */
export function boardStandardWorkdays(
  setting: StandardWorkSetting,
  scheduledUnits: number,
  dayMinutes = STANDARD_DAY_MINUTES,
): number {
  if (setting.mode === 'FIXED') return setting.workdays ?? 0;
  if (setting.mode === 'MINUTES') return round2((setting.minutes ?? 0) / dayMinutes);
  return round2(scheduledUnits);
}

export type MonthStandardMode = 'DYNAMIC' | 'FIXED';

export interface MonthStandardSetting {
  readonly mode: MonthStandardMode;
  readonly workdays: number | null;
}

/** Tháng chưa cấu hình: công chuẩn động theo lịch ca. */
export const DEFAULT_MONTH_STANDARD: MonthStandardSetting = { mode: 'DYNAMIC', workdays: null };

/** Đọc một dòng cấu hình công chuẩn tháng; dòng hỏng hoặc thiếu thì dùng công chuẩn động. */
export function monthStandardSetting(
  row: { mode?: unknown; workdays?: unknown } | null | undefined,
): MonthStandardSetting {
  const workdays = Number(row?.workdays);
  if (row?.mode === 'FIXED' && Number.isFinite(workdays) && workdays > 0)
    return { mode: 'FIXED', workdays: round2(workdays) };
  return DEFAULT_MONTH_STANDARD;
}

/** Kiểm tra cấu hình công chuẩn tháng do người dùng gửi; trả thông báo lỗi tiếng Việt hoặc null nếu hợp lệ. */
export function validateMonthStandard(input: { mode?: unknown; workdays?: unknown }): string | null {
  if (input.mode !== 'DYNAMIC' && input.mode !== 'FIXED') return 'Cách tính công chuẩn phải là động hoặc cố định';
  if (input.mode === 'DYNAMIC') {
    return input.workdays === undefined || input.workdays === null || input.workdays === ''
      ? null
      : 'Công chuẩn động không có số ngày công cố định';
  }
  const n = Number(input.workdays);
  if (!Number.isFinite(n) || n < 1 || n > MAX_STANDARD_WORKDAYS || Math.round(n * 2) !== n * 2)
    return `Công chuẩn cố định phải từ 1 đến ${MAX_STANDARD_WORKDAYS} ngày, bước 0,5`;
  return null;
}

/** Công chuẩn hiển thị trên bảng công của một nhân viên theo cấu hình của tháng. */
export function monthStandardWorkdays(setting: MonthStandardSetting, scheduledUnits: number): number {
  return setting.mode === 'FIXED' ? (setting.workdays ?? 0) : round2(scheduledUnits);
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Tháng bắt đầu áp dụng phải đúng dạng YYYY-MM và không nằm trong quá khứ (không viết lại lịch sử công chuẩn đã dùng). */
export function validateEffectiveMonth(month: unknown, currentMonth: string): string | null {
  if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) return 'Tháng áp dụng phải có dạng YYYY-MM';
  if (month < currentMonth) return 'Tháng áp dụng không được ở quá khứ; chính sách đã dùng được giữ nguyên làm lịch sử';
  return null;
}

/** Chính sách đang hiệu lực của một tháng: bản có tháng bắt đầu không sau tháng đó và mới nhất; chưa có thì null (động). */
export function policyForMonth<T extends { readonly effectiveMonth: string }>(
  policies: readonly T[],
  month: string,
): T | null {
  let best: T | null = null;
  for (const p of policies) if (p.effectiveMonth <= month && (!best || p.effectiveMonth > best.effectiveMonth)) best = p;
  return best;
}
