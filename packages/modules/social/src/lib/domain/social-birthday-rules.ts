import type { SocialBirthday } from '@enterprise-platform/contracts-social';

/** Múi giờ của công ty, dùng để biết "hôm nay" khi tính sinh nhật. */
export const SOCIAL_COMPANY_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const DAY_MS = 86_400_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Ngày `YYYY-MM-DD` của một thời điểm theo múi giờ cho trước. */
export function dayInTimeZone(now: Date, timeZone: string = SOCIAL_COMPANY_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function parseDay(day: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new RangeError(`Ngày không hợp lệ: ${day}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isValidBirthday(birthday: SocialBirthday): boolean {
  if (!Number.isInteger(birthday.month) || !Number.isInteger(birthday.day)) return false;
  if (birthday.month < 1 || birthday.month > 12 || birthday.day < 1) return false;
  // Năm nhuận để chấp nhận 29/2.
  const daysInMonth = new Date(Date.UTC(2024, birthday.month, 0)).getUTCDate();
  return birthday.day <= daysInMonth;
}

/**
 * Số ngày từ `today` (`YYYY-MM-DD`) tới lần sinh nhật kế tiếp; 0 là hôm nay. Sinh 29/2 tính vào 28/2 ở
 * năm không nhuận.
 */
export function daysUntilBirthday(today: string, birthday: SocialBirthday): number {
  const base = parseDay(today);
  const baseMs = Date.UTC(base.year, base.month - 1, base.day);
  const occurrence = (year: number): number => {
    const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? 28 : birthday.day;
    return Date.UTC(year, birthday.month - 1, day);
  };
  let target = occurrence(base.year);
  if (target < baseMs) target = occurrence(base.year + 1);
  return Math.round((target - baseMs) / DAY_MS);
}

/** Cộng `count` ngày vào ngày `YYYY-MM-DD`. */
export function addDays(day: string, count: number): string {
  const base = parseDay(day);
  const result = new Date(Date.UTC(base.year, base.month - 1, base.day + count));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

/** Ngày cuối của tháng thứ `months` tính từ tháng của `today` (tháng hiện tại là 1). */
export function endOfMonthWindow(today: string, months: number): string {
  const base = parseDay(today);
  const end = new Date(Date.UTC(base.year, base.month - 1 + months, 0));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
}

/** Tuổi tròn ở lần sinh nhật rơi vào `occurrenceDate`; `undefined` khi không có năm sinh hợp lý. */
export function ageAtOccurrence(occurrenceDate: string, birthYear: number | undefined): number | undefined {
  if (!birthYear) return undefined;
  const age = parseDay(occurrenceDate).year - birthYear;
  return age >= 0 && age <= 120 ? age : undefined;
}
