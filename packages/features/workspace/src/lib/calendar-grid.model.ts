import type { CalendarOccurrence, WorkItem } from '@enterprise-platform/contracts-workspace';

export type CalendarMode = 'week' | 'month';

/** Một ô ngày trên lưới. */
export interface CalendarCell {
  /** `YYYY-MM-DD` theo giờ trình duyệt. */
  readonly date: string;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly entries: readonly CalendarEntry[];
}

/**
 * Một mục hiển thị trên lưới.
 *
 * Gộp hai nguồn: sự kiện lịch thật, và **hạn của công việc** hiện như sự kiện.
 * Hạn công việc không phải dòng trong `calendar_events` — đổ nó vào đó sẽ tạo
 * ra hai nguồn sự thật phải đồng bộ mỗi lần ai đó dời hạn.
 */
export interface CalendarEntry {
  readonly key: string;
  readonly kind: 'event' | 'deadline';
  readonly title: string;
  /** `HH:mm`, rỗng với mục cả ngày và với hạn công việc. */
  readonly time?: string;
  readonly tone: string;
  readonly occurrence?: CalendarOccurrence;
  readonly workItemId?: string;
}

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` theo giờ trình duyệt, không phải UTC. */
export function dateKey(value: Date): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/**
 * Ngày đầu lưới.
 *
 * Tuần bắt đầu **thứ Hai**, đúng thói quen làm việc ở Việt Nam. Lưới tháng
 * kéo lùi tới thứ Hai của tuần chứa ngày mùng 1, nên luôn là bội số của 7 ô.
 */
export function gridStart(anchor: Date, mode: CalendarMode): Date {
  const base = mode === 'week' ? startOfDay(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  // `getDay()` trả 0 cho Chủ nhật; đổi sang 0 = thứ Hai.
  const weekdayFromMonday = (base.getDay() + 6) % 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - weekdayFromMonday);
}

/** Số ô của lưới: 7 với chế độ tuần, 42 với chế độ tháng. */
export function gridLength(mode: CalendarMode): number {
  // Luôn 6 hàng ở chế độ tháng: lưới cao cố định thì các tháng không nhảy
  // chiều cao khi bấm qua lại.
  return mode === 'week' ? 7 : 42;
}

/** Khoảng cần hỏi server, tính từ lưới đang hiển thị. */
export function gridRange(anchor: Date, mode: CalendarMode): { from: Date; to: Date } {
  const from = gridStart(anchor, mode);
  const to = new Date(from.getTime() + (gridLength(mode) - 1) * MS_PER_DAY);
  return { from, to: new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999) };
}

const EVENT_TONES: Record<string, string> = {
  meeting: '#2563eb',
  activity: '#15803d',
  other: '#6d28d9',
};

/**
 * Dựng lưới từ sự kiện đã khai triển cộng hạn công việc.
 *
 * Mục nhiều ngày được rải vào **từng ngày** nó chạm tới, để một chuyến công
 * tác ba ngày hiện trên cả ba ô chứ không chỉ ô đầu.
 */
export function buildCalendarGrid(
  anchor: Date,
  mode: CalendarMode,
  occurrences: readonly CalendarOccurrence[],
  workItems: readonly WorkItem[],
): CalendarCell[] {
  const start = gridStart(anchor, mode);
  const length = gridLength(mode);
  const today = dateKey(new Date());
  const currentMonth = mode === 'week' ? undefined : anchor.getMonth();

  const byDate = new Map<string, CalendarEntry[]>();
  const push = (date: string, entry: CalendarEntry) => {
    const list = byDate.get(date);
    if (list) list.push(entry);
    else byDate.set(date, [entry]);
  };

  for (const occurrence of occurrences) {
    const from = startOfDay(new Date(occurrence.startAt));
    const until = startOfDay(new Date(occurrence.endAt));
    for (
      let cursor = from;
      cursor.getTime() <= until.getTime();
      cursor = new Date(cursor.getTime() + MS_PER_DAY)
    ) {
      const isFirstDay = cursor.getTime() === from.getTime();
      push(dateKey(cursor), {
        // `eventId` không đủ làm khoá: một chuỗi lặp có nhiều buổi cùng id.
        key: `${occurrence.eventId}:${occurrence.occurrenceDate}:${dateKey(cursor)}`,
        kind: 'event',
        title: occurrence.title,
        time:
          occurrence.allDay || !isFirstDay
            ? undefined
            : new Date(occurrence.startAt).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              }),
        tone: EVENT_TONES[occurrence.eventType] ?? EVENT_TONES.other,
        occurrence,
      });
    }
  }

  for (const item of workItems) {
    if (!item.plannedEnd) continue;
    if (item.status === 'done' || item.status === 'cancelled') continue;
    push(item.plannedEnd.slice(0, 10), {
      key: `deadline:${item.id}`,
      kind: 'deadline',
      title: `Hạn: ${item.title}`,
      tone: '#b45309',
      workItemId: item.id,
    });
  }

  const cells: CalendarCell[] = [];
  for (let index = 0; index < length; index += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dateKey(day);
    cells.push({
      date: key,
      inCurrentMonth: currentMonth === undefined || day.getMonth() === currentMonth,
      isToday: key === today,
      // Mục cả ngày và hạn công việc không có giờ, xếp lên đầu ô.
      entries: (byDate.get(key) ?? []).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
    });
  }
  return cells;
}

/** Nhãn của thanh điều hướng: `Tuần 21/09 – 27/09/2026` hoặc `Tháng 9/2026`. */
export function gridLabel(anchor: Date, mode: CalendarMode): string {
  if (mode === 'month') return `Tháng ${anchor.getMonth() + 1}/${anchor.getFullYear()}`;
  const start = gridStart(anchor, 'week');
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  const short = (value: Date) =>
    `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}`;
  return `Tuần ${short(start)} – ${short(end)}/${end.getFullYear()}`;
}

/** Dời mốc neo đi một đơn vị hiển thị. */
export function shiftAnchor(anchor: Date, mode: CalendarMode, direction: -1 | 1): Date {
  return mode === 'week'
    ? new Date(anchor.getTime() + direction * 7 * MS_PER_DAY)
    : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

/** Một sự kiện có giờ trên lưới tuần, đã xếp cột cho các buổi chồng giờ. */
export interface TimedEntry {
  readonly key: string;
  readonly title: string;
  readonly time: string;
  readonly location?: string;
  readonly tone: string;
  readonly occurrence: CalendarOccurrence;
  /** Phút tính từ 00:00 của ngày, đã cắt vào trong ngày đó. */
  readonly startMinute: number;
  readonly endMinute: number;
  /** Cột của mục trong cụm chồng giờ, đếm từ 0, và số cột của cả cụm. */
  readonly column: number;
  readonly columns: number;
}

export interface TimelineDay {
  readonly date: string;
  readonly isToday: boolean;
  readonly isWeekend: boolean;
  /** Sự kiện cả ngày, sự kiện kéo qua nhiều ngày và hạn công việc. */
  readonly allDay: readonly CalendarEntry[];
  readonly timed: readonly TimedEntry[];
}

export interface WeekTimeline {
  readonly days: readonly TimelineDay[];
  /** Khung giờ hiển thị: mặc định 07–19, nới ra nếu có sự kiện ngoài khung. */
  readonly startHour: number;
  readonly endHour: number;
}

const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 19;
/** Sự kiện ngắn hơn ngần này vẫn được vẽ đủ cao để đọc được tên. */
const MIN_BLOCK_MINUTES = 30;

/**
 * Lưới giờ của một tuần: mỗi ngày một cột, sự kiện có giờ đặt theo phút.
 *
 * - Sự kiện cả ngày, sự kiện vắt qua nhiều ngày và hạn công việc nằm ở hàng
 *   "cả ngày" trên đầu cột — chúng không có một khoảng giờ để đặt vào.
 * - Các buổi chồng giờ nhau trong cùng ngày chia đều bề ngang, mỗi buổi một
 *   cột, như mọi ứng dụng lịch quen thuộc.
 */
export function buildWeekTimeline(
  anchor: Date,
  occurrences: readonly CalendarOccurrence[],
  workItems: readonly WorkItem[],
): WeekTimeline {
  const cells = buildCalendarGrid(anchor, 'week', [], workItems);
  const start = gridStart(anchor, 'week');
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;

  const timedByDate = new Map<string, Omit<TimedEntry, 'column' | 'columns'>[]>();
  const allDayByDate = new Map<string, CalendarEntry[]>();

  for (const occurrence of occurrences) {
    const begin = new Date(occurrence.startAt);
    const finish = new Date(occurrence.endAt);
    const sameDay = dateKey(begin) === dateKey(new Date(finish.getTime() - 1));
    const entry: CalendarEntry = {
      key: `${occurrence.eventId}:${occurrence.occurrenceDate}`,
      kind: 'event',
      title: occurrence.title,
      tone: EVENT_TONES[occurrence.eventType] ?? EVENT_TONES.other,
      occurrence,
    };
    if (occurrence.allDay || !sameDay) {
      // Rải vào từng ngày nó chạm tới, như lưới tháng.
      for (
        let cursor = startOfDay(begin);
        cursor.getTime() <= startOfDay(finish).getTime();
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
      ) {
        const key = dateKey(cursor);
        const list = allDayByDate.get(key) ?? [];
        list.push({ ...entry, key: `${entry.key}:${key}` });
        allDayByDate.set(key, list);
      }
      continue;
    }
    const startMinute = begin.getHours() * 60 + begin.getMinutes();
    const endMinute = Math.max(
      startMinute + MIN_BLOCK_MINUTES,
      finish.getHours() * 60 + finish.getMinutes() || 24 * 60,
    );
    startHour = Math.min(startHour, Math.floor(startMinute / 60));
    endHour = Math.max(endHour, Math.min(24, Math.ceil(endMinute / 60)));
    const key = dateKey(begin);
    const list = timedByDate.get(key) ?? [];
    list.push({
      key: entry.key,
      title: occurrence.title,
      time: `${formatClock(begin)}–${formatClock(finish)}`,
      location: occurrence.location,
      tone: entry.tone,
      occurrence,
      startMinute,
      endMinute: Math.min(endMinute, 24 * 60),
    });
    timedByDate.set(key, list);
  }

  const days: TimelineDay[] = cells.map((cell, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      date: cell.date,
      isToday: cell.isToday,
      isWeekend: day.getDay() === 0 || day.getDay() === 6,
      allDay: [...(allDayByDate.get(cell.date) ?? []), ...cell.entries],
      timed: layoutColumns(timedByDate.get(cell.date) ?? []),
    };
  });

  return { days, startHour, endHour };
}

/**
 * Xếp cột cho các buổi chồng giờ.
 *
 * Duyệt theo giờ bắt đầu, gom các buổi chạm nhau thành một cụm; trong cụm,
 * mỗi buổi lấy cột trống đầu tiên. Mọi buổi trong cụm dùng chung số cột để
 * bề ngang của chúng bằng nhau.
 */
function layoutColumns(entries: readonly Omit<TimedEntry, 'column' | 'columns'>[]): TimedEntry[] {
  const sorted = [...entries].sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute,
  );
  const result: TimedEntry[] = [];
  let cluster: { entry: Omit<TimedEntry, 'column' | 'columns'>; column: number }[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flush = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const { entry, column } of cluster) result.push({ ...entry, column, columns });
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const entry of sorted) {
    if (cluster.length > 0 && entry.startMinute >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= entry.startMinute);
    if (column < 0) {
      column = columnEnds.length;
      columnEnds.push(entry.endMinute);
    } else {
      columnEnds[column] = entry.endMinute;
    }
    cluster.push({ entry, column });
    clusterEnd = Math.max(clusterEnd, entry.endMinute);
  }
  flush();
  return result;
}

function formatClock(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}
