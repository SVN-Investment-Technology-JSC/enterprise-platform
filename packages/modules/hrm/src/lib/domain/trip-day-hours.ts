/**
 * Giờ làm theo ngày của đơn công tác (hàm thuần). Người đi công tác khai các khung giờ làm việc thực tế trong một ngày,
 * có thể sang ngày hôm sau (ví dụ 18:00 đến 05:00). Hệ thống tách thành giờ trong ca (tối đa bằng ca của nhân viên trong
 * ngày) và giờ làm thêm (phần vượt ca; ngày không có ca thì toàn bộ là làm thêm). Nếu tenant bật tùy chọn khung giờ đêm thì
 * phần làm thêm nằm trong khung đêm được tách ra thành giờ đêm, không thì gộp chung vào làm thêm.
 */

export interface DayWindow {
  /** Giờ bắt đầu dạng HH:mm. */
  readonly from: string;
  /** Giờ kết thúc dạng HH:mm; không sau giờ bắt đầu nghĩa là sang ngày hôm sau. */
  readonly to: string;
}

/** Khoảng phút tính từ 00:00 của ngày làm việc; `end` có thể lớn hơn 1440 khi sang ngày hôm sau. */
export interface MinuteSpan {
  readonly start: number;
  readonly end: number;
}

export interface NightWindow {
  /** Phút bắt đầu khung đêm trong ngày, ví dụ 1320 là 22:00. */
  readonly startMinute: number;
  /** Phút kết thúc khung đêm của sáng hôm sau, ví dụ 360 là 06:00. */
  readonly endMinute: number;
}

export interface OtSegment extends MinuteSpan {
  readonly minutes: number;
  /** Số phút của đoạn nằm trong khung đêm (0 khi tenant không bật tách đêm). */
  readonly nightMinutes: number;
}

export interface TripDayClassification {
  readonly totalMinutes: number;
  readonly scheduledMinutes: number;
  readonly normalMinutes: number;
  readonly otMinutes: number;
  /** Số phút đêm trong phần làm thêm. */
  readonly nightMinutes: number;
  readonly otSegments: readonly OtSegment[];
}

const DAY = 1440;
/** Một khung giờ không dài quá 24 giờ và không kết thúc sau 36 giờ kể từ 00:00 của ngày làm việc. */
const MAX_END = DAY + 720;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClock(value: string): number | null {
  const m = TIME.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Đổi khung giờ khai sang khoảng phút; null nếu sai định dạng. */
export function spanOfWindow(window: DayWindow): MinuteSpan | null {
  const start = parseClock(window.from);
  const to = parseClock(window.to);
  if (start === null || to === null) return null;
  return { start, end: to > start ? to : to + DAY };
}

/** Kiểm tra danh sách khung giờ một ngày; trả thông báo lỗi tiếng Việt hoặc null nếu hợp lệ. */
export function validateWindows(windows: readonly DayWindow[]): string | null {
  if (windows.length > 6) return 'Một ngày chỉ khai tối đa 6 khung giờ';
  const spans: MinuteSpan[] = [];
  for (const w of windows) {
    const span = spanOfWindow(w);
    if (!span) return 'Khung giờ phải có dạng HH:mm';
    if (span.end - span.start > DAY) return 'Một khung giờ không dài quá 24 giờ';
    if (span.end > MAX_END) return 'Khung giờ không được kết thúc quá 12:00 của ngày hôm sau';
    spans.push(span);
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1)
    if (spans[i].start < spans[i - 1].end) return 'Các khung giờ trong một ngày không được chồng nhau';
  return null;
}

const overlap = (a: MinuteSpan, b: MinuteSpan) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Số phút của một khoảng nằm trong khung đêm (trải qua hai đêm quanh ngày làm việc: sáng sớm, tối và sáng hôm sau). */
export function nightMinutesOf(span: MinuteSpan, night: NightWindow): number {
  const intervals: MinuteSpan[] = [
    { start: 0, end: night.endMinute },
    { start: night.startMinute, end: DAY + night.endMinute },
    { start: DAY + night.startMinute, end: 2 * DAY },
  ];
  return intervals.reduce((sum, interval) => sum + overlap(span, interval), 0);
}

/**
 * Tách một ngày công tác. `scheduledMinutes` là số phút ca của nhân viên trong ngày (0 khi ngày không có ca). Các khung giờ
 * được tính theo thứ tự thời gian: số phút đầu tiên, tối đa bằng ca, là giờ trong ca; phần còn lại là làm thêm.
 */
export function classifyTripDay(input: {
  windows: readonly DayWindow[];
  scheduledMinutes: number;
  night?: NightWindow | null;
}): TripDayClassification {
  const spans = input.windows
    .map(spanOfWindow)
    .filter((s): s is MinuteSpan => s !== null)
    .sort((a, b) => a.start - b.start);
  const scheduled = Math.max(0, Math.floor(input.scheduledMinutes));
  let quota = scheduled;
  let total = 0;
  const raw: MinuteSpan[] = [];
  for (const span of spans) {
    const length = span.end - span.start;
    total += length;
    const normal = Math.min(quota, length);
    quota -= normal;
    if (length - normal > 0) raw.push({ start: span.start + normal, end: span.end });
  }
  // Ghép các đoạn làm thêm liền kề.
  const merged: MinuteSpan[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, seg.end) };
    else merged.push(seg);
  }
  const otSegments: OtSegment[] = merged.map((seg) => ({
    ...seg,
    minutes: seg.end - seg.start,
    nightMinutes: input.night ? nightMinutesOf(seg, input.night) : 0,
  }));
  const otMinutes = otSegments.reduce((s, x) => s + x.minutes, 0);
  return {
    totalMinutes: total,
    scheduledMinutes: scheduled,
    normalMinutes: total - otMinutes,
    otMinutes,
    nightMinutes: otSegments.reduce((s, x) => s + x.nightMinutes, 0),
    otSegments,
  };
}

/**
 * Sáng ngày hôm sau có làm không: đọc từ khung giờ khai của ngày kế tiếp (bắt đầu từ 12:00 trở đi nghĩa là sáng hôm đó
 * nghỉ). Ngày kế tiếp không khai thì coi là có làm theo ca. Dùng để hiển thị gợi ý, không ảnh hưởng cách tính.
 */
export function restsNextMorning(nextDayWindows: readonly DayWindow[] | null | undefined): boolean {
  if (!nextDayWindows || nextDayWindows.length === 0) return false;
  const first = nextDayWindows.map(spanOfWindow).filter((s): s is MinuteSpan => s !== null).sort((a, b) => a.start - b.start)[0];
  return Boolean(first && first.start >= 720);
}
