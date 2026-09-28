import { WorkspaceValidationError } from './workspace.error.js';

/**
 * Tập con RRULE được hỗ trợ ở phiên bản này.
 *
 * Cột trong CSDL đã đúng chuẩn RFC 5545, nên thay bằng thư viện RRULE đầy đủ
 * về sau sẽ không phải migrate dữ liệu.
 */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RecurrenceRule {
  readonly freq: Frequency;
  /** Mặc định 1. Ví dụ `INTERVAL=2` với `WEEKLY` là hai tuần một lần. */
  readonly interval: number;
  readonly until?: Date;
  readonly count?: number;
}

/** Một lần xuất hiện đã khai triển. */
export interface Occurrence {
  /** Ngày theo giờ địa phương của sự kiện, dạng `YYYY-MM-DD`. Khoá của ngoại lệ. */
  readonly occurrenceDate: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** Chặn trần tuyệt đối để một quy tắc sai không sinh vòng lặp vô tận. */
const MAX_OCCURRENCES = 366;

/* =========================================================================
   MÚI GIỜ

   Không có thư viện ngày tháng trong repo, nên dùng `Intl.DateTimeFormat`
   với `timeZone` — API chuẩn của nền tảng, có sẵn dữ liệu IANA.
   ========================================================================= */

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new WorkspaceValidationError(`Múi giờ "${timeZone}" không hợp lệ.`);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Giờ treo tường của một mốc UTC, nhìn từ một múi giờ. */
export function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function asUtcMillis(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Độ lệch của múi giờ tại một thời điểm, tính bằng phút. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  return (asUtcMillis(wallClockIn(instant, timeZone)) - instant.getTime()) / 60000;
}

/**
 * Giờ treo tường trong một múi giờ → mốc UTC.
 *
 * Độ lệch múi giờ phụ thuộc chính thời điểm cần tìm, nên phải giải hai vòng:
 * đoán bằng độ lệch tại mốc ước lượng, rồi hiệu chỉnh lại bằng độ lệch tại
 * kết quả. Vòng thứ hai là thứ giữ cho giờ không trôi khi chuỗi lặp đi qua
 * mốc đổi giờ mùa.
 */
export function zonedWallClockToUtc(wall: WallClock, timeZone: string): Date {
  const guessMillis = asUtcMillis(wall);
  const firstOffset = offsetMinutesAt(new Date(guessMillis), timeZone);
  const firstTry = new Date(guessMillis - firstOffset * 60000);
  const secondOffset = offsetMinutesAt(firstTry, timeZone);
  if (secondOffset === firstOffset) return firstTry;
  return new Date(guessMillis - secondOffset * 60000);
}

/** `2026-09-21` theo giờ địa phương của sự kiện. */
export function localDateKey(instant: Date, timeZone: string): string {
  const wall = wallClockIn(instant, timeZone);
  return [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');
}

/* =========================================================================
   PHÂN TÍCH RRULE
   ========================================================================= */

/**
 * Đọc chuỗi RRULE.
 *
 * Trả về `undefined` khi chuỗi rỗng — sự kiện đơn lẻ. Chuỗi có nội dung mà
 * sai cú pháp thì ném lỗi: im lặng coi như đơn lẻ sẽ khiến người dùng tưởng
 * đã đặt lịch lặp trong khi không có.
 */
/**
 * `externalStop`: sự kiện đã có điểm dừng ở cột `recurrence_until` /
 * `recurrence_count`. Khi đó chuỗi RRULE không cần tự chứa UNTIL hay COUNT —
 * tách "từ buổi này trở đi" ghi điểm dừng vào cột, không vào chuỗi.
 */
export function parseRecurrenceRule(
  raw?: string | null,
  externalStop = false,
): RecurrenceRule | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  const parts = new Map<string, string>();
  for (const chunk of text.replace(/^RRULE:/i, '').split(';')) {
    if (!chunk.trim()) continue;
    const [key, value] = chunk.split('=');
    if (!key || value === undefined) {
      throw new WorkspaceValidationError(`Quy tắc lặp sai cú pháp tại "${chunk}".`);
    }
    parts.set(key.trim().toUpperCase(), value.trim());
  }

  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
    throw new WorkspaceValidationError(
      'Chỉ hỗ trợ FREQ=DAILY, WEEKLY hoặc MONTHLY ở phiên bản này.',
    );
  }

  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new WorkspaceValidationError('INTERVAL phải là số nguyên từ 1 đến 365.');
  }

  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES)) {
    throw new WorkspaceValidationError(`COUNT phải là số nguyên từ 1 đến ${MAX_OCCURRENCES}.`);
  }

  const until = parts.has('UNTIL') ? parseUntil(parts.get('UNTIL') as string) : undefined;

  // Chuỗi vô hạn khiến mọi truy vấn phải tự nghĩ ra điểm dừng, và một sự kiện
  // đặt phòng vô hạn thì không ai giải phóng được phòng đó.
  if (!until && count === undefined && !externalStop) {
    throw new WorkspaceValidationError('Quy tắc lặp phải có điểm dừng: UNTIL hoặc COUNT.');
  }

  return { freq, interval, until, count };
}

/**
 * Bỏ UNTIL và COUNT khỏi chuỗi RRULE, giữ FREQ, INTERVAL và phần còn lại.
 *
 * Dùng khi điểm dừng được chuyển sang cột: để nguyên COUNT trong chuỗi thì
 * chuỗi mới tách ra sẽ đếm lại từ đầu và sinh thừa buổi.
 */
export function withoutStop(raw: string): string {
  return raw
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((chunk) => {
      const key = chunk.split('=')[0]?.trim().toUpperCase();
      return chunk.trim() && key !== 'COUNT' && key !== 'UNTIL';
    })
    .join(';');
}

/** Điểm dừng chặt hơn giữa chuỗi RRULE và cột — cái nào đến trước thì thắng. */
export function effectiveStop(
  rule: RecurrenceRule,
  columnUntil?: Date | null,
  columnCount?: number | null,
): { until?: Date; count?: number } {
  const untils = [rule.until, columnUntil ?? undefined].filter(Boolean) as Date[];
  const counts = [rule.count, columnCount ?? undefined].filter(
    (value): value is number => value !== undefined && value !== null,
  );
  return {
    until: untils.length ? new Date(Math.min(...untils.map((d) => d.getTime()))) : undefined,
    count: counts.length ? Math.min(...counts) : undefined,
  };
}

/** `20261231T235959Z` hoặc `2026-12-31`. */
function parseUntil(value: string): Date {
  const compact = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (compact) {
    const [, y, m, d, hh, mm, ss] = compact;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh ?? 23), Number(mm ?? 59), Number(ss ?? 59)),
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new WorkspaceValidationError(`UNTIL "${value}" không đọc được.`);
  }
  return parsed;
}

/* =========================================================================
   KHAI TRIỂN
   ========================================================================= */

export interface ExpandInput {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly timezone: string;
  readonly rule?: RecurrenceRule;
  /** Điểm dừng lấy từ cột riêng, dùng khi RRULE không tự mang UNTIL. */
  readonly until?: Date | null;
  readonly count?: number | null;
}

/**
 * Sinh các lần xuất hiện rơi vào khoảng `[from, to]`.
 *
 * Mỗi lần xuất hiện giữ nguyên **giờ treo tường** của lần đầu: cộng theo ngày
 * lịch rồi đổi ngược về UTC, chứ không cộng thẳng 7×24 giờ. Nhờ vậy một cuộc
 * họp 9:00 hằng tuần vẫn là 9:00 giờ địa phương sau khi vùng đó đổi giờ mùa.
 *
 * Độ dài buổi giữ nguyên theo số mili giây. Một buổi 9:00–10:00 vắt qua mốc
 * đổi giờ sẽ kết thúc lúc 11:00 hoặc 9:00 giờ địa phương — chấp nhận được, và
 * quan trọng hơn là độ dài không tự dãn ra thêm một tiếng.
 */
export function expandOccurrences(input: ExpandInput, from: Date, to: Date): Occurrence[] {
  const durationMs = Math.max(input.endAt.getTime() - input.startAt.getTime(), 0);
  const single = (start: Date): Occurrence => ({
    occurrenceDate: localDateKey(start, input.timezone),
    startAt: start,
    endAt: new Date(start.getTime() + durationMs),
  });

  if (!input.rule) {
    // Sự kiện đơn lẻ vẫn phải qua bộ lọc khoảng, để nơi gọi không cần biết có
    // lặp hay không.
    return overlaps(input.startAt, new Date(input.startAt.getTime() + durationMs), from, to)
      ? [single(input.startAt)]
      : [];
  }

  // Lấy điểm dừng CHẶT HƠN giữa chuỗi và cột. Ưu tiên một bên (`??`) thì một
  // chuỗi đã bị cắt bằng cột vẫn chạy tiếp tới COUNT cũ ghi trong chuỗi.
  const { until: limitUntil, count: limitCount } = effectiveStop(
    input.rule,
    input.until,
    input.count,
  );
  const maxCount = Math.min(limitCount ?? MAX_OCCURRENCES, MAX_OCCURRENCES);

  const anchor = wallClockIn(input.startAt, input.timezone);
  const results: Occurrence[] = [];

  // Hai bộ đếm tách rời: `step` là số bước đã thử, `produced` là số lần xuất
  // hiện thật. RFC 5545 tính COUNT theo lần xuất hiện, nên một tháng bị bỏ
  // qua KHÔNG được ăn mất một suất của COUNT. Trần trên `step` chỉ để một
  // quy tắc lạ không quay vòng vô tận.
  const maxSteps = MAX_OCCURRENCES * 2;
  let produced = 0;

  for (let step = 0; step < maxSteps && produced < maxCount; step += 1) {
    const wall = shiftWallClock(anchor, input.rule.freq, input.rule.interval * step);
    // MONTHLY ngày 31 rơi vào tháng ngắn thì RFC 5545 bỏ qua lần đó, không
    // dồn sang ngày 1 tháng sau.
    if (!wall) continue;

    const start = zonedWallClockToUtc(wall, input.timezone);
    if (limitUntil && start.getTime() > limitUntil.getTime()) break;
    produced += 1;
    // Đã vượt quá cuối khoảng tra cứu thì mọi lần sau cũng vậy.
    if (start.getTime() > to.getTime()) break;

    const end = new Date(start.getTime() + durationMs);
    if (overlaps(start, end, from, to)) results.push(single(start));
  }

  return results;
}

/** Dịch giờ treo tường đi `steps` bước theo tần suất, giữ nguyên giờ trong ngày. */
function shiftWallClock(
  anchor: WallClock,
  freq: Frequency,
  steps: number,
): WallClock | undefined {
  if (steps === 0) return anchor;

  if (freq === 'MONTHLY') {
    const monthIndex = anchor.month - 1 + steps;
    const year = anchor.year + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    // `Date.UTC(y, m + 1, 0)` cho ngày cuối của tháng m.
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    if (anchor.day > lastDay) return undefined;
    return { ...anchor, year, month: month + 1 };
  }

  const days = freq === 'WEEKLY' ? steps * 7 : steps;
  const shifted = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + days));
  return {
    ...anchor,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Hai khoảng thời gian có giao nhau không; chạm đầu mút vẫn tính là giao. */
export function overlaps(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA.getTime() <= endB.getTime() && endA.getTime() >= startB.getTime();
}
