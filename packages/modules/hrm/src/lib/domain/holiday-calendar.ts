import {
  HOLIDAY_TEMPLATE_BY_YEAR,
  HOLIDAY_TEMPLATE_FIXED,
  HOLIDAY_TEMPLATE_MANUAL,
} from './holiday-templates.js';

export interface HolidayDraftItem {
  /** null: HR phai nhap ngay truoc khi luu. */
  date: string | null;
  name: string;
  paid: boolean;
  note: string;
  exists: boolean;
}

function validYear(year: number) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

export function buildHolidayDraft(
  year: number,
  existingDates: Iterable<string>,
): HolidayDraftItem[] {
  if (!validYear(year)) throw new RangeError('Năm không hợp lệ');
  const existing = new Set(existingDates);
  const known = HOLIDAY_TEMPLATE_BY_YEAR[year] ?? [];
  const items: Omit<HolidayDraftItem, 'exists'>[] = [
    ...HOLIDAY_TEMPLATE_FIXED.map((i) => ({
      date: `${year}-${i.monthDay}`,
      name: i.name,
      paid: i.paid,
      note: i.note,
    })),
    ...known.map((i) => ({ ...i })),
    // Manual items disappear once the year config already lists a date for them.
    ...HOLIDAY_TEMPLATE_MANUAL.filter(
      (m) => !known.some((k) => k.name === m.name),
    ).map((i) => ({ date: null, name: i.name, paid: i.paid, note: i.note })),
  ];
  return items.map((i) => ({ ...i, exists: !!i.date && existing.has(i.date) }));
}

const FIXED_MD = new Set(HOLIDAY_TEMPLATE_FIXED.map((i) => i.monthDay));

/** Clone HOLIDAY rows of the previous year: fixed solar dates shift, the rest need manual dates. */
export function cloneHolidayYear(
  previous: { date: string; name: string; paid: boolean }[],
  toYear: number,
  existingDates: Iterable<string>,
): HolidayDraftItem[] {
  if (!validYear(toYear)) throw new RangeError('Năm không hợp lệ');
  const existing = new Set(existingDates);
  return previous.map((row) => {
    const monthDay = row.date.slice(5, 10);
    const date = FIXED_MD.has(monthDay) ? `${toYear}-${monthDay}` : null;
    return {
      date,
      name: row.name,
      paid: row.paid,
      note: date
        ? 'Nhân bản từ năm trước (ngày dương lịch cố định)'
        : 'Nhân bản từ năm trước - nhập lại ngày theo thông báo (âm lịch)',
      exists: !!date && existing.has(date),
    };
  });
}

/** Only items with a date that is in the year and not already on the calendar get saved. */
export function selectHolidaysToSave(
  items: { date: string | null; name: string; paid: boolean }[],
  year: number,
  existingDates: Iterable<string>,
) {
  const existing = new Set(existingDates);
  const seen = new Set<string>();
  const toSave: { date: string; name: string; paid: boolean }[] = [];
  const skipped: { date: string | null; name: string; reason: string }[] = [];
  for (const i of items) {
    if (!i.date || !i.date.startsWith(`${year}-`))
      skipped.push({ ...i, reason: 'Thiếu ngày hoặc ngoài năm đã chọn' });
    else if (existing.has(i.date) || seen.has(i.date))
      skipped.push({ ...i, reason: 'Ngày đã có trong lịch; không ghi đè' });
    else {
      seen.add(i.date);
      toSave.push({ date: i.date, name: i.name, paid: i.paid });
    }
  }
  return { toSave, skipped };
}
