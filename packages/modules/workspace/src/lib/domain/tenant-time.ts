import { localDateKey, wallClockIn, zonedWallClockToUtc } from './recurrence.js';

/**
 * Múi giờ mặc định của tenant.
 *
 * Nền tảng **chưa có** thiết lập múi giờ cho từng tenant — không bảng nào
 * lưu nó, và access-decision cũng không trả về. Vì vậy mọi tenant tạm dùng
 * chung một múi giờ, đọc từ biến môi trường để triển khai ở vùng khác không
 * phải sửa mã. Khi nền tảng có thiết lập thật, chỉ cần đổi nguồn của
 * `timezoneOf` — phần còn lại không phải động tới.
 */
const FALLBACK_TIMEZONE = process.env.WORKSPACE_DEFAULT_TIMEZONE ?? 'Asia/Ho_Chi_Minh';

export function timezoneOf(_tenantId: string): string {
  return FALLBACK_TIMEZONE;
}

/** Khoảng `[từ, đến]` của một ngày, tính theo giờ địa phương rồi đổi về UTC. */
export interface DayWindow {
  readonly from: Date;
  readonly to: Date;
  /** `YYYY-MM-DD` theo giờ địa phương. */
  readonly dateKey: string;
}

/**
 * Cửa sổ một ngày theo múi giờ tenant.
 *
 * Dùng UTC ở đây là sai lệch 7 tiếng với người dùng Việt Nam: việc đến hạn
 * lúc 6 giờ sáng mai sẽ lọt vào "hôm nay" nếu cắt ngày theo UTC.
 */
export function dayWindow(instant: Date, timeZone: string, offsetDays = 0): DayWindow {
  const wall = wallClockIn(instant, timeZone);
  // Cộng ngày bằng `Date.UTC` để tháng và năm tự nhảy đúng ở đầu và cuối tháng.
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + offsetDays));

  const base = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };

  const from = zonedWallClockToUtc({ ...base, hour: 0, minute: 0, second: 0 }, timeZone);
  const to = zonedWallClockToUtc({ ...base, hour: 23, minute: 59, second: 59 }, timeZone);
  return { from, to, dateKey: localDateKey(from, timeZone) };
}

/** Ngày hôm nay theo giờ tenant, dạng `YYYY-MM-DD`. */
export function todayKey(timeZone: string, now: Date = new Date()): string {
  return localDateKey(now, timeZone);
}

/**
 * Cửa sổ tuần hiện tại, bắt đầu **thứ Hai**.
 *
 * Tuần làm việc ở Việt Nam bắt đầu thứ Hai; `getDay()` của JavaScript đánh số
 * Chủ nhật là 0, nên phải dịch lại.
 */
export function weekWindow(timeZone: string, now: Date = new Date()): DayWindow {
  const wall = wallClockIn(now, timeZone);
  const asUtc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  const weekdayFromMonday = (asUtc.getUTCDay() + 6) % 7;

  const monday = dayWindow(now, timeZone, -weekdayFromMonday);
  const sunday = dayWindow(now, timeZone, 6 - weekdayFromMonday);
  return { from: monday.from, to: sunday.to, dateKey: monday.dateKey };
}
