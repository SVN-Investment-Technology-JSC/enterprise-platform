/**
 * Hợp đồng trang `/birthday` của Mạng nội bộ: danh sách sinh nhật sắp tới nhóm theo tháng. Ngày sinh
 * thuộc HRM, đọc qua API nội bộ khi cần, không lưu vào `social_schema`. Năm sinh không đi qua hợp đồng
 * này; chỉ có `age` (tuổi sẽ tròn ở lần sinh nhật đó) khi HRM có năm sinh.
 */
import type { SocialBirthday } from './contracts-social-discovery.js';
import type { SocialUserRef } from './contracts-social.js';

export const SOCIAL_BIRTHDAY_PAGE_DEFAULT_MONTHS = 3;
export const SOCIAL_BIRTHDAY_PAGE_MAX_MONTHS = 12;
export const SOCIAL_BIRTHDAY_PAGE_QUERY_MAX = 100;

export interface SocialBirthdayEntry {
  /** Có `unitName` (đơn vị) và `position` khi Tenant Core có. */
  readonly user: SocialUserRef;
  readonly birthday: SocialBirthday;
  /** Ngày sinh nhật sắp tới, `YYYY-MM-DD` (theo múi giờ công ty). */
  readonly date: string;
  /** 0 là hôm nay. */
  readonly daysUntil: number;
  readonly isToday: boolean;
  /** Tuổi tròn ở lần sinh nhật này; thiếu khi HRM chưa có năm sinh. */
  readonly age?: number;
}

export interface SocialBirthdayMonthGroup {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** Theo ngày trong tháng rồi tên. */
  readonly items: readonly SocialBirthdayEntry[];
}

export interface SocialBirthdaysUpcomingQuery {
  /** 1-`SOCIAL_BIRTHDAY_PAGE_MAX_MONTHS`, tính từ tháng hiện tại; mặc định `SOCIAL_BIRTHDAY_PAGE_DEFAULT_MONTHS`. */
  readonly months?: number;
  /** Lọc theo tên hoặc đơn vị, không phân biệt hoa thường và dấu. */
  readonly q?: string;
}

export interface SocialBirthdaysUpcoming {
  /** Hôm nay, `YYYY-MM-DD`. */
  readonly today: string;
  /** Chỉ gồm tháng có người; theo thứ tự thời gian. */
  readonly groups: readonly SocialBirthdayMonthGroup[];
  readonly total: number;
}
