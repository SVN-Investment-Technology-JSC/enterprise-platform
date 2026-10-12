import type { CalendarOccurrence, WorkItem } from '@enterprise-platform/contracts-workspace';
import {
  buildCalendarGrid,
  buildWeekTimeline,
  dateKey,
  gridLabel,
  gridLength,
  gridStart,
  shiftAnchor,
} from './calendar-grid.model';

function occurrence(overrides: Partial<CalendarOccurrence>): CalendarOccurrence {
  return {
    eventId: 'e1',
    occurrenceDate: '2026-09-21',
    startAt: '2026-09-21T02:00:00.000Z',
    endAt: '2026-09-21T03:00:00.000Z',
    title: 'Họp tuần',
    eventType: 'meeting',
    allDay: false,
    timezone: 'Asia/Ho_Chi_Minh',
    organizerUserId: 'u1',
    isException: false,
    isRecurring: false,
    ...overrides,
  };
}

function workItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: 'CV-001',
    title: 'Việc',
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('gridStart', () => {
  it('tuần bắt đầu từ thứ Hai', () => {
    // 2026-09-24 là thứ Năm; thứ Hai của tuần đó là 2026-09-21.
    expect(dateKey(gridStart(new Date(2026, 8, 24), 'week'))).toBe('2026-09-21');
  });

  it('Chủ nhật thuộc về tuần bắt đầu thứ Hai trước đó', () => {
    // 2026-09-27 là Chủ nhật; không được nhảy sang tuần sau.
    expect(dateKey(gridStart(new Date(2026, 8, 27), 'week'))).toBe('2026-09-21');
  });

  it('lưới tháng lùi tới thứ Hai của tuần chứa ngày mùng 1', () => {
    // 2026-09-01 là thứ Ba, nên lưới bắt đầu từ 2026-08-31.
    expect(dateKey(gridStart(new Date(2026, 8, 15), 'month'))).toBe('2026-08-31');
  });
});

describe('gridLength', () => {
  it('tuần 7 ô, tháng luôn 42 ô', () => {
    expect(gridLength('week')).toBe(7);
    expect(gridLength('month')).toBe(42);
  });
});

describe('buildCalendarGrid', () => {
  const anchor = new Date(2026, 8, 24);

  it('đặt sự kiện vào đúng ô ngày', () => {
    const cells = buildCalendarGrid(anchor, 'week', [occurrence({})], []);
    const cell = cells.find((entry) => entry.date === '2026-09-21');
    expect(cell?.entries).toHaveLength(1);
    expect(cell?.entries[0]).toMatchObject({ kind: 'event', title: 'Họp tuần' });
  });

  it('sự kiện nhiều ngày hiện trên từng ngày nó chạm tới', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [
        occurrence({
          title: 'Công tác',
          startAt: '2026-09-21T01:00:00.000Z',
          endAt: '2026-09-23T10:00:00.000Z',
        }),
      ],
      [],
    );
    const hit = cells.filter((cell) => cell.entries.length > 0).map((cell) => cell.date);
    expect(hit).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
  });

  it('chỉ ngày đầu của mục nhiều ngày mới hiện giờ', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [occurrence({ startAt: '2026-09-21T01:00:00.000Z', endAt: '2026-09-22T10:00:00.000Z' })],
      [],
    );
    expect(cells.find((cell) => cell.date === '2026-09-21')?.entries[0]?.time).toBeTruthy();
    expect(cells.find((cell) => cell.date === '2026-09-22')?.entries[0]?.time).toBeUndefined();
  });

  it('hạn công việc hiện như một mục trên lưới', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [],
      [workItem({ id: 'w1', title: 'Nộp hồ sơ', plannedEnd: '2026-09-25' })],
    );
    expect(cells.find((cell) => cell.date === '2026-09-25')?.entries[0]).toMatchObject({
      kind: 'deadline',
      title: 'Hạn: Nộp hồ sơ',
      workItemId: 'w1',
    });
  });

  it('việc đã đóng không còn hiện hạn', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [],
      [workItem({ id: 'w1', status: 'done', plannedEnd: '2026-09-25' })],
    );
    expect(cells.every((cell) => cell.entries.length === 0)).toBe(true);
  });

  it('ô ngoài tháng đang xem được đánh dấu', () => {
    const cells = buildCalendarGrid(new Date(2026, 8, 15), 'month', [], []);
    expect(cells[0]).toMatchObject({ date: '2026-08-31', inCurrentMonth: false });
    expect(cells.find((cell) => cell.date === '2026-09-01')?.inCurrentMonth).toBe(true);
  });

  it('mỗi buổi của chuỗi lặp có khoá riêng', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [
        occurrence({ occurrenceDate: '2026-09-21' }),
        occurrence({
          occurrenceDate: '2026-09-22',
          startAt: '2026-09-22T02:00:00.000Z',
          endAt: '2026-09-22T03:00:00.000Z',
        }),
      ],
      [],
    );
    const keys = cells.flatMap((cell) => cell.entries.map((entry) => entry.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('shiftAnchor', () => {
  it('chế độ tuần nhảy đúng 7 ngày', () => {
    expect(dateKey(shiftAnchor(new Date(2026, 8, 24), 'week', 1))).toBe('2026-10-01');
  });

  it('chế độ tháng nhảy sang mùng 1 tháng trước', () => {
    expect(dateKey(shiftAnchor(new Date(2026, 8, 24), 'month', -1))).toBe('2026-08-01');
  });
});

describe('gridLabel', () => {
  it('nhãn tháng và nhãn tuần đọc được', () => {
    expect(gridLabel(new Date(2026, 8, 24), 'month')).toBe('Tháng 9/2026');
    expect(gridLabel(new Date(2026, 8, 24), 'week')).toBe('Tuần 21/09 – 27/09/2026');
  });
});

describe('buildWeekTimeline', () => {
  // Thứ Năm 24/09/2026; tuần chạy từ thứ Hai 21/09 tới Chủ nhật 27/09.
  const anchor = new Date(2026, 8, 24);
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).toISOString();

  it('đặt sự kiện có giờ vào đúng ngày, theo phút trong ngày', () => {
    const timeline = buildWeekTimeline(
      anchor,
      [occurrence({ startAt: at(22, 9, 30), endAt: at(22, 11) })],
      [],
    );
    expect(timeline.days).toHaveLength(7);
    expect(timeline.days[0].date).toBe('2026-09-21');
    const tuesday = timeline.days[1];
    expect(tuesday.timed).toHaveLength(1);
    expect(tuesday.timed[0]).toMatchObject({
      startMinute: 9 * 60 + 30,
      endMinute: 11 * 60,
      time: '09:30–11:00',
      column: 0,
      columns: 1,
    });
    expect(timeline.days[5].isWeekend).toBe(true);
    expect(timeline.days[6].isWeekend).toBe(true);
    expect(timeline.days[4].isWeekend).toBe(false);
  });

  it('chia cột cho các buổi chồng giờ và tách cụm khi hết chồng', () => {
    const timeline = buildWeekTimeline(
      anchor,
      [
        occurrence({ eventId: 'a', startAt: at(23, 9), endAt: at(23, 11) }),
        occurrence({ eventId: 'b', startAt: at(23, 10), endAt: at(23, 12) }),
        occurrence({ eventId: 'c', startAt: at(23, 11), endAt: at(23, 12) }),
        occurrence({ eventId: 'd', startAt: at(23, 14), endAt: at(23, 15) }),
      ],
      [],
    );
    const byId = new Map(
      timeline.days[2].timed.map((entry) => [entry.occurrence.eventId, entry]),
    );
    expect(byId.get('a')).toMatchObject({ column: 0, columns: 2 });
    expect(byId.get('b')).toMatchObject({ column: 1, columns: 2 });
    // `c` bắt đầu đúng lúc `a` kết thúc nên dùng lại cột của `a`.
    expect(byId.get('c')).toMatchObject({ column: 0, columns: 2 });
    expect(byId.get('d')).toMatchObject({ column: 0, columns: 1 });
  });

  it('đưa sự kiện cả ngày, sự kiện nhiều ngày và hạn công việc lên hàng cả ngày', () => {
    const timeline = buildWeekTimeline(
      anchor,
      [
        occurrence({ eventId: 'all', allDay: true, startAt: at(21, 0), endAt: at(21, 23, 59) }),
        occurrence({ eventId: 'trip', startAt: at(24, 8), endAt: at(25, 17) }),
      ],
      [workItem({ id: 'w1', plannedEnd: '2026-09-26' })],
    );
    expect(timeline.days[0].allDay.map((entry) => entry.occurrence?.eventId)).toEqual(['all']);
    expect(timeline.days[3].allDay.map((entry) => entry.occurrence?.eventId)).toEqual(['trip']);
    expect(timeline.days[4].allDay.map((entry) => entry.occurrence?.eventId)).toEqual(['trip']);
    expect(timeline.days[5].allDay.map((entry) => entry.kind)).toEqual(['deadline']);
    expect(timeline.days.every((day) => day.timed.length === 0)).toBe(true);
  });

  it('nới khung giờ khi có sự kiện ngoài 07–19', () => {
    expect(buildWeekTimeline(anchor, [], [])).toMatchObject({ startHour: 7, endHour: 19 });
    const timeline = buildWeekTimeline(
      anchor,
      [
        occurrence({ eventId: 'early', startAt: at(22, 5, 30), endAt: at(22, 6, 30) }),
        occurrence({ eventId: 'late', startAt: at(23, 20), endAt: at(23, 21, 15) }),
      ],
      [],
    );
    expect(timeline).toMatchObject({ startHour: 5, endHour: 22 });
  });
});
