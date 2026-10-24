/**
 * Logic thuần của trang `/birthday` và widget sinh nhật (không dùng React, dễ kiểm thử).
 */
import type {
  SocialBirthdayEntry,
  SocialBirthdayMonthGroup,
  SocialBirthdaysUpcoming,
} from '@enterprise-platform/contracts-social';


/** Nhãn nhóm tháng: `Tháng 10`; khác năm hiện tại thì thêm năm (`Tháng 1/2027`). */
export function monthGroupLabel(group: Pick<SocialBirthdayMonthGroup, 'month' | 'year'>, todayIso: string): string {
  const currentYear = Number(todayIso.slice(0, 4));
  return group.year === currentYear || !Number.isFinite(currentYear)
    ? `Tháng ${group.month}`
    : `Tháng ${group.month}/${group.year}`;
}

/** Ngày sinh nhật `YYYY-MM-DD` thành `dd/MM`; sai định dạng thì rỗng. */
export function entryDayMonth(entry: Pick<SocialBirthdayEntry, 'date'>): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(entry.date);
  return match ? `${match[2]}/${match[1]}` : '';
}

/** Chỉ có khi API trả `age` hợp lệ. */
export function ageLabel(entry: Pick<SocialBirthdayEntry, 'age'>): string | undefined {
  return typeof entry.age === 'number' && entry.age > 0 ? `${entry.age} tuổi` : undefined;
}

export function whenLabel(entry: Pick<SocialBirthdayEntry, 'daysUntil' | 'isToday'>): string {
  if (entry.isToday || entry.daysUntil <= 0) return 'Hôm nay';
  if (entry.daysUntil === 1) return 'Ngày mai';
  return `Còn ${entry.daysUntil} ngày`;
}

export function flattenEntries(data: Pick<SocialBirthdaysUpcoming, 'groups'>): readonly SocialBirthdayEntry[] {
  return data.groups.flatMap((group) => group.items);
}

/** Người sinh nhật hôm nay; còn lại là những người sắp tới (tối đa `limit`), theo thứ tự thời gian. */
export function splitForWidget(
  data: Pick<SocialBirthdaysUpcoming, 'groups'>,
  limit = 6,
): { readonly today: readonly SocialBirthdayEntry[]; readonly next: readonly SocialBirthdayEntry[]; readonly more: number } {
  const all = flattenEntries(data);
  const today = all.filter((entry) => entry.isToday);
  const rest = all.filter((entry) => !entry.isToday);
  return { today, next: rest.slice(0, limit), more: Math.max(0, rest.length - limit) };
}

export function entrySubtitle(entry: Pick<SocialBirthdayEntry, 'user'>): string {
  return entry.user.unitName ?? '';
}

