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
