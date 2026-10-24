import {
  SOCIAL_BIRTHDAY_DEFAULT_DAYS,
  SOCIAL_BIRTHDAY_MAX_DAYS,
  SOCIAL_BIRTHDAY_PAGE_DEFAULT_MONTHS,
  SOCIAL_BIRTHDAY_PAGE_MAX_MONTHS,
  SOCIAL_BIRTHDAY_PAGE_QUERY_MAX,
  type SocialBirthdayEntry,
  type SocialBirthdayMonthGroup,
  type SocialBirthdays,
  type SocialBirthdaysQuery,
  type SocialBirthdaysUpcoming,
  type SocialBirthdaysUpcomingQuery,
} from '@enterprise-platform/contracts-social';
import {
  SOCIAL_COMPANY_TIME_ZONE,
  addDays,
  ageAtOccurrence,
  dayInTimeZone,
  daysUntilBirthday,
  endOfMonthWindow,
} from '../domain/social-birthday-rules.js';
import { foldSearchText } from '../domain/social-search-text.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { PeopleProfilePort } from './ports/people-profile.port.js';
import type { SocialActor } from './social-actor.js';

/** Sinh nhật hôm nay và vài ngày tới. Dữ liệu từ HRM qua `PeopleProfilePort`, không lưu lại. */
export class SocialBirthdayService {
  constructor(
    private readonly people: PeopleProfilePort,
    private readonly clock: () => Date = () => new Date(),
    private readonly timeZone: string = SOCIAL_COMPANY_TIME_ZONE,
  ) {}

  async birthdays(actor: SocialActor, query: SocialBirthdaysQuery = {}): Promise<SocialBirthdays> {
    const days = normalizeDays(query.days);
    const today = dayInTimeZone(this.clock(), this.timeZone);
    const found = await this.people.birthdays(actor.tenantId, { today, days });
    const inRange = found
      .filter((item) => item.daysUntil >= 0 && item.daysUntil <= days)
      .sort((left, right) => left.daysUntil - right.daysUntil || left.user.name.localeCompare(right.user.name, 'vi'));
    return {
      today: inRange.filter((item) => item.daysUntil === 0),
      upcoming: inRange.filter((item) => item.daysUntil > 0),
    };
  }

  /** Trang `/birthday`: từ hôm nay đến hết tháng thứ `months`, nhóm theo tháng, lọc tên/đơn vị bằng `q`. */
  async upcoming(actor: SocialActor, query: SocialBirthdaysUpcomingQuery = {}): Promise<SocialBirthdaysUpcoming> {
    const months = normalizeMonths(query.months);
    const needle = normalizeFilter(query.q);
    const today = dayInTimeZone(this.clock(), this.timeZone);
    const windowEnd = endOfMonthWindow(today, months);
    const people = await this.people.listBirthdayPeople(actor.tenantId);

    const entries: SocialBirthdayEntry[] = [];
    for (const person of people) {
      const daysUntil = daysUntilBirthday(today, person.birthday);
      const date = addDays(today, daysUntil);
      if (date > windowEnd) continue;
      if (needle && !foldSearchText(`${person.user.name} ${person.user.unitName ?? ''}`).includes(needle)) continue;
      const age = ageAtOccurrence(date, person.birthYear);
      entries.push({
        user: person.user,
        birthday: person.birthday,
        date,
        daysUntil,
        isToday: daysUntil === 0,
        ...(age !== undefined ? { age } : {}),
      });
    }
    entries.sort((left, right) => left.date.localeCompare(right.date) || left.user.name.localeCompare(right.user.name, 'vi'));

    const groups: SocialBirthdayMonthGroup[] = [];
    for (const entry of entries) {
      const year = Number(entry.date.slice(0, 4));
      const month = Number(entry.date.slice(5, 7));
      const last = groups[groups.length - 1];
      if (last && last.year === year && last.month === month) (last.items as SocialBirthdayEntry[]).push(entry);
      else groups.push({ year, month, items: [entry] });
    }
    return { today, groups, total: entries.length };
  }
}

function normalizeDays(value: unknown): number {
  if (value === undefined || value === null || value === '') return SOCIAL_BIRTHDAY_DEFAULT_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > SOCIAL_BIRTHDAY_MAX_DAYS) {
    throw new SocialValidationError(`Số ngày phải từ 1 đến ${SOCIAL_BIRTHDAY_MAX_DAYS}.`);
  }
  return days;
}

function normalizeMonths(value: unknown): number {
  if (value === undefined || value === null || value === '') return SOCIAL_BIRTHDAY_PAGE_DEFAULT_MONTHS;
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > SOCIAL_BIRTHDAY_PAGE_MAX_MONTHS) {
    throw new SocialValidationError(`Số tháng phải từ 1 đến ${SOCIAL_BIRTHDAY_PAGE_MAX_MONTHS}.`);
  }
  return months;
}

function normalizeFilter(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new SocialValidationError('Từ khoá lọc không hợp lệ.');
  const text = value.trim();
  if (text.length > SOCIAL_BIRTHDAY_PAGE_QUERY_MAX) {
    throw new SocialValidationError(`Từ khoá lọc tối đa ${SOCIAL_BIRTHDAY_PAGE_QUERY_MAX} ký tự.`);
  }
  return foldSearchText(text);
}
